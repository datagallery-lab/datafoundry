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
  createActivityDelta,
  createPlanActivityEvent,
  createModelProviderFromEnv,
  type AgUiEventEmitter
} from "@open-data-agent/agent-runtime";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@open-data-agent/contracts";
import { LocalDataGateway } from "@open-data-agent/data-gateway";
import { RunEventWriter, createMetadataStore, type MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Observable } from "rxjs";

import {
  createInitialPlanTaskState,
  createRunFailedPlanPatch,
  createRunFinishedPlanPatch,
  observePlanActivityEvent
} from "./plan-state.js";
import { extractDatasourceId, extractLastUserText } from "./run-input.js";
import { createRunRequestFingerprint, resolveExistingRun, validateParentRun } from "./run-identity.js";

const DEV_USER: MeResponse = {
  id: "dev-user",
  email: "dev@example.com",
  display_name: "Dev User"
};

const COPILOTKIT_PATH = "/api/copilotkit";

export type CreateServerOptions = {
  metadataStore?: MetadataStore;
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
  const dataGateway = new LocalDataGateway(metadataStore);

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
          dataGateway
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
  });

  return server;
};

type HandleCopilotKitRequestInput = {
  request: IncomingMessage;
  response: ServerResponse;
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway
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
        user: DEV_USER
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
  user: MeResponse;
};

class DataAgentAgUiAgent extends AbstractAgent {
  constructor(private readonly input: DataAgentAgUiAgentInput) {
    super({
      agentId: "dataAgent",
      description: "Read-only data analysis agent backed by Mastra and Data Gateway."
    });
  }

  run(runInput: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = async (): Promise<void> => {
        const sessionId = runInput.threadId;
        const runId = runInput.runId;
        const selectedDatasourceId = extractDatasourceId(runInput) ?? this.input.defaultDatasourceId;
        const userInput = extractLastUserText(runInput) ?? "CopilotKit AG-UI run";
        const runEventWriter = new RunEventWriter(this.input.metadataStore.runEvents);
        const planTaskState = createInitialPlanTaskState();
        const requestFingerprint = createRunRequestFingerprint(runInput, selectedDatasourceId);
        const existingRun = this.input.metadataStore.runs.find({
          user_id: this.input.user.id,
          run_id: runId
        });

        if (existingRun) {
          const replayedEvents = resolveExistingRun({
            existingRun,
            requestFingerprint,
            runEventWriter,
            sessionId
          });
          replayedEvents.forEach((event) => subscriber.next(event));
          subscriber.complete();
          return;
        }

        validateParentRun({
          metadataStore: this.input.metadataStore,
          parentRunId: runInput.parentRunId,
          sessionId,
          userId: this.input.user.id
        });

        ensureDemoDataSource(this.input.metadataStore, selectedDatasourceId);
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
          const replayedEvents = resolveExistingRun({
            existingRun: claim.run,
            requestFingerprint,
            runEventWriter,
            sessionId
          });
          replayedEvents.forEach((event) => subscriber.next(event));
          subscriber.complete();
          return;
        }

        const runContext = createDataAgentRunContext({
          user_id: this.input.user.id,
          session_id: sessionId,
          run_id: runId,
          user_input: userInput,
          chat_mode: "copilotkit",
          selected_datasource_id: selectedDatasourceId,
          model_name: this.input.modelProvider.model_name
        });
        const emit = (event: BaseEvent): void => {
          observePlanActivityEvent(planTaskState, event);
          runEventWriter.write({
            user_id: this.input.user.id,
            run_id: runId,
            session_id: sessionId,
            event
          });
          subscriber.next(event);
        };
        const emitter: AgUiEventEmitter = { emit };
        const { agent, governedMessages } = createDataAgent({
          dataGateway: this.input.dataGateway,
          emitter,
          messages: runInput.messages,
          modelProvider: this.input.modelProvider,
          runContext
        });
        const mastraAgent = new MastraAgent({
          agent,
          resourceId: this.input.user.id
        });
        const subscription = mastraAgent.run({ ...runInput, messages: governedMessages }).subscribe({
          next: (event) => {
            emit(event);

            if (event.type === EventType.RUN_STARTED) {
              emit(createPlanActivityEvent(runContext));
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
              emit(createActivityDelta(runContext, "PLAN", createRunFinishedPlanPatch(planTaskState)));
              emit(createRunStatusDelta("completed"));
            }

            if (event.type === EventType.RUN_ERROR) {
              this.input.metadataStore.runs.updateStatus({
                user_id: this.input.user.id,
                run_id: runId,
                status: "failed",
                error_message: "AG-UI run error"
              });
              emit(createActivityDelta(runContext, "PLAN", createRunFailedPlanPatch(planTaskState)));
              emit(createRunStatusDelta("failed", "AG-UI run error"));
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
            emit(createActivityDelta(runContext, "PLAN", createRunFailedPlanPatch(planTaskState)));
            emit(createRunStatusDelta("failed", message));
            subscriber.error(error);
          },
          complete: () => {
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

const createRunStatusDelta = (status: "completed" | "failed", errorMessage?: string): BaseEvent => ({
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
