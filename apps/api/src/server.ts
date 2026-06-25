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
import { LocalDataGateway } from "@open-data-agent/data-gateway";
import { LocalFileAssetService } from "@open-data-agent/files";
import { LocalKnowledgeService } from "@open-data-agent/knowledge";
import {
  RunEventWriter,
  createMetadataStore,
  type MetadataStore
} from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Observable } from "rxjs";

import { handleConfigApiRequest } from "./config-api.js";
import { createRunAgentAssembly, createRunAgentContext } from "./run-agent-assembly.js";
import { resolveRunConfig } from "./run-config-resolver.js";
import { resolveRunIdentity } from "./run-identity-orchestrator.js";
import { createRunMemoryAssembly } from "./run-memory-assembly.js";
import { extractLastUserText } from "./run-input.js";
import { extractInteractionResume, InteractionRuntimeAdapter } from "./interaction-runtime-adapter.js";
import { RunEventPipeline } from "./run-event-pipeline.js";
import { RunFinalizer } from "./run-finalizer.js";
import { TaskPlanProjector } from "./task-plan-projector.js";
import { ToolCallResultBridge } from "./tool-call-result-bridge.js";

const DEV_USER: MeResponse = {
  id: "dev-user",
  email: "dev@example.com",
  display_name: "Dev User"
};

const COPILOTKIT_PATH = "/api/copilotkit";

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
  const dataGateway = new LocalDataGateway(metadataStore, {
    defaultLimit: envConfig.sql.default_limit,
    maxLimit: envConfig.sql.max_limit,
    timeoutMs: envConfig.sql.timeout_ms
  });
  const fileAssetService = new LocalFileAssetService(metadataStore, {
    storageRoot: process.env.FILE_ASSET_STORAGE_ROOT ?? join(envConfig.storage.root_dir, "files")
  });
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
  ensureDemoDataSource(metadataStore, "api-duckdb-demo");
  ensureBuiltinConfigResources(metadataStore);

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

      const configResponse = await handleConfigApiRequest(request, requestUrl.pathname, {
        dataGateway,
        fileAssetService,
        knowledgeService,
        metadataStore,
        userId: DEV_USER.id
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
            ?? envConfig.memory.completed_extraction_timeout_ms
        });
        return;
      }

      sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Route not found."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";

      if (!response.headersSent) {
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
  taskStateRuntime: TaskStateRuntime;
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
  taskStateRuntime
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
        taskStateRuntime,
        user: DEV_USER,
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
  taskStateRuntime: TaskStateRuntime;
  user: MeResponse;
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
        const runId = runInput.runId;
        const interactionResume = extractInteractionResume(runInput);
        const userInput = extractLastUserText(runInput) ?? "CopilotKit AG-UI run";
        const {
          effectiveRunConfig,
          mcpRuntime,
          modelProvider,
          modelSettings,
          selectedSkills,
          skillSelection
        } = resolveRunConfig({
          defaultDatasourceId: this.input.defaultDatasourceId,
          metadataStore: this.input.metadataStore,
          runInput,
          userId: this.input.user.id,
          userInput
        });
        const runEventWriter = new RunEventWriter(this.input.metadataStore.runEvents);
        const identity = resolveRunIdentity({
          effectiveRunConfig,
          ...(interactionResume ? { interactionResume } : {}),
          metadataStore: this.input.metadataStore,
          modelName: modelProvider.model_name,
          runEventWriter,
          runInput,
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
          runInput,
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
          userInput
        });
        const taskPlanProjector = new TaskPlanProjector(runContext);
        const toolCallResultBridge = new ToolCallResultBridge();
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
          modelProvider,
          ...(modelSettings ? { modelSettings } : {}),
          runContext,
          selectedSkills,
          skillSelection,
          taskStateRuntime: this.input.taskStateRuntime,
          userId: this.input.user.id,
          workspaceRoot: this.input.workspaceRoot
        });
        const finalizer = new RunFinalizer({
          destroyWorkspace: agentAssembly.destroyWorkspace,
          emit,
          flushCompletedMemory: (flushInput) => memoryAssembly.flushCompletedMemory(flushInput),
          memoryExtractionTimeoutMs: this.input.memoryExtractionTimeoutMs,
          metadataStore: this.input.metadataStore,
          runId,
          userId: this.input.user.id
        });
        let suspended = false;
        let resumeResolved = false;
        let finalization: Promise<void> | undefined;
        const subscription = agentAssembly.mastraAgent.run({
          ...runInput,
          messages: agentAssembly.governedMessages
        }).subscribe({
          next: (event) => {
            const interactionRequested = interactionRuntime.capture(event);
            if (interactionRequested) {
              suspended = true;
              emit(interactionRequested);
              finalizer.suspend();
              return;
            }
            if (event.type === EventType.RUN_FINISHED && suspended) {
              return;
            }
            if (event.type === EventType.RUN_FINISHED && interactionResume?.response === false) {
              finalization = finalizer.cancel({
                interactionResolvedEvent: interactionRuntime.cancel(interactionResume),
                terminalEvent: event
              });
              return;
            }
            if (event.type === EventType.RUN_FINISHED) {
              finalization = finalizer.complete({ goalRuntime: agentAssembly.goalRuntime, terminalEvent: event });
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              finalizer.fail({ errorMessage: "AG-UI run error", terminalEvent: event });
              return;
            }
            emit(event);

            if (
              interactionResume
              && !resumeResolved
              && event.type === EventType.TOOL_CALL_RESULT
              && event.toolCallId === interactionResume.interrupt.toolCallId
            ) {
              emit(interactionRuntime.resolve(interactionResume));
              resumeResolved = true;
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
                workspace: agentAssembly.workspace
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
            }

          },
          error: (error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown AG-UI agent error";
            const event: BaseEvent = {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            };
            finalizer.fail({ errorMessage: message, terminalEvent: event });
            subscriber.error(error);
          },
          complete: () => {
            if (finalization) {
              void finalization.then(() => subscriber.complete(), (error: unknown) => subscriber.error(error));
              return;
            }
            subscriber.complete();
          }
        });

        subscriber.add(() => {
          subscription.unsubscribe();
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, If-Match",
    "Access-Control-Max-Age": "86400"
  });
  response.end();
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
};

const ensureDemoDataSource = (metadataStore: MetadataStore, datasourceId: string): void => {
  try {
    const current = metadataStore.dataSources.get({
      user_id: DEV_USER.id,
      datasource_id: datasourceId
    });
    const config = JSON.parse(current.config_json) as Record<string, unknown>;
    if (config.builtin !== true || config.defaultEnabled !== true) {
      metadataStore.dataSources.create({
        user_id: DEV_USER.id,
        id: current.id,
        name: current.name,
        type: current.type,
        config: { ...config, builtin: true, defaultEnabled: true, mode: "demo" },
        ...(current.description ? { description: current.description } : {}),
        status: current.status
      });
    }
  } catch {
    metadataStore.dataSources.create({
      user_id: DEV_USER.id,
      id: datasourceId,
      name: "API DuckDB Demo",
      type: "duckdb",
      config: { builtin: true, defaultEnabled: true, mode: "demo" },
      description: "Default demo datasource for agent runtime smoke runs."
    });
  }
};

const BUILTIN_SKILLS = [
  {
    id: "data-agent-default",
    name: "通用数据分析",
    description: "默认 ReAct 数据问答与探索",
    instructions: "Use the standard data analysis workflow and choose the smallest sufficient set of tools."
  },
  {
    id: "schema-explore",
    name: "Schema 探索",
    description: "优先检查表结构与字段含义",
    instructions: "Prioritize schema inspection and explain table and column semantics before querying data."
  },
  {
    id: "sql-analysis",
    name: "SQL 分析",
    description: "聚焦只读查询与指标计算",
    instructions: "Prioritize reproducible read-only SQL analysis and report the executed SQL with results."
  },
  {
    id: "report-draft",
    name: "报告草稿",
    description: "偏向结论整理与报告产出",
    instructions: "Organize verified findings into a concise report with evidence and artifact references."
  }
] as const;

const ensureBuiltinConfigResources = (metadataStore: MetadataStore): void => {
  const common = { workspace_id: "default", user_id: DEV_USER.id };
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
  BUILTIN_SKILLS.forEach((skill) => {
    if (metadataStore.configResources.find({ ...common, kind: "skill", id: skill.id })) {
      return;
    }
    metadataStore.configResources.upsert({
      ...common,
      kind: "skill",
      id: skill.id,
      name: skill.name,
      description: skill.description,
      payload: {
        instructions: skill.instructions,
        packageFormat: "builtin",
        packageFileName: "SKILL.md",
        version: "1.0.0"
      },
      builtin: true,
      default_enabled: false,
      status: "valid"
    });
  });
};
