import { MastraAgent } from "@ag-ui/mastra";
import { MCPMiddleware } from "@ag-ui/mcp-middleware";
import type { RunAgentInput } from "@ag-ui/client";
import {
  createDataAgent,
  createDataAgentRunContext,
  type AgentRunContext,
  type AgUiEventEmitter,
  type GoalRuntimeAdapter,
  type TaskStateRuntime
} from "@open-data-agent/agent-runtime";
import type { DataGateway } from "@open-data-agent/data-gateway";
import type { KnowledgeService } from "@open-data-agent/knowledge";
import type { LongTermMemoryRecord } from "@open-data-agent/metadata";

import type { InteractionResume } from "./interaction-runtime-adapter.js";
import type { McpRuntime, ResolvedRunConfig } from "./run-config-resolver.js";
import type { EffectiveRunConfig } from "./run-input.js";

export type RunAgentAssembly = {
  destroyWorkspace(): Promise<void>;
  goalRuntime?: GoalRuntimeAdapter | undefined;
  governedMessages: RunAgentInput["messages"];
  mastraAgent: MastraAgent;
  workspace: {
    command_execution_enabled: boolean;
    isolation: "bwrap" | "none" | "seatbelt";
  };
};

type CreateRunAgentContextInput = {
  effectiveRunConfig: EffectiveRunConfig;
  modelProvider: ResolvedRunConfig["modelProvider"];
  runId: string;
  selectedDatasourceId: string;
  sessionId: string;
  userId: string;
  userInput: string;
};

type CreateRunAgentAssemblyInput = {
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  goal?: EffectiveRunConfig["goal"] | undefined;
  interactionResume?: InteractionResume | undefined;
  knowledgeService: KnowledgeService;
  longTermMemories: LongTermMemoryRecord[];
  mcpRuntime: McpRuntime;
  messages: RunAgentInput["messages"];
  modelProvider: ResolvedRunConfig["modelProvider"];
  modelSettings?: ResolvedRunConfig["modelSettings"] | undefined;
  runContext: AgentRunContext;
  skillPolicy?: ResolvedRunConfig["skillPolicy"] | undefined;
  taskStateRuntime: TaskStateRuntime;
  userId: string;
  workspaceRoot: string;
};

/** Create the canonical agent run context used by Mastra tools, projections, and metadata. */
export const createRunAgentContext = (input: CreateRunAgentContextInput): AgentRunContext =>
  createDataAgentRunContext({
    user_id: input.userId,
    session_id: input.sessionId,
    run_id: input.runId,
    user_input: input.userInput,
    chat_mode: "copilotkit",
    selected_datasource_id: input.selectedDatasourceId,
    enabled_datasource_ids: input.effectiveRunConfig.enabledDatasourceIds,
    ...(input.effectiveRunConfig.activeLlmProfileId
      ? { requested_llm_profile_id: input.effectiveRunConfig.activeLlmProfileId }
      : {}),
    ...(input.effectiveRunConfig.activeSkillId ? { active_skill_id: input.effectiveRunConfig.activeSkillId } : {}),
    ...(input.effectiveRunConfig.enabledKnowledgeIds.length > 0
      ? { enabled_knowledge_ids: input.effectiveRunConfig.enabledKnowledgeIds }
      : {}),
    ...(input.effectiveRunConfig.enabledMcpServerIds.length > 0
      ? { enabled_mcp_server_ids: input.effectiveRunConfig.enabledMcpServerIds }
      : {}),
    model_name: input.modelProvider.model_name
  });

/** Assemble the Mastra-backed AG-UI agent and its run-scoped execution metadata. */
export const createRunAgentAssembly = async (
  input: CreateRunAgentAssemblyInput
): Promise<RunAgentAssembly> => {
  const {
    agent,
    commandExecutionEnabled,
    destroyWorkspace,
    goalRuntime,
    governedMessages,
    isolation
  } = await createDataAgent({
    dataGateway: input.dataGateway,
    knowledgeService: input.knowledgeService,
    ...(input.mcpRuntime.toolNames.length > 0 ? { mcpToolNames: input.mcpRuntime.toolNames } : {}),
    emitter: input.emitter,
    messages: input.messages,
    modelProvider: input.modelProvider,
    ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
    ...(input.longTermMemories.length > 0 ? { longTermMemory: { records: input.longTermMemories } } : {}),
    runContext: input.runContext,
    ...(input.skillPolicy ? { skillPolicy: input.skillPolicy } : {}),
    taskStateRuntime: input.taskStateRuntime,
    ...(!input.interactionResume && input.goal ? { goal: input.goal } : {}),
    workspaceRoot: input.workspaceRoot
  });
  const mastraAgent = new MastraAgent({
    agent,
    resourceId: input.userId
  });
  if (input.mcpRuntime.servers.length > 0) {
    mastraAgent.use(new MCPMiddleware(input.mcpRuntime.servers, { maxIterations: 8 }));
  }

  return {
    destroyWorkspace,
    ...(goalRuntime ? { goalRuntime } : {}),
    governedMessages,
    mastraAgent,
    workspace: {
      command_execution_enabled: commandExecutionEnabled,
      isolation
    }
  };
};
