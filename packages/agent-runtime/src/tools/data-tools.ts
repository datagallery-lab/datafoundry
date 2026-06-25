import { createTool } from "@mastra/core/tools";
import type { DataGateway, SchemaSummary, SqlExecutionResult } from "@open-data-agent/data-gateway";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ContextPackage } from "../context/inventory/context-package.js";
import { truncateContextText } from "../context/inventory/context-text.js";
import { SQL_MAX_SQL_CHARS } from "../context/inventory/context-limits.js";
import { toolObservationActivityFromPackage } from "../context/tool-observation/tool-observation-projection-items.js";
import { createActivitySnapshot, createArtifactEvent, createCustomEvent } from "../events.js";
import { SQL_MAX_EXECUTION_COUNT } from "../runtime-limits.js";
import type { AgentRunContext, AgUiEventEmitter } from "../types.js";

type SchemaCapability = {
  datasource_id: string;
  schema_id: string;
};

type InspectSchemaResult = SchemaSummary & {
  schema_id: string;
};

type RawSqlToolResult = {
  result: SqlExecutionResult;
  sql: string;
};

type GovernedResultInput = {
  contextPackage: ContextPackage;
  rawResult: unknown;
  toolName: string;
};

export type ToolRegistry = {
  inspectSchema(input?: { datasource_id?: string; table_names?: string[] }): Promise<InspectSchemaResult>;
  listDataSources(input?: { enabled_only?: boolean }): Promise<unknown>;
  mastraTools: {
    inspect_schema: ReturnType<typeof createTool>;
    list_data_sources: ReturnType<typeof createTool>;
    preview_table: ReturnType<typeof createTool>;
    run_sql_readonly: ReturnType<typeof createTool>;
  };
  onGovernedResult(input: GovernedResultInput): void;
  onGovernanceError(input: { error: unknown; rawResult: unknown; toolName: string }): void;
  previewTable(input: { schema_id: string; table: string; limit?: number }): Promise<unknown>;
  runSqlReadonly(input: {
    schema_id: string;
    sql: string;
    limit?: number;
    timeout_ms?: number;
  }): Promise<RawSqlToolResult>;
  state: {
    artifact_ids: string[];
    schema_capabilities: Map<string, SchemaCapability>;
    sql_execution_count: number;
    sql_execution_count_by_datasource: Map<string, number>;
  };
};

type CreateDataAgentToolRegistryInput = {
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  runContext: AgentRunContext;
};

/** Create the run-local data tool registry and concurrency-safe execution state. */
export const createDataAgentToolRegistry = (input: CreateDataAgentToolRegistryInput): ToolRegistry => {
  const state = {
    artifact_ids: [] as string[],
    schema_capabilities: new Map<string, SchemaCapability>(),
    sql_execution_count: 0,
    sql_execution_count_by_datasource: new Map<string, number>()
  };
  const resultMetadata = new WeakMap<object, { datasourceId: string; stepId: string }>();

  const listDataSources = async (toolInput: { enabled_only?: boolean } = {}): Promise<unknown> => {
    const allowedIds = new Set(input.runContext.enabled_datasource_ids);
    const results = await input.dataGateway.listDataSources({
      user_id: input.runContext.user_id,
      ...(toolInput.enabled_only !== undefined ? { enabled_only: toolInput.enabled_only } : {})
    });
    return { datasources: results.filter((datasource) => allowedIds.has(datasource.id)) };
  };

  const inspectSchema = async (
    toolInput: { datasource_id?: string; table_names?: string[] } = {}
  ): Promise<InspectSchemaResult> => {
    const datasourceId = resolveDatasourceId(input.runContext, toolInput.datasource_id);
    const stepId = `schema-${randomUUID()}`;
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: stepId,
      title: "检查数据源 schema",
      kind: "schema",
      tool_name: "inspect_schema",
      status: "running",
      datasource_id: datasourceId,
      input: toolInput
    }));

    try {
      const result = await input.dataGateway.inspectSchema({
        user_id: input.runContext.user_id,
        datasource_id: datasourceId,
        ...(toolInput.table_names ? { table_names: toolInput.table_names } : {})
      });
      const schema_id = `schema_${randomUUID()}`;
      state.schema_capabilities.set(schema_id, { datasource_id: datasourceId, schema_id });
      const rawResult = { ...result, schema_id };
      resultMetadata.set(rawResult, { datasourceId, stepId });
      return rawResult;
    } catch (error) {
      emitFailedStep(input, stepId, "inspect_schema", "检查数据源 schema", error);
      throw error;
    }
  };

  const runSqlReadonly = async (toolInput: {
    schema_id: string;
    sql: string;
    limit?: number;
    timeout_ms?: number;
  }): Promise<RawSqlToolResult> => {
    const capability = state.schema_capabilities.get(toolInput.schema_id);
    if (!capability) {
      throw new Error("SCHEMA_REQUIRED_BEFORE_SQL");
    }
    const datasourceId = capability.datasource_id;

    state.sql_execution_count += 1;
    const datasourceCount = (state.sql_execution_count_by_datasource.get(datasourceId) ?? 0) + 1;
    state.sql_execution_count_by_datasource.set(datasourceId, datasourceCount);
    if (state.sql_execution_count > SQL_MAX_EXECUTION_COUNT) {
      throw new Error("SQL_EXECUTION_LIMIT_EXCEEDED");
    }

    const stepId = `sql-${state.sql_execution_count}`;
    const sqlActivityPreview = truncateContextText(toolInput.sql, SQL_MAX_SQL_CHARS);
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: stepId,
      title: "执行只读 SQL",
      kind: "sql",
      tool_name: "run_sql_readonly",
      status: "running",
      datasource_id: datasourceId,
      sql: sqlActivityPreview,
      input: { ...toolInput, datasource_id: datasourceId, sql: sqlActivityPreview }
    }));

    try {
      const result = await input.dataGateway.runSqlReadonly({
        user_id: input.runContext.user_id,
        run_id: input.runContext.run_id,
        datasource_id: datasourceId,
        sql: toolInput.sql,
        ...(toolInput.limit ? { limit: toolInput.limit } : {}),
        ...(toolInput.timeout_ms ? { timeout_ms: toolInput.timeout_ms } : {})
      });
      if (result.artifact_id) {
        state.artifact_ids.push(result.artifact_id);
      }
      emitSqlReferences(input, datasourceId, result);
      const rawResult = { result, sql: toolInput.sql };
      resultMetadata.set(rawResult, { datasourceId, stepId });
      return rawResult;
    } catch (error) {
      emitFailedStep(input, stepId, "run_sql_readonly", "执行只读 SQL", error);
      throw error;
    }
  };

  const previewTable = async (toolInput: {
    schema_id: string;
    table: string;
    limit?: number;
  }): Promise<unknown> => {
    const capability = state.schema_capabilities.get(toolInput.schema_id);
    if (!capability) {
      throw new Error("SCHEMA_REQUIRED_BEFORE_PREVIEW");
    }
    const result = await input.dataGateway.previewTable({
      user_id: input.runContext.user_id,
      datasource_id: capability.datasource_id,
      table: toolInput.table,
      ...(toolInput.limit ? { limit: toolInput.limit } : {})
    });
    return { datasource_id: capability.datasource_id, table: toolInput.table, ...result };
  };

  const onGovernedResult = (governed: GovernedResultInput): void => {
    if (!isObject(governed.rawResult)) {
      return;
    }
    const metadata = resultMetadata.get(governed.rawResult);
    if (!metadata) {
      return;
    }
    const isSchema = governed.toolName === "inspect_schema";
    const isSql = governed.toolName === "run_sql_readonly";
    if (!isSchema && !isSql) {
      return;
    }
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: metadata.stepId,
      title: isSchema ? "检查数据源 schema" : "执行只读 SQL",
      kind: isSchema ? "schema" : "sql",
      tool_name: governed.toolName,
      status: "completed",
      output_type: isSchema ? "json" : "table",
      content: toolObservationActivityFromPackage(governed.contextPackage)
    }));
  };

  const onGovernanceError = (failed: { error: unknown; rawResult: unknown; toolName: string }): void => {
    if (!isObject(failed.rawResult)) {
      return;
    }
    const metadata = resultMetadata.get(failed.rawResult);
    if (!metadata || (failed.toolName !== "inspect_schema" && failed.toolName !== "run_sql_readonly")) {
      return;
    }
    emitFailedStep(
      input,
      metadata.stepId,
      failed.toolName,
      failed.toolName === "inspect_schema" ? "检查数据源 schema" : "执行只读 SQL",
      failed.error
    );
  };

  return {
    inspectSchema,
    listDataSources,
    mastraTools: createMastraDataTools({ inspectSchema, listDataSources, previewTable, runSqlReadonly }),
    onGovernanceError,
    onGovernedResult,
    previewTable,
    runSqlReadonly,
    state
  };
};

type DataToolExecutors = Pick<ToolRegistry, "inspectSchema" | "listDataSources" | "previewTable" | "runSqlReadonly">;

const createMastraDataTools = (executors: DataToolExecutors): ToolRegistry["mastraTools"] => ({
  list_data_sources: createTool({
    id: "list_data_sources",
    description: "List datasources enabled for this run.",
    inputSchema: z.object({ enabled_only: z.boolean().optional() }),
    execute: (toolInput) => executors.listDataSources({
      ...(toolInput.enabled_only !== undefined ? { enabled_only: toolInput.enabled_only } : {})
    })
  }),
  inspect_schema: createTool({
    id: "inspect_schema",
    description:
      "Inspect a datasource schema and return a run-local schema_id that must precede SQL or preview calls.",
    inputSchema: z.object({
      datasource_id: z.string().optional(),
      table_names: z.array(z.string()).optional()
    }),
    execute: (toolInput) => executors.inspectSchema({
      ...(toolInput.datasource_id ? { datasource_id: toolInput.datasource_id } : {}),
      ...(toolInput.table_names ? { table_names: toolInput.table_names } : {})
    })
  }),
  preview_table: createTool({
    id: "preview_table",
    description: "Preview a table using a schema_id returned by inspect_schema in this run.",
    inputSchema: z.object({
      schema_id: z.string(),
      table: z.string().min(1),
      limit: z.number().int().positive().optional()
    }),
    execute: (toolInput) => executors.previewTable({
      schema_id: toolInput.schema_id,
      table: toolInput.table,
      ...(toolInput.limit ? { limit: toolInput.limit } : {})
    })
  }),
  run_sql_readonly: createTool({
    id: "run_sql_readonly",
    description: "Execute one read-only SELECT/WITH query using a schema_id returned in this run.",
    inputSchema: z.object({
      schema_id: z.string(),
      sql: z.string(),
      limit: z.number().int().positive().max(1000).optional(),
      timeout_ms: z.number().int().positive().max(30000).optional()
    }),
    execute: (toolInput) => executors.runSqlReadonly({
      schema_id: toolInput.schema_id,
      sql: toolInput.sql,
      ...(toolInput.limit ? { limit: toolInput.limit } : {}),
      ...(toolInput.timeout_ms ? { timeout_ms: toolInput.timeout_ms } : {})
    })
  })
});

const emitSqlReferences = (
  input: CreateDataAgentToolRegistryInput,
  datasourceId: string,
  result: SqlExecutionResult
): void => {
  input.emitter.emit(createCustomEvent("sql_audit", {
    audit_log_id: result.audit_log_id,
    datasource_id: datasourceId,
    status: "succeeded",
    row_count: result.row_count,
    elapsed_ms: result.elapsed_ms
  }));
  if (result.artifact) {
    input.emitter.emit(createArtifactEvent(result.artifact));
  }
};

const emitFailedStep = (
  input: CreateDataAgentToolRegistryInput,
  stepId: string,
  toolName: string,
  title: string,
  error: unknown
): void => {
  input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
    step_id: stepId,
    title,
    kind: toolName === "inspect_schema" ? "schema" : "sql",
    tool_name: toolName,
    status: "failed",
    error_message: error instanceof Error ? error.message : `Unknown ${toolName} error`
  }));
};

const resolveDatasourceId = (context: AgentRunContext, requestedDatasourceId: string | undefined): string => {
  const datasourceId = requestedDatasourceId ?? context.selected_datasource_id;
  if (!context.enabled_datasource_ids.includes(datasourceId)) {
    throw new Error("DATASOURCE_NOT_SELECTED");
  }
  return datasourceId;
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
