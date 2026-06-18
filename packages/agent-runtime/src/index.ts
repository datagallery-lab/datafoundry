import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import type {
  RunEventEnvelope,
  StepDonePayload,
  StepMetaPayload,
  StepOutputPayload,
  StepStartPayload
} from "@open-data-agent/contracts";
import type { DataGateway, SchemaSummary, SqlExecutionResult } from "@open-data-agent/data-gateway";
import { createModelProvider, type ModelProvider } from "@open-data-agent/providers";
import { z } from "zod";

export type AgentRunContext = {
  user_id: string;
  session_id: string;
  run_id: string;
  user_input: string;
  chat_mode: string;
  selected_datasource_id: string;
  model_name?: string;
};

export type AgentRunContextInput = AgentRunContext;

export interface RunEventEmitter {
  create<TPayload>(type: RunEventEnvelope<TPayload>["type"], payload: TPayload): RunEventEnvelope;
}

export type CreateDataAgentInput = {
  dataGateway: DataGateway;
  emitter: RunEventEmitter;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
};

export const createDataAgent = (input: CreateDataAgentInput): { agent: Agent; registry: ToolRegistry } => {
  const registry = createDataAgentToolRegistry({
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext
  });
  const agent = new Agent({
    id: "data-agent",
    name: "Data Agent",
    instructions: buildAgentInstructions(input.runContext),
    model: input.modelProvider.model as never,
    tools: registry.mastraTools,
    defaultOptions: {
      maxSteps: 6,
      providerOptions: {
        openai: {
          systemMessageMode: "system"
        }
      }
    }
  });

  return { agent, registry };
};

export const createDataAgentRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }

  return input;
};

export const createModelProviderFromEnv = (env: Record<string, string | undefined>): ModelProvider =>
  createModelProvider(env);

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

type CreateToolRegistryInput = {
  dataGateway: DataGateway;
  emitter: RunEventEmitter;
  runContext: AgentRunContext;
};

export const createDataAgentToolRegistry = (input: CreateToolRegistryInput): ToolRegistry => {
  const state = {
    artifact_ids: [] as string[],
    schema_inspected_datasource_ids: new Set<string>(),
    sql_execution_count: 0
  };

  const inspectSchema = async (toolInput: { datasource_id?: string; table_names?: string[] } = {}): Promise<SchemaSummary> => {
    const datasourceId = resolveDatasourceId(input.runContext, toolInput.datasource_id);
    const stepId = "schema";
    input.emitter.create<StepStartPayload>("step.start", {
      step_id: stepId,
      title: "检查数据源 schema",
      kind: "schema",
      tool_name: "inspect_schema"
    });
    input.emitter.create<StepMetaPayload>("step.meta", {
      step_id: stepId,
      status: "running",
      datasource_id: datasourceId,
      input: toolInput
    });

    try {
      const result = await input.dataGateway.inspectSchema({
        user_id: input.runContext.user_id,
        datasource_id: datasourceId,
        ...(toolInput.table_names ? { table_names: toolInput.table_names } : {})
      });
      state.schema_inspected_datasource_ids.add(datasourceId);
      input.emitter.create<StepOutputPayload>("step.output", {
        step_id: stepId,
        output_type: "json",
        content: result
      });
      input.emitter.create<StepDonePayload>("step.done", {
        step_id: stepId,
        status: "completed"
      });
      return result;
    } catch (error) {
      input.emitter.create<StepDonePayload>("step.done", {
        step_id: stepId,
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown schema inspection error"
      });
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
    input.emitter.create<StepStartPayload>("step.start", {
      step_id: stepId,
      title: "执行只读 SQL",
      kind: "sql",
      tool_name: "run_sql_readonly"
    });
    input.emitter.create<StepMetaPayload>("step.meta", {
      step_id: stepId,
      status: "running",
      datasource_id: datasourceId,
      sql: toolInput.sql,
      input: { ...toolInput, datasource_id: datasourceId }
    });

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

      input.emitter.create<StepOutputPayload>("step.output", {
        step_id: stepId,
        output_type: "table",
        content: {
          columns: result.columns,
          rows: result.rows,
          row_count: result.row_count,
          audit_log_id: result.audit_log_id,
          artifact_id: result.artifact_id
        }
      });
      input.emitter.create<StepDonePayload>("step.done", {
        step_id: stepId,
        status: "completed",
        artifact_ids: result.artifact_id ? [result.artifact_id] : []
      });
      return result;
    } catch (error) {
      input.emitter.create<StepDonePayload>("step.done", {
        step_id: stepId,
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown SQL execution error"
      });
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

const buildAgentInstructions = (context: AgentRunContext): string => `
You are a read-only data analysis ReAct agent.

You can only access data through tools. Never invent schema, rows, or SQL execution results.
The selected datasource_id is "${context.selected_datasource_id}". Use only this datasource.

Required policy:
1. For any data analysis request, call inspect_schema before writing SQL.
2. After observing schema, generate a SELECT or WITH SQL query.
3. Execute SQL only through run_sql_readonly.
4. If schema or SQL execution fails, explain the failure. Do not fabricate results.
5. Do not reveal credentials, datasource config, or internal environment values.
`;
