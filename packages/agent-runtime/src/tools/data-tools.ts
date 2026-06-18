import { createTool } from "@mastra/core/tools";
import type { DataGateway, SchemaSummary, SqlExecutionResult } from "@open-data-agent/data-gateway";
import { z } from "zod";

import { createActivityDelta, createActivitySnapshot, createCustomEvent } from "../events.js";
import type { AgentRunContext, AgUiEventEmitter } from "../types.js";

export type ToolRegistry = {
  inspectSchema(input?: { datasource_id?: string; table_names?: string[] }): Promise<SchemaSummary>;
  mastraTools: {
    inspect_schema: ReturnType<typeof createTool>;
    run_sql_readonly: ReturnType<typeof createTool>;
  };
  runSqlReadonly(input: { datasource_id?: string; sql: string; limit?: number; timeout_ms?: number }): Promise<SqlExecutionResult>;
  state: {
    artifact_ids: string[];
    schema_inspected_datasource_ids: Set<string>;
    sql_execution_count: number;
  };
};

type CreateDataAgentToolRegistryInput = {
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  runContext: AgentRunContext;
};

export const createDataAgentToolRegistry = (input: CreateDataAgentToolRegistryInput): ToolRegistry => {
  const state = {
    artifact_ids: [] as string[],
    schema_inspected_datasource_ids: new Set<string>(),
    sql_execution_count: 0
  };

  const inspectSchema = async (toolInput: { datasource_id?: string; table_names?: string[] } = {}): Promise<SchemaSummary> => {
    const datasourceId = resolveDatasourceId(input.runContext, toolInput.datasource_id);
    const stepId = "schema";
    input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [{ index: 0, status: "running" }]));
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
      state.schema_inspected_datasource_ids.add(datasourceId);
      input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [{ index: 0, status: "completed" }]));
      input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
        step_id: stepId,
        title: "检查数据源 schema",
        kind: "schema",
        tool_name: "inspect_schema",
        status: "completed",
        output_type: "json",
        content: result
      }));
      return result;
    } catch (error) {
      input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [{ index: 0, status: "failed" }]));
      input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
        step_id: stepId,
        title: "检查数据源 schema",
        kind: "schema",
        tool_name: "inspect_schema",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown schema inspection error"
      }));
      throw error;
    }
  };

  const runSqlReadonly = async (toolInput: {
    datasource_id?: string;
    sql: string;
    limit?: number;
    timeout_ms?: number;
  }): Promise<SqlExecutionResult> => {
    const datasourceId = resolveDatasourceId(input.runContext, toolInput.datasource_id);

    if (!state.schema_inspected_datasource_ids.has(datasourceId)) {
      throw new Error("SCHEMA_REQUIRED_BEFORE_SQL");
    }

    state.sql_execution_count += 1;

    if (state.sql_execution_count > 3) {
      throw new Error("SQL_EXECUTION_LIMIT_EXCEEDED");
    }

    const stepId = `sql-${state.sql_execution_count}`;
    input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [{ index: 1, status: "running" }]));
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: stepId,
      title: "执行只读 SQL",
      kind: "sql",
      tool_name: "run_sql_readonly",
      status: "running",
      datasource_id: datasourceId,
      sql: toolInput.sql,
      input: { ...toolInput, datasource_id: datasourceId }
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

      input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [
        { index: 1, status: "completed" },
        { index: 2, status: "running" }
      ]));
      input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
        step_id: stepId,
        title: "执行只读 SQL",
        kind: "sql",
        tool_name: "run_sql_readonly",
        status: "completed",
        output_type: "table",
        content: {
          columns: result.columns,
          rows: result.rows,
          row_count: result.row_count,
          audit_log_id: result.audit_log_id,
          artifact_id: result.artifact_id
        }
      }));
      input.emitter.emit(createCustomEvent("sql_audit", {
        audit_log_id: result.audit_log_id,
        datasource_id: datasourceId,
        status: "succeeded",
        row_count: result.row_count,
        elapsed_ms: result.elapsed_ms
      }));

      if (result.artifact) {
        input.emitter.emit(createCustomEvent("artifact", result.artifact));
      }

      return result;
    } catch (error) {
      input.emitter.emit(createPlanTaskStatusDelta(input.runContext, [{ index: 1, status: "failed" }]));
      input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
        step_id: stepId,
        title: "执行只读 SQL",
        kind: "sql",
        tool_name: "run_sql_readonly",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown SQL execution error"
      }));
      throw error;
    }
  };

  return {
    inspectSchema,
    mastraTools: {
      inspect_schema: createTool({
        id: "inspect_schema",
        description: "Inspect the selected datasource schema before writing SQL.",
        inputSchema: z.object({
          datasource_id: z.string().optional(),
          table_names: z.array(z.string()).optional()
        }),
        outputSchema: z.object({
          datasource_id: z.string(),
          tables: z.array(
            z.object({
              name: z.string(),
              columns: z.array(
                z.object({
                  name: z.string(),
                  type: z.string(),
                  nullable: z.boolean().optional()
                })
              )
            })
          )
        }),
        execute: async (toolInput) =>
          inspectSchema({
            ...(toolInput.datasource_id ? { datasource_id: toolInput.datasource_id } : {}),
            ...(toolInput.table_names ? { table_names: toolInput.table_names } : {})
          })
      }),
      run_sql_readonly: createTool({
        id: "run_sql_readonly",
        description: "Execute a read-only SELECT/WITH SQL query through the Data Gateway.",
        inputSchema: z.object({
          datasource_id: z.string().optional(),
          sql: z.string(),
          limit: z.number().int().positive().max(1000).optional(),
          timeout_ms: z.number().int().positive().max(30000).optional()
        }),
        outputSchema: z.object({
          columns: z.array(z.string()),
          rows: z.array(z.array(z.unknown())),
          row_count: z.number(),
          audit_log_id: z.string(),
          elapsed_ms: z.number(),
          artifact_id: z.string().optional()
        }),
        execute: async (toolInput) =>
          runSqlReadonly({
            sql: toolInput.sql,
            ...(toolInput.datasource_id ? { datasource_id: toolInput.datasource_id } : {}),
            ...(toolInput.limit ? { limit: toolInput.limit } : {}),
            ...(toolInput.timeout_ms ? { timeout_ms: toolInput.timeout_ms } : {})
          })
      })
    },
    runSqlReadonly,
    state
  };
};

const resolveDatasourceId = (context: AgentRunContext, requestedDatasourceId: string | undefined): string => {
  const datasourceId = requestedDatasourceId ?? context.selected_datasource_id;

  if (datasourceId !== context.selected_datasource_id) {
    throw new Error("DATASOURCE_NOT_SELECTED");
  }

  return datasourceId;
};

const createPlanTaskStatusDelta = (
  context: AgentRunContext,
  updates: Array<{ index: number; status: "pending" | "running" | "completed" | "failed" }>
) =>
  createActivityDelta(
    context,
    "PLAN",
    updates.map((update) => ({
      op: "replace",
      path: `/tasks/${update.index}/status`,
      value: update.status
    }))
  );
