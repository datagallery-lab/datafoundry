import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer as createHttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { createServer as createApiServer } from "../apps/api/dist/server.js";
import { resolveEffectiveRunConfig } from "../apps/api/dist/run-input.js";
import { createTaskStateRuntime } from "../packages/agent-runtime/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

const root = mkdtempSync(join(tmpdir(), "open-data-agent-config-smoke-"));
const datasourcePath = join(root, "source.sqlite");
const source = new DatabaseSync(datasourcePath);
source.exec("CREATE TABLE metrics (name TEXT, value INTEGER); INSERT INTO metrics VALUES ('revenue', 42)");
source.close();

process.env.EMBEDDING_API_KEY = "";
process.env.MASTRA_STORAGE_PATH = join(root, "mastra.sqlite");
process.env.STORAGE_ROOT_DIR = root;

const metadataStore = createMetadataStore({
  database_path: join(root, "metadata.sqlite"),
  secret_master_key: "config-smoke-master-key"
});
const taskStateRuntime = await createTaskStateRuntime(join(root, "task-state.sqlite"));
let modelProbeRequest;
const modelProviderServer = createHttpServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  modelProbeRequest = {
    authorization: request.headers.authorization,
    body,
    method: request.method,
    path: request.url
  };
  response.writeHead(200, { "Connection": "close", "Content-Type": "application/json" });
  response.end(JSON.stringify({
    id: "chatcmpl-config-smoke",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: "OK" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
  }));
});
await new Promise((resolve) => modelProviderServer.listen(0, "127.0.0.1", resolve));
const modelProviderAddress = modelProviderServer.address();
assert(modelProviderAddress && typeof modelProviderAddress === "object");

const mcpServer = createHttpServer(async (request, response) => {
  const server = new McpServer({ name: "config-smoke-mcp", version: "1.0.0" });
  server.registerTool("echo", {
    description: "Echo one value.",
    inputSchema: { value: z.string() }
  }, async ({ value }) => ({ content: [{ type: "text", text: value }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(request, response);
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
});
await new Promise((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
const mcpAddress = mcpServer.address();
assert(mcpAddress && typeof mcpAddress === "object");

const server = await createApiServer({ metadataStore, taskStateRuntime });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { body, response };
};

const requestRaw = async (path, init = {}) => fetch(`${baseUrl}${path}`, init);

const closeHttpServer = async (httpServer) => {
  await new Promise((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
    setImmediate(() => httpServer.closeAllConnections?.());
  });
  httpServer.unref?.();
};

try {
  const createdDatasource = await requestJson("/api/v1/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "local-sqlite",
      name: "Local SQLite",
      type: "sqlite",
      settings: { filePath: datasourcePath, password: "must-not-leak" },
      queryPolicy: { maxRows: 25, timeoutMs: 5000 }
    })
  });
  assert.equal(createdDatasource.response.status, 201);
  assert.equal(createdDatasource.body.data.hasSecret, true);
  assert.equal(JSON.stringify(createdDatasource.body).includes("must-not-leak"), false);
  assert.equal(createdDatasource.body.data.config.path, datasourcePath);

  const datasource = await requestJson("/api/v1/datasources/local-sqlite");
  assert.equal(JSON.stringify(datasource.body).includes("password"), false);
  const datasourceRevision = datasource.body.data.revision;
  const connection = await requestJson("/api/v1/datasources/local-sqlite/test", { method: "POST" });
  assert.equal(connection.body.success, true);

  const introspection = await requestJson("/api/v1/datasources/local-sqlite/introspect", {
    method: "POST",
    headers: { "Idempotency-Key": "schema-once" }
  });
  const repeatedIntrospection = await requestJson("/api/v1/datasources/local-sqlite/introspect", {
    method: "POST",
    headers: { "Idempotency-Key": "schema-once" }
  });
  assert.equal(introspection.body.data.id, repeatedIntrospection.body.data.id);
  const schema = await requestJson("/api/v1/datasources/local-sqlite/schema");
  assert.equal(schema.body.data.schema.tables[0].name, "metrics");

  const conflict = await requestJson("/api/v1/datasources/local-sqlite", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Conflict", revision: datasourceRevision + 100 })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "REVISION_CONFLICT");

  const knowledgeBase = await requestJson("/api/v1/knowledge-bases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "metrics-docs", name: "Metrics Docs", retrievalTopK: 3 })
  });
  assert.equal(knowledgeBase.response.status, 201);
  const fileForm = new FormData();
  fileForm.append("files", new Blob(["Revenue metric can be imported from file assets."], {
    type: "text/markdown"
  }), "file-metrics.md");
  const fileUploadResponse = await requestRaw("/api/v1/files", { method: "POST", body: fileForm });
  assert.equal(fileUploadResponse.status, 201);
  const fileUpload = await fileUploadResponse.json();
  assert.equal(fileUpload.body?.success ?? fileUpload.success, true);
  const uploadedFile = fileUpload.body?.data?.files?.[0] ?? fileUpload.data.files[0];
  assert.equal(uploadedFile.filename, "file-metrics.md");
  const fileDownload = await requestRaw(`/api/v1/files/${uploadedFile.id}/download`);
  assert.equal(fileDownload.status, 200);
  assert.equal(await fileDownload.text(), "Revenue metric can be imported from file assets.");
  const fileImport = await requestJson("/api/v1/knowledge-bases/metrics-docs/files/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds: [uploadedFile.id] })
  });
  assert.equal(fileImport.response.status, 207);
  assert.equal(fileImport.body.data.results[0].status, "ready");
  const upload = await requestJson("/api/v1/knowledge-bases/metrics-docs/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "metrics.md", content: "Revenue metric is gross sales before refunds." })
  });
  assert.equal(upload.response.status, 201);
  assert.equal(upload.body.data.status, "ready");
  const search = await requestJson("/api/v1/knowledge-bases/metrics-docs/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "revenue metric" })
  });
  assert.equal(search.body.data[0].filename, "metrics.md");

  const skillForm = new FormData();
  skillForm.set("file", new Blob([
    "---\nname: Smoke Skill\ndescription: Smoke skill package\nversion: 1.0.0\nallowed-tools: inspect_schema\n---\nInspect schema first.\n"
  ], { type: "text/markdown" }), "SKILL.md");
  const skill = await requestJson("/api/v1/skills", { method: "POST", body: skillForm });
  assert.equal(skill.response.status, 201);
  assert.equal(skill.body.data.validationStatus, "valid");
  assert.equal("packageContent" in skill.body.data, false);

  const mcpConfig = await requestJson("/api/v1/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "smoke-mcp",
      name: "Smoke MCP",
      transport: "streamable-http",
      serverUrl: `http://127.0.0.1:${mcpAddress.port}`
    })
  });
  assert.equal(mcpConfig.response.status, 201);
  const mcpTest = await requestJson("/api/v1/mcp-servers/smoke-mcp/test", { method: "POST" });
  assert.equal(mcpTest.body.data.toolCount, 1);
  const mcpTools = await requestJson("/api/v1/mcp-servers/smoke-mcp/tools");
  assert.equal(mcpTools.body.data[0].name, "echo");

  const modelProfile = await requestJson("/api/v1/model-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "smoke-openai-compatible",
      name: "Smoke OpenAI Compatible",
      provider: "openai-compatible",
      modelName: "smoke-model",
      baseUrl: `http://127.0.0.1:${modelProviderAddress.port}`,
      credentials: { apiKey: "smoke-model-key" },
      timeoutMs: 5000
    })
  });
  assert.equal(modelProfile.response.status, 201);
  assert.equal(modelProfile.body.data.hasSecret, true);
  assert.equal(JSON.stringify(modelProfile.body).includes("smoke-model-key"), false);
  const modelProfileTest = await requestJson("/api/v1/model-profiles/smoke-openai-compatible/test", {
    method: "POST"
  });
  assert.equal(modelProfileTest.body.success, true);
  assert.equal(modelProfileTest.body.data.status, "connected");
  assert.equal(modelProfileTest.body.data.model, "smoke-model");
  assert.equal(modelProfileTest.body.data.response, "OK");
  assert.equal(modelProbeRequest.method, "POST");
  assert.equal(modelProbeRequest.path, "/chat/completions");
  assert.equal(modelProbeRequest.authorization, "Bearer smoke-model-key");
  assert.equal(modelProbeRequest.body.model, "smoke-model");
  assert.equal(modelProbeRequest.body.messages.some((message) => message.role === "system"), true);
  const testedModelProfile = await requestJson("/api/v1/model-profiles/smoke-openai-compatible");
  assert.equal(testedModelProfile.body.data.connectionStatus, "connected");
  assert.equal(testedModelProfile.body.data.revision, modelProfileTest.body.data.revision);

  const effective = resolveEffectiveRunConfig({
    threadId: "effective-session",
    runId: "effective-run",
    parentRunId: undefined,
    messages: [{ id: "user-message", role: "user", content: "inspect metrics" }],
    tools: [],
    context: [{
      description: "run_config",
      value: {
        activeDatasourceId: "local-sqlite",
        activeLlmProfileId: "server-default",
        enabledDatasourceIds: ["local-sqlite"],
        enabledKnowledgeIds: [],
        enabledMcpServerIds: [],
        enabledSkillIds: []
      }
    }],
    state: {},
    forwardedProps: {}
  }, metadataStore, "dev-user", "api-duckdb-demo");
  assert.equal(effective.activeSkillId, undefined);
  assert.equal(effective.resourceRevisions["datasource:local-sqlite"], datasource.body.data.revision);
  assert.equal(effective.resourceRevisions["model-profile:server-default"] > 0, true);

  const currentKnowledgeBase = await requestJson("/api/v1/knowledge-bases/metrics-docs");
  const workspacePatch = await requestJson("/api/v1/workspace-config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      knowledgeBases: [{
        id: "metrics-docs",
        defaultEnabled: false,
        revision: currentKnowledgeBase.body.data.revision
      }]
    })
  });
  assert.equal(workspacePatch.body.data.knowledgeBases[0].defaultEnabled, false);
  const defaults = await requestJson("/api/v1/run-defaults");
  assert.equal(defaults.body.data.enabledKnowledgeIds.includes("metrics-docs"), false);

  metadataStore.sessions.create({ user_id: "dev-user", id: "session-smoke", title: "config smoke" });
  metadataStore.runs.create({
    user_id: "dev-user",
    id: "run-smoke",
    session_id: "session-smoke",
    request_fingerprint: "config-smoke",
    user_input: "config smoke",
    status: "completed"
  });
  const artifact = metadataStore.artifacts.create({
    id: "artifact-smoke",
    user_id: "dev-user",
    session_id: "session-smoke",
    run_id: "run-smoke",
    type: "table",
    name: "metrics",
    preview_json: { columns: ["name", "value"], rows: [{ name: "revenue", value: 42 }] }
  });
  assert.equal(artifact.id, "artifact-smoke");
  const download = await fetch(`${baseUrl}/api/v1/artifacts/artifact-smoke/download`);
  assert.equal(download.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal((await download.text()).includes("revenue,42"), true);

  const builtinDelete = await requestJson("/api/v1/datasources/api-duckdb-demo", { method: "DELETE" });
  assert.equal(builtinDelete.response.status, 409);
  assert.equal(builtinDelete.body.error.code, "CONFLICT");

  metadataStore.sqlAuditLogs.create({
    user_id: "dev-user",
    id: "audit-before-delete",
    datasource_id: "local-sqlite",
    sql_text: "SELECT 1",
    status: "succeeded"
  });
  const deletedDatasource = await requestJson("/api/v1/datasources/local-sqlite", { method: "DELETE" });
  assert.equal(deletedDatasource.body.data.deleted, true);
  const datasourceList = await requestJson("/api/v1/datasources");
  assert.equal(datasourceList.body.data.some((item) => item.id === "local-sqlite"), false);
  assert.throws(() => metadataStore.secrets.get({
    ref: createdDatasource.body.data.secretRef,
    workspace_id: "default",
    user_id: "dev-user"
  }), /SECRET_NOT_FOUND/u);

  console.log(
    "Config API smoke OK: secrets, datasource, revision, KB, MCP, model profile, skill, defaults, artifact, tombstone"
  );
} finally {
  await closeHttpServer(server);
  await closeHttpServer(mcpServer);
  await closeHttpServer(modelProviderServer);
  await taskStateRuntime.close();
}

process.exit(0);
