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
import { createSkillTools, createWorkspaceTools } from "@mastra/core/workspace";
import type { Message } from "@ag-ui/core";
import type { ArtifactService } from "@open-data-agent/artifacts";
import type { DataGateway } from "@open-data-agent/data-gateway";
import { type FileAssetService, fileAssetRefDto, mimeTypeForFilename } from "@open-data-agent/files";
import type { KnowledgeService } from "@open-data-agent/knowledge";
import {
  materializeSkillPackages,
  type SkillRecord,
  type SkillSelectionResult
} from "@open-data-agent/skills";
import { copyFileSync, linkSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
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
import { createRunWorkspace, resolveRunWorkspaceDir } from "./tools/workspace-factory.js";
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
  "publish_artifact",
  "promote_workspace_file",
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
  artifactService?: ArtifactService;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  fileAssetService?: FileAssetService;
  knowledgeService?: KnowledgeService;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  mcpToolNames?: string[];
  selectedSkills?: SkillRecord[];
  skillSelection?: SkillSelectionResult;
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
  workspaceAttachments?: WorkspaceAttachment[];
  goal?: GoalRequest;
  /**
   * 工作区根目录（调用方注入）。未提供时回落到 WORKSPACE_ROOT，再回落到系统 temp。
   * 每个 run 在该目录下按 {user_id}/{session_id}/{run_id} 建立隔离子目录。
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

  const runDir = resolveRunWorkspaceDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  const materializedSkills = input.selectedSkills?.length
    ? await materializeSkillPackages({
        fileAssetService: requireFileAssetService(input.fileAssetService),
        runDir,
        skills: input.selectedSkills,
        userId: input.runContext.user_id,
        workspaceId: "default"
      })
    : [];
  // 绑定到本次 run 的工作区：LocalFilesystem + LocalSandbox（macOS seatbelt / Linux bubblewrap 隔离）。
  // createDataAgent 每次 run 都调用，直接闭包捕获 runContext，不依赖下游 requestContext 注入。
  const runWorkspace = createRunWorkspace({
    runContext: input.runContext,
    ...(materializedSkills.length > 0 ? { skillPaths: materializedSkills.map((skill) => skill.path) } : {}),
    workspaceRoot: input.workspaceRoot
  });
  const workspaceAttachments = materializeWorkspaceAttachments(runWorkspace.runDir, input.workspaceAttachments ?? []);

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
  const artifactTools = input.artifactService
    ? createArtifactTools({
        artifactService: input.artifactService,
        emitter: input.emitter,
        runContext: input.runContext,
        workspaceDir: runWorkspace.runDir
      })
    : {};
  const fileAssetTools = input.fileAssetService
    ? createFileAssetTools({
        fileAssetService: input.fileAssetService,
        runContext: input.runContext,
        workspaceDir: runWorkspace.runDir
      })
    : {};
  const workspaceTools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  const skillTools = runWorkspace.workspace.skills ? createSkillTools(runWorkspace.workspace.skills) : {};
  runWorkspace.workspace.setToolsConfig({ enabled: false });
  const availableTools = {
    ...registry.mastraTools,
    ...artifactTools,
    ...fileAssetTools,
    ...knowledgeTools,
    ...taskTools,
    ...collaborationTools,
    ...workspaceTools,
    ...skillTools
  };
  const selectedTools = selectToolsByPolicy(availableTools, input.skillSelection);
  const tools = governedToolFactory.governTools(selectedTools);
  const agent = new Agent({
    id: "data-agent",
    name: "Data Agent",
    instructions: buildAgentInstructions({
      runContext: input.runContext,
      commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
      collaborationToolsEnabled: Boolean(input.taskStateRuntime),
      selectedSkills: input.selectedSkills ?? [],
      taskToolsEnabled: Boolean(input.taskStateRuntime),
      toolNames: Object.keys(selectedTools),
      workspaceAttachments
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
  selectedSkills: SkillRecord[];
  /** builtin task_* 工具是否启用（取决于是否注入 taskStateRuntime）。 */
  taskToolsEnabled: boolean;
  toolNames: string[];
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
  const dataTools = ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"].filter(enabled);
  const toolGroups: string[] = dataTools.length > 0 ? [`Data tools: ${dataTools.join(", ")}.`] : [];
  if ((context.enabled_knowledge_ids?.length ?? 0) > 0 && enabled("retrieve_knowledge")) {
    toolGroups.push("Knowledge tools: retrieve_knowledge.");
  }
  if (enabled("publish_artifact")) {
    toolGroups.push("Artifact tools: publish_artifact.");
  }
  if (enabled("promote_workspace_file")) {
    toolGroups.push("File asset tools: promote_workspace_file.");
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
  if (input.workspaceAttachments.length > 0) {
    toolGroups.push(`Uploaded workspace input files: ${input.workspaceAttachments
      .map((file) => `${file.path} (file_id=${file.file_id}, mime=${file.mime_type ?? "unknown"}, size=${file.size_bytes})`)
      .join("; ")}.`);
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
  if (input.selectedSkills.length > 0 && skillTools.length > 0) {
    policies.push(
      "Use skills as task guidance, not as executable tools. When the task matches an available skill, call "
        + "skill_search or skill to load its instructions, then use normal approved tools to act. "
        + "Use skill_read for references, scripts, or assets that belong to a selected skill. "
        + "Scripts from skills may be executed only through approved workspace tools such as execute_command."
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
        + "the final message. Call publish_artifact for files that should be visible and downloadable by the user. "
        + "Call promote_workspace_file only for files that should be reused in later runs but are not final deliverables."
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
  const selectedSkillSummary = input.selectedSkills.length > 0
    ? input.selectedSkills.map((skill) => `${skill.name} (${skill.id}): ${skill.description}`).join("\n")
    : "None";

  return `
You are a general-purpose data agent. Analyze data by calling tools. Never invent schema, rows, SQL results,
file contents, or command output.

Datasources available this run: [${(context.enabled_datasource_ids ?? []).join(", ")}]
Default datasource: "${context.selected_datasource_id}".
You may query any datasource in the list above by passing its id to a data tool's datasource_id argument.
Never reference a datasource id outside this list; the tool rejects it with DATASOURCE_NOT_SELECTED.
Available skills this run:
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

const createArtifactTools = (input: {
  artifactService: ArtifactService;
  emitter: AgUiEventEmitter;
  runContext: AgentRunContext;
  workspaceDir: string;
}): Record<string, ReturnType<typeof createTool>> => ({
  publish_artifact: createTool({
    id: "publish_artifact",
    description: "Publish a file from the current run workspace as a downloadable artifact.",
    inputSchema: z.object({
      path: z.string().min(1),
      name: z.string().min(1).optional(),
      type: z.enum(["table", "chart", "markdown", "html", "file", "image", "citation_bundle"]).default("file"),
      preview: z.unknown().optional()
    }),
    execute: async (toolInput) => {
      const sourcePath = resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path);
      const name = toolInput.name ?? basename(sourcePath);
      const artifact = await input.artifactService.createArtifactFromFile({
        user_id: input.runContext.user_id,
        session_id: input.runContext.session_id,
        run_id: input.runContext.run_id,
        workspace_id: "default",
        type: toolInput.type ?? "file",
        name,
        source_path: sourcePath,
        ...(toolInput.preview !== undefined ? { preview_json: toolInput.preview } : {})
      });
      input.emitter.emit(createCustomEvent("artifact", artifact));
      return artifact;
    }
  })
});

const createFileAssetTools = (input: {
  fileAssetService: FileAssetService;
  runContext: AgentRunContext;
  workspaceDir: string;
}): Record<string, ReturnType<typeof createTool>> => ({
  promote_workspace_file: createTool({
    id: "promote_workspace_file",
    description: "Promote a file from the current run workspace into a reusable file asset.",
    inputSchema: z.object({
      path: z.string().min(1),
      filename: z.string().min(1).optional(),
      description: z.string().optional()
    }),
    execute: async (toolInput) => {
      const sourcePath = resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path);
      const filename = toolInput.filename ?? basename(sourcePath);
      const resolved = input.fileAssetService.createRefFromPath({
        user_id: input.runContext.user_id,
        workspace_id: "default",
        session_id: input.runContext.session_id,
        run_id: input.runContext.run_id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename),
        source: "workspace",
        path: sourcePath,
        ...(toolInput.description ? { metadata: { description: toolInput.description } } : {})
      });
      return {
        ...fileAssetRefDto(resolved),
        download_url: `/api/v1/files/${resolved.ref.id}/download`
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

const sanitizeIngressMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => message.role !== "activity" && message.role !== "reasoning");
