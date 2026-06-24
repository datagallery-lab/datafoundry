import { Agent } from "@mastra/core/agent";
import {
  askUserTool,
  submitPlanTool,
  taskCheckTool,
  taskCompleteTool,
  taskUpdateTool,
  taskWriteTool
} from "@mastra/core/harness";
import { Mastra } from "@mastra/core/mastra";
import { createWorkspaceTools } from "@mastra/core/workspace";
import type { Message } from "@ag-ui/core";
import type { DataGateway } from "@open-data-agent/data-gateway";
import type { KnowledgeService } from "@open-data-agent/knowledge";
import {
  createModelProvider,
  createModelProviderFromConfig,
  type ChatProviderConfig,
  type ModelProvider
} from "@open-data-agent/providers";

import { AGENT_MAX_STEPS, SQL_MAX_EXECUTION_COUNT } from "./runtime-limits.js";
import { SQL_MAX_SQL_CHARS } from "./context/inventory/context-limits.js";
import { createToolObservationBoundary } from "./context/tool-observation/tool-observation-boundary.js";
import {
  createMastraContextProcessorBoundary
} from "./context/protocol/mastra/mastra-context-processor-boundary.js";
import { ToolObservationDispatcher } from "./context/tool-observation/tool-observation-dispatcher.js";
import { createAgUiContextEventSink } from "./context/protocol/ag-ui/ag-ui-context-event-sink.js";
import {
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
import { GoalRuntimeAdapter, type GoalRequest } from "./memory/goal-runtime-adapter.js";
import { createDataAgentToolRegistry } from "./tools/data-tools.js";
import { GovernedToolFactory } from "./tools/governed-tool-factory.js";
import { createRunWorkspace } from "./tools/workspace-factory.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
import { createCustomEvent } from "./events.js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export const STATIC_AGENT_TOOL_NAMES = [
  "ask_user",
  "edit_file",
  "execute_command",
  "file_stat",
  "grep",
  "inspect_schema",
  "list_data_sources",
  "list_files",
  "mkdir",
  "preview_table",
  "read_file",
  "retrieve_knowledge",
  "run_sql_readonly",
  "submit_plan",
  "task_check",
  "task_complete",
  "task_update",
  "task_write",
  "write_file"
] as const;
export {
  ContextTokenCounter,
  type ContextTokenCounterOptions
} from "./context/policy/context-token-counter.js";
export { createActivityDelta, createActivitySnapshot, createCustomEvent } from "./events.js";
export {
  AGENT_MEMORY_MODES,
  createAgentMemoryRuntime,
  createTaskStateRuntime,
  parseAgentMemoryMode,
  type AgentMemoryMode,
  type AgentMemoryRuntime,
  type AgentMemoryRuntimeOptions,
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
export { GoalRuntimeAdapter, type GoalRequest, type GoalSnapshot } from "./memory/goal-runtime-adapter.js";
export {
  CONVERSATION_WORKING_MEMORY_CONFIG,
  CONVERSATION_WORKING_MEMORY_TEMPLATE,
  MastraConversationMemoryBridge,
  createMastraConversationMemoryBridge,
  formatConversationProjection,
  type ConversationMemoryBridge,
  type ConversationMemoryProjection
} from "./memory/conversation-memory-bridge.js";

export type AgentLongTermMemoryRecord = {
  confidence: number;
  content_text: string;
  datasource_id?: string;
  id: string;
  kind: string;
  scope: "datasource" | "session" | "user";
  session_id?: string;
  source?: string;
  source_run_id?: string;
};

export type CreateDataAgentInput = {
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  knowledgeService?: KnowledgeService;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  mcpToolNames?: string[];
  skillPolicy?: {
    instructions: string;
    allowedTools?: string[];
  };
  taskStateRuntime?: TaskStateRuntime;
  longTermMemory?: {
    records: AgentLongTermMemoryRecord[];
    maxChars?: number;
  };
  messages: Message[];
  modelSettings?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  goal?: GoalRequest;
  /**
   * 工作区根目录（调用方注入）。未提供时回落到 WORKSPACE_ROOT，再回落到系统 temp。
   * 每个 run 在该目录下按 {user_id}/{session_id}/{run_id} 建立隔离子目录。
   * 留空即按默认策略隔离，不影响 workspace 工具的可用性。
   */
  workspaceRoot?: string | undefined;
};

export const createDataAgent = async (
  input: CreateDataAgentInput
): Promise<{
  agent: Agent;
  governedMessages: Message[];
  goalRuntime?: GoalRuntimeAdapter;
  commandExecutionEnabled: boolean;
  isolation: "bwrap" | "none" | "seatbelt";
  workspaceDir: string;
  destroyWorkspace(): Promise<void>;
}> => {
  const toolObservationBoundary = createToolObservationBoundary({
    identity: {
      resourceId: input.runContext.user_id,
      sessionId: input.runContext.session_id,
      runId: input.runContext.run_id
    },
    includeKnowledge: Boolean(input.knowledgeService),
    ...(input.mcpToolNames?.length ? { mcpToolNames: input.mcpToolNames } : {})
  });
  const contextRunState = toolObservationBoundary.contextRunState;

  // 绑定到本次 run 的工作区：LocalFilesystem + LocalSandbox（macOS seatbelt / Linux bubblewrap 隔离）。
  // createDataAgent 每次 run 都调用，直接闭包捕获 runContext，不依赖下游 requestContext 注入。
  const runWorkspace = createRunWorkspace({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });

  const governedMessages = sanitizeIngressMessages(input.messages);

  const registry = createDataAgentToolRegistry({
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext
  });
  const dispatcher = new ToolObservationDispatcher(toolObservationBoundary.packager, {
    modelName: input.runContext.model_name,
    resourceId: input.runContext.user_id,
    runId: input.runContext.run_id,
    sessionId: input.runContext.session_id
  });
  const governedToolFactory = new GovernedToolFactory(
    dispatcher,
    registry.onGovernedResult,
    registry.onGovernanceError
  );
  const contextEventSink = createAgUiContextEventSink(input.emitter);
  const mastraContextProcessors = createMastraContextProcessorBoundary({
    dispatcher,
    eventSink: contextEventSink,
    ...(input.longTermMemory ? { longTermMemory: input.longTermMemory } : {}),
    modelName: input.runContext.model_name,
    runScope: {
      runId: input.runContext.run_id,
      sessionId: input.runContext.session_id,
      userId: input.runContext.user_id
    },
    runState: contextRunState,
    ...(input.taskStateRuntime ? { taskStateRuntime: input.taskStateRuntime } : {})
  });
  const taskTools = input.taskStateRuntime
    ? {
        task_check: taskCheckTool,
        task_complete: taskCompleteTool,
        task_update: taskUpdateTool,
        task_write: taskWriteTool
      }
    : {};
  const collaborationTools = input.taskStateRuntime
    ? {
        ask_user: askUserTool,
        submit_plan: submitPlanTool
      }
    : {};
  const knowledgeTools = input.knowledgeService
    ? {
        retrieve_knowledge: createTool({
          id: "retrieve_knowledge",
          description: "Retrieve relevant chunks from a knowledge base enabled for this run.",
          inputSchema: z.object({
            collection_id: z.string().min(1),
            query: z.string().min(1),
            top_k: z.number().int().min(1).max(20).optional()
          }),
          execute: async (toolInput) => {
            if (!input.runContext.enabled_knowledge_ids?.includes(toolInput.collection_id)) {
              throw new Error(`KNOWLEDGE_BASE_NOT_ENABLED:${toolInput.collection_id}`);
            }
            return {
              collection_id: toolInput.collection_id,
              chunks: await input.knowledgeService?.retrieve({
                user_id: input.runContext.user_id,
                collection_id: toolInput.collection_id,
                query: toolInput.query,
                ...(toolInput.top_k ? { top_k: toolInput.top_k } : {})
              }) ?? []
            };
          }
        })
      }
    : {};
  const workspaceTools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  runWorkspace.workspace.setToolsConfig({ enabled: false });
  const availableTools = {
    ...registry.mastraTools,
    ...knowledgeTools,
    ...taskTools,
    ...collaborationTools,
    ...workspaceTools
  };
  const selectedTools = input.skillPolicy?.allowedTools
    ? Object.fromEntries(Object.entries(availableTools).filter(([name]) => input.skillPolicy?.allowedTools?.includes(name)))
    : availableTools;
  const tools = governedToolFactory.governTools(selectedTools);
  const agent = new Agent({
    id: "data-agent",
    name: "Data Agent",
    instructions: buildAgentInstructions({
      runContext: input.runContext,
      commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
      collaborationToolsEnabled: Boolean(input.taskStateRuntime),
      ...(input.skillPolicy?.instructions ? { skillInstructions: input.skillPolicy.instructions } : {}),
      taskToolsEnabled: Boolean(input.taskStateRuntime),
      toolNames: Object.keys(selectedTools)
    }),
    model: input.modelProvider.model as never,
    tools,
    ...(input.taskStateRuntime ? { memory: input.taskStateRuntime.memory } : {}),
    ...(input.goal ? { goal: { judge: input.modelProvider.model as never, maxRuns: input.goal.maxRuns ?? 10 } } : {}),
    // Workspace remains attached for execution context, while auto-injection is disabled above.
    // Explicitly created tools are wrapped by the same governed execution boundary as every other tool.
    workspace: runWorkspace.workspace,
    inputProcessors: mastraContextProcessors.inputProcessors,
    outputProcessors: mastraContextProcessors.outputProcessors,
    defaultOptions: {
      maxSteps: AGENT_MAX_STEPS,
      ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
      providerOptions: {
        openai: {
          systemMessageMode: "system"
        }
      }
    }
  });
  const mastra = input.taskStateRuntime
    ? new Mastra({
        agents: { dataAgent: agent },
        storage: input.taskStateRuntime.storage
      })
    : undefined;
  let goalRuntime: GoalRuntimeAdapter | undefined;
  if (input.goal && mastra) {
    goalRuntime = new GoalRuntimeAdapter(agent, input.runContext.user_id, input.runContext.session_id);
    const objective = await goalRuntime.setObjective(input.goal);
    input.emitter.emit(createCustomEvent("goal.updated", {
      goal: objective,
      source: "mastra-native-goal"
    }));
  }

  return {
    agent,
    commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
    destroyWorkspace: () => runWorkspace.workspace.destroy(),
    governedMessages,
    ...(goalRuntime ? { goalRuntime } : {}),
    isolation: runWorkspace.isolation,
    workspaceDir: runWorkspace.runDir
  };
};

export const createDataAgentRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }
  if (!input.enabled_datasource_ids.includes(input.selected_datasource_id)) {
    throw new Error("ACTIVE_DATASOURCE_NOT_ENABLED");
  }

  return input;
};

export const createModelProviderFromEnv = (env: Record<string, string | undefined>): ModelProvider =>
  createModelProvider(env);

/** Create a model provider from a resolved persisted profile. */
export const createModelProviderFromProfile = (config: ChatProviderConfig): ModelProvider =>
  createModelProviderFromConfig(config);

/** Execute a minimal real model call through the same Mastra model boundary used by production runs. */
export const probeModelProvider = async (
  provider: Exclude<ModelProvider, { kind: "mock" }>,
  timeoutMs = 30000
): Promise<{ model: string; text: string }> => {
  const agent = new Agent({
    id: "model-profile-probe",
    name: "Model Profile Probe",
    instructions: "Reply with OK only.",
    model: provider.model as never
  });
  const output = await agent.generate("Reply with OK only.", {
    abortSignal: AbortSignal.timeout(timeoutMs),
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 16, temperature: 0 }
  });
  return { model: provider.model_name, text: output.text.trim() };
};

type AgentInstructionsInput = {
  runContext: AgentRunContext;
  /** execute_command 工具是否启用（由沙箱隔离可用性与 env 决定）。 */
  commandExecutionEnabled: boolean;
  collaborationToolsEnabled: boolean;
  skillInstructions?: string;
  /** builtin task_* 工具是否启用（取决于是否注入 taskStateRuntime）。 */
  taskToolsEnabled: boolean;
  toolNames: string[];
};

const buildAgentInstructions = (input: AgentInstructionsInput): string => {
  const { runContext: context, collaborationToolsEnabled, commandExecutionEnabled, taskToolsEnabled } = input;
  const enabled = (name: string): boolean => input.toolNames.includes(name);
  const dataTools = ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"].filter(enabled);
  const toolGroups: string[] = dataTools.length > 0 ? [`Data tools: ${dataTools.join(", ")}.`] : [];
  if ((context.enabled_knowledge_ids?.length ?? 0) > 0 && enabled("retrieve_knowledge")) {
    toolGroups.push("Knowledge tools: retrieve_knowledge.");
  }
  const workspaceTools = [
    "read_file",
    "write_file",
    "edit_file",
    "list_files",
    "file_stat",
    "mkdir",
    "grep",
    ...(commandExecutionEnabled ? ["execute_command"] : [])
  ].filter(enabled);
  if (workspaceTools.length > 0) {
    toolGroups.push(`Workspace tools (per-run isolated directory): ${workspaceTools.join(", ")}. `
      + "Files you write stay within this run's directory. "
      + (enabled("execute_command")
        ? "execute_command runs in a sandbox without network access. Use it only for local transforms, charts, "
          + "or exports; never use it to access external services."
        : "execute_command is disabled this run; rely on the available data and file tools only."));
  }
  const taskTools = ["task_write", "task_update", "task_complete", "task_check"].filter(enabled);
  if (taskToolsEnabled && taskTools.length > 0) {
    toolGroups.push(`Task tools: ${taskTools.join(", ")}.`);
  }
  const collaborationTools = ["ask_user", "submit_plan"].filter(enabled);
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    toolGroups.push(`Collaboration tools: ${collaborationTools.join(", ")}.`);
  }

  const policies: string[] = [];
  if (taskToolsEnabled && taskTools.length === 4) {
    policies.push(
      "Plan with tasks. For work with three or more distinct actions, call task_write first and keep exactly one "
        + "task in_progress at a time. "
        + "Update tasks as you progress and call task_complete when each is done. "
        + "Before declaring work finished, call task_check to confirm nothing is left. "
        + "Never invent task IDs; reuse only those returned by tool results."
    );
  }
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    policies.push(
      "Use ask_user only when progress requires information or a decision that cannot be inferred safely. "
        + "Use submit_plan when explicit user approval is required before implementation; both tools suspend the run."
    );
  }
  if (enabled("inspect_schema") && (enabled("run_sql_readonly") || enabled("preview_table"))) {
    policies.push("Inspect before you query, then reuse the schema_id. inspect_schema returns a schema_id token that authorizes "
      + "run_sql_readonly and preview_table; pass it as their schema_id argument. The first SQL or preview against a "
      + "datasource must be preceded by an inspect_schema for it; without a valid schema_id the tools fail with "
      + "SCHEMA_REQUIRED. The token enforces inspect-before-query ordering within this run; Data Gateway remains the "
      + "authorization and read-only SQL boundary. Reuse the token instead of repeatedly inspecting the same schema."
    );
  }
  if (enabled("run_sql_readonly")) {
    policies.push("Write read-only SQL only. Generate SELECT or WITH queries and run them through run_sql_readonly. "
      + "Do not attempt writes, DDL, or multi-statement scripts through SQL"
      + ". Never use execute_command or direct database clients to bypass Data Gateway."
    );
  }
  policies.push(
    `Respect limits. This run allows at most ${AGENT_MAX_STEPS} steps and `
      + `${SQL_MAX_EXECUTION_COUNT} SQL executions total `
      + `(SQL longer than ${SQL_MAX_SQL_CHARS} chars is truncated from view). `
      + "Prefer one focused query per datasource before refining."
  );
  if (commandExecutionEnabled) {
    policies.push(
      "Persist derived artifacts in the workspace. When analysis produces exports, charts, or transformed datasets, "
        + "write them as files via write_file so they are retained with the run, rather than only echoing them in "
        + "the final message."
    );
  }
  policies.push(
    "Report failures honestly. If schema inspection, SQL execution, a file write, or a command fails, explain the "
      + "failure plainly. "
      + "Do not fabricate results to mask an error."
  );
  policies.push(
    "Confidentiality. Never reveal credentials, datasource config, internal environment values, or workspace "
      + "absolute paths in your responses."
  );
  if (input.skillInstructions) {
    policies.push(`Active skill policy: ${input.skillInstructions}`);
  }

  return `
You are a general-purpose data agent. Analyze data by calling tools. Never invent schema, rows, SQL results,
file contents, or command output.

Datasources available this run: [${(context.enabled_datasource_ids ?? []).join(", ")}]
Default datasource: "${context.selected_datasource_id}".
You may query any datasource in the list above by passing its id to a data tool's datasource_id argument.
Never reference a datasource id outside this list; the tool rejects it with DATASOURCE_NOT_SELECTED.

Tool groups:
- ${toolGroups.join("\n- ")}

Operating policy:
${policies.map((policy, index) => `${index + 1}. ${policy}`).join("\n")}
`;
};

const sanitizeIngressMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => message.role !== "activity" && message.role !== "reasoning");
