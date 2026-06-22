import { MastraAgent } from "@ag-ui/mastra";
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
  type AgUiEventEmitter,
  type TaskStateRuntime
} from "@open-data-agent/agent-runtime";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@open-data-agent/contracts";
import { LocalDataGateway } from "@open-data-agent/data-gateway";
import { RunEventWriter, createMetadataStore, type MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Observable } from "rxjs";

import { extractEffectiveRunConfig, extractLastUserText } from "./run-input.js";
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
  const ownsTaskStateRuntime = options.taskStateRuntime === undefined;
  const taskStateRuntime =
    options.taskStateRuntime ??
    await createTaskStateRuntime(
      process.env.MASTRA_STORAGE_PATH ?? join(envConfig.storage.root_dir, "mastra", "agent-state.sqlite")
    );
  ensureDemoDataSource(metadataStore, "api-duckdb-demo");

  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        sendJson(response, 200, createSuccessResult({ status: "ok" }));
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
  taskStateRuntime: TaskStateRuntime;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway,
  taskStateRuntime
}: HandleCopilotKitRequestInput): Promise<void> => {
  const modelProvider = createModelProviderFromEnv(process.env);

  if (modelProvider.kind === "mock") {
    sendJson(response, 503, createErrorResult("PROVIDER_CONFIG_MISSING", "LLM_API_KEY is required."));
    return;
  }

  const runtime = new CopilotRuntime({
    agents: {
      dataAgent: new DataAgentAgUiAgent({
        dataGateway,
        defaultDatasourceId: "api-duckdb-demo",
        metadataStore,
        modelProvider,
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
  modelProvider: Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }>;
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
        const effectiveRunConfig = extractEffectiveRunConfig(runInput, this.input.defaultDatasourceId);
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
            model_name: this.input.modelProvider.model_name,
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
          model_name: this.input.modelProvider.model_name
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
          emitter,
          messages: runInput.messages,
          modelProvider: this.input.modelProvider,
          runContext,
          taskStateRuntime: this.input.taskStateRuntime,
          ...(!interactionResume && effectiveRunConfig.goal ? { goal: effectiveRunConfig.goal } : {}),
          workspaceRoot: this.input.workspaceRoot
        });
        const mastraAgent = new MastraAgent({
          agent,
          resourceId: this.input.user.id
        });
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
              emit(event);
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "canceled"
              });
              emit(createRunStatusDelta("canceled"));
              void destroyWorkspace().catch(() => undefined);
              return;
            }
            if (event.type === EventType.RUN_FINISHED && goalRuntime) {
              finalization = (async () => {
                emit(createCustomEvent("goal.updated", {
                  goal: await goalRuntime.getSnapshot(),
                  source: "mastra-native-goal"
                }));
                emit(event);
                this.input.metadataStore.runs.updateStatus({
                  user_id: this.input.user.id,
                  run_id: runId,
                  status: "completed"
                });
                emit(createRunStatusDelta("completed"));
                await destroyWorkspace().catch(() => undefined);
              })();
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

            if (event.type === EventType.RUN_FINISHED) {
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "completed"
              });
              emit(createRunStatusDelta("completed"));
              void destroyWorkspace().catch(() => undefined);
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
            }
          },
          error: (error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown AG-UI agent error";
            const event: BaseEvent = {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            };
            emit(event);
            this.input.metadataStore.runs.updateStatus({
              user_id: this.input.user.id,
              run_id: runId,
              status: "failed",
              error_message: message
            });
            emit(createRunStatusDelta("failed", message));
            void destroyWorkspace().catch(() => undefined);
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    metadataStore.dataSources.get({
      user_id: DEV_USER.id,
      datasource_id: datasourceId
    });
  } catch {
    metadataStore.dataSources.create({
      user_id: DEV_USER.id,
      id: datasourceId,
      name: "API DuckDB Demo",
      type: "duckdb",
      config: { mode: "demo" },
      description: "Default demo datasource for agent runtime smoke runs."
    });
  }
};
