import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint
} from "@copilotkit/runtime";
import {
  createTaskStateRuntime,
  createCustomEvent,
  parseAgentMemoryMode,
  type AgentMemoryMode,
  type TaskStateRuntime
} from "@open-data-agent/agent-runtime";
import { LocalArtifactService } from "@open-data-agent/artifacts";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@open-data-agent/contracts";
import { LocalDataGateway, createDemoDuckDbConfig } from "@open-data-agent/data-gateway";
import { LocalFileAssetService } from "@open-data-agent/files";
import { LocalKnowledgeService } from "@open-data-agent/knowledge";
import {
  RunEventWriter,
  createMetadataStore,
  type UserRecord,
  type MetadataStore
} from "@open-data-agent/metadata";
import { buildSkillResourcePayload, parseSkillPackage } from "@open-data-agent/skills";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Observable } from "rxjs";

import { handleConfigApiRequest } from "./config-api.js";
import { createRunAgentAssembly, createRunAgentContext } from "./run-agent-assembly.js";
import { resolveRunConfig } from "./run-config-resolver.js";
import { resolveRunIdentity } from "./run-identity-orchestrator.js";
import { createRunMemoryAssembly } from "./run-memory-assembly.js";
import { extractLastUserText } from "./run-input.js";
import { extractInteractionResume, InteractionRuntimeAdapter } from "./interaction-runtime-adapter.js";
import { RunCancelRegistry } from "./run-cancel-registry.js";
import { RunEventPipeline } from "./run-event-pipeline.js";
import { RunFinalizer } from "./run-finalizer.js";
import { startSessionTitleTask } from "./session-title.js";
import { TaskPlanProjector } from "./task-plan-projector.js";
import { ToolCallResultBridge } from "./tool-call-result-bridge.js";

const DEV_USER: MeResponse = {
  id: "dev-user",
  email: "dev@example.com",
  display_name: "Dev User"
};

const COPILOTKIT_PATH = "/api/copilotkit";
const DEFAULT_WORKSPACE_ID = "default";
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILL_ROOT = join(SERVER_DIR, "../../../packages/skills/builtin");

export type CreateServerOptions = {
  conversationMemoryMode?: AgentMemoryMode | undefined;
  memoryExtractionTimeoutMs?: number | undefined;
  metadataStore?: MetadataStore;
  taskStateRuntime?: TaskStateRuntime;
};

export const createServer = async (options: CreateServerOptions = {}): Promise<Server> => {
  const envConfig = createEnvConfig(process.env);
  const conversationMemoryMode =
    options.conversationMemoryMode
    ?? parseAgentMemoryMode(process.env.MASTRA_CONVERSATION_MEMORY_MODE, "working-memory-readonly");
  const metadataStore =
    options.metadataStore ??
    createMetadataStore({
      database_path: process.env.METADATA_DB_PATH ?? join(envConfig.storage.root_dir, "metadata", "workbench.sqlite"),
      ...(envConfig.storage.secret_master_key ? { secret_master_key: envConfig.storage.secret_master_key } : {}),
      dev_user: {
        id: DEV_USER.id,
        email: DEV_USER.email ?? "dev@example.com",
        display_name: DEV_USER.display_name ?? "Dev User",
        dev_token: "dev-token"
      }
    });
  const fileAssetService = new LocalFileAssetService(metadataStore, {
    storageRoot: process.env.FILE_ASSET_STORAGE_ROOT ?? join(envConfig.storage.root_dir, "files")
  });
  const dataGateway = new LocalDataGateway(metadataStore, {
    defaultLimit: envConfig.sql.default_limit,
    maxLimit: envConfig.sql.max_limit,
    timeoutMs: envConfig.sql.timeout_ms,
    workspaceId: DEFAULT_WORKSPACE_ID
  }, fileAssetService);
  const artifactService = new LocalArtifactService(metadataStore, fileAssetService);
  const knowledgeService = new LocalKnowledgeService(metadataStore, {
    embedding: {
      provider: envConfig.embedding.provider,
      model: envConfig.embedding.model,
      base_url: envConfig.embedding.base_url,
      ...(envConfig.embedding.api_key ? { api_key: envConfig.embedding.api_key } : {})
    }
  });
  const ownsTaskStateRuntime = options.taskStateRuntime === undefined;
  const taskStateRuntime =
    options.taskStateRuntime ??
    await createTaskStateRuntime(
      process.env.MASTRA_STORAGE_PATH ?? join(envConfig.storage.root_dir, "mastra", "agent-state.sqlite"),
      { conversationMemoryMode }
    );
  const runCancelRegistry = new RunCancelRegistry();
  ensureDevUser(metadataStore);
  ensureDemoDataSource(metadataStore, DEV_USER.id, "api-duckdb-demo");
  await ensureBuiltinConfigResources(fileAssetService, metadataStore, DEV_USER.id, DEFAULT_WORKSPACE_ID);

  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        sendJson(response, 200, createSuccessResult({ status: "ok" }));
        return;
      }

      if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/v1/")) {
        sendCorsPreflight(response);
        return;
      }

      const authContext = resolveRequestAuth(request, metadataStore);
      if (authContext.user.id === DEV_USER.id) {
        ensureDemoDataSource(metadataStore, authContext.user.id, "api-duckdb-demo");
      }
      await ensureBuiltinConfigResources(fileAssetService, metadataStore, authContext.user.id, authContext.workspaceId);

      const configResponse = await handleConfigApiRequest(request, requestUrl.pathname, {
        dataGateway,
        fileAssetService,
        knowledgeService,
        metadataStore,
        runCancelRegistry,
        userId: authContext.user.id,
        workspaceId: authContext.workspaceId
      });
      if (configResponse) {
        if (Buffer.isBuffer(configResponse.body)) {
          response.writeHead(configResponse.status, {
            "Access-Control-Allow-Origin": "*",
            ...configResponse.headers
          });
          response.end(configResponse.body);
        } else {
          sendJson(response, configResponse.status, configResponse.body);
        }
        return;
      }

      if (isCopilotKitPath(requestUrl.pathname)) {
        if (request.method === "OPTIONS") {
          sendCorsPreflight(response);
          return;
        }

        await handleCopilotKitRequest({
          request,
          response,
          metadataStore,
          dataGateway,
          artifactService,
          fileAssetService,
          knowledgeService,
          taskStateRuntime,
          conversationMemoryMode,
          memoryExtractionTimeoutMs: options.memoryExtractionTimeoutMs
            ?? envConfig.memory.completed_extraction_timeout_ms,
          runCancelRegistry,
          user: authContext.user,
          workspaceId: authContext.workspaceId
        });
        return;
      }

      sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Route not found."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";

      if (!response.headersSent) {
        if (message.startsWith("UNAUTHORIZED:")) {
          sendJson(response, 401, createErrorResult("UNAUTHORIZED", message.slice("UNAUTHORIZED:".length)));
          return;
        }
        sendJson(response, 500, createErrorResult("NOT_ENABLED", message));
        return;
      }

      response.destroy(error instanceof Error ? error : new Error(message));
    }
  });

  server.on("close", () => {
    metadataStore.close();
    if (ownsTaskStateRuntime) {
      void taskStateRuntime.close();
    }
  });

  return server;
};

type HandleCopilotKitRequestInput = {
  artifactService: LocalArtifactService;
  conversationMemoryMode: AgentMemoryMode;
  request: IncomingMessage;
  response: ServerResponse;
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  fileAssetService: LocalFileAssetService;
  knowledgeService: LocalKnowledgeService;
  memoryExtractionTimeoutMs: number;
  runCancelRegistry: RunCancelRegistry;
  taskStateRuntime: TaskStateRuntime;
  user: MeResponse;
  workspaceId: string;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway,
  artifactService,
  fileAssetService,
  conversationMemoryMode,
  knowledgeService,
  memoryExtractionTimeoutMs,
  runCancelRegistry,
  taskStateRuntime,
  user,
  workspaceId
}: HandleCopilotKitRequestInput): Promise<void> => {
  const runtime = new CopilotRuntime({
    agents: {
      dataAgent: new DataAgentAgUiAgent({
        dataGateway,
        artifactService,
        fileAssetService,
        conversationMemoryMode,
        knowledgeService,
        memoryExtractionTimeoutMs,
        defaultDatasourceId: "api-duckdb-demo",
        metadataStore,
        runCancelRegistry,
        taskStateRuntime,
        user,
        workspaceId,
        workspaceRoot: process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces")
      })
    }
  });
  const endpoint = copilotRuntimeNodeHttpEndpoint({
    endpoint: COPILOTKIT_PATH,
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    cors: {
      origin: "*"
    }
  });

  try {
    await endpoint(request, response);
  } catch (error) {
    throw error;
  }
};

type DataAgentAgUiAgentInput = {
  artifactService: LocalArtifactService;
  conversationMemoryMode: AgentMemoryMode;
  dataGateway: LocalDataGateway;
  defaultDatasourceId: string;
  fileAssetService: LocalFileAssetService;
  metadataStore: MetadataStore;
  knowledgeService: LocalKnowledgeService;
  memoryExtractionTimeoutMs: number;
  runCancelRegistry: RunCancelRegistry;
  taskStateRuntime: TaskStateRuntime;
  user: MeResponse;
  workspaceId: string;
  workspaceRoot: string;
};

class DataAgentAgUiAgent extends AbstractAgent {
  private input: DataAgentAgUiAgentInput;

  constructor(input: DataAgentAgUiAgentInput) {
    super({
      agentId: "dataAgent",
      description: "Read-only data analysis agent backed by Mastra and Data Gateway."
    });
    this.input = input;
  }

  clone(): DataAgentAgUiAgent {
    const cloned = super.clone() as DataAgentAgUiAgent;
    cloned.input = this.input;
    return cloned;
  }

  run(runInput: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = async (): Promise<void> => {
        const sessionId = runInput.threadId;
        const interactionResume = extractInteractionResume(runInput);
        const runId = interactionResume?.interrupt.runId ?? runInput.runId;
        // CopilotKit may send a fresh runId on resume; Mastra embeds runInput.runId in
        // on_interrupt payloads, so keep AG-UI identity aligned with the suspended run.
        const normalizedRunInput =
          runId === runInput.runId ? runInput : { ...runInput, runId };
        const userInput = extractLastUserText(normalizedRunInput) ?? "CopilotKit AG-UI run";
        const {
          effectiveRunConfig,
          mcpRuntime,
          modelContextProfile,
          modelProvider,
          modelSettings,
          reasoningModel,
          runTimeoutMs,
          selectedSkills,
          skillSelection
        } = resolveRunConfig({
          defaultDatasourceId: this.input.defaultDatasourceId,
          metadataStore: this.input.metadataStore,
          runInput: normalizedRunInput,
          userId: this.input.user.id,
          userInput,
          workspaceId: this.input.workspaceId
        });
        const runEventWriter = new RunEventWriter(this.input.metadataStore.runEvents);
        const identity = resolveRunIdentity({
          effectiveRunConfig,
          ...(interactionResume ? { interactionResume } : {}),
          metadataStore: this.input.metadataStore,
          modelName: modelProvider.model_name,
          runEventWriter,
          runInput: normalizedRunInput,
          userId: this.input.user.id,
          userInput
        });
        if (identity.kind === "replay") {
          identity.events.forEach((event) => subscriber.next(event));
          subscriber.complete();
          return;
        }
        const { isResume, selectedDatasourceId } = identity;

        const memoryAssembly = await createRunMemoryAssembly({
          conversationMemoryMode: this.input.conversationMemoryMode,
          isResume,
          metadataStore: this.input.metadataStore,
          model: modelProvider.model,
          modelName: modelProvider.model_name,
          modelTemperature: modelSettings?.temperature,
          runId,
          runInput: normalizedRunInput,
          selectedDatasourceId,
          sessionId,
          taskStateRuntime: this.input.taskStateRuntime,
          userId: this.input.user.id,
          userInput
        });
        const {
          conversationMemoryObserver,
          conversationMessages,
          longTermMemories
        } = memoryAssembly;
        const runContext = createRunAgentContext({
          effectiveRunConfig,
          modelProvider,
          runId,
          selectedDatasourceId,
          sessionId,
          userId: this.input.user.id,
          userInput,
          workspaceId: this.input.workspaceId
        });
        const taskPlanProjector = new TaskPlanProjector(runContext);
        const toolCallResultBridge = new ToolCallResultBridge();
        const runAbortController = new AbortController();
        const interactionRuntime = new InteractionRuntimeAdapter(
          this.input.metadataStore,
          this.input.user.id,
          sessionId,
          runId
        );
        const eventPipeline = new RunEventPipeline({
          conversationMemoryObserver,
          runEventWriter,
          runId,
          sessionId,
          taskPlanProjector,
          toolCallResultBridge,
          userId: this.input.user.id,
          sink: (event) => subscriber.next(event)
        });
        const emit = (event: BaseEvent): void => {
          eventPipeline.emit(event);
        };
        const agentAssembly = await createRunAgentAssembly({
          abortSignal: runAbortController.signal,
          dataGateway: this.input.dataGateway,
          artifactService: this.input.artifactService,
          effectiveRunConfig,
          fileAssetService: this.input.fileAssetService,
          emitter: { emit },
          ...(effectiveRunConfig.goal ? { goal: effectiveRunConfig.goal } : {}),
          ...(interactionResume ? { interactionResume } : {}),
          knowledgeService: this.input.knowledgeService,
          longTermMemories,
          mcpRuntime,
          messages: conversationMessages,
          ...(modelContextProfile ? { modelContextProfile } : {}),
          modelProvider,
          ...(modelSettings ? { modelSettings } : {}),
          runContext,
          selectedSkills,
          skillSelection,
          taskStateRuntime: this.input.taskStateRuntime,
          userId: this.input.user.id,
          workspaceId: this.input.workspaceId,
          workspaceRoot: this.input.workspaceRoot
        });
        const finalizer = new RunFinalizer({
          destroyWorkspace: agentAssembly.destroyWorkspace,
          emit,
          fileAssetService: this.input.fileAssetService,
          flushCompletedMemory: (flushInput) => memoryAssembly.flushCompletedMemory(flushInput),
          flushDraftsMemory: () => {
            memoryAssembly.flushDraftsMemory();
          },
          memoryExtractionTimeoutMs: this.input.memoryExtractionTimeoutMs,
          metadataStore: this.input.metadataStore,
          runId,
          sessionId,
          userId: this.input.user.id,
          sessionDir: agentAssembly.sessionDir,
          workspaceId: this.input.workspaceId
        });
        let subscription: { unsubscribe(): void } | undefined;
        let suspended = false;
        let resumeResolved = false;
        let finalization: Promise<void> | undefined;
        let unregisterCancel = (): void => undefined;
        let runTimeout: ReturnType<typeof setTimeout> | undefined;
        let terminalStarted = false;
        let sessionTitleStarted = false;
        const clearRunTimeout = (): void => {
          if (runTimeout) {
            clearTimeout(runTimeout);
            runTimeout = undefined;
          }
        };
        const failRun = (message: string, terminalEvent?: BaseEvent): void => {
          if (terminalStarted) {
            return;
          }
          terminalStarted = true;
          runAbortController.abort(new Error(message));
          clearRunTimeout();
          unregisterCancel();
          finalizer.fail({
            errorMessage: message,
            terminalEvent: terminalEvent ?? {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            }
          });
        };
        const cancelRun = (reason = "RUN_CANCELLED"): void => {
          if (terminalStarted) {
            return;
          }
          terminalStarted = true;
          runAbortController.abort(new Error(reason));
          clearRunTimeout();
          unregisterCancel();
          subscription?.unsubscribe();
          finalization = finalizer.cancelRun({
            reason,
            terminalEvent: {
              type: EventType.RUN_FINISHED,
              status: "cancelled",
              timestamp: Date.now()
            } as BaseEvent
          });
          void finalization.then(() => subscriber.complete(), (error: unknown) => subscriber.error(error));
        };
        unregisterCancel = this.input.runCancelRegistry.register({
          cancel: cancelRun,
          runId,
          sessionId,
          userId: this.input.user.id
        });
        subscriber.add(() => unregisterCancel());

        subscription = agentAssembly.mastraAgent.run({
          ...normalizedRunInput,
          runId,
          messages: agentAssembly.governedMessages
        }).subscribe({
          next: (event) => {
            if (terminalStarted) {
              return;
            }
            const interactionRequested = interactionRuntime.capture(event);
            if (interactionRequested) {
              terminalStarted = true;
              clearRunTimeout();
              unregisterCancel();
              suspended = true;
              emit(interactionRequested);
              finalizer.suspend();
              // CopilotKit useInterrupt listens for the native Mastra interrupt event.
              if (event.type === EventType.CUSTOM && event.name === "on_interrupt") {
                emit(event);
              }
              // Stream must finalize so CopilotKit can surface the interrupt UI via onRunFinalized.
              // This synthetic terminal event is transport-only; suspended runs must not replay as finished.
              subscriber.next({
                type: EventType.RUN_FINISHED,
                timestamp: Date.now()
              });
              return;
            }
            if (event.type === EventType.RUN_FINISHED && suspended) {
              return;
            }
            if (event.type === EventType.RUN_FINISHED && interactionResume?.response === false) {
              terminalStarted = true;
              clearRunTimeout();
              unregisterCancel();
              finalization = finalizer.cancel({
                interactionResolvedEvent: interactionRuntime.cancel(interactionResume),
                terminalEvent: event
              });
              return;
            }
            if (event.type === EventType.RUN_FINISHED) {
              terminalStarted = true;
              clearRunTimeout();
              unregisterCancel();
              finalization = finalizer.complete({ goalRuntime: agentAssembly.goalRuntime, terminalEvent: event });
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              failRun("AG-UI run error", event);
              return;
            }
            emit(event);

            if (
              interactionResume
              && !resumeResolved
              && event.type === EventType.TOOL_CALL_RESULT
              && event.toolCallId === interactionResume.interrupt.toolCallId
            ) {
              try {
                emit(interactionRuntime.resolve(interactionResume));
                resumeResolved = true;
              } catch (error) {
                const message = error instanceof Error ? error.message : "Interaction resume failed";
                emit({
                  type: EventType.RUN_ERROR,
                  message,
                  timestamp: Date.now()
                });
              }
            }

            if (event.type === EventType.RUN_STARTED) {
              emit(createCustomEvent("run.config.resolved", {
                active_datasource_id: effectiveRunConfig.activeDatasourceId,
                active_skill_id: effectiveRunConfig.activeSkillId,
                enabled_datasource_ids: effectiveRunConfig.enabledDatasourceIds,
                file_ids: effectiveRunConfig.fileIds,
                enabled_knowledge_ids: effectiveRunConfig.enabledKnowledgeIds,
                enabled_mcp_server_ids: effectiveRunConfig.enabledMcpServerIds,
                selected_skill_ids: selectedSkills.map((skill) => skill.id),
                skill_mode: effectiveRunConfig.skillMode,
                requested_llm_profile_id: effectiveRunConfig.activeLlmProfileId,
                active_llm_profile_id: effectiveRunConfig.activeLlmProfileId,
                workspace_id: this.input.workspaceId,
                workspace: agentAssembly.workspace,
                ...(modelContextProfile
                  ? {
                      context_window: modelContextProfile.contextWindow,
                      input_budget: Math.max(
                        modelContextProfile.contextWindow
                          - modelContextProfile.outputReserve
                          - modelContextProfile.safetyMargin,
                        0
                      )
                    }
                  : {}),
                ...(reasoningModel !== undefined ? { reasoning_model: reasoningModel } : {}),
                ...(runTimeoutMs !== undefined ? { run_timeout_ms: runTimeoutMs } : {}),
                ...(effectiveRunConfig.mentioned
                  ? {
                      mentioned: {
                        db: effectiveRunConfig.mentioned.db,
                        kb: effectiveRunConfig.mentioned.kb,
                        mcp: effectiveRunConfig.mentioned.mcp,
                        skill: effectiveRunConfig.mentioned.skill,
                        ...(effectiveRunConfig.mentioned.excluded && effectiveRunConfig.mentioned.excluded.length > 0
                          ? { excluded: effectiveRunConfig.mentioned.excluded }
                          : {})
                      }
                    }
                  : {}),
                ...((effectiveRunConfig.pinnedPaths?.length ?? 0) > 0
                  ? { pinned_paths: effectiveRunConfig.pinnedPaths }
                  : {}),
                ...(effectiveRunConfig.disabledByPolicy && effectiveRunConfig.disabledByPolicy.length > 0
                  ? { disabled_by_policy: effectiveRunConfig.disabledByPolicy }
                  : {})
              }));
              emit(createCustomEvent("skill.selection", {
                audit: skillSelection.audit,
                effective_tool_policy: skillSelection.effectiveToolPolicy,
                mode: effectiveRunConfig.skillMode,
                selected: selectedSkills.map((skill) => ({
                  id: skill.id,
                  name: skill.name,
                  revision: skill.revision,
                  tags: skill.tags
                }))
              }));
              emit({
                type: EventType.STATE_SNAPSHOT,
                snapshot: {
                  selectedDatasourceId,
                  runId,
                  runStatus: "running",
                  sessionId
                },
                timestamp: Date.now()
              });
              if (!isResume && !sessionTitleStarted) {
                sessionTitleStarted = true;
                startSessionTitleTask({
                  emit: (titleEvent) => {
                    if (!terminalStarted) {
                      emit(titleEvent);
                    }
                  },
                  metadataStore: this.input.metadataStore,
                  model: modelProvider.model,
                  modelTemperature: modelSettings?.temperature,
                  sessionId,
                  userId: this.input.user.id,
                  userInput
                });
              }
            }

          },
          error: (error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown AG-UI agent error";
            const event: BaseEvent = {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            };
            failRun(message, event);
            subscriber.error(error);
          },
          complete: () => {
            clearRunTimeout();
            unregisterCancel();
            if (finalization) {
              void finalization.then(() => subscriber.complete(), (error: unknown) => subscriber.error(error));
              return;
            }
            subscriber.complete();
          }
        });

        if (runTimeoutMs !== undefined) {
          runTimeout = setTimeout(() => {
            runAbortController.abort(new Error(`RUN_TIMEOUT:${runTimeoutMs}`));
            subscription?.unsubscribe();
            failRun(`RUN_TIMEOUT:${runTimeoutMs}`);
            subscriber.complete();
          }, runTimeoutMs);
        }

        subscriber.add(() => {
          if (!terminalStarted) {
            runAbortController.abort(new Error("RUN_SUBSCRIBER_CLOSED"));
          }
          clearRunTimeout();
          unregisterCancel();
          subscription?.unsubscribe();
        });
      };

      run().catch((error: unknown) => {
        subscriber.error(error);
      });
    });
  }
}

const isCopilotKitPath = (pathname: string): boolean =>
  pathname === COPILOTKIT_PATH || pathname.startsWith(`${COPILOTKIT_PATH}/`);

const sendCorsPreflight = (response: ServerResponse): void => {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, If-Match, X-Dev-Token, X-Workspace-Id",
    "Access-Control-Max-Age": "86400"
  });
  response.end();
};

type RequestAuthContext = {
  user: MeResponse;
  workspaceId: string;
};

const resolveRequestAuth = (request: IncomingMessage, metadataStore: MetadataStore): RequestAuthContext => {
  const token = extractAuthToken(request);
  const workspaceId = sanitizeWorkspaceId(headerString(request.headers["x-workspace-id"]));
  if (!token) {
    return { user: DEV_USER, workspaceId };
  }
  const user = metadataStore.users.getByDevToken({ dev_token: token });
  if (!user) {
    throw new Error("UNAUTHORIZED:Invalid local auth token.");
  }
  return { user: userRecordToMeResponse(user), workspaceId };
};

const extractAuthToken = (request: IncomingMessage): string | undefined => {
  const authorization = headerString(request.headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }
  return headerString(request.headers["x-dev-token"]);
};

const sanitizeWorkspaceId = (value: string | undefined): string => {
  const candidate = value?.trim() || DEFAULT_WORKSPACE_ID;
  if (!/^[a-zA-Z0-9._-]{1,128}$/u.test(candidate)) {
    throw new Error("UNAUTHORIZED:Invalid workspace id.");
  }
  return candidate;
};

const headerString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const userRecordToMeResponse = (user: UserRecord): MeResponse => ({
  id: user.id,
  ...(user.email ? { email: user.email } : {}),
  ...(user.display_name ? { display_name: user.display_name } : {})
});

const ensureDevUser = (metadataStore: MetadataStore): void => {
  metadataStore.users.upsertDevUser({
    id: DEV_USER.id,
    email: DEV_USER.email ?? "dev@example.com",
    display_name: DEV_USER.display_name ?? "Dev User",
    dev_token: "dev-token"
  });
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
};

const ensureDemoDataSource = (metadataStore: MetadataStore, userId: string, datasourceId: string): void => {
  const demoConfig = createDemoDuckDbConfig();

  try {
    const current = metadataStore.dataSources.get({
      user_id: userId,
      datasource_id: datasourceId
    });
    const config = JSON.parse(current.config_json) as Record<string, unknown>;
    if (
      config.builtin !== true
      || config.defaultEnabled !== true
      || config.mode !== "demo"
      || config.path !== demoConfig.path
    ) {
      metadataStore.dataSources.create({
        user_id: userId,
        id: current.id,
        name: current.name,
        type: current.type,
        config: { ...config, ...demoConfig },
        ...(current.description ? { description: current.description } : {}),
        status: current.status
      });
    }
  } catch {
    metadataStore.dataSources.create({
      user_id: userId,
      id: datasourceId,
      name: "API DuckDB Demo",
      type: "duckdb",
      config: demoConfig,
      description: "Default demo datasource for agent runtime smoke runs."
    });
  }
};

const BUILTIN_SKILL_SOURCES = [
  { id: "data-analysis", path: join(BUILTIN_SKILL_ROOT, "data-analysis", "SKILL.md") }
] as const;

const ensureBuiltinConfigResources = async (
  fileAssetService: LocalFileAssetService,
  metadataStore: MetadataStore,
  userId: string,
  workspaceId: string
): Promise<void> => {
  const common = { workspace_id: workspaceId, user_id: userId };
  if (!metadataStore.configResources.find({ ...common, kind: "model-profile", id: "server-default" })) {
    metadataStore.configResources.upsert({
      ...common,
      kind: "model-profile",
      id: "server-default",
      name: "服务端默认",
      description: "Uses the server LLM environment variables.",
      payload: { provider: "server", modelName: "server", baseUrl: "server" },
      builtin: true,
      status: "connected"
    });
  }
  for (const source of BUILTIN_SKILL_SOURCES) {
    const content = readFileSync(source.path);
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    const current = metadataStore.configResources.find({ ...common, kind: "skill", id: source.id });
    const currentPackageRefId = stringRecordValue(current?.payload, "packageFileRefId");
    const currentContentSha256 = stringRecordValue(current?.payload, "builtinContentSha256");
    if (currentPackageRefId && currentContentSha256 === contentSha256 && current?.status === "valid") {
      continue;
    }
    const parsed = await parseSkillPackage({
      content,
      filename: "SKILL.md",
      mimeType: "text/markdown"
    });
    const packageRef = fileAssetService.createRef({
      user_id: userId,
      workspace_id: workspaceId,
      filename: "SKILL.md",
      content,
      declared_mime_type: "text/markdown",
      source: "upload",
      metadata: { builtin: true, kind: "skill-package", skill: parsed.name, version: parsed.version }
    });
    metadataStore.configResources.upsert({
      ...common,
      kind: "skill",
      id: source.id,
      name: parsed.name,
      description: parsed.description,
      payload: {
        ...buildSkillResourcePayload({
          fields: { packageSource: `builtin://${source.id}` },
          packageFileRefId: packageRef.ref.id,
          parsed
        }),
        builtinContentSha256: contentSha256,
        builtinSource: `builtin://${source.id}`
      },
      builtin: true,
      default_enabled: false,
      status: "valid"
    });
  }
};

const stringRecordValue = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
