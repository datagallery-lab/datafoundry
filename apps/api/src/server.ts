import { MastraAgent } from "@ag-ui/mastra";
import { MCPMiddleware, type MCPClientConfig } from "@ag-ui/mcp-middleware";
import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint
} from "@copilotkit/runtime";
import {
  createDataAgent,
  createDataAgentRunContext,
  createTaskStateRuntime,
  createCustomEvent,
  createModelProviderFromEnv,
  createModelProviderFromProfile,
  McpToolContextAdapter,
  type AgUiEventEmitter,
  type TaskStateRuntime
} from "@open-data-agent/agent-runtime";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@open-data-agent/contracts";
import { LocalDataGateway } from "@open-data-agent/data-gateway";
import { LocalKnowledgeService } from "@open-data-agent/knowledge";
import { RunEventWriter, createMetadataStore, type MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Observable } from "rxjs";

import { handleConfigApiRequest } from "./config-api.js";
import { extractLastUserText, resolveEffectiveRunConfig, type EffectiveRunConfig } from "./run-input.js";
import { createRunRequestFingerprint, resolveExistingRun, validateParentRun } from "./run-identity.js";
import { extractInteractionResume, InteractionRuntimeAdapter } from "./interaction-runtime-adapter.js";
import { TaskPlanProjector } from "./task-plan-projector.js";
import { ToolCallResultBridge } from "./tool-call-result-bridge.js";

const DEV_USER: MeResponse = {
  id: "dev-user",
  email: "dev@example.com",
  display_name: "Dev User"
};

const COPILOTKIT_PATH = "/api/copilotkit";

export type CreateServerOptions = {
  metadataStore?: MetadataStore;
  taskStateRuntime?: TaskStateRuntime;
};

export const createServer = async (options: CreateServerOptions = {}): Promise<Server> => {
  const envConfig = createEnvConfig(process.env);
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
      process.env.MASTRA_STORAGE_PATH ?? join(envConfig.storage.root_dir, "mastra", "agent-state.sqlite")
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
          knowledgeService,
          taskStateRuntime
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
  request: IncomingMessage;
  response: ServerResponse;
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  knowledgeService: LocalKnowledgeService;
  taskStateRuntime: TaskStateRuntime;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway,
  knowledgeService,
  taskStateRuntime
}: HandleCopilotKitRequestInput): Promise<void> => {
  const runtime = new CopilotRuntime({
    agents: {
      dataAgent: new DataAgentAgUiAgent({
        dataGateway,
        knowledgeService,
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
  dataGateway: LocalDataGateway;
  defaultDatasourceId: string;
  metadataStore: MetadataStore;
  knowledgeService: LocalKnowledgeService;
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
        const effectiveRunConfig = resolveEffectiveRunConfig(
          runInput,
          this.input.metadataStore,
          this.input.user.id,
          this.input.defaultDatasourceId
        );
        validateEffectiveResources(effectiveRunConfig, this.input.metadataStore, this.input.user.id);
        const modelProvider = resolveRunModelProvider(
          effectiveRunConfig.activeLlmProfileId,
          this.input.metadataStore,
          this.input.user.id
        );
        const skillPolicy = resolveSkillPolicy(
          effectiveRunConfig.activeSkillId,
          this.input.metadataStore,
          this.input.user.id
        );
        const modelSettings = resolveModelSettings(
          effectiveRunConfig.activeLlmProfileId,
          this.input.metadataStore,
          this.input.user.id
        );
        const mcpRuntime = resolveMcpRuntime(
          effectiveRunConfig.enabledMcpServerIds,
          this.input.metadataStore,
          this.input.user.id
        );
        enforceSkillMcpPolicy(skillPolicy, mcpRuntime.toolNames);
        const userInput = extractLastUserText(runInput) ?? "CopilotKit AG-UI run";
        const runEventWriter = new RunEventWriter(this.input.metadataStore.runEvents);
        const requestFingerprint = createRunRequestFingerprint(runInput, effectiveRunConfig);
        const existingRun = this.input.metadataStore.runs.find({
          user_id: this.input.user.id,
          run_id: runId
        });
        const selectedDatasourceId = interactionResume && existingRun?.datasource_id
          ? existingRun.datasource_id
          : effectiveRunConfig.activeDatasourceId;
        const isResume = interactionResume !== undefined && existingRun?.status === "suspended";

        if (existingRun && !isResume) {
          if (interactionResume) {
            const interaction = this.input.metadataStore.interactions.getByToolCall({
              user_id: this.input.user.id,
              run_id: runId,
              tool_call_id: interactionResume.interrupt.toolCallId
            });
            if (interaction.status !== "resolved" || interaction.resume_fingerprint !== interactionResume.fingerprint) {
              throw new Error(`INTERACTION_NOT_RESUMABLE:${interactionResume.interrupt.toolCallId}`);
            }
          }
          const replayedEvents = resolveExistingRun({
            existingRun,
            requestFingerprint: interactionResume ? existingRun.request_fingerprint ?? "" : requestFingerprint,
            runEventWriter,
            sessionId
          });
          replayedEvents.forEach((event) => subscriber.next(event));
          subscriber.complete();
          return;
        }

        if (isResume) {
          if (existingRun?.session_id !== sessionId) {
            throw new Error(`RUN_SESSION_MISMATCH:${runId}`);
          }
          const interaction = this.input.metadataStore.interactions.getByToolCall({
            user_id: this.input.user.id,
            run_id: runId,
            tool_call_id: interactionResume.interrupt.toolCallId
          });
          if (
            interaction.session_id !== sessionId
            || interaction.tool_name !== interactionResume.interrupt.toolName
            || interaction.status !== "pending"
          ) {
            throw new Error(`INTERACTION_IDENTITY_MISMATCH:${interactionResume.interrupt.toolCallId}`);
          }
          this.input.metadataStore.runs.updateStatus({
            user_id: this.input.user.id,
            run_id: runId,
            status: "running"
          });
        } else {
          validateParentRun({
            metadataStore: this.input.metadataStore,
            parentRunId: runInput.parentRunId,
            sessionId,
            userId: this.input.user.id
          });
          this.input.metadataStore.dataSources.get({
            user_id: this.input.user.id,
            datasource_id: selectedDatasourceId
          });
          this.input.metadataStore.sessions.create({
            user_id: this.input.user.id,
            id: sessionId,
            title: userInput.slice(0, 80),
            selected_datasource_id: selectedDatasourceId
          });
          const claim = this.input.metadataStore.runs.claim({
            user_id: this.input.user.id,
            id: runId,
            session_id: sessionId,
            ...(runInput.parentRunId ? { parent_run_id: runInput.parentRunId } : {}),
            request_fingerprint: requestFingerprint,
            user_input: userInput,
            status: "running",
            model_name: modelProvider.model_name,
            datasource_id: selectedDatasourceId
          });
          if (!claim.created) {
            throw new Error(`RUN_CLAIM_CONFLICT:${runId}`);
          }
        }

        const runContext = createDataAgentRunContext({
          user_id: this.input.user.id,
          session_id: sessionId,
          run_id: runId,
          user_input: userInput,
          chat_mode: "copilotkit",
          selected_datasource_id: selectedDatasourceId,
          enabled_datasource_ids: effectiveRunConfig.enabledDatasourceIds,
          ...(effectiveRunConfig.activeLlmProfileId
            ? { requested_llm_profile_id: effectiveRunConfig.activeLlmProfileId }
            : {}),
          ...(effectiveRunConfig.activeSkillId ? { active_skill_id: effectiveRunConfig.activeSkillId } : {}),
          ...(effectiveRunConfig.enabledKnowledgeIds.length > 0
            ? { enabled_knowledge_ids: effectiveRunConfig.enabledKnowledgeIds }
            : {}),
          ...(effectiveRunConfig.enabledMcpServerIds.length > 0
            ? { enabled_mcp_server_ids: effectiveRunConfig.enabledMcpServerIds }
            : {}),
          model_name: modelProvider.model_name
        });
        const taskPlanProjector = new TaskPlanProjector(runContext);
        const toolCallResultBridge = new ToolCallResultBridge();
        const interactionRuntime = new InteractionRuntimeAdapter(
          this.input.metadataStore,
          this.input.user.id,
          sessionId,
          runId
        );
        const emit = (event: BaseEvent): void => {
          const deliver = (payload: BaseEvent): void => {
            runEventWriter.write({
              user_id: this.input.user.id,
              run_id: runId,
              session_id: sessionId,
              event: payload
            });
            subscriber.next(payload);
          };
          deliver(event);
          toolCallResultBridge.observe(event).forEach(deliver);
          taskPlanProjector.observe(event).forEach((projectedEvent) => emit(projectedEvent));
        };
        const emitter: AgUiEventEmitter = { emit };
        const {
          agent,
          commandExecutionEnabled,
          destroyWorkspace,
          goalRuntime,
          governedMessages,
          isolation
        } = await createDataAgent({
          dataGateway: this.input.dataGateway,
          knowledgeService: this.input.knowledgeService,
          additionalToolAdapters: mcpRuntime.toolNames.map((name) => new McpToolContextAdapter(name)),
          emitter,
          messages: runInput.messages,
          modelProvider,
          ...(modelSettings ? { modelSettings } : {}),
          runContext,
          ...(skillPolicy ? { skillPolicy } : {}),
          taskStateRuntime: this.input.taskStateRuntime,
          ...(!interactionResume && effectiveRunConfig.goal ? { goal: effectiveRunConfig.goal } : {}),
          workspaceRoot: this.input.workspaceRoot
        });
        const mastraAgent = new MastraAgent({
          agent,
          resourceId: this.input.user.id
        });
        if (mcpRuntime.servers.length > 0) {
          mastraAgent.use(new MCPMiddleware(mcpRuntime.servers, { maxIterations: 8 }));
        }
        let suspended = false;
        let resumeResolved = false;
        let finalization: Promise<void> | undefined;
        const subscription = mastraAgent.run({ ...runInput, messages: governedMessages }).subscribe({
          next: (event) => {
            const interactionRequested = interactionRuntime.capture(event);
            if (interactionRequested) {
              suspended = true;
              emit(interactionRequested);
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "suspended"
              });
              emit(createRunStatusDelta("suspended"));
              return;
            }
            if (event.type === EventType.RUN_FINISHED && suspended) {
              return;
            }
            if (event.type === EventType.RUN_FINISHED && interactionResume?.response === false) {
              emit(interactionRuntime.cancel(interactionResume));
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "canceled"
              });
              emit(createRunStatusDelta("canceled"));
              finalization = destroyWorkspace().catch(() => undefined).then(() => emit(event));
              return;
            }
            if (event.type === EventType.RUN_FINISHED && goalRuntime) {
              finalization = (async () => {
                emit(createCustomEvent("goal.updated", {
                  goal: await goalRuntime.getSnapshot(),
                  source: "mastra-native-goal"
                }));
                this.input.metadataStore.runs.updateStatus({
                  user_id: this.input.user.id,
                  run_id: runId,
                  status: "completed"
                });
                emit(createRunStatusDelta("completed"));
                await destroyWorkspace().catch(() => undefined);
                emit(event);
              })();
              return;
            }
            if (event.type === EventType.RUN_FINISHED) {
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "completed"
              });
              emit(createRunStatusDelta("completed"));
              finalization = destroyWorkspace().catch(() => undefined).then(() => emit(event));
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "failed",
                error_message: "AG-UI run error"
              });
              emit(createRunStatusDelta("failed", "AG-UI run error"));
              void destroyWorkspace().catch(() => undefined);
              emit(event);
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
                enabled_knowledge_ids: effectiveRunConfig.enabledKnowledgeIds,
                enabled_mcp_server_ids: effectiveRunConfig.enabledMcpServerIds,
                requested_llm_profile_id: effectiveRunConfig.activeLlmProfileId,
                workspace: {
                  command_execution_enabled: commandExecutionEnabled,
                  isolation
                }
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
            this.input.metadataStore.runs.updateStatus({
              user_id: this.input.user.id,
              run_id: runId,
              status: "failed",
              error_message: message
            });
            emit(createRunStatusDelta("failed", message));
            void destroyWorkspace().catch(() => undefined);
            emit(event);
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

const createRunStatusDelta = (
  status: "running" | "suspended" | "completed" | "failed" | "canceled",
  errorMessage?: string
): BaseEvent => ({
  type: EventType.STATE_DELTA,
  delta: [
    { op: "replace", path: "/runStatus", value: status },
    ...(errorMessage ? [{ op: "add", path: "/errorMessage", value: errorMessage }] : [])
  ],
  timestamp: Date.now()
});

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
      status: "valid"
    });
  });
};

const resolveRunModelProvider = (
  profileId: string | undefined,
  metadataStore: MetadataStore,
  userId: string
): Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }> => {
  if (!profileId || profileId === "server-default") {
    const provider = createModelProviderFromEnv(process.env);
    if (provider.kind === "mock") {
      throw new Error("PROVIDER_CONFIG_MISSING:LLM_API_KEY is required for server-default.");
    }
    return provider;
  }
  const providers: Array<Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }>> = [];
  const profileIds: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = profileId;
  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`MODEL_FALLBACK_CYCLE:${currentId}`);
    }
    visited.add(currentId);
    const profile = metadataStore.configResources.get({
      id: currentId,
      workspace_id: "default",
      user_id: userId,
      kind: "model-profile"
    });
    const credentials = profile.secret_ref
      ? metadataStore.secrets.get({ ref: profile.secret_ref, workspace_id: "default", user_id: userId })
      : {};
    const apiKey = stringRecordValue(credentials, "apiKey") ?? stringRecordValue(credentials, "api_key");
    const provider = createModelProviderFromProfile({
      provider: stringRecordValue(profile.payload, "provider") ?? "openai-compatible",
      model: stringRecordValue(profile.payload, "modelName") ?? stringRecordValue(profile.payload, "model") ?? "",
      base_url: stringRecordValue(profile.payload, "baseUrl") ?? stringRecordValue(profile.payload, "base_url") ?? "",
      ...(apiKey ? { api_key: apiKey } : {})
    });
    if (provider.kind === "mock") {
      throw new Error(`PROVIDER_CONFIG_MISSING:${currentId}`);
    }
    providers.push(provider);
    profileIds.push(currentId);
    currentId = stringRecordValue(profile.payload, "fallbackProfileId");
  }
  const primary = providers[0];
  if (!primary) {
    throw new Error(`PROVIDER_CONFIG_MISSING:${profileId}`);
  }
  if (providers.length === 1) {
    return primary;
  }
  return {
    kind: primary.kind,
    model_name: profileIds.join(" -> "),
    model: providers.map((provider, index) => ({
      id: profileIds[index] as string,
      model: provider.model,
      maxRetries: 1,
      enabled: true
    }))
  };
};

const validateEffectiveResources = (
  config: EffectiveRunConfig,
  metadataStore: MetadataStore,
  userId: string
): void => {
  config.enabledDatasourceIds.forEach((id) => {
    const datasource = metadataStore.dataSources.get({ user_id: userId, datasource_id: id });
    if (datasource.status !== "ready") {
      throw new Error(`DATASOURCE_NOT_ENABLED:${id}`);
    }
  });
  validateConfigIds(metadataStore, userId, "knowledge-base", config.enabledKnowledgeIds);
  validateConfigIds(metadataStore, userId, "mcp-server", config.enabledMcpServerIds);
  validateConfigIds(metadataStore, userId, "skill", config.enabledSkillIds);
  if (config.activeSkillId) {
    validateConfigIds(metadataStore, userId, "skill", [config.activeSkillId]);
  }
  if (config.activeLlmProfileId && config.activeLlmProfileId !== "server-default") {
    validateConfigIds(metadataStore, userId, "model-profile", [config.activeLlmProfileId]);
  }
};

const resolveSkillPolicy = (
  skillId: string | undefined,
  metadataStore: MetadataStore,
  userId: string
): { instructions: string; allowedTools?: string[] } | undefined => {
  if (!skillId) {
    return undefined;
  }
  const skill = metadataStore.configResources.get({
    id: skillId,
    workspace_id: "default",
    user_id: userId,
    kind: "skill"
  });
  const instructions = stringRecordValue(skill.payload, "instructions")
    ?? stringRecordValue(skill.payload, "packageContent")
    ?? "Follow the standard data-agent policy.";
  const rawAllowedTools = skill.payload.allowedTools;
  const allowedTools = Array.isArray(rawAllowedTools)
    ? rawAllowedTools.filter((value): value is string => typeof value === "string" && value.length > 0)
    : typeof rawAllowedTools === "string"
      ? rawAllowedTools.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined;
  return {
    instructions,
    ...(allowedTools && allowedTools.length > 0 ? { allowedTools } : {})
  };
};

const resolveModelSettings = (
  profileId: string | undefined,
  metadataStore: MetadataStore,
  userId: string
): { maxOutputTokens?: number; temperature?: number } | undefined => {
  if (!profileId || profileId === "server-default") {
    return undefined;
  }
  const profile = metadataStore.configResources.get({
    id: profileId,
    workspace_id: "default",
    user_id: userId,
    kind: "model-profile"
  });
  const temperature = numericRecordValue(profile.payload, "temperature");
  const maxOutputTokens = numericRecordValue(profile.payload, "maxTokens")
    ?? numericRecordValue(profile.payload, "maxOutputTokens");
  return {
    ...(temperature !== undefined ? { temperature: Math.max(0, Math.min(2, temperature)) } : {}),
    ...(maxOutputTokens !== undefined
      ? { maxOutputTokens: Math.max(1, Math.min(100000, Math.floor(maxOutputTokens))) }
      : {})
  };
};

const resolveMcpRuntime = (
  serverIds: string[],
  metadataStore: MetadataStore,
  userId: string
): { servers: MCPClientConfig[]; toolNames: string[] } => {
  const usedNames = new Set<string>();
  const toolNames: string[] = [];
  const servers = serverIds.map((id): MCPClientConfig => {
    const resource = metadataStore.configResources.get({
      id,
      workspace_id: "default",
      user_id: userId,
      kind: "mcp-server"
    });
    const transport = stringRecordValue(resource.payload, "transport") ?? "streamable-http";
    if (transport !== "streamable-http" && transport !== "sse") {
      throw new Error(`MCP_TRANSPORT_UNSUPPORTED:${id}:${transport}`);
    }
    const url = stringRecordValue(resource.payload, "serverUrl") ?? stringRecordValue(resource.payload, "url");
    if (!url) {
      throw new Error(`MCP_SERVER_URL_REQUIRED:${id}`);
    }
    const manifest = resource.payload.toolManifest;
    if (!Array.isArray(manifest)) {
      throw new Error(`MCP_TOOL_MANIFEST_REQUIRED:${id}`);
    }
    manifest.forEach((tool) => {
      if (!isRecord(tool) || typeof tool.name !== "string") {
        throw new Error(`MCP_TOOL_MANIFEST_INVALID:${id}`);
      }
      const baseName = `mcp__${sanitizeMcpName(id)}__${sanitizeMcpName(tool.name)}`;
      let resolved = baseName.slice(0, 64);
      let suffix = 1;
      while (usedNames.has(resolved)) {
        const marker = `_${suffix}`;
        resolved = `${baseName.slice(0, 64 - marker.length)}${marker}`;
        suffix += 1;
      }
      usedNames.add(resolved);
      toolNames.push(resolved);
    });
    const secret = resource.secret_ref
      ? metadataStore.secrets.get({ ref: resource.secret_ref, workspace_id: "default", user_id: userId })
      : {};
    const headers = resolveMcpHeaders(resource.payload, secret);
    return {
      type: transport === "streamable-http" ? "http" : "sse",
      url,
      serverId: id,
      ...(Object.keys(headers).length > 0 ? { headers } : {})
    };
  });
  return { servers, toolNames };
};

const resolveMcpHeaders = (
  payload: Record<string, unknown>,
  secret: Record<string, unknown>
): Record<string, string> => {
  const configured = isRecord(secret.headers)
    ? Object.fromEntries(Object.entries(secret.headers).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"))
    : {};
  const token = stringRecordValue(secret, "token") ?? stringRecordValue(secret, "apiKey");
  const authType = stringRecordValue(payload, "authType") ?? "none";
  if (authType === "bearer" && token) {
    return { ...configured, Authorization: `Bearer ${token}` };
  }
  return configured;
};

const enforceSkillMcpPolicy = (
  skillPolicy: { instructions: string; allowedTools?: string[] } | undefined,
  mcpToolNames: string[]
): void => {
  if (!skillPolicy?.allowedTools || mcpToolNames.length === 0) {
    return;
  }
  const disallowed = mcpToolNames.filter((name) => !skillPolicy.allowedTools?.includes(name));
  if (disallowed.length > 0) {
    throw new Error(`SKILL_MCP_TOOL_POLICY_UNSUPPORTED:${disallowed.join(",")}`);
  }
};

const sanitizeMcpName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_");

const validateConfigIds = (
  metadataStore: MetadataStore,
  userId: string,
  kind: "knowledge-base" | "mcp-server" | "model-profile" | "skill",
  ids: string[]
): void => {
  ids.forEach((id) => {
    const resource = metadataStore.configResources.get({
      id,
      workspace_id: "default",
      user_id: userId,
      kind
    });
    if (!resource.default_enabled) {
      throw new Error(`CONFIG_RESOURCE_NOT_ENABLED:${kind}:${id}`);
    }
  });
};

const stringRecordValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const numericRecordValue = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
