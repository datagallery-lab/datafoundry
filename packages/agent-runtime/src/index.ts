import { Agent } from "@mastra/core/agent";
import type { DataGateway } from "@open-data-agent/data-gateway";
import { createModelProvider, type ModelProvider } from "@open-data-agent/providers";

import { createDataAgentToolRegistry, type ToolRegistry } from "./tools/data-tools.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export { createActivityDelta, createPlanActivityEvent } from "./events.js";
export { createDataAgentToolRegistry, type ToolRegistry } from "./tools/data-tools.js";

export type CreateDataAgentInput = {
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
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
