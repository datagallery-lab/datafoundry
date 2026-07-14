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
import { WorkingMemory } from "@mastra/core/processors";
import { createSkillTools, createWorkspaceTools } from "@mastra/core/workspace";
import type { Message } from "@ag-ui/core";
import type { ArtifactService, SessionOutputService } from "@datafoundry/artifacts";
import type { DataGateway } from "@datafoundry/data-gateway";
import { type FileAssetService, fileAssetRefDto, mimeTypeForFilename } from "@datafoundry/files";
import type { KnowledgeService } from "@datafoundry/knowledge";
import {
  materializeSkillPackages,
  type SkillRecord,
  type SkillSelectionResult
} from "@datafoundry/skills";
import { copyFileSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  createModelProvider,
  createModelProviderFromConfig,
  type ChatProviderConfig,
  type ModelProvider
} from "@datafoundry/providers";

import { AGENT_MAX_STEPS, SQL_MAX_EXECUTION_COUNT } from "./runtime-limits.js";
import { SQL_MAX_SQL_CHARS } from "./context/inventory/context-limits.js";
import { createToolObservationBoundary } from "./context/tool-observation/tool-observation-boundary.js";
import {
  createMastraContextProcessorBoundary
} from "./context/protocol/mastra/mastra-context-processor-boundary.js";
import type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
import type { ContextPackage } from "./context/inventory/context-package.js";
import { ToolObservationDispatcher } from "./context/tool-observation/tool-observation-dispatcher.js";
import { createAgUiContextEventSink } from "./context/protocol/ag-ui/ag-ui-context-event-sink.js";
import {
  NonEmptyMessageContentCompatProcessor,
  shouldApplyNonEmptyMessageContentCompat,
} from "./provider-compat/non-empty-message-content-compat.js";
import {
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
import { CONVERSATION_WORKING_MEMORY_CONFIG } from "./memory/conversation-memory-bridge.js";
import type { RuntimeContextSource } from "./context/source/runtime-context-source.js";
import {
  createContextItem,
  type ContextItem,
  type CreateContextItemInput
} from "./context/inventory/context-item.js";
import {
  createContextSourceMetadata,
  type ContextSourceMetadata
} from "./context/inventory/context-source-metadata.js";
import { GoalRuntimeAdapter, type GoalRequest } from "./memory/goal-runtime-adapter.js";
import { createDataFoundryToolRegistry } from "./tools/data-tools.js";
import { GovernedToolFactory } from "./tools/governed-tool-factory.js";
import {
  maybeIngestSessionFileOutput,
  maybeIngestSessionFileToolResult
} from "./tools/session-output-ingest.js";
import {
  createRunWorkspace,
  resolveSkillCacheDir,
  resolveWorkspaceDir
} from "./tools/workspace-factory.js";
import {
  applyToolInputCompatibility,
  buildToolInputCompatibilityInstruction
} from "./tools/tool-input-compat.js";
import { createMastraStreamNormalizerHooks } from "./stream/mastra-stream-hooks.js";
import { createTokenUsageCorrelationStore } from "./stream/token-usage-correlation.js";
import { wrapAgentForAgUi } from "./stream/mastra-stream-normalizer.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
import { createCustomEvent } from "./events.js";
import { createTool, type ToolAction } from "@mastra/core/tools";
import { z } from "zod";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export type { ContextPackage } from "./context/inventory/context-package.js";
export type { ContextPlan } from "./context/inventory/context-plan.js";
export type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
export type AgentContextItem = ContextItem;
export type AgentContextSourceMetadata = ContextSourceMetadata;
export type CreateAgentContextItemInput = CreateContextItemInput;
export type AgentModelContextProfile = {
  id: string;
  contextWindow: number;
  outputReserve: number;
  safetyMargin: number;
  messageOverhead: number;
  modelPattern: string;
  toolSchemaOverhead: number;
};
export const createAgentContextItem = createContextItem;
export const createAgentContextSourceMetadata = createContextSourceMetadata;

export const DATA_AGENT_TOOL_NAMES = [
  "inspect_schema",
  "list_data_sources",
  "preview_table",
  "run_sql_readonly"
] as const;
/** HITL tools that suspend the run; their TOOL_CALL_RESULT is emitted on interaction resume. */
const HITL_TOOL_NAMES = ["ask_user", "submit_plan"] as const;
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
  "promote_workspace_file",
  "list_workspace_files",
  "read_workspace_file",
  "read_file",
  "retrieve_knowledge",
  "run_sql_readonly",
  "skill",
  "skill_read",
  "skill_search",
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
export {
  normalizeMastraFullStream,
  wrapAgentForAgUi,
  type MastraAgentForAgUiOptions,
  type MastraStreamChunk,
  type MastraStreamNormalizerHooks
} from "./stream/mastra-stream-normalizer.js";
export { createMastraStreamNormalizerHooks, tokenUsageEventFromChunk } from "./stream/mastra-stream-hooks.js";
export {
  createTokenUsageCorrelationStore,
  type TokenUsageCorrelationPayload,
} from "./stream/token-usage-correlation.js";
export {
  resolveRunWorkspaceDir,
  resolveSkillCacheDir,
  resolveSkillCacheRoot,
  resolveSessionWorkspaceDir,
  resolveWorkspaceDir,
  resolveWorkspaceRoot
} from "./tools/workspace-factory.js";
export { resolvePythonRuntime } from "./tools/python-runtime.js";
export { createDataFoundryToolRegistry, type ToolRegistry } from "./tools/data-tools.js";
export {
  GoalRuntimeAdapter,
  type GoalRequest,
  type GoalSnapshot
} from "./memory/goal-runtime-adapter.js";
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

export type CreateDataFoundryInput = {
  abortSignal?: AbortSignal | undefined;
  artifactService?: ArtifactService;
  contextPackageRecorder?: ContextPackageRecorder;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  fileAssetService?: FileAssetService;
  initialContextPackage?: ContextPackage;
  knowledgeService?: KnowledgeService;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  mcpTools?: Record<string, ToolAction<any, any, any, any, any>>;
  sessionOutputService?: SessionOutputService;
  mcpToolNames?: string[];
  selectedSkills?: SkillRecord[];
  skillSelection?: SkillSelectionResult;
  taskStateRuntime?: TaskStateRuntime;
  longTermMemory?: {
    records: AgentLongTermMemoryRecord[];
    maxChars?: number;
  };
  evidenceContextItems?: AgentContextItem[];
  messages: Message[];
  modelSettings?: {
    frequencyPenalty?: number;
    maxOutputTokens?: number;
    presencePenalty?: number;
    temperature?: number;
    topP?: number;
  };
  modelContextProfile?: AgentModelContextProfile;
  workspaceAttachments?: WorkspaceAttachment[];
  goal?: GoalRequest;
  /**
   * 工作区根目录（调用方注入）。未提供时回落到 WORKSPACE_ROOT，再回落到系统 temp。
   * 每个 session 在该目录下按 {user_id}/{session_id} 建立隔离子目录，跨 run 保留文件。
   * 留空即按默认策略隔离，不影响 workspace 工具的可用性。
   */
  workspaceRoot?: string | undefined;
};

export type WorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  size_bytes: number;
  source_path: string;
};

export const createDataFoundry = async (
  input: CreateDataFoundryInput
): Promise<{
  agent: Agent;
  governedMessages: Message[];
  goalRuntime?: GoalRuntimeAdapter;
  commandExecutionEnabled: boolean;
  isolation: "bwrap" | "none" | "seatbelt";
  workspaceDir: string;
  sessionDir: string;
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
  if (input.initialContextPackage) {
    contextRunState.merge(input.initialContextPackage);
  }

  const runDir = resolveWorkspaceDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  const skillCacheDir = resolveSkillCacheDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  if (input.selectedSkills?.length) {
    await materializeSkillPackages({
      fileAssetService: requireFileAssetService(input.fileAssetService),
      runDir: skillCacheDir,
      skills: input.selectedSkills,
      userId: input.runContext.user_id,
      workspaceId: input.runContext.workspace_id ?? "default"
    });
  }
  mkdirSync(join(skillCacheDir, "skills"), { recursive: true });
  // 绑定到本次 session 的工作区：LocalFilesystem + LocalSandbox。
  // createDataFoundry 每次 run 都调用，直接闭包捕获 runContext，不依赖下游 requestContext 注入。
  const runWorkspace = createRunWorkspace({
    runContext: input.runContext,
    skillPaths: ["skills"],
    workspaceRoot: input.workspaceRoot
  });
  const workspaceAttachments = materializeWorkspaceAttachments(runWorkspace.runDir, input.workspaceAttachments ?? []);
  const evidenceRuntimeSource = createEvidenceFocusRuntimeSource(input.evidenceContextItems ?? []);

  const governedMessages = normalizeIngressMessages(input.messages);

  const tokenUsageCorrelation = createTokenUsageCorrelationStore();
  const registry = createDataFoundryToolRegistry({
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext,
    tokenUsageCorrelation,
  });
  const dispatcher = new ToolObservationDispatcher(toolObservationBoundary.packager, {
    modelName: input.runContext.model_name,
    resourceId: input.runContext.user_id,
    runId: input.runContext.run_id,
    sessionId: input.runContext.session_id
  });
  const onGovernedResultWithSessionOutput: typeof registry.onGovernedResult = async (governed) => {
    await registry.onGovernedResult?.(governed);
    if (!input.sessionOutputService) {
      return;
    }
    await maybeIngestSessionFileToolResult({
      toolName: governed.toolName,
      ...(governed.toolCallId ? { toolCallId: governed.toolCallId } : {}),
      ...(governed.toolInput !== undefined ? { toolInput: governed.toolInput } : {}),
      ...(governed.rawResult !== undefined ? { rawResult: governed.rawResult } : {}),
      sessionDir: runWorkspace.sessionDir,
      sessionOutputService: input.sessionOutputService,
      runContext: input.runContext,
      emitter: input.emitter
    });
  };
  const governedToolFactory = new GovernedToolFactory(
    dispatcher,
    onGovernedResultWithSessionOutput,
    registry.onGovernanceError,
    {
      emitter: input.emitter,
      // HITL tools suspend the run and have their TOOL_CALL_RESULT emitted on interaction
      // resume; the boundary must not emit a (spurious) result for them.
      externallyResolvedToolNames: new Set(HITL_TOOL_NAMES)
    }
  );
  const contextEventSink = createAgUiContextEventSink(input.emitter);
  const mastraContextProcessors = createMastraContextProcessorBoundary({
    dispatcher,
    eventSink: contextEventSink,
    ...(input.contextPackageRecorder ? { contextPackageRecorder: input.contextPackageRecorder } : {}),
    ...(evidenceRuntimeSource ? { additionalRuntimeSources: [evidenceRuntimeSource] } : {}),
    ...(input.longTermMemory ? { longTermMemory: input.longTermMemory } : {}),
    ...(input.modelContextProfile ? { modelContextProfile: input.modelContextProfile } : {}),
    modelName: input.runContext.model_name,
    runScope: {
      runId: input.runContext.run_id,
      sessionId: input.runContext.session_id,
      userId: input.runContext.user_id
    },
    runState: contextRunState,
    ...(input.taskStateRuntime ? { taskStateRuntime: input.taskStateRuntime } : {})
  });
  const readOnlyWorkingMemoryProcessor = input.taskStateRuntime
    ? await createReadOnlyWorkingMemoryProcessor(input.taskStateRuntime)
    : undefined;
  const nonEmptyMessageContentCompat = new NonEmptyMessageContentCompatProcessor(
    shouldApplyNonEmptyMessageContentCompat(input.modelProvider),
  );
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
                workspace_id: input.runContext.workspace_id ?? "default",
                collection_id: toolInput.collection_id,
                query: toolInput.query,
                ...(toolInput.top_k ? { top_k: toolInput.top_k } : {})
              }) ?? []
            };
          }
        })
      }
    : {};
  const fileAssetTools = input.fileAssetService
    ? createFileAssetTools({
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        fileAssetService: input.fileAssetService,
        runContext: input.runContext,
        sessionDir: runWorkspace.sessionDir,
        workspaceDir: runWorkspace.runDir
      })
    : {};
  // Workspace file tools (write_file / edit_file / execute_command, etc.) produce
  // session-scoped files. Eligible write/edit outputs are auto-ingested into Session
  // Outputs from governed tool results (and workspace.metadata when Mastra emits it);
  // drafts/scripts remain workspace-only.
  const workspaceTools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  const skillTools = runWorkspace.workspace.skills ? createSkillTools(runWorkspace.workspace.skills) : {};
  runWorkspace.workspace.setToolsConfig({ enabled: false });
  const dataToolsEnabled = (input.runContext.enabled_datasource_ids?.length ?? 0) > 0;
  const availableTools = {
    ...(dataToolsEnabled ? registry.mastraTools : {}),
    ...fileAssetTools,
    ...knowledgeTools,
    ...taskTools,
    ...collaborationTools,
    ...workspaceTools,
    ...skillTools
  };
  const selectedPolicyTools = selectToolsByPolicy(availableTools, input.skillSelection);
  const selectedTools = applyToolInputCompatibility({
    ...selectedPolicyTools,
    ...(input.mcpTools ?? {})
  });
  const tools = governedToolFactory.governTools(selectedTools);
  const agent = new Agent({
    id: "data-foundry",
    name: "DataFoundry",
    instructions: buildAgentInstructions({
      runContext: input.runContext,
      commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
      collaborationToolsEnabled: Boolean(input.taskStateRuntime),
      pythonRuntimeAvailable: Boolean(runWorkspace.pythonRuntime),
      selectedSkills: input.selectedSkills ?? [],
      taskToolsEnabled: Boolean(input.taskStateRuntime),
      toolNames: Object.keys(selectedTools),
      mcpToolNames: input.mcpToolNames ?? [],
      workspaceAttachments
    }),
    model: input.modelProvider.model as never,
    tools,
    ...(input.taskStateRuntime ? { memory: input.taskStateRuntime.memory } : {}),
    ...(input.goal ? { goal: { judge: input.modelProvider.model as never, maxRuns: input.goal.maxRuns ?? 10 } } : {}),
    // Workspace remains attached for execution context, while auto-injection is disabled above.
    // Explicitly created tools are wrapped by the same governed execution boundary as every other tool.
    workspace: runWorkspace.workspace,
    inputProcessors: [
      ...(readOnlyWorkingMemoryProcessor ? [readOnlyWorkingMemoryProcessor] : []),
      ...mastraContextProcessors.inputProcessors,
      nonEmptyMessageContentCompat
    ],
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
  const agentForAgUi = wrapAgentForAgUi(
    agent,
    createMastraStreamNormalizerHooks(input.emitter, input.sessionOutputService
      ? {
          onWorkspaceMetadata: (metadata) =>
            maybeIngestSessionFileOutput({
              metadata,
              emitter: input.emitter,
              runContext: input.runContext,
              sessionDir: runWorkspace.sessionDir,
              sessionOutputService: input.sessionOutputService as SessionOutputService
            })
        }
      : {}),
    { ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}) },
  );
  const mastra = input.taskStateRuntime
    ? new Mastra({
        agents: { dataFoundry: agentForAgUi },
        storage: input.taskStateRuntime.storage
      })
    : undefined;
  let goalRuntime: GoalRuntimeAdapter | undefined;
  if (input.goal && mastra) {
    goalRuntime = new GoalRuntimeAdapter(agentForAgUi, input.runContext.user_id, input.runContext.session_id);
    const snapshot = await goalRuntime.setObjective(input.goal);
    // R-016: stable goal.updated contract. `objective` is the spec key; `goal` is kept
    // as a backward-compatible alias. Mastra's "active"/"paused"/"done" maps to the
    // spec's "running"/"paused"/"done".
    const goalStatus = snapshot?.status === "active" ? "running" : snapshot?.status ?? "running";
    input.emitter.emit(createCustomEvent("goal.updated", {
      objective: snapshot?.objective ?? input.goal.objective,
      goal: snapshot?.objective ?? input.goal.objective,
      status: goalStatus,
      source: "mastra-native-goal"
    }));
  }

  return {
    agent: agentForAgUi,
    commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
    destroyWorkspace: () => runWorkspace.destroy(),
    governedMessages,
    ...(goalRuntime ? { goalRuntime } : {}),
    isolation: runWorkspace.isolation,
    workspaceDir: runWorkspace.runDir,
    sessionDir: runWorkspace.sessionDir
  };
};

const createEvidenceFocusRuntimeSource = (items: AgentContextItem[]): RuntimeContextSource | undefined => {
  if (items.length === 0) {
    return undefined;
  }
  return {
    sourceType: "evidence-focus",
    collect: () => items
  };
};

export const createDataFoundryRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if ((input.enabled_datasource_ids?.length ?? 0) === 0) {
    return input;
  }
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }
  if (!(input.enabled_datasource_ids ?? []).includes(input.selected_datasource_id)) {
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
  /** execute_command 是否已接入项目 Python venv（numpy/pandas/matplotlib/sklearn）。 */
  pythonRuntimeAvailable: boolean;
  selectedSkills: SkillRecord[];
  /** builtin task_* 工具是否启用（取决于是否注入 taskStateRuntime）。 */
  taskToolsEnabled: boolean;
  toolNames: string[];
  /** MCP tools injected through AG-UI clientTools for this run. */
  mcpToolNames: string[];
  workspaceAttachments: MaterializedWorkspaceAttachment[];
};

type MaterializedWorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  path: string;
  size_bytes: number;
};

const buildAgentInstructions = (input: AgentInstructionsInput): string => {
  const { runContext: context, collaborationToolsEnabled, commandExecutionEnabled, taskToolsEnabled } = input;
  const enabled = (name: string): boolean => input.toolNames.includes(name);
  const promoteWorkspaceFileEnabled = enabled("promote_workspace_file");
  const dataTools = ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"].filter(enabled);
  const toolGroups: string[] = dataTools.length > 0 ? [`Data tools: ${dataTools.join(", ")}.`] : [];
  if (input.mcpToolNames.length > 0) {
    toolGroups.push(`MCP tools: ${input.mcpToolNames.join(", ")}.`);
  }
  if ((context.enabled_knowledge_ids?.length ?? 0) > 0 && enabled("retrieve_knowledge")) {
    toolGroups.push("Knowledge tools: retrieve_knowledge.");
  }
  const workspaceAssetTools = ["list_workspace_files", "read_workspace_file", "promote_workspace_file"]
    .filter(enabled);
  if (workspaceAssetTools.length > 0) {
    const sessionProducerTools = [
      ...(enabled("write_file") ? ["write_file"] : []),
      ...(enabled("execute_command") ? ["execute_command"] : [])
    ];
    const sessionProducerText = sessionProducerTools.length > 0
      ? `New files you write (${sessionProducerTools.join(" / ")}) are session-scoped — only this session sees them. `
      : "New files in the session workspace are session-scoped — only this session sees them. ";
    toolGroups.push(
      `Workspace asset tools: ${workspaceAssetTools.join(", ")}. `
      + sessionProducerText
      + "list_workspace_files / read_workspace_file read the cross-session workspace root (shared across your "
      + "sessions, read-only). "
      + (promoteWorkspaceFileEnabled
        ? "promote_workspace_file copies a session file into that cross-session root."
        : "Use only the available workspace asset tools listed above.")
    );
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
    toolGroups.push(`Workspace tools (session-isolated directory): ${workspaceTools.join(", ")}. `
      + "Files you write stay within this session's workspace and can be reused by later runs in the same session. "
      + (enabled("execute_command")
          ? (input.pythonRuntimeAvailable
          ? "execute_command runs in a sandbox without network access. Use `python3.12 script.py` for local analysis; "
            + "numpy, pandas, matplotlib, and scikit-learn are available from the project venv. "
            + "Write scripts with write_file first, "
            + "save charts with plt.savefig(), and persist outputs as workspace files. "
            + "Do not use execute_command for external services or direct database access."
          : "execute_command runs in a sandbox without network access. Use it only for local transforms, charts, "
            + "or exports; never use it to access external services.")
        : "Command execution is disabled this run; rely on the available data and file tools only."));
  }
  if (input.workspaceAttachments.length > 0) {
    toolGroups.push(`Uploaded workspace input files: ${input.workspaceAttachments
      .map((file) =>
        `${file.path} (file_id=${file.file_id}, mime=${file.mime_type ?? "unknown"}, size=${file.size_bytes})`
      )
      .join("; ")}.`);
  }
  // R-019: per-run @ mentions — focus signal, not a narrowing. The agent is told which
  // resources the user explicitly highlighted this run so it can prioritize them while
  // the rest of the enabled set stays available.
  const mentioned = context.mentioned;
  if (mentioned) {
    const focusParts: string[] = [];
    if (mentioned.db.length > 0) {
      focusParts.push(`datasources ${mentioned.db.join(", ")}`);
    }
    if (mentioned.kb.length > 0) {
      focusParts.push(`knowledge bases ${mentioned.kb.join(", ")}`);
    }
    if (mentioned.mcp.length > 0) {
      focusParts.push(`MCP servers ${mentioned.mcp.join(", ")}`);
    }
    if (mentioned.skill.length > 0) {
      focusParts.push(`skills ${mentioned.skill.join(", ")}`);
    }
    if (focusParts.length > 0) {
      toolGroups.push(
        `User focus this run (via @ mentions): ${focusParts.join("; ")}. Prioritize these resources in your analysis `
          + "and tool selection; other enabled resources remain available but should take lower priority."
      );
    }
  }
  // R-024: pinned session-relative workspace files the user wants the agent to read/reference.
  const pinnedPaths = context.pinned_paths;
  if (pinnedPaths && pinnedPaths.length > 0) {
    toolGroups.push(
      `Pinned workspace files to read/reference this run: ${pinnedPaths.join(", ")}. These already exist in the `
        + "session workspace — read them with read_file; do not re-create or copy them into input/."
    );
  }
  const evidenceRefs = context.evidence_refs;
  if (evidenceRefs && evidenceRefs.length > 0) {
    const labels = evidenceRefs
      .map((ref) => `${ref.kind}:${ref.label}`)
      .slice(0, 12)
      .join("; ");
    toolGroups.push(
      `User-selected evidence focus this run: ${labels}. Treat these references as the primary context for the `
        + "follow-up question. You may run new data tools when needed; make new queries and outputs visible in steps."
    );
  }
  const taskTools = ["task_write", "task_update", "task_complete", "task_check"].filter(enabled);
  if (taskToolsEnabled && taskTools.length > 0) {
    toolGroups.push(`Task tools: ${taskTools.join(", ")}.`);
  }
  const collaborationTools = ["ask_user", "submit_plan"].filter(enabled);
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    toolGroups.push(`Collaboration tools: ${collaborationTools.join(", ")}.`);
  }
  const skillTools = ["skill", "skill_search", "skill_read"].filter(enabled);
  if (skillTools.length > 0) {
    toolGroups.push(`Skill tools: ${skillTools.join(", ")}.`);
  }

  const policies: string[] = [];
  policies.push(buildToolInputCompatibilityInstruction(input.toolNames));
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
  if (input.mcpToolNames.length > 0) {
    policies.push(
      "MCP tools are enabled for this run. Use the exact MCP tool names listed above when the user asks for MCP, "
        + "datagraph, graph exploration, or a tool whose description directly matches the task."
    );
  }
  if (skillTools.length > 0) {
    const selectedSkillHint = input.selectedSkills.length > 0
      ? ` Prioritize the selected skills listed in the prompt: ${
          input.selectedSkills.map((skill) => skill.name).join(", ")
        }.`
      : "";
    const skillScriptPolicy = enabled("execute_command")
      ? " Scripts from skills may be executed only through approved workspace tools such as execute_command."
      : " Treat scripts from skills as reference material this run because command execution is unavailable.";
    policies.push(
      "Use skills as task guidance, not as executable tools. skill_search may search the full shared skill cache; "
        + "a search result does not by itself mean the skill was selected for this run."
        + selectedSkillHint
        + " When the task matches an available skill, call "
        + "skill_search or skill to load its instructions, then use normal approved tools to act. "
        + "Use skill_read for references, scripts, or assets that belong to a relevant loaded skill. "
        + skillScriptPolicy
    );
  }
  if (enabled("inspect_schema") && (enabled("run_sql_readonly") || enabled("preview_table"))) {
    policies.push("Inspect before you query, then reuse the schema_id. "
      + "inspect_schema returns a schema_id token that authorizes "
      + "run_sql_readonly and preview_table; pass it as their schema_id argument. The first SQL or preview against a "
      + "datasource must be preceded by an inspect_schema for it; without a valid schema_id the tools fail with "
      + "SCHEMA_REQUIRED. The token enforces inspect-before-query ordering within this run; Data Gateway remains the "
      + "authorization and read-only SQL boundary. Reuse the token instead of repeatedly inspecting the same schema."
    );
  }
  if (enabled("run_sql_readonly")) {
    policies.push("Write read-only SQL only. Generate SELECT or WITH queries and run them through run_sql_readonly. "
      + "Do not attempt writes, DDL, or multi-statement scripts through SQL"
      + (enabled("execute_command")
        ? ". Never use execute_command or direct database clients to bypass Data Gateway."
        : ". Never use direct database clients to bypass Data Gateway.")
    );
  }
  policies.push(
    "Reply in the same natural language as the user's latest request. If the user mixes languages, use the dominant "
      + "language from the request. Keep SQL, code, table names, column names, and other technical identifiers "
      + "unchanged."
  );
  policies.push(
    "Always finish a run with a brief natural-language message to the user that summarizes what you did and the "
      + "outcome, even when your most recent action was a tool call such as a file write, command execution, or "
      + "artifact publish. Never end a run silently right after a tool result: that closing message is how the user "
      + "learns the result. Summarize outcomes and refer to any produced files or artifacts by name instead of "
      + "restating raw tool output."
  );
  policies.push(
    `Respect limits. This run allows at most ${AGENT_MAX_STEPS} steps and `
      + `${SQL_MAX_EXECUTION_COUNT} SQL executions total `
      + `(SQL longer than ${SQL_MAX_SQL_CHARS} chars is truncated from view). `
      + "Prefer one focused query per datasource before refining."
  );
  if (commandExecutionEnabled) {
    const workspacePromotionPolicy = promoteWorkspaceFileEnabled
      ? "Call promote_workspace_file only to lift a session workspace file into a cross-session reusable asset "
        + "(files in the same session are already retained across runs; do not promote merely to reuse within this "
        + "session)."
      : "";
    policies.push(
      "Persist derived artifacts in the workspace. When analysis produces exports, charts, or transformed datasets, "
        + "write them as files via write_file so they are retained with the session, rather than only echoing them in "
        + "the final message. "
        + "Eligible reusable files (for example CSV, JSON, Markdown, HTML, PNG, SVG, XLSX) are automatically shown "
        + "as Session Outputs after successful write_file/edit_file calls. "
        + "Do not invent download URLs, link text, or UI placement such as 'click the link below'; the client renders "
        + "download controls from output events and file APIs. "
        + workspacePromotionPolicy
    );
    if (input.pythonRuntimeAvailable) {
      policies.push(
        "For Python analysis, prefer write_file to create a .py script, then execute_command with "
          + "`python3.12 <script>`. "
          + "Use pandas for tabular work, matplotlib with plt.savefig() for charts (no GUI display), and scikit-learn "
          + "for modeling. "
          + "Export CSV/JSON/PNG files to the session workspace when the user should reuse or download results."
      );
    }
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
  const selectedSkillSummary = input.selectedSkills.length > 0
    ? input.selectedSkills.map((skill) => `${skill.name} (${skill.id}): ${skill.description}`).join("\n")
    : "None";
  const datasourcePolicy = (context.enabled_datasource_ids ?? []).length > 0
    ? `Datasources available this run: [${(context.enabled_datasource_ids ?? []).join(", ")}]
Default datasource: "${context.selected_datasource_id ?? ""}".
You may query any datasource in the list above by passing its id to a data tool's datasource_id argument.
Never reference a datasource id outside this list; the tool rejects it with DATASOURCE_NOT_SELECTED.`
    : "No datasources are enabled this run. Answer general questions directly. "
      + "Do not call data tools unless the user enables a datasource.";

  return `
You are a general-purpose data agent. Analyze data by calling tools. Never invent schema, rows, SQL results,
file contents, or command output.

${datasourcePolicy}
Selected skills to prioritize this run:
${selectedSkillSummary}

Tool groups:
- ${toolGroups.join("\n- ")}

Operating policy:
${policies.map((policy, index) => `${index + 1}. ${policy}`).join("\n")}
`;
};

const selectToolsByPolicy = <TTool>(
  availableTools: Record<string, TTool>,
  skillSelection: SkillSelectionResult | undefined
): Record<string, TTool> => {
  const policy = skillSelection?.effectiveToolPolicy;
  const deniedTools = new Set(policy?.deniedTools ?? []);
  const allowedTools = policy?.allowedTools ? new Set(policy.allowedTools) : undefined;
  const skillMetaTools = new Set(["skill", "skill_search", "skill_read"]);
  return Object.fromEntries(Object.entries(availableTools).filter(([name]) =>
    !deniedTools.has(name) && (!allowedTools || allowedTools.has(name) || skillMetaTools.has(name))
  ));
};

const createReadOnlyWorkingMemoryProcessor = async (
  runtime: TaskStateRuntime
): Promise<WorkingMemory | undefined> => {
  const memoryStore = await runtime.storage.getStore("memory");
  if (!memoryStore) {
    return undefined;
  }
  return new WorkingMemory({
    storage: memoryStore,
    readOnly: true,
    scope: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.scope,
    template: {
      format: "markdown",
      content: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.template
    },
    templateProvider: runtime.memory
  });
};

const requireFileAssetService = (service: FileAssetService | undefined): FileAssetService => {
  if (!service) {
    throw new Error("SKILL_FILE_ASSET_SERVICE_REQUIRED");
  }
  return service;
};

const materializeWorkspaceAttachments = (
  runDir: string,
  attachments: WorkspaceAttachment[]
): MaterializedWorkspaceAttachment[] => {
  const inputDir = join(runDir, "input");
  mkdirSync(inputDir, { recursive: true });
  const usedNames = new Set<string>();
  return attachments.map((attachment) => {
    const filename = uniqueWorkspaceInputFilename(attachment.filename, usedNames);
    const targetPath = resolve(inputDir, filename);
    if (!targetPath.startsWith(`${inputDir}${sep}`)) {
      throw new Error("WORKSPACE_ATTACHMENT_PATH_ESCAPE");
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      linkSync(attachment.source_path, targetPath);
    } catch {
      copyFileSync(attachment.source_path, targetPath);
    }
    return {
      file_id: attachment.file_id,
      filename,
      ...(attachment.mime_type ? { mime_type: attachment.mime_type } : {}),
      path: `input/${filename}`,
      size_bytes: attachment.size_bytes
    };
  });
};

const createFileAssetTools = (input: {
  abortSignal?: AbortSignal | undefined;
  fileAssetService: FileAssetService;
  runContext: AgentRunContext;
  /** Per-session directory — the agent's writable basePath (where new files live). */
  sessionDir: string;
  /** Persistent workspace root — cross-session asset area (read-only to the agent). */
  workspaceDir: string;
}): Record<string, ReturnType<typeof createTool>> => ({
  promote_workspace_file: createTool({
    id: "promote_workspace_file",
    description: "Promote a session file into the cross-session workspace root so other sessions can read it. "
      + "The file currently lives in this session's scope (only this session sees it); after promote it is "
      + "copied/hardlinked into the persistent workspace root and registered as a cross-session asset. "
      + "Use this only to share a file across sessions, not to reuse within the current session.",
    inputSchema: z.object({
      path: z.string().min(1),
      filename: z.string().min(1).optional(),
      description: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      // Source is a session-scoped file; target is the persistent workspace root.
      const sourcePath = resolveWorkspaceRelativePath(input.sessionDir, toolInput.path);
      const filename = toolInput.filename ?? basename(sourcePath);
      const targetPath = resolveWorkspaceRelativePath(input.workspaceDir, filename);
      const sourceRef = input.fileAssetService.createRefFromPath({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        session_id: input.runContext.session_id,
        run_id: input.runContext.run_id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename),
        source: "workspace",
        path: sourcePath,
        ...(toolInput.description ? { metadata: { description: toolInput.description } } : {})
      }).ref;
      // Materialize into the workspace root (hardlink, fall back to copy).
      input.fileAssetService.materializeRefToPath({
        ref: sourceRef,
        targetPath,
        linkStrategy: "hardlink"
      });
      // Register as a cross-session workspace ref (session_id IS NULL).
      const resolved = input.fileAssetService.promoteFileToWorkspace({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        file_asset_ref_id: sourceRef.id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename)
      });
      return {
        ...fileAssetRefDto(resolved),
        download_url: `/api/v1/files/${resolved.ref.id}/download`
      };
    }
  }),
  list_workspace_files: createTool({
    id: "list_workspace_files",
    description: "List files in the cross-session workspace root (read-only). These are assets shared across "
      + "all of the user's sessions — uploads and promoted files. To read one, use read_workspace_file with the "
      + "returned path. New files you write go to the session scope (list_files), not here.",
    inputSchema: z.object({
      path: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const listPath = toolInput.path
        ? resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path)
        : input.workspaceDir;
      const entries = listWorkspaceFiles(listPath);
      return { path: toolInput.path ?? ".", files: entries };
    }
  }),
  read_workspace_file: createTool({
    id: "read_workspace_file",
    description: "Read a file from the cross-session workspace root (read-only). Use the path from "
      + "list_workspace_files. These files are shared across sessions; do not attempt to write or edit them "
      + "(use write_file for new session-scoped files, promote_workspace_file to add one here).",
    inputSchema: z.object({
      path: z.string().min(1)
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const filePath = resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path);
      const body = readFileSync(filePath);
      return {
        path: toolInput.path,
        content: body.toString("utf8"),
        size_bytes: body.length,
        mime_type: mimeTypeForFilename(toolInput.path)
      };
    }
  })
});

const resolveWorkspaceRelativePath = (workspaceDir: string, relativePath: string): string => {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  const path = resolve(workspaceDir, relativePath);
  if (path !== workspaceDir && !path.startsWith(`${workspaceDir}${sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }
  return path;
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

/** List files under a directory (one level) relative to the workspace root, read-only. */
type WorkspaceFileEntry = {
  is_directory: boolean;
  name: string;
  path: string;
  size_bytes: number;
};

const listWorkspaceFiles = (dirPath: string): WorkspaceFileEntry[] => {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== ".DS_Store")
    .map((entry) => {
      const full = join(dirPath, entry.name);
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        // unreadable entry — keep size 0
      }
      return {
        path: entry.name,
        name: entry.name,
        size_bytes: size,
        is_directory: entry.isDirectory()
      };
    });
};

const uniqueWorkspaceInputFilename = (filename: string, usedNames: Set<string>): string => {
  const safe = basename(filename).replace(/[^a-zA-Z0-9._ -]+/gu, "-").trim() || "file";
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  throw new Error("WORKSPACE_ATTACHMENT_NAME_EXHAUSTED");
};

export const normalizeIngressMessages = (messages: Message[]): Message[] =>
  messages
    .filter((message) => message.role !== "activity" && message.role !== "reasoning")
    .map(normalizeWorkspaceUploadMessage);

const normalizeWorkspaceUploadMessage = (message: Message): Message => {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return message;
  }
  const existingText = message.content
    .filter((part): part is { text: string; type: "text" } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const content: unknown[] = [];
  let changed = false;

  for (const part of message.content) {
    content.push(part);
    const uploadText = workspaceUploadPartText(part, existingText);
    if (uploadText) {
      content.push({ type: "text", text: uploadText });
      changed = true;
    }
  }

  return changed ? { ...message, content } as Message : message;
};

const workspaceUploadPartText = (part: unknown, existingText: string): string | undefined => {
  if (!isRecord(part)) {
    return undefined;
  }
  const source = isRecord(part.source) ? part.source : undefined;
  const rawPath = source?.type === "url" && typeof source.value === "string" ? source.value.trim() : undefined;
  if (
    !rawPath
    || !isWorkspaceUploadPath(rawPath)
    || (existingText.includes("Uploaded workspace file:") && existingText.includes(rawPath))
  ) {
    return undefined;
  }
  const metadata = isRecord(part.metadata) ? part.metadata : {};
  const filename = typeof metadata.filename === "string" && metadata.filename.trim()
    ? metadata.filename.trim()
    : basename(rawPath);
  const mimeType = typeof source?.mimeType === "string" && source.mimeType.trim()
    ? source.mimeType.trim()
    : "unknown";
  return [
    "Uploaded workspace file:",
    `- path: ${rawPath}`,
    `- filename: ${filename}`,
    `- mime_type: ${mimeType}`,
    "Use the workspace read_file tool with this path when you need the file contents."
  ].join("\n");
};

const isWorkspaceUploadPath = (value: string): boolean =>
  value.startsWith("uploads/")
  && !value.startsWith("/")
  && !value.includes("\0")
  && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
