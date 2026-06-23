import {
  createErrorResult,
  createSuccessResult,
  type ApiResult,
  type AppErrorCode
} from "@open-data-agent/contracts";
import {
  createModelProviderFromEnv,
  createModelProviderFromProfile,
  probeModelProvider,
  STATIC_AGENT_TOOL_NAMES
} from "@open-data-agent/agent-runtime";
import type { LocalDataGateway } from "@open-data-agent/data-gateway";
import type { LocalKnowledgeService } from "@open-data-agent/knowledge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  artifactRecordToSummary,
  type ConfigResourceKind,
  type ConfigResourceRecord,
  type DataSourceRecord,
  type MetadataStore
} from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { basename, resolve, sep } from "node:path";

import { parseSkillUpload, readMultipartUpload } from "./upload-parser.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const DEFAULT_WORKSPACE_ID = "default";

export type ConfigApiContext = {
  dataGateway: LocalDataGateway;
  knowledgeService: LocalKnowledgeService;
  metadataStore: MetadataStore;
  userId: string;
  workspaceId?: string;
};

export type ConfigApiResponse = {
  body: ApiResult<unknown> | Buffer;
  headers?: Record<string, string>;
  status: number;
};

const RESOURCE_PATHS: Record<string, ConfigResourceKind> = {
  "knowledge-bases": "knowledge-base",
  "mcp-servers": "mcp-server",
  "model-profiles": "model-profile",
  skills: "skill"
};

/** Handle one configuration REST request, or return undefined for a non-config path. */
export const handleConfigApiRequest = async (
  request: IncomingMessage,
  pathname: string,
  context: ConfigApiContext
): Promise<ConfigApiResponse | undefined> => {
  if (!pathname.startsWith("/api/v1/")) {
    return undefined;
  }
  try {
    return await routeConfigRequest(request, pathname, {
      ...context,
      workspaceId: context.workspaceId ?? DEFAULT_WORKSPACE_ID
    });
  } catch (error) {
    return errorResponse(error);
  }
};

const routeConfigRequest = async (
  request: IncomingMessage,
  pathname: string,
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const segments = pathname.slice("/api/v1/".length).split("/").filter(Boolean);
  const root = segments[0] ?? "";

  if (root === "datasources") {
    return handleDatasourceRequest(request, segments.slice(1), context);
  }
  if (root === "workspace-config") {
    if (request.method === "GET") {
      return ok(buildWorkspaceConfig(context));
    }
    if (request.method === "PATCH") {
      return handleWorkspaceConfigPatch(request, context);
    }
    return methodNotAllowed();
  }
  if (root === "run-defaults" && request.method === "GET") {
    return ok(buildRunDefaults(context));
  }
  if (root === "capabilities" && request.method === "GET") {
    return ok({
      "artifact.export": true,
      "datasource.queryPolicy": true,
      "datasource.server": true,
      "llm.samplingParams": true,
      knowledge: true,
      mcp: true,
      skills: true
    });
  }
  if (root === "jobs") {
    return handleJobRequest(request, segments.slice(1), context);
  }
  if (root === "artifacts") {
    return handleArtifactRequest(request, segments.slice(1), context);
  }
  const kind = RESOURCE_PATHS[root];
  if (kind) {
    return handleGenericResourceRequest(request, segments.slice(1), context, kind);
  }
  return fail(404, "RESOURCE_NOT_FOUND", `Unknown API resource: ${root}`);
};

const handleDatasourceRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  const action = segments[1];
  if (!id && request.method === "GET") {
    return ok(context.metadataStore.dataSources.list({ user_id: context.userId }).map(dataSourceDto));
  }
  if (!id && request.method === "POST") {
    const body = await readJsonBody(request);
    const resourceId = stringValue(body.id) ?? slugify(stringValue(body.name) ?? `datasource-${randomUUID()}`);
    return ok(await saveDatasource(body, resourceId, context), 201);
  }
  if (!id) {
    return methodNotAllowed();
  }
  if (action === "test" && request.method === "POST") {
    const startedAt = Date.now();
    try {
      const result = await context.dataGateway.testConnect({ user_id: context.userId, datasource_id: id });
      return ok({ ...result, latencyMs: Date.now() - startedAt, status: "connected" });
    } catch (error) {
      context.metadataStore.dataSources.touchTest({ user_id: context.userId, datasource_id: id, status: "failed" });
      throw new Error(`DATASOURCE_TEST_FAILED:${messageOf(error)}`);
    }
  }
  if (action === "introspect" && request.method === "POST") {
    const job = context.metadataStore.configJobs.create({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      type: "datasource-introspect",
      resource_id: id,
      ...(request.headers["idempotency-key"]
        ? { idempotency_key: String(request.headers["idempotency-key"]) }
        : {})
    });
    if (job.status !== "queued") {
      return ok(job, 202);
    }
    context.metadataStore.configJobs.update({
      id: job.id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      status: "running",
      progress: 10
    });
    try {
      const schema = await context.dataGateway.inspectSchema({ user_id: context.userId, datasource_id: id });
      context.metadataStore.configResources.upsert({
        id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        kind: "datasource-schema",
        name: id,
        payload: { schema, adapterSchemaVersion: 1, inspectedAt: new Date().toISOString() },
        status: "ready"
      });
      const completed = context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "completed",
        progress: 100,
        result: schema
      });
      return ok(completed, 202);
    } catch (error) {
      context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "failed",
        error: { message: messageOf(error) }
      });
      throw error;
    }
  }
  if (action === "schema" && request.method === "GET") {
    const snapshot = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind: "datasource-schema"
    });
    return ok(snapshot.payload);
  }
  if (request.method === "GET") {
    return ok(dataSourceDto(context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: id })));
  }
  if (request.method === "PATCH") {
    return ok(await saveDatasource(await readJsonBody(request), id, context));
  }
  if (request.method === "DELETE") {
    const current = context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: id });
    if (booleanValue(parseRecord(current.config_json).builtin, false)) {
      throw new Error(`BUILTIN_RESOURCE_READONLY:${id}`);
    }
    if (current.credential_ref) {
      context.metadataStore.secrets.delete({
        ref: current.credential_ref,
        workspace_id: context.workspaceId,
        user_id: context.userId
      });
    }
    context.metadataStore.dataSources.delete({ user_id: context.userId, datasource_id: id });
    return ok({ deleted: true, id });
  }
  return methodNotAllowed();
};

const saveDatasource = async (
  body: Record<string, unknown>,
  id: string,
  context: Required<ConfigApiContext>
): Promise<Record<string, unknown>> => withConfigTransaction(
  context.metadataStore,
  () => saveDatasourceInTransaction(body, id, context)
);

const saveDatasourceInTransaction = (
  body: Record<string, unknown>,
  id: string,
  context: Required<ConfigApiContext>
): Record<string, unknown> => {
  const existing = findDatasource(context.metadataStore, context.userId, id);
  const existingConfig = existing ? parseRecord(existing.config_json) : {};
  if (existing && booleanValue(existingConfig.builtin, false)) {
    const mutableKeys = new Set(["defaultEnabled", "revision"]);
    const readonlyKeys = Object.keys(body).filter((key) => !mutableKeys.has(key));
    if (readonlyKeys.length > 0) {
      throw new Error(`BUILTIN_RESOURCE_READONLY:${id}`);
    }
  }
  const rawConfig = recordValue(body.config) ?? recordValue(body.connection) ?? recordValue(body.settings) ?? {};
  const inputConfig = { ...rawConfig };
  const inlinePassword = stringValue(inputConfig.password) ?? stringValue(body.password);
  delete inputConfig.password;
  const credentials = recordValue(body.credentials) ?? (inlinePassword ? { password: inlinePassword } : undefined);
  let secretRef = existing?.credential_ref;
  if (credentials) {
    secretRef = context.metadataStore.secrets.put({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      owner_kind: "datasource",
      owner_id: id,
      value: credentials,
      ...(secretRef ? { secret_ref: secretRef } : {})
    });
  } else if (body.clearCredentials === true && secretRef) {
    context.metadataStore.secrets.delete({ ref: secretRef, workspace_id: context.workspaceId, user_id: context.userId });
    secretRef = undefined;
  }
  const policy = recordValue(body.queryPolicy);
  const expectedRevision = numberValue(body.revision);
  const type = stringValue(body.type) ?? existing?.type ?? "duckdb";
  const normalizedConfig = normalizeDatasourceConfig(type, inputConfig);
  const description = stringValue(body.description) ?? existing?.description;
  const config = {
    ...existingConfig,
    ...normalizedConfig,
    ...(policy ? { queryPolicy: policy } : {}),
    defaultEnabled: booleanValue(body.defaultEnabled, booleanValue(existingConfig.defaultEnabled, true)),
    builtin: booleanValue(body.builtin, booleanValue(existingConfig.builtin, false)),
    mode: "readonly"
  };
  const record = context.metadataStore.dataSources.create({
    user_id: context.userId,
    id,
    name: stringValue(body.name) ?? existing?.name ?? id,
    type,
    config,
    ...(secretRef ? { credential_ref: secretRef } : {}),
    ...(description ? { description } : {}),
    status: existing?.status ?? "ready",
    ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {})
  });
  return dataSourceDto(record);
};

const handleGenericResourceRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>,
  kind: ConfigResourceKind
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  const action = segments[1];
  if (!id && request.method === "GET") {
    return ok(context.metadataStore.configResources.list({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    }).map(configResourceDto));
  }
  if (!id && request.method === "POST") {
    const body = kind === "skill" && isMultipart(request)
      ? await skillUploadBody(request, context)
      : await readJsonBody(request);
    const resourceId = stringValue(body.id) ?? slugify(stringValue(body.name) ?? `${kind}-${randomUUID()}`);
    return ok(saveConfigResource(body, resourceId, kind, context), 201);
  }
  if (!id) {
    return methodNotAllowed();
  }
  const targetResource = context.metadataStore.configResources.get({
    id,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind
  });
  if (kind === "knowledge-base" && action === "files" && request.method === "POST") {
    const upload = isMultipart(request) ? await readMultipartUpload(request) : undefined;
    const body = upload ? upload.fields : await readJsonBody(request);
    const filename = upload?.file.filename ?? stringValue(body.filename) ?? "document.txt";
    const content = upload?.file.content.toString("utf8") ?? stringValue(body.content);
    if (!content) {
      throw new Error("KNOWLEDGE_DOCUMENT_CONTENT_REQUIRED");
    }
    const mimeType = upload?.file.mimeType ?? stringValue(body.mimeType);
    const document = await context.knowledgeService.ingestText({
      user_id: context.userId,
      collection_id: id,
      filename,
      content,
      ...(mimeType ? { mime_type: mimeType } : {})
    });
    context.metadataStore.configResources.upsert({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind,
      name: targetResource.name,
      ...(targetResource.description ? { description: targetResource.description } : {}),
      payload: targetResource.payload,
      ...(targetResource.secret_ref ? { secret_ref: targetResource.secret_ref } : {}),
      default_enabled: targetResource.default_enabled,
      builtin: targetResource.builtin,
      status: "ready",
      expected_revision: targetResource.revision
    });
    return ok(document, 201);
  }
  if (kind === "knowledge-base" && action === "search" && request.method === "POST") {
    const body = await readJsonBody(request);
    const query = stringValue(body.query);
    if (!query) {
      throw new Error("KNOWLEDGE_QUERY_REQUIRED");
    }
    const topK = numberValue(body.topK);
    return ok(await context.knowledgeService.retrieve({
      user_id: context.userId,
      collection_id: id,
      query,
      ...(topK !== undefined ? { top_k: topK } : {})
    }));
  }
  if (kind === "knowledge-base" && action === "reindex" && request.method === "POST") {
    const job = context.metadataStore.configJobs.create({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      type: "knowledge-reindex",
      resource_id: id,
      ...(request.headers["idempotency-key"]
        ? { idempotency_key: String(request.headers["idempotency-key"]) }
        : {})
    });
    if (job.status !== "queued") {
      return ok(job, 202);
    }
    context.metadataStore.configJobs.update({
      id: job.id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      status: "running",
      progress: 10
    });
    try {
      const result = await context.knowledgeService.reindex({ user_id: context.userId, collection_id: id });
      return ok(context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "completed",
        progress: 100,
        result: {
          documents: context.knowledgeService.listDocuments({ user_id: context.userId, collection_id: id }).length,
          ...result
        }
      }), 202);
    } catch (error) {
      context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "failed",
        error: { message: messageOf(error) }
      });
      throw error;
    }
  }
  if (kind === "skill" && action === "replace" && request.method === "POST") {
    return ok(saveConfigResource(await skillUploadBody(request, context), id, kind, context));
  }
  if (kind === "skill" && action === "validate" && request.method === "POST") {
    const current = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    return ok({ id, revision: current.revision, validationStatus: "valid" });
  }
  if (kind === "skill" && action === "package" && request.method === "GET") {
    const current = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    return ok({
      packageBase64: current.payload.packageBase64,
      packageContent: current.payload.packageContent,
      packageFileName: current.payload.packageFileName,
      packageFormat: current.payload.packageFormat
    });
  }
  if (action === "test" && request.method === "POST") {
    const startedAt = Date.now();
    const resource = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    if (kind === "mcp-server") {
      const tools = await listMcpTools(resource, context);
      const updated = context.metadataStore.configResources.upsert({
        id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        kind,
        name: resource.name,
        ...(resource.description ? { description: resource.description } : {}),
        payload: { ...resource.payload, toolManifest: tools },
        ...(resource.secret_ref ? { secret_ref: resource.secret_ref } : {}),
        default_enabled: resource.default_enabled,
        builtin: resource.builtin,
        status: "connected",
        expected_revision: resource.revision
      });
      return ok({ id, latencyMs: 0, status: "connected", toolCount: tools.length, revision: updated.revision });
    }
    if (kind === "model-profile") {
      const provider = resolveProfileProvider(resource, context);
      const probe = await probeModelProvider(provider, numberValue(resource.payload.timeoutMs) ?? 30000);
      const updated = context.metadataStore.configResources.upsert({
        id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        kind,
        name: resource.name,
        ...(resource.description ? { description: resource.description } : {}),
        payload: {
          ...resource.payload,
          capabilities: { reasoning: "unknown", toolCall: "untested" }
        },
        ...(resource.secret_ref ? { secret_ref: resource.secret_ref } : {}),
        default_enabled: resource.default_enabled,
        builtin: resource.builtin,
        status: "connected",
        expected_revision: resource.revision
      });
      return ok({
        id,
        latencyMs: Date.now() - startedAt,
        model: probe.model,
        response: probe.text,
        status: "connected",
        revision: updated.revision
      });
    }
    return ok({ id, status: "connected", validated: true, revision: resource.revision });
  }
  if (action === "tools" && request.method === "GET" && kind === "mcp-server") {
    const resource = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    return ok(await listMcpTools(resource, context));
  }
  if (request.method === "GET") {
    return ok(configResourceDto(context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    })));
  }
  if (request.method === "PATCH") {
    return ok(saveConfigResource(await readJsonBody(request), id, kind, context));
  }
  if (request.method === "DELETE") {
    const current = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    if (kind === "knowledge-base") {
      context.metadataStore.db.prepare(
        "DELETE FROM knowledge_embeddings WHERE user_id = ? AND collection_id = ?"
      ).run(context.userId, id);
      context.metadataStore.db.prepare(
        "DELETE FROM knowledge_chunks WHERE user_id = ? AND collection_id = ?"
      ).run(context.userId, id);
      context.metadataStore.db.prepare(
        "DELETE FROM knowledge_documents WHERE user_id = ? AND collection_id = ?"
      ).run(context.userId, id);
    }
    context.metadataStore.configResources.delete({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    if (current.secret_ref) {
      context.metadataStore.secrets.delete({
        ref: current.secret_ref,
        workspace_id: context.workspaceId,
        user_id: context.userId
      });
    }
    return ok({ deleted: true, id });
  }
  return methodNotAllowed();
};

const saveConfigResource = (
  body: Record<string, unknown>,
  id: string,
  kind: ConfigResourceKind,
  context: Required<ConfigApiContext>
): Record<string, unknown> => withConfigTransaction(
  context.metadataStore,
  () => saveConfigResourceInTransaction(body, id, kind, context)
);

const saveConfigResourceInTransaction = (
  body: Record<string, unknown>,
  id: string,
  kind: ConfigResourceKind,
  context: Required<ConfigApiContext>
): Record<string, unknown> => {
  const current = context.metadataStore.configResources.find({
    id,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind
  });
  if (current?.builtin) {
    const mutableKeys = new Set(["defaultEnabled", "revision"]);
    const readonlyKeys = Object.keys(body).filter((key) => !mutableKeys.has(key));
    if (readonlyKeys.length > 0) {
      throw new Error(`BUILTIN_RESOURCE_READONLY:${id}`);
    }
  }
  const credentials = resourceCredentials(body, kind);
  let secretRef = current?.secret_ref;
  if (credentials) {
    secretRef = context.metadataStore.secrets.put({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      owner_kind: kind,
      owner_id: id,
      value: credentials,
      ...(secretRef ? { secret_ref: secretRef } : {})
    });
  } else if (body.clearCredentials === true && secretRef) {
    context.metadataStore.secrets.delete({
      ref: secretRef,
      workspace_id: context.workspaceId,
      user_id: context.userId
    });
    secretRef = undefined;
  }
  const reserved = new Set([
    "apiKey", "api_key", "builtin", "clearCredentials", "credentials", "defaultEnabled", "description", "headers",
    "id", "name", "password", "revision", "status", "token"
  ]);
  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => !reserved.has(key)));
  if (kind === "model-profile") {
    validateModelFallback(id, { ...(current?.payload ?? {}), ...payload }, context);
  }
  const description = stringValue(body.description) ?? current?.description;
  const expectedRevision = numberValue(body.revision);
  const record = context.metadataStore.configResources.upsert({
    id,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind,
    name: stringValue(body.name) ?? current?.name ?? id,
    ...(description ? { description } : {}),
    payload: { ...(current?.payload ?? {}), ...payload },
    ...(body.clearCredentials === true ? { secret_ref: null } : secretRef ? { secret_ref: secretRef } : {}),
    default_enabled: booleanValue(body.defaultEnabled, current?.default_enabled ?? true),
    builtin: booleanValue(body.builtin, current?.builtin ?? false),
    status: resourceStatusValue(body, kind) ?? current?.status ?? defaultResourceStatus(kind),
    ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {})
  });
  return configResourceDto(record);
};

const validateModelFallback = (
  profileId: string,
  payload: Record<string, unknown>,
  context: Required<ConfigApiContext>
): void => {
  const visited = new Set([profileId]);
  let fallbackId = stringValue(payload.fallbackProfileId);
  while (fallbackId) {
    if (visited.has(fallbackId)) {
      throw new Error(`MODEL_FALLBACK_CYCLE:${fallbackId}`);
    }
    visited.add(fallbackId);
    const fallback = context.metadataStore.configResources.get({
      id: fallbackId,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind: "model-profile"
    });
    fallbackId = stringValue(fallback.payload.fallbackProfileId);
  }
};

const handleJobRequest = (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): ConfigApiResponse => {
  const id = segments[0];
  if (!id) {
    return fail(400, "BAD_REQUEST", "Job id is required.");
  }
  if (request.method === "GET") {
    return ok(context.metadataStore.configJobs.get({ id, workspace_id: context.workspaceId, user_id: context.userId }));
  }
  if (request.method === "POST" && segments[1] === "cancel") {
    return ok(context.metadataStore.configJobs.update({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      status: "canceled"
    }));
  }
  return methodNotAllowed();
};

const handleArtifactRequest = (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): ConfigApiResponse => {
  const id = segments[0];
  if (!id || request.method !== "GET") {
    return methodNotAllowed();
  }
  const artifact = context.metadataStore.artifacts.get({ user_id: context.userId, artifact_id: id });
  if (segments[1] === "preview") {
    return ok(artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null);
  }
  if (segments[1] === "content" || segments[1] === "download") {
    const file = artifactFileContent(artifact.storage_path);
    const preview = artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null;
    const content = file ?? serializeArtifactPreview(preview, segments[1] === "download");
    const filename = safeDownloadName(artifact.name, content.mimeType);
    return {
      body: content.body,
      headers: {
        "Content-Disposition": `${segments[1] === "download" ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Type": content.mimeType
      },
      status: 200
    };
  }
  return ok({
    ...artifactRecordToSummary(artifact),
    mimeType: artifact.mime_type,
    metadata: artifact.metadata_json ? JSON.parse(artifact.metadata_json) as unknown : undefined,
    createdAt: artifact.created_at
  });
};

const artifactFileContent = (storagePath: string | undefined): { body: Buffer; mimeType: string } | undefined => {
  if (!storagePath) {
    return undefined;
  }
  const root = resolve(process.env.ARTIFACT_STORAGE_ROOT ?? "storage/artifacts");
  const path = resolve(storagePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("ARTIFACT_STORAGE_PATH_INVALID");
  }
  return { body: readFileSync(path), mimeType: mimeTypeForPath(path) };
};

const serializeArtifactPreview = (
  preview: unknown,
  preferCsv: boolean
): { body: Buffer; mimeType: string } => {
  const csv = preferCsv ? previewCsv(preview) : undefined;
  if (csv !== undefined) {
    return { body: Buffer.from(csv, "utf8"), mimeType: "text/csv; charset=utf-8" };
  }
  return {
    body: Buffer.from(JSON.stringify(preview, null, 2), "utf8"),
    mimeType: "application/json; charset=utf-8"
  };
};

const previewCsv = (preview: unknown): string | undefined => {
  if (!isRecord(preview) || !Array.isArray(preview.columns) || !Array.isArray(preview.rows)) {
    return undefined;
  }
  const columns = preview.columns.filter((column): column is string => typeof column === "string");
  if (columns.length === 0) {
    return undefined;
  }
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  const lines = [columns.map(escape).join(",")];
  preview.rows.forEach((row) => {
    if (Array.isArray(row)) {
      lines.push(row.map(escape).join(","));
    } else if (isRecord(row)) {
      lines.push(columns.map((column) => escape(row[column])).join(","));
    }
  });
  return `${lines.join("\n")}\n`;
};

const safeDownloadName = (name: string, mimeType: string): string => {
  const safe = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-") || "artifact";
  if (safe.includes(".")) {
    return safe;
  }
  return `${safe}.${mimeType.startsWith("text/csv") ? "csv" : "json"}`;
};

const mimeTypeForPath = (path: string): string => {
  const extension = path.toLowerCase().split(".").pop();
  return ({ csv: "text/csv; charset=utf-8", json: "application/json; charset=utf-8", md: "text/markdown; charset=utf-8",
    png: "image/png", svg: "image/svg+xml", txt: "text/plain; charset=utf-8" } as Record<string, string>)[extension ?? ""]
    ?? "application/octet-stream";
};

const handleWorkspaceConfigPatch = async (
  request: IncomingMessage,
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const body = await readJsonBody(request);
  const updated = withConfigTransaction(context.metadataStore, () => {
    const datasourceUpdates = workspaceUpdates(body.datasources);
    for (const update of datasourceUpdates) {
      const current = context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: update.id });
      const config = parseRecord(current.config_json);
      context.metadataStore.dataSources.create({
        user_id: context.userId,
        id: current.id,
        name: current.name,
        type: current.type,
        config: { ...config, defaultEnabled: update.defaultEnabled },
        ...(current.credential_ref ? { credential_ref: current.credential_ref } : {}),
        ...(current.description ? { description: current.description } : {}),
        status: current.status,
        ...(update.revision !== undefined ? { expected_revision: update.revision } : {})
      });
    }
    const groups: Array<{ key: string; kind: ConfigResourceKind }> = [
      { key: "knowledgeBases", kind: "knowledge-base" },
      { key: "mcpServers", kind: "mcp-server" },
      { key: "modelProfiles", kind: "model-profile" },
      { key: "skills", kind: "skill" }
    ];
    for (const group of groups) {
      for (const update of workspaceUpdates(body[group.key])) {
        const current = context.metadataStore.configResources.get({
          id: update.id,
          workspace_id: context.workspaceId,
          user_id: context.userId,
          kind: group.kind
        });
        context.metadataStore.configResources.upsert({
          id: current.id,
          workspace_id: current.workspace_id,
          user_id: current.user_id,
          kind: current.kind,
          name: current.name,
          ...(current.description ? { description: current.description } : {}),
          payload: current.payload,
          ...(current.secret_ref ? { secret_ref: current.secret_ref } : {}),
          default_enabled: update.defaultEnabled,
          builtin: current.builtin,
          status: current.status,
          ...(update.revision !== undefined ? { expected_revision: update.revision } : {})
        });
      }
    }
    return buildWorkspaceConfig(context);
  });
  return ok(updated);
};

const buildWorkspaceConfig = (context: Required<ConfigApiContext>): Record<string, unknown> => ({
  datasources: context.metadataStore.dataSources.list({ user_id: context.userId }).map(dataSourceDto),
  knowledgeBases: listConfig(context, "knowledge-base"),
  mcpServers: listConfig(context, "mcp-server"),
  modelProfiles: listConfig(context, "model-profile"),
  skills: listConfig(context, "skill")
});

const buildRunDefaults = (context: Required<ConfigApiContext>): Record<string, unknown> => {
  const datasourceIds = context.metadataStore.dataSources.list({ user_id: context.userId })
    .filter((item) => booleanValue(parseRecord(item.config_json).defaultEnabled, true) && item.status === "ready")
    .map((item) => item.id);
  const enabled = (kind: ConfigResourceKind): ConfigResourceRecord[] =>
    context.metadataStore.configResources.list({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    }).filter((item) => item.default_enabled);
  return {
    enabledDatasourceIds: datasourceIds,
    enabledKnowledgeIds: enabled("knowledge-base").map((item) => item.id),
    enabledMcpServerIds: enabled("mcp-server").map((item) => item.id),
    enabledSkillIds: enabled("skill").map((item) => item.id),
    activeDatasourceId: datasourceIds[0],
    activeLlmProfileId: enabled("model-profile")[0]?.id,
    activeSkillId: enabled("skill")[0]?.id
  };
};

const listConfig = (context: Required<ConfigApiContext>, kind: ConfigResourceKind): Record<string, unknown>[] =>
  context.metadataStore.configResources.list({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind
  }).map(configResourceDto);

const dataSourceDto = (record: DataSourceRecord): Record<string, unknown> => {
  const config = parseRecord(record.config_json);
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? "",
    type: record.type,
    mode: "readonly",
    config,
    secretRef: record.credential_ref,
    hasSecret: Boolean(record.credential_ref),
    defaultEnabled: booleanValue(config.defaultEnabled, true),
    builtin: booleanValue(config.builtin, false),
    connectionStatus: datasourceStatus(record.status),
    revision: record.revision,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
};

const configResourceDto = (record: ConfigResourceRecord): Record<string, unknown> => ({
  id: record.id,
  name: record.name,
  description: record.description ?? "",
  ...publicPayload(record.payload),
  secretRef: record.secret_ref,
  hasSecret: Boolean(record.secret_ref),
  defaultEnabled: record.default_enabled,
  builtin: record.builtin,
  [resourceStatusField(record.kind)]: record.status,
  revision: record.revision,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("JSON_OBJECT_REQUIRED");
  }
  return parsed;
};

const skillUploadBody = async (
  request: IncomingMessage,
  _context: Required<ConfigApiContext>
): Promise<Record<string, unknown>> => {
  if (!isMultipart(request)) {
    throw new Error("SKILL_MULTIPART_REQUIRED");
  }
  const upload = await readMultipartUpload(request);
  const parsed = await parseSkillUpload(upload.file);
  const knownTools = new Set<string>(STATIC_AGENT_TOOL_NAMES);
  const unknownTools = parsed.allowedTools.filter((tool) => !knownTools.has(tool) && !tool.startsWith("mcp__"));
  if (unknownTools.length > 0) {
    throw new Error(`SKILL_ALLOWED_TOOL_UNKNOWN:${unknownTools.join(",")}`);
  }
  return {
    ...upload.fields,
    ...parsed,
    packageContent: parsed.instructions,
    status: "valid"
  };
};

const errorResponse = (error: unknown): ConfigApiResponse => {
  const message = messageOf(error);
  if (message.startsWith("REVISION_CONFLICT")) {
    return fail(409, "REVISION_CONFLICT", message);
  }
  if (message.includes("NOT_FOUND") || message.includes("not found")) {
    return fail(404, "RESOURCE_NOT_FOUND", message);
  }
  if (message.startsWith("SECRET_MASTER_KEY_REQUIRED")) {
    return fail(503, "SECRET_MASTER_KEY_REQUIRED", message);
  }
  if (message.startsWith("DATASOURCE_TEST_FAILED")) {
    return fail(422, "DATASOURCE_TEST_FAILED", message);
  }
  if (message.startsWith("PROVIDER_") || message.startsWith("MODEL_FALLBACK")) {
    return fail(422, "PROVIDER_TEST_FAILED", message);
  }
  if (message.startsWith("BUILTIN_RESOURCE_READONLY") || message.startsWith("SECRET_OWNER_MISMATCH")) {
    return fail(409, "CONFLICT", message);
  }
  if (error instanceof SyntaxError || message.includes("REQUIRED") || message.includes("INVALID")) {
    return fail(400, "BAD_REQUEST", message);
  }
  return fail(500, "INTERNAL_ERROR", message);
};

const ok = (data: unknown, status = 200): ConfigApiResponse => ({ body: createSuccessResult(data), status });
const fail = (status: number, code: AppErrorCode, message: string): ConfigApiResponse => ({
  body: createErrorResult(code, message),
  status
});
const methodNotAllowed = (): ConfigApiResponse => fail(405, "BAD_REQUEST", "Method not allowed.");
const messageOf = (value: unknown): string => value instanceof Error ? value.message : String(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const recordValue = (value: unknown): Record<string, unknown> | undefined => isRecord(value) ? value : undefined;
const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const booleanValue = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
const parseRecord = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  return isRecord(parsed) ? parsed : {};
};
const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "");
const datasourceStatus = (status: DataSourceRecord["status"]): string => status === "ready" ? "connected" : status;
const resourceStatusField = (kind: ConfigResourceKind): string => {
  if (kind === "knowledge-base") {
    return "indexStatus";
  }
  if (kind === "mcp-server") {
    return "healthStatus";
  }
  if (kind === "skill") {
    return "validationStatus";
  }
  return "connectionStatus";
};
const resourceStatusValue = (body: Record<string, unknown>, kind: ConfigResourceKind): string | undefined =>
  stringValue(body[resourceStatusField(kind)]) ?? stringValue(body.status);
const defaultResourceStatus = (kind: ConfigResourceKind): string => kind === "knowledge-base" ? "empty" : "untested";
const workspaceUpdates = (value: unknown): Array<{ id: string; defaultEnabled: boolean; revision?: number }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    if (typeof entry === "string") {
      return { id: entry, defaultEnabled: true };
    }
    if (!isRecord(entry) || !stringValue(entry.id) || typeof entry.defaultEnabled !== "boolean") {
      throw new Error("WORKSPACE_CONFIG_UPDATE_INVALID");
    }
    const revision = numberValue(entry.revision);
    return {
      id: stringValue(entry.id) as string,
      defaultEnabled: entry.defaultEnabled,
      ...(revision !== undefined ? { revision } : {})
    };
  });
};

const withConfigTransaction = <T>(metadataStore: MetadataStore, operation: () => T): T => {
  metadataStore.db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    metadataStore.db.exec("COMMIT");
    return result;
  } catch (error) {
    metadataStore.db.exec("ROLLBACK");
    throw error;
  }
};
const findDatasource = (store: MetadataStore, userId: string, id: string): DataSourceRecord | undefined => {
  try {
    return store.dataSources.get({ user_id: userId, datasource_id: id });
  } catch {
    return undefined;
  }
};

const isMultipart = (request: IncomingMessage): boolean =>
  String(request.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data");

const publicPayload = (payload: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(payload).filter(([key]) =>
    !["apiKey", "api_key", "headers", "packageBase64", "packageContent", "password", "token"].includes(key)));

const resourceCredentials = (
  body: Record<string, unknown>,
  kind: ConfigResourceKind
): Record<string, unknown> | undefined => {
  const explicit = recordValue(body.credentials);
  if (explicit) {
    return explicit;
  }
  const keys = kind === "model-profile" || kind === "knowledge-base"
    ? ["apiKey", "api_key"]
    : kind === "mcp-server"
      ? ["token", "apiKey", "headers"]
      : [];
  const entries = keys.flatMap((key) => body[key] === undefined ? [] : [[key, body[key]] as [string, unknown]]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeDatasourceConfig = (
  type: string,
  config: Record<string, unknown>
): Record<string, unknown> => {
  const filePath = stringValue(config.filePath) ?? stringValue(config.file_path);
  if (type === "sqlite" && filePath) {
    return { ...config, path: filePath, filePath: undefined, file_path: undefined };
  }
  if ((type === "csv" || type === "xlsx") && filePath) {
    return { ...config, file_path: filePath, filePath: undefined };
  }
  return config;
};

const listMcpTools = async (
  resource: ConfigResourceRecord,
  context: Required<ConfigApiContext>
): Promise<Array<Record<string, unknown>>> => {
  const url = stringValue(resource.payload.serverUrl) ?? stringValue(resource.payload.url);
  const transport = stringValue(resource.payload.transport) ?? "streamable-http";
  if (!url || (transport !== "streamable-http" && transport !== "sse")) {
    throw new Error("MCP_SERVER_CONFIG_INVALID");
  }
  const secret = resource.secret_ref
    ? context.metadataStore.secrets.get({
        ref: resource.secret_ref,
        workspace_id: context.workspaceId,
        user_id: context.userId
      })
    : {};
  const token = stringValue(secret.token) ?? stringValue(secret.apiKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const requestOptions = headers ? { requestInit: { headers } } : undefined;
  const client = new Client({ name: "open-data-agent-config", version: "0.1.0" });
  try {
    const clientTransport = transport === "sse"
      ? new SSEClientTransport(new URL(url), requestOptions)
      : new StreamableHTTPClientTransport(new URL(url), requestOptions);
    await client.connect(clientTransport as unknown as Transport);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
};

const resolveProfileProvider = (
  resource: ConfigResourceRecord,
  context: Required<ConfigApiContext>
): Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }> => {
  const provider = resource.id === "server-default"
    ? createModelProviderFromEnv(process.env)
    : createModelProviderFromProfile({
        provider: stringValue(resource.payload.provider) ?? "openai-compatible",
        model: stringValue(resource.payload.modelName) ?? stringValue(resource.payload.model) ?? "",
        base_url: stringValue(resource.payload.baseUrl) ?? stringValue(resource.payload.base_url) ?? "",
        ...profileApiKey(resource, context)
      });
  if (provider.kind === "mock") {
    throw new Error(`PROVIDER_CONFIG_MISSING:${resource.id}`);
  }
  return provider;
};

const profileApiKey = (
  resource: ConfigResourceRecord,
  context: Required<ConfigApiContext>
): { api_key?: string } => {
  if (!resource.secret_ref) {
    return {};
  }
  const secret = context.metadataStore.secrets.get({
    ref: resource.secret_ref,
    workspace_id: context.workspaceId,
    user_id: context.userId
  });
  const apiKey = stringValue(secret.apiKey) ?? stringValue(secret.api_key);
  return apiKey ? { api_key: apiKey } : {};
};
