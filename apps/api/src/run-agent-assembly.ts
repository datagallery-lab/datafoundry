import { MastraAgent } from "@ag-ui/mastra";
import type { RunAgentInput } from "@ag-ui/client";
import type { ArtifactService } from "@open-data-agent/artifacts";
import {
  createDataAgent,
  createDataAgentRunContext,
  type AgentRunContext,
  type AgUiEventEmitter,
  type GoalRuntimeAdapter,
  type TaskStateRuntime,
  type WorkspaceAttachment
} from "@open-data-agent/agent-runtime";
import type { DataGateway } from "@open-data-agent/data-gateway";
import type { FileAssetService } from "@open-data-agent/files";
import type { KnowledgeService } from "@open-data-agent/knowledge";
import type { LongTermMemoryRecord } from "@open-data-agent/metadata";
import type { SkillRecord, SkillSelectionResult } from "@open-data-agent/skills";

import type { InteractionResume } from "./interaction-runtime-adapter.js";
import { PolicyMcpMiddleware } from "./policy-mcp-middleware.js";
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
  workspaceId: string;
};

type CreateRunAgentAssemblyInput = {
  artifactService: ArtifactService;
  dataGateway: DataGateway;
  effectiveRunConfig: EffectiveRunConfig;
  emitter: AgUiEventEmitter;
  fileAssetService: FileAssetService;
  goal?: EffectiveRunConfig["goal"] | undefined;
  interactionResume?: InteractionResume | undefined;
  knowledgeService: KnowledgeService;
  longTermMemories: LongTermMemoryRecord[];
  mcpRuntime: McpRuntime;
  messages: RunAgentInput["messages"];
  modelContextProfile?: ResolvedRunConfig["modelContextProfile"] | undefined;
  modelProvider: ResolvedRunConfig["modelProvider"];
  modelSettings?: ResolvedRunConfig["modelSettings"] | undefined;
  runContext: AgentRunContext;
  selectedSkills: SkillRecord[];
  skillSelection: SkillSelectionResult;
  taskStateRuntime: TaskStateRuntime;
  userId: string;
  workspaceId: string;
  workspaceRoot: string;
};

/** Create the canonical agent run context used by Mastra tools, projections, and metadata. */
export const createRunAgentContext = (input: CreateRunAgentContextInput): AgentRunContext =>
  createDataAgentRunContext({
    user_id: input.userId,
    workspace_id: input.workspaceId,
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
    artifactService: input.artifactService,
    dataGateway: input.dataGateway,
    fileAssetService: input.fileAssetService,
    knowledgeService: input.knowledgeService,
    ...(input.mcpRuntime.toolNames.length > 0 ? { mcpToolNames: input.mcpRuntime.toolNames } : {}),
    emitter: input.emitter,
    messages: input.messages,
    ...(input.modelContextProfile ? { modelContextProfile: input.modelContextProfile } : {}),
    modelProvider: input.modelProvider,
    ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
    ...(input.longTermMemories.length > 0 ? { longTermMemory: { records: input.longTermMemories } } : {}),
    runContext: input.runContext,
    selectedSkills: input.selectedSkills,
    skillSelection: input.skillSelection,
    taskStateRuntime: input.taskStateRuntime,
    ...(!input.interactionResume && input.goal ? { goal: input.goal } : {}),
    ...(input.effectiveRunConfig.fileIds.length > 0
      ? { workspaceAttachments: resolveWorkspaceAttachments(input) }
      : {}),
    workspaceRoot: input.workspaceRoot
  });
  const mastraAgent = new MastraAgent({
    agent,
    resourceId: input.userId
  });
  if (input.mcpRuntime.servers.length > 0) {
    mastraAgent.use(new PolicyMcpMiddleware(input.mcpRuntime.servers, { maxIterations: 8 }));
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

const resolveWorkspaceAttachments = (input: CreateRunAgentAssemblyInput): WorkspaceAttachment[] =>
  input.effectiveRunConfig.fileIds.map((fileId) => {
    const resolved = input.fileAssetService.getRef({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      id: fileId
    });
    return {
      file_id: resolved.ref.id,
      filename: resolved.ref.filename,
      ...(resolved.ref.declared_mime_type ?? resolved.asset.detected_mime_type
        ? { mime_type: resolved.ref.declared_mime_type ?? resolved.asset.detected_mime_type }
        : {}),
      size_bytes: resolved.asset.size_bytes,
      source_path: resolved.asset.storage_path
    };
  });
