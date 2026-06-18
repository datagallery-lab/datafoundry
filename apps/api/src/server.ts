import { MastraAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint
} from "@copilotkit/runtime";
import {
  createDataAgent,
  createDataAgentRunContext,
  createModelProviderFromEnv,
  type RunEventEmitter
} from "@open-data-agent/agent-runtime";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@open-data-agent/contracts";
import { LocalDataGateway } from "@open-data-agent/data-gateway";
import { RunEventWriter, createMetadataStore, type MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

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
  const runEventWriter = new RunEventWriter(metadataStore.runEvents);

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
          runEventWriter
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
  runEventWriter: RunEventWriter;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway,
  runEventWriter
}: HandleCopilotKitRequestInput): Promise<void> => {
  const modelProvider = createModelProviderFromEnv(process.env);

  if (modelProvider.kind === "mock") {
    sendJson(response, 503, createErrorResult("PROVIDER_CONFIG_MISSING", "LLM_API_KEY is required."));
    return;
  }

  const sessionId = getHeaderValue(request.headers["x-session-id"]) ?? randomUUID();
  const runId = randomUUID();
  const selectedDatasourceId = getHeaderValue(request.headers["x-datasource-id"]) ?? "api-duckdb-demo";

  ensureDemoDataSource(metadataStore, selectedDatasourceId);
  metadataStore.sessions.create({
    user_id: DEV_USER.id,
    id: sessionId,
    title: "CopilotKit session",
    selected_datasource_id: selectedDatasourceId
  });
  metadataStore.runs.create({
    user_id: DEV_USER.id,
    id: runId,
    session_id: sessionId,
    user_input: "CopilotKit AG-UI run",
    status: "running",
    model_name: modelProvider.model_name,
    datasource_id: selectedDatasourceId
  });

  const emitter: RunEventEmitter = {
    create: (type, payload) =>
      runEventWriter.write({
        user_id: DEV_USER.id,
        run_id: runId,
        session_id: sessionId,
        type,
        payload
      })
  };
  emitter.create("plan.update", {
    tasks: [
      { id: "schema", title: "检查数据源 schema", status: "pending" },
      { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
      { id: "final", title: "生成最终回答", status: "pending" }
    ]
  });

  const runContext = createDataAgentRunContext({
    user_id: DEV_USER.id,
    session_id: sessionId,
    run_id: runId,
    user_input: "CopilotKit AG-UI run",
    chat_mode: "copilotkit",
    selected_datasource_id: selectedDatasourceId,
    model_name: modelProvider.model_name
  });
  const { agent } = createDataAgent({
    dataGateway,
    emitter,
    modelProvider,
    runContext
  });
  const runtime = new CopilotRuntime({
    agents: {
      dataAgent: new MastraAgent({
        agent,
        resourceId: DEV_USER.id
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
    metadataStore.runs.updateStatus({
      user_id: DEV_USER.id,
      run_id: runId,
      status: "completed"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CopilotKit runtime error";

    metadataStore.runs.updateStatus({
      user_id: DEV_USER.id,
      run_id: runId,
      status: "failed",
      error_message: message
    });
    throw error;
  }
};

const getHeaderValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" && value.trim() ? value : undefined;
};

const isCopilotKitPath = (pathname: string): boolean =>
  pathname === COPILOTKIT_PATH || pathname.startsWith(`${COPILOTKIT_PATH}/`);

const sendCorsPreflight = (response: ServerResponse): void => {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-ID, X-Datasource-ID",
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
