import {
  createErrorResult,
  createSuccessResult,
  type ApiResult,
  type AppErrorCode,
  type EvidenceKind,
  type EvidenceRef
} from "@datafoundry/contracts";
import {
  createModelProviderFromEnv,
  createModelProviderFromProfile,
  probeModelProvider,
  resolveSkillCacheDir,
  resolveSessionWorkspaceDir,
  resolveWorkspaceDir,
  STATIC_AGENT_TOOL_NAMES
} from "@datafoundry/agent-runtime";
import { fileAssetRefDto, type FileAssetService, mimeTypeForFilename, safeFilename } from "@datafoundry/files";
import {
  buildSkillResourcePayload,
  materializeSkillPackages,
  parseSkillPackage,
  selectSkillsForRun
} from "@datafoundry/skills";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  artifactRecordToSummary,
  type ArtifactRecord,
  type ConfigResourceKind,
  type ConfigResourceRecord,
  type ConversationMessageRecord,
  type ConversationSummaryRecord,
  type DataSourceRecord,
  type FileAssetRefSource,
  type InteractionRecord,
  type JobRecord,
  type MetadataStore,
  type QueryHistoryRecord,
  type RunRecord,
  type RunEventRecord,
  type SessionBranchRecord,
  type SessionRecord,
  type UserRecord
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { basename, join, resolve, sep } from "node:path";
import writeXlsxFile, { type SheetData } from "write-excel-file/node";

import { resolveEffectiveRunConfig } from "./run-input.js";
import { handleCapabilitiesRequest } from "./routes/capabilities.js";
import type { ConfigApiContext, ConfigApiResponse } from "./routes/types.js";
import { sessionTitleDto } from "./session-title.js";
import {
  createSessionBranch,
  latestVisibleConversationSummary,
  listConversationBranchOptions,
  listVisibleConversationMessages,
  resolveSessionLineage,
  type ConversationBranchOption
} from "./session-branching.js";
import { readMultipartFiles, readMultipartUpload } from "./upload-parser.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const DEFAULT_WORKSPACE_ID = "default";

/**
 * Map the user-facing `origin` label (R-021) to the internal FileAssetRefSource enum
 * so the files panel can filter by display label without coupling to the enum.
 * Unknown labels map to undefined and are dropped.
 */
const originToSource = (origin: string): string | undefined => {
  switch (origin.toLowerCase()) {
    case "uploaded":
      return "upload";
    case "generated":
      return "artifact";
    case "saved":
      return "workspace";
    default:
      return undefined;
  }
};

export type { ConfigApiContext, ConfigApiResponse } from "./routes/types.js";

const RESOURCE_PATHS: Record<string, ConfigResourceKind> = {
  "knowledge-bases": "knowledge-base",
  "mcp-servers": "mcp-server",
  "model-profiles": "model-profile",
  skills: "skill"
};
const CHAT_UPLOAD_MAX_FILES = 1;
const CHAT_UPLOAD_MAX_FILE_BYTES = 20 * 1024 * 1024;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CHAT_UPLOAD_TYPES = new Set([
  "application/json",
  "application/pdf",
  XLSX_MIME_TYPE,
  "text/csv",
  "text/plain",
  "text/tab-separated-values"
]);
const CHAT_UPLOAD_EXTENSIONS = new Set([".csv", ".json", ".parquet", ".pdf", ".tsv", ".txt", ".xlsx"]);

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

  if (root === "me") {
    return handleMeRequest(request, context);
  }
  if (root === "dev") {
    return handleDevIdentityRequest(request, segments.slice(1), context);
  }
  if (root === "datasource-types" && request.method === "GET") {
    return ok(await context.dataGateway.supportTypes());
  }
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
  if (root === "capabilities") {
    return handleCapabilitiesRequest(request.method);
  }
  if (root === "chat" && segments[1] === "uploads") {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    return handleChatUpload(request, context);
  }
  if (root === "sessions") {
    return handleSessionRequest(request, segments.slice(1), context);
  }
  if (root === "jobs") {
    return handleJobRequest(request, segments.slice(1), context);
  }
  if (root === "runs") {
    return handleRunRequest(request, segments.slice(1), context);
  }
  if (root === "query-history") {
    return handleQueryHistoryRequest(request, segments.slice(1), context);
  }
  if (root === "artifacts") {
    return handleArtifactRequest(request, segments.slice(1), context);
  }
  if (root === "files") {
    return handleFileRequest(request, segments.slice(1), context);
  }
  if (root === "skills" && segments[1] === "select" && request.method === "POST") {
    return handleSkillSelectionPreview(request, context);
  }
  const kind = RESOURCE_PATHS[root];
  if (kind) {
    return handleGenericResourceRequest(request, segments.slice(1), context, kind);
  }
  return fail(404, "RESOURCE_NOT_FOUND", `Unknown API resource: ${root}`);
};

const handleMeRequest = (
  request: IncomingMessage,
  context: Required<ConfigApiContext>
): ConfigApiResponse => {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }
  const user = context.metadataStore.users.getById({ user_id: context.userId });
  return ok({
    user: devIdentityUserDto(user),
    workspace: defaultWorkspaceDto(context.workspaceId)
  });
};

const handleDevIdentityRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  if (!isDevIdentityApiEnabled()) {
    return fail(404, "RESOURCE_NOT_FOUND", "Dev identity API is not enabled.");
  }
  const resource = segments[0];
  if (resource === "identities" && request.method === "GET") {
    return ok({
      users: context.metadataStore.users.list().map(devIdentityUserDto),
      currentUserId: context.userId,
      workspace: defaultWorkspaceDto(context.workspaceId)
    });
  }
  if (resource === "users" && request.method === "POST") {
    const body = await readJsonBody(request);
    const id = sanitizeDevUserId(stringValue(body.id) ?? stringValue(body.userId) ?? "");
    const email = sanitizeOptionalEmail(stringValue(body.email), id);
    const displayName = sanitizeDisplayName(
      stringValue(body.displayName) ?? stringValue(body.display_name) ?? id
    );
    const user = context.metadataStore.users.upsertDevUser({
      id,
      email,
      display_name: displayName,
      dev_token: `dev-token-${id}`
    });
    return ok({ user: devIdentityUserDto(user) }, 201);
  }
  return fail(404, "RESOURCE_NOT_FOUND", `Unknown dev identity resource: ${resource ?? ""}`);
};

const isDevIdentityApiEnabled = (): boolean =>
  process.env.NODE_ENV !== "production" || process.env.DATAFOUNDRY_ENABLE_DEV_IDENTITY_API === "true";

const handleChatUpload = async (
  request: IncomingMessage,
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  if (!isMultipart(request)) {
    throw new Error("CHAT_UPLOAD_MULTIPART_REQUIRED");
  }
  const upload = await readMultipartFiles(request, {
    maxFileBytes: CHAT_UPLOAD_MAX_FILE_BYTES,
    maxFiles: CHAT_UPLOAD_MAX_FILES,
    maxTotalBytes: CHAT_UPLOAD_MAX_FILE_BYTES
  });
  const file = upload.files[0];
  if (!file) {
    throw new Error("UPLOAD_FILE_REQUIRED");
  }
  if (!isSupportedChatUpload(file.filename, file.mimeType)) {
    throw new Error("UNSUPPORTED_FILE_TYPE");
  }
  const sessionId = stringValue(upload.fields.sessionId)
    ?? stringValue(upload.fields.session_id)
    ?? stringValue(upload.fields.threadId)
    ?? stringValue(upload.fields.thread_id)
    ?? stringHeader(request.headers["x-session-id"])
    ?? stringHeader(request.headers["x-thread-id"]);
  if (!sessionId) {
    throw new Error("CHAT_UPLOAD_SESSION_REQUIRED");
  }
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces");
  const workspaceDir = resolveSessionWorkspaceDir({
    runContext: {
      user_id: context.userId,
      workspace_id: context.workspaceId,
      session_id: sessionId,
      run_id: "chat-upload",
      selected_datasource_id: "api-duckdb-demo",
      enabled_datasource_ids: ["api-duckdb-demo"],
      user_input: "chat upload",
      chat_mode: "copilotkit",
      model_name: "chat-upload"
    },
    workspaceRoot
  });
  const uploadDir = resolve(workspaceDir, "uploads");
  if (!uploadDir.startsWith(`${workspaceDir}${sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }
  mkdirSync(uploadDir, { recursive: true });
  const filename = uniqueUploadFilename(uploadDir, file.filename);
  const targetPath = resolve(uploadDir, filename);
  if (!targetPath.startsWith(`${uploadDir}${sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }
  writeFileSync(targetPath, file.content);
  // R-025: register a session-scoped FileAssetRef (source=upload, session_id set) so the
  // uploaded file is listed by GET /api/v1/files?scope=session&sessionId=...&origin=uploaded.
  // Best-effort: a failure to register must not fail the upload (the file is already on disk).
  let fileId: string | undefined;
  try {
    const resolved = context.fileAssetService.createRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      session_id: sessionId,
      run_id: "chat-upload",
      filename,
      content: file.content,
      declared_mime_type: file.mimeType || mimeTypeForFilename(filename),
      source: "upload",
      metadata: { kind: "chat-upload", session_id: sessionId }
    });
    fileId = resolved.ref.id;
  } catch {
    // best-effort; the on-disk file remains usable as a chat attachment
  }
  return {
    body: {
      mimeType: file.mimeType || mimeTypeForFilename(filename),
      path: `uploads/${filename}`,
      size: file.content.length,
      ...(fileId ? { fileId } : {})
    },
    status: 200
  };
};

const handleSessionRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const sessionId = segments[0];
  const action = segments[1];
  if (!sessionId && request.method === "GET") {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const limit = clampInteger(Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10), 1, 200, 50);
    const cursor = requestUrl.searchParams.get("cursor");
    const records = context.metadataStore.sessions.list({
      user_id: context.userId,
      limit,
      ...(cursor ? { cursor } : {})
    });
    return ok({
      sessions: records.map(sessionListDto),
      ...(records.length === limit ? { nextCursor: encodeSessionCursor(records.at(-1) as SessionRecord) } : {})
    });
  }
  if (!sessionId) {
    return fail(400, "BAD_REQUEST", "Session id is required.");
  }
  if (!action && request.method === "PATCH") {
    const body = await readJsonBody(request);
    const title = stringValue(body.title)?.trim();
    if (!title) {
      throw new Error("SESSION_TITLE_REQUIRED");
    }
    const session = context.metadataStore.sessions.create({
      user_id: context.userId,
      id: sessionId,
      title: title.slice(0, 80),
      title_source: "user"
    });
    return ok(sessionTitleDto(session));
  }
  if (action === "branches" && request.method === "POST") {
    const body = await readJsonBody(request);
    const runId = stringValue(body.runId ?? body.run_id);
    if (!runId) {
      throw new Error("RUN_ID_REQUIRED");
    }
    const title = stringValue(body.title);
    const created = createSessionBranch({
      activeSessionId: sessionId,
      metadataStore: context.metadataStore,
      runId,
      ...(title ? { title } : {}),
      userId: context.userId
    });
    return ok(sessionBranchCreatedDto(created), 201);
  }
  if (action !== "conversation") {
    return methodNotAllowed();
  }
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const session = context.metadataStore.sessions.get({ user_id: context.userId, session_id: sessionId });
  const lineage = resolveSessionLineage({
    metadataStore: context.metadataStore,
    sessionId,
    userId: context.userId
  });
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const limit = clampInteger(Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10), 1, 200, 80);
  const messages = listVisibleConversationMessages({
    lineage,
    limit,
    metadataStore: context.metadataStore,
    userId: context.userId
  });
  const latestSummary = latestVisibleConversationSummary({
    lineage,
    metadataStore: context.metadataStore,
    sessionId,
    userId: context.userId
  });
  const runIds = [...new Set([
    ...messages.map((message) => message.run_id),
    ...(latestSummary?.source_run_id ? [latestSummary.source_run_id] : [])
  ])];
  const runEventGroups = runIds.map((runId) => ({
    runId,
    events: context.metadataStore.runEvents.listByRun({ user_id: context.userId, run_id: runId })
  }));
  const visiblePositions = new Map(messages.map((message, index) => [message.id, index + 1]));
  const checkpoints = runCheckpointDtos({
    context,
    messages,
    runEventGroups,
    runIds,
    visiblePositions
  });
  const branchOptions = listConversationBranchOptions({
    lineage,
    metadataStore: context.metadataStore,
    sessionId,
    userId: context.userId
  });
  const pendingInteractions = context.metadataStore.interactions.listPendingBySession({
    user_id: context.userId,
    session_id: sessionId
  });

  return ok({
    sessionId,
    title: session.title ?? "",
    titleSource: session.title_source ?? "fallback",
    updatedAt: session.updated_at,
    messages: messages.map((message, index) => conversationMessageDto(message, index + 1)),
    ...(latestSummary ? { summary: conversationSummaryDto(latestSummary) } : {}),
    runEventRefs: runEventGroups.map(({ runId, events }) => runEventRefDto(runId, events)),
    ...(checkpoints.length > 0 ? { checkpoints } : {}),
    ...(lineage.branch ? { branch: sessionBranchDto(lineage.branch, session) } : {}),
    ...(branchOptions.length > 0 ? { branches: branchOptions.map(conversationBranchOptionDto) } : {}),
    toolCalls: runEventGroups.flatMap(({ runId, events }) => toolCallPairDtos(runId, events)),
    pendingInteractions: pendingInteractions.map(pendingInteractionDto),
    restorableCustomEvents: runEventGroups.flatMap(({ runId, events }) =>
      restorableCustomEventDtos(runId, events)
    )
  });
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
      const result = await context.dataGateway.testConnect({
        user_id: context.userId,
        workspace_id: context.workspaceId,
        datasource_id: id
      });
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
      const snapshot = await refreshDatasourceSchemaSnapshot(id, context);
      const completed = context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "completed",
        progress: 100,
        result: snapshot.payload.schema
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
    const snapshot = await resolveDatasourceSchemaSnapshot(id, context);
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    return ok(schemaBrowserDto(snapshot.payload, {
      includeStats: requestUrl.searchParams.get("includeStats") === "true",
      query: requestUrl.searchParams.get("q") ?? undefined
    }));
  }
  if (request.method === "GET") {
    return ok(dataSourceDto(context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: id })));
  }
  if (request.method === "PATCH") {
    return ok(await saveDatasource(await readJsonBody(request), id, context));
  }
  if (request.method === "DELETE") {
    const current = context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: id });
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

const resolveDatasourceSchemaSnapshot = async (
  datasourceId: string,
  context: Required<ConfigApiContext>
): Promise<ConfigResourceRecord> => {
  const snapshot = context.metadataStore.configResources.find({
    id: datasourceId,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind: "datasource-schema"
  });
  if (!snapshot || isDatasourceSchemaExpired(datasourceId, snapshot, context)) {
    return refreshDatasourceSchemaSnapshot(datasourceId, context);
  }
  return snapshot;
};

const refreshDatasourceSchemaSnapshot = async (
  datasourceId: string,
  context: Required<ConfigApiContext>
): Promise<ConfigResourceRecord> => {
  const schema = await context.dataGateway.inspectSchema({
    user_id: context.userId,
    workspace_id: context.workspaceId,
    datasource_id: datasourceId
  });
  return context.metadataStore.configResources.upsert({
    id: datasourceId,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    kind: "datasource-schema",
    name: datasourceId,
    payload: { schema, adapterSchemaVersion: 1, inspectedAt: new Date().toISOString() },
    status: "ready"
  });
};

const schemaBrowserDto = (
  payload: Record<string, unknown>,
  options: { includeStats: boolean; query?: string | undefined }
): Record<string, unknown> => {
  const schema = recordValue(payload.schema) ?? payload;
  const datasourceId = stringValue(schema.datasource_id);
  const query = options.query?.trim().toLowerCase();
  const rawTables = Array.isArray(schema.tables) ? schema.tables : [];
  const tables = rawTables.map((table) => schemaBrowserTableDto(table, options.includeStats))
    .filter((table) => {
      if (!query) {
        return true;
      }
      const tableName = stringValue(table.name)?.toLowerCase() ?? "";
      const columns = Array.isArray(table.columns) ? table.columns : [];
      return tableName.includes(query) || columns.some((column) =>
        isRecord(column) && typeof column.name === "string" && column.name.toLowerCase().includes(query)
      );
    });
  return {
    ...(datasourceId ? { datasourceId, datasource_id: datasourceId } : {}),
    tables,
    inspectedAt: stringValue(payload.inspectedAt),
    adapterSchemaVersion: payload.adapterSchemaVersion ?? 1
  };
};

const schemaBrowserTableDto = (value: unknown, includeStats: boolean): Record<string, unknown> => {
  const table = recordValue(value) ?? {};
  const columns = Array.isArray(table.columns) ? table.columns : [];
  return {
    name: stringValue(table.name) ?? "",
    table: stringValue(table.name) ?? "",
    description: stringValue(table.description) ?? "",
    sampleAvailable: true,
    columns: columns.map(schemaBrowserColumnDto),
    ...(includeStats ? { stats: schemaStatsDto(table) } : {})
  };
};

const schemaBrowserColumnDto = (value: unknown): Record<string, unknown> => {
  const column = recordValue(value) ?? {};
  return {
    name: stringValue(column.name) ?? "",
    type: stringValue(column.type) ?? "unknown",
    nullable: column.nullable === undefined ? undefined : Boolean(column.nullable),
    description: stringValue(column.description) ?? ""
  };
};

const schemaStatsDto = (table: Record<string, unknown>): Record<string, unknown> => ({
  rowCount: numberValue(table.row_count) ?? numberValue(table.rowCount),
  sizeBytes: numberValue(table.size_bytes) ?? numberValue(table.sizeBytes)
});

const isDatasourceSchemaExpired = (
  datasourceId: string,
  snapshot: ConfigResourceRecord,
  context: Required<ConfigApiContext>
): boolean => {
  const refreshIntervalSec = datasourceRefreshIntervalSec(datasourceId, context);
  if (refreshIntervalSec === undefined) {
    return false;
  }
  const inspectedAt = stringValue(snapshot.payload.inspectedAt);
  if (!inspectedAt) {
    return true;
  }
  const inspectedTime = Date.parse(inspectedAt);
  if (!Number.isFinite(inspectedTime)) {
    return true;
  }
  return Date.now() - inspectedTime >= refreshIntervalSec * 1000;
};

const datasourceRefreshIntervalSec = (
  datasourceId: string,
  context: Required<ConfigApiContext>
): number | undefined => {
  const datasource = context.metadataStore.dataSources.get({ user_id: context.userId, datasource_id: datasourceId });
  const config = parseRecord(datasource.config_json);
  const introspection = recordValue(config.introspection);
  const refreshIntervalSec = numberValue(introspection?.refreshIntervalSec);
  return refreshIntervalSec !== undefined && refreshIntervalSec > 0 ? Math.floor(refreshIntervalSec) : undefined;
};

const saveDatasourceInTransaction = (
  body: Record<string, unknown>,
  id: string,
  context: Required<ConfigApiContext>
): Record<string, unknown> => {
  const existing = findDatasource(context.metadataStore, context.userId, id);
  const existingConfig = existing ? parseRecord(existing.config_json) : {};
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
  const policy = recordValue(body.queryPolicy) ?? recordValue(inputConfig.queryPolicy);
  const introspection = recordValue(body.introspection) ?? recordValue(inputConfig.introspection);
  const samplePolicy = recordValue(body.samplePolicy) ?? recordValue(inputConfig.samplePolicy);
  const maskFields = arrayValue(body.maskFields) ?? arrayValue(inputConfig.maskFields);
  const expectedRevision = numberValue(body.revision);
  const type = stringValue(body.type) ?? existing?.type ?? "duckdb";
  const normalizedConfig = normalizeDatasourceConfig(type, inputConfig);
  const description = stringValue(body.description) ?? existing?.description;
  const config = {
    ...existingConfig,
    ...normalizedConfig,
    ...(policy ? { queryPolicy: { ...recordValue(existingConfig.queryPolicy), ...policy } } : {}),
    ...(introspection ? { introspection: { ...recordValue(existingConfig.introspection), ...introspection } } : {}),
    ...(samplePolicy ? { samplePolicy: { ...recordValue(existingConfig.samplePolicy), ...samplePolicy } } : {}),
    ...(maskFields ? { maskFields } : {}),
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
  if (kind === "knowledge-base" && action === "files" && segments[2] === "import" && request.method === "POST") {
    const body = await readJsonBody(request);
    const fileIds = stringArrayValue(body.fileIds ?? body.file_ids);
    if (fileIds.length === 0) {
      throw new Error("KNOWLEDGE_FILE_IDS_REQUIRED");
    }
    const results = await Promise.all(fileIds.map(async (fileId) => {
      try {
        const resolved = context.fileAssetService.getRef({
          user_id: context.userId,
          workspace_id: context.workspaceId,
          id: fileId
        });
        const file = context.fileAssetService.readRef({
          user_id: context.userId,
          workspace_id: context.workspaceId,
          id: fileId
        });
        const content = textContentFromFile(resolved.ref.filename, file.mimeType, file.body);
        const document = await context.knowledgeService.ingestText({
          user_id: context.userId,
          workspace_id: context.workspaceId,
          collection_id: id,
          filename: resolved.ref.filename,
          content,
          file_asset_ref_id: resolved.ref.id,
          mime_type: file.mimeType
        });
        return { fileId, document, status: "ready" };
      } catch (error) {
        return { fileId, error: messageOf(error), status: "failed" };
      }
    }));
    if (results.some((result) => result.status === "ready")) {
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
    }
    return ok({ results }, 207);
  }
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
      workspace_id: context.workspaceId,
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
      workspace_id: context.workspaceId,
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
      const result = await context.knowledgeService.reindex({
        user_id: context.userId,
        workspace_id: context.workspaceId,
        collection_id: id
      });
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
      packageFileRefId: current.payload.packageFileRefId,
      packageFileName: current.payload.packageFileName,
      packageFormat: current.payload.packageFormat
    });
  }
  if (kind === "skill" && action === "download" && request.method === "GET") {
    const current = context.metadataStore.configResources.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      kind
    });
    const packageFileRefId = stringValue(current.payload.packageFileRefId);
    if (!packageFileRefId) {
      throw new Error(`SKILL_PACKAGE_FILE_REF_REQUIRED:${id}`);
    }
    const resolved = context.fileAssetService.getRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id: packageFileRefId
    });
    const file = context.fileAssetService.readRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id: packageFileRefId
    });
    return {
      body: file.body,
      headers: {
        "Content-Disposition": `attachment; filename="${safeDownloadName(resolved.ref.filename, file.mimeType)}"`,
        "Content-Type": file.mimeType
      },
      status: 200
    };
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
  if (current?.builtin && kind === "skill") {
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
    return ok(artifactExportJobDto(context.metadataStore.configJobs.get({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId
    })));
  }
  if (request.method === "POST" && segments[1] === "cancel") {
    const current = context.metadataStore.configJobs.get({ id, workspace_id: context.workspaceId, user_id: context.userId });
    if (current.status !== "queued" && current.status !== "running") {
      return ok(artifactExportJobDto(current));
    }
    return ok(artifactExportJobDto(context.metadataStore.configJobs.update({
      id,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      status: "canceled"
    })));
  }
  return methodNotAllowed();
};

const handleRunRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  if (!id) {
    return fail(400, "BAD_REQUEST", "Run id is required.");
  }
  if (segments[1] !== "cancel" || request.method !== "POST") {
    return methodNotAllowed();
  }
  const body = await readJsonBody(request);
  const reason = stringValue(body.reason);
  const result = context.runCancelRegistry.cancel({
    userId: context.userId,
    runId: id,
    ...(reason ? { reason } : {})
  });
  if (result.canceled) {
    return ok({ canceled: true, runId: result.runId, sessionId: result.sessionId });
  }
  const run = context.metadataStore.runs.find({ user_id: context.userId, run_id: id });
  if (run && (run.status === "queued" || run.status === "running" || run.status === "suspended")) {
    context.metadataStore.runs.updateStatus({
      user_id: context.userId,
      run_id: id,
      status: "canceled"
    });
    return ok({ canceled: true, runId: id, persistedOnly: true });
  }
  return ok({ canceled: false, reason: result.reason, runId: id }, 404);
};

const handleQueryHistoryRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  if (!id && request.method === "GET") {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const limit = clampInteger(Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10), 1, 200, 50);
    const favorite = requestUrl.searchParams.get("favorite");
    const records = context.metadataStore.queryHistory.list({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      limit,
      ...(requestUrl.searchParams.get("sessionId") ? { session_id: requestUrl.searchParams.get("sessionId") ?? "" } : {}),
      ...(requestUrl.searchParams.get("session_id") ? { session_id: requestUrl.searchParams.get("session_id") ?? "" } : {}),
      ...(requestUrl.searchParams.get("datasourceId")
        ? { datasource_id: requestUrl.searchParams.get("datasourceId") ?? "" }
        : {}),
      ...(requestUrl.searchParams.get("datasource_id")
        ? { datasource_id: requestUrl.searchParams.get("datasource_id") ?? "" }
        : {}),
      ...(favorite === "true" ? { favorite: true } : favorite === "false" ? { favorite: false } : {})
    });
    return ok({ queries: records.map(queryHistoryDto) });
  }
  if (!id) {
    return methodNotAllowed();
  }
  if ((segments[1] === "favorite" || segments[1] === "unfavorite") && request.method === "POST") {
    const record = context.metadataStore.queryHistory.setFavorite({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id,
      favorite: segments[1] === "favorite"
    });
    return ok(queryHistoryDto(record));
  }
  if (request.method === "PATCH") {
    const body = await readJsonBody(request);
    if (typeof body.favorite !== "boolean") {
      throw new Error("QUERY_HISTORY_FAVORITE_REQUIRED");
    }
    return ok(queryHistoryDto(context.metadataStore.queryHistory.setFavorite({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id,
      favorite: body.favorite
    })));
  }
  return methodNotAllowed();
};

const handleFileRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  if (!id && request.method === "GET") {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    // Filtering (R-021). Three orthogonal dimensions, all backward compatible:
    //  - `source`/`sources`: comma-separated internal source enum
    //    (artifact|knowledge|run-attachment|upload|workspace).
    //  - `origin`: comma-separated display label (uploaded|generated|saved), mapped
    //    1:1 to the internal source enum. Lets the frontend ask for "files the user
    //    can reuse across sessions" without knowing the internal enum.
    //  - `scope`: `session` | `workspace`. `session` ⇒ refs with a session_id;
    //    `workspace` ⇒ refs with session_id IS NULL (cross-session assets).
    //  - `sessionId`: restrict to one session's refs (implies scope=session).
    const sourceParam = requestUrl.searchParams.get("source") ?? requestUrl.searchParams.get("sources");
    const originParam = requestUrl.searchParams.get("origin") ?? requestUrl.searchParams.get("origins");
    const scopeParam = requestUrl.searchParams.get("scope");
    const sessionIdParam = requestUrl.searchParams.get("sessionId") ?? requestUrl.searchParams.get("session_id");
    const sourcesFromOrigin = originParam
      ? originParam.split(",").map((s) => s.trim()).filter(Boolean).map(originToSource).filter(Boolean)
      : [];
    const sources = sourceParam
      ? sourceParam.split(",").map((s) => s.trim()).filter(Boolean)
      : (sourcesFromOrigin.length ? sourcesFromOrigin : undefined);
    // Resolve the session filter: an explicit sessionId wins; otherwise scope=session
    // without a sessionId returns all refs that have any session_id; scope=workspace
    // maps to session_id=null (cross-session assets only).
    let sessionIdFilter: string | null | undefined;
    let hasSessionFilter: boolean | undefined;
    if (sessionIdParam) {
      sessionIdFilter = sessionIdParam;
    } else if (scopeParam === "workspace") {
      sessionIdFilter = null;
    } else if (scopeParam === "session") {
      hasSessionFilter = true;
    }
    const listOne = (source?: string) => context.fileAssetService.listRefs({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      ...(source ? { source: source as FileAssetRefSource } : {}),
      ...(sessionIdFilter !== undefined ? { session_id: sessionIdFilter } : {}),
      ...(hasSessionFilter ? { has_session: true } : {})
    });
    const all = sources
      ? sources.map((source) => listOne(source)).flat()
      : listOne();
    return ok({ files: all.map(fileAssetRefDto) });
  }
  if (!id && request.method === "POST") {
    if (!isMultipart(request)) {
      throw new Error("FILE_MULTIPART_REQUIRED");
    }
    const upload = await readMultipartFiles(request, {
      maxFiles: numberFromEnv("FILE_UPLOAD_MAX_FILES", 20),
      maxFileBytes: numberFromEnv("FILE_UPLOAD_MAX_BYTES", 25 * 1024 * 1024),
      maxTotalBytes: numberFromEnv("FILE_UPLOAD_MAX_TOTAL_BYTES", 100 * 1024 * 1024)
    });
    // New files default to the session scope: the upload lands in the per-session
    // directory so only this session sees it until promoted. A sessionId is required
    // (header or multipart field), mirroring the chat-upload contract.
    const sessionId = stringValue(upload.fields.sessionId)
      ?? stringValue(upload.fields.session_id)
      ?? stringValue(upload.fields.threadId)
      ?? stringValue(upload.fields.thread_id)
      ?? stringHeader(request.headers["x-session-id"])
      ?? stringHeader(request.headers["x-thread-id"]);
    if (!sessionId) {
      throw new Error("FILE_UPLOAD_SESSION_REQUIRED");
    }
    const workspaceRoot = process.env.WORKSPACE_ROOT
      ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces");
    const sessionDir = resolveSessionWorkspaceDir({
      runContext: {
        user_id: context.userId,
        workspace_id: context.workspaceId,
        session_id: sessionId,
        run_id: "file-upload",
        selected_datasource_id: "",
        enabled_datasource_ids: [],
        user_input: "",
        chat_mode: "config",
        model_name: "file-upload"
      },
      workspaceRoot
    });
    const files = upload.files.map((file) => {
      const resolved = context.fileAssetService.createRef({
        user_id: context.userId,
        workspace_id: context.workspaceId,
        session_id: sessionId,
        run_id: "file-upload",
        filename: file.filename,
        content: file.content,
        declared_mime_type: file.mimeType || mimeTypeForFilename(file.filename),
        source: "upload",
        metadata: { fields: upload.fields }
      });
      // Materialize into the per-session directory (session-scoped). The asset store is
      // the source of truth; this hardlink/copy makes the file visible to the agent's
      // list_files. Best-effort: a failure to materialize must not fail the upload.
      try {
        const targetPath = resolve(sessionDir, safeFilename(resolved.ref.filename));
        if (targetPath.startsWith(`${sessionDir}${sep}`)) {
          context.fileAssetService.materializeRefToPath({
            ref: resolved.ref,
            targetPath,
            linkStrategy: "hardlink"
          });
        }
      } catch {
        // session materialization is best-effort; the ref is already persisted
      }
      return fileAssetRefDto(resolved);
    });
    return ok({ files }, 201);
  }
  if (!id) {
    return methodNotAllowed();
  }
  // POST /api/v1/files/:id/promote — promote a session-scoped file ref into the
  // cross-session workspace root (R-026 / file promote). Accepts the file_id (ref id),
  // reuses promoteFileToWorkspace (idempotent, no byte copy), and materializes the file
  // into the workspace root so other sessions can read it.
  if (segments[1] === "promote" && request.method === "POST") {
    const source = context.fileAssetService.getRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id
    });
    const workspaceRoot = process.env.WORKSPACE_ROOT
      ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces");
    const workspaceDir = resolveWorkspaceDir({
      runContext: {
        user_id: context.userId,
        workspace_id: context.workspaceId,
        session_id: "promote",
        run_id: "promote",
        selected_datasource_id: "",
        enabled_datasource_ids: [],
        user_input: "",
        chat_mode: "config",
        model_name: "promote"
      },
      workspaceRoot
    });
    // Materialize the file into the workspace root (best-effort hardlink/copy).
    try {
      const targetPath = resolve(workspaceDir, safeFilename(source.ref.filename));
      if (targetPath.startsWith(`${workspaceDir}${sep}`)) {
        context.fileAssetService.materializeRefToPath({
          ref: source.ref,
          targetPath,
          linkStrategy: "hardlink"
        });
      }
    } catch {
      // best-effort; the ref promotion below is the source of truth
    }
    const resolved = context.fileAssetService.promoteFileToWorkspace({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      file_asset_ref_id: id,
      filename: source.ref.filename,
      ...(source.ref.declared_mime_type ? { declared_mime_type: source.ref.declared_mime_type } : {})
    });
    return ok({
      ...fileAssetRefDto(resolved),
      downloadUrl: `/api/v1/files/${resolved.ref.id}/download`
    });
  }
  if (request.method === "GET" && segments[1] === "download") {
    const resolved = context.fileAssetService.getRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id
    });
    const file = context.fileAssetService.readRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id
    });
    return {
      body: file.body,
      headers: {
        "Content-Disposition": `attachment; filename="${safeDownloadName(resolved.ref.filename, file.mimeType)}"`,
        "Content-Type": file.mimeType
      },
      status: 200
    };
  }
  if (request.method === "GET") {
    return ok(fileAssetRefDto(context.fileAssetService.getRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id
    })));
  }
  if (request.method === "DELETE") {
    const deleted = context.fileAssetService.deleteRef({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      id
    });
    return ok({ deleted: true, id: deleted.id });
  }
  return methodNotAllowed();
};

/**
 * DTO for the session artifact list (R-023). Mirrors the shape the frontend
 * `SessionArtifactsRestore` expects: stable `fileId` (nullable for pure-preview
 * table/chart), `downloadUrl` only when there is a backing file, parsed `preview_json`.
 */
const sessionArtifactDto = (artifact: ArtifactRecord): Record<string, unknown> => ({
  id: artifact.id,
  type: artifact.type,
  name: artifact.name,
  ...(artifact.file_asset_ref_id ? { fileId: artifact.file_asset_ref_id } : { fileId: null }),
  ...(artifact.file_asset_ref_id
    ? { downloadUrl: `/api/v1/artifacts/${artifact.id}/download` }
    : {}),
  ...(artifact.mime_type ? { mimeType: artifact.mime_type } : {}),
  preview_json: artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null,
  createdAt: artifact.created_at
});

const handleArtifactRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const id = segments[0];
  // R-023: list artifacts for a session (session-restore). No id, GET, ?sessionId=.
  if (!id) {
    if (request.method !== "GET") {
      return methodNotAllowed();
    }
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const sessionId = requestUrl.searchParams.get("sessionId") ?? requestUrl.searchParams.get("session_id");
    if (!sessionId) {
      throw new Error("ARTIFACT_LIST_SESSION_ID_REQUIRED");
    }
    const records = context.metadataStore.artifacts.listBySession({
      user_id: context.userId,
      session_id: sessionId
    });
    return ok({ artifacts: records.map(sessionArtifactDto) });
  }
  // R-022: promote a file-type artifact into a cross-session workspace asset.
  if (segments[1] === "promote") {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    const artifact = context.metadataStore.artifacts.get({ user_id: context.userId, artifact_id: id });
    if (!artifact.file_asset_ref_id) {
      // Only file-backed artifacts (table/chart preview-only types) can be promoted.
      throw new Error("ARTIFACT_PROMOTE_NO_FILE");
    }
    const resolved = context.fileAssetService.promoteFileToWorkspace({
      user_id: context.userId,
      workspace_id: context.workspaceId,
      file_asset_ref_id: artifact.file_asset_ref_id,
      filename: artifact.name,
      ...(artifact.mime_type ? { declared_mime_type: artifact.mime_type } : {})
    });
    return ok({
      ...fileAssetRefDto(resolved),
      downloadUrl: `/api/v1/files/${resolved.ref.id}/download`
    });
  }
  if (segments[1] === "export") {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    const artifact = context.metadataStore.artifacts.get({ user_id: context.userId, artifact_id: id });
    const body = await readJsonBody(request);
    const format = (stringValue(body.format) ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") {
      throw new Error(`ARTIFACT_EXPORT_FORMAT_UNSUPPORTED:${format}`);
    }
    const idempotencyKey = stringValue(body.idempotencyKey);
    const job = context.metadataStore.configJobs.create({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      type: "artifact-export",
      resource_id: artifact.id,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
    });
    queueArtifactExportJob({
      artifact,
      context,
      format,
      job
    });
    return ok(artifactExportJobDto(job), 202);
  }
  if (request.method !== "GET") {
    return methodNotAllowed();
  }
  const artifact = context.metadataStore.artifacts.get({ user_id: context.userId, artifact_id: id });
  if (segments[1] === "preview") {
    return ok(artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null);
  }
  if (segments[1] === "content" || segments[1] === "download") {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const format = requestUrl.searchParams.get("format")?.toLowerCase();
    if (format && format !== "csv" && format !== "xlsx") {
      throw new Error(`ARTIFACT_EXPORT_FORMAT_UNSUPPORTED:${format}`);
    }
    const file = artifact.file_asset_ref_id
      ? context.fileAssetService.readRef({
          user_id: context.userId,
          workspace_id: context.workspaceId,
          id: artifact.file_asset_ref_id
        })
      : artifactFileContent(artifact.storage_path);
    const preview = artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null;
    const content = format === "xlsx"
      ? await serializeArtifactXlsx(artifact.name, file, preview)
      : format === "csv"
        ? serializeArtifactCsv(artifact.name, file, preview)
        : file ?? serializeArtifactPreview(preview, segments[1] === "download");
    const filename = format === "xlsx"
      ? safeDownloadNameWithExtension(artifact.name, "xlsx")
      : format === "csv"
        ? safeDownloadNameWithExtension(artifact.name, "csv")
        : safeDownloadName(artifact.name, content.mimeType, artifact.type, artifact.mime_type);
    const responseMimeType = resolveArtifactContentType(artifact, content.mimeType);
    return {
      body: content.body,
      headers: {
        "Content-Disposition": `${segments[1] === "download" ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Type": responseMimeType
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

const conversationMessageDto = (
  message: ConversationMessageRecord,
  visiblePosition = message.position
): Record<string, unknown> => ({
  id: message.id,
  runId: message.run_id,
  role: message.role,
  source: message.source,
  ...(message.message_id ? { messageId: message.message_id } : {}),
  contentText: message.content_text,
  ...conversationMessageEvidenceRefsDto(message),
  position: visiblePosition,
  createdAt: message.created_at
});

const conversationMessageEvidenceRefsDto = (message: ConversationMessageRecord): Record<string, unknown> => {
  const content = parseRecord(message.content_json);
  const refs = evidenceRefsFromUnknown(content.evidenceRefs ?? content.evidence_refs);
  return refs.length > 0 ? { evidenceRefs: refs } : {};
};

const sessionListDto = (session: SessionRecord): Record<string, unknown> => ({
  id: session.id,
  threadId: session.id,
  title: session.title ?? "",
  titleSource: session.title_source ?? "fallback",
  createdAt: session.created_at,
  updatedAt: session.updated_at,
  lastMessageAt: session.last_message_at ?? session.updated_at
});

const sessionBranchCreatedDto = (input: { branch: SessionBranchRecord; session: SessionRecord }): Record<string, unknown> => ({
  ...sessionBranchDto(input.branch, input.session),
  session: sessionListDto(input.session)
});

const sessionBranchDto = (
  branch: SessionBranchRecord,
  session?: SessionRecord
): Record<string, unknown> => ({
  id: branch.id,
  sessionId: branch.child_session_id,
  threadId: branch.child_session_id,
  parentSessionId: branch.parent_session_id,
  rootSessionId: branch.root_session_id,
  forkRunId: branch.fork_run_id,
  forkMessageEndPosition: branch.fork_message_end_position,
  createdAt: branch.created_at,
  ...(session?.title ? { title: session.title } : {})
});

const conversationBranchOptionDto = (branch: ConversationBranchOption): Record<string, unknown> => ({
  sessionId: branch.sessionId,
  threadId: branch.sessionId,
  parentSessionId: branch.parentSessionId,
  rootSessionId: branch.rootSessionId,
  forkRunId: branch.forkRunId,
  forkMessageEndPosition: branch.forkMessageEndPosition,
  isOriginal: branch.isOriginal,
  createdAt: branch.createdAt,
  ...(branch.title ? { title: branch.title } : {})
});

const queryHistoryDto = (record: QueryHistoryRecord): Record<string, unknown> => ({
  id: record.id,
  sessionId: record.session_id,
  runId: record.run_id,
  datasourceId: record.datasource_id,
  sql: record.sql_text,
  rowCount: record.row_count,
  elapsedMs: record.elapsed_ms,
  favorite: record.favorite,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

const artifactExportJobDto = (job: JobRecord): Record<string, unknown> => ({
  id: job.id,
  type: job.type,
  artifactId: job.resource_id,
  status: job.status,
  progress: job.progress,
  ...(job.result !== undefined ? { result: job.result } : {}),
  ...(job.error !== undefined ? { error: job.error } : {}),
  createdAt: job.created_at,
  ...(job.started_at ? { startedAt: job.started_at } : {}),
  ...(job.finished_at ? { finishedAt: job.finished_at } : {})
});

const encodeSessionCursor = (session: SessionRecord): string => Buffer.from(JSON.stringify({
  id: session.id,
  sort_at: session.last_message_at ?? session.updated_at
}), "utf8").toString("base64url");

const conversationSummaryDto = (summary: ConversationSummaryRecord): Record<string, unknown> => ({
  id: summary.id,
  ...(summary.source_run_id ? { sourceRunId: summary.source_run_id } : {}),
  fromPosition: summary.from_position,
  toPosition: summary.to_position,
  summaryText: summary.summary_text,
  createdAt: summary.created_at
});

const runEventRefDto = (runId: string, events: RunEventRecord[]): Record<string, unknown> => ({
  runId,
  eventCount: events.length,
  ...(events[0] ? { firstSeq: events[0].seq } : {}),
  ...(events.at(-1) ? { lastSeq: events.at(-1)?.seq } : {})
});

const runCheckpointDtos = (input: {
  context: Required<ConfigApiContext>;
  messages: ConversationMessageRecord[];
  runEventGroups: Array<{ events: RunEventRecord[]; runId: string }>;
  runIds: string[];
  visiblePositions?: Map<string, number>;
}): Record<string, unknown>[] => {
  const eventsByRun = new Map(input.runEventGroups.map((group) => [group.runId, group.events]));
  return input.runIds.flatMap((runId) => {
    const run = input.context.metadataStore.runs.find({
      user_id: input.context.userId,
      run_id: runId
    });
    if (!run) {
      return [];
    }
    return [
      runCheckpointDto({
        events: eventsByRun.get(runId) ?? [],
        messages: input.messages.filter((message) => message.run_id === runId),
        run,
        ...(input.visiblePositions ? { visiblePositions: input.visiblePositions } : {})
      })
    ];
  });
};

const runCheckpointDto = (input: {
  events: RunEventRecord[];
  messages: ConversationMessageRecord[];
  run: RunRecord;
  visiblePositions?: Map<string, number>;
}): Record<string, unknown> => {
  const positions = input.messages.map((message) => input.visiblePositions?.get(message.id) ?? message.position);
  const firstEvent = input.events[0];
  const lastEvent = input.events.at(-1);
  return {
    runId: input.run.id,
    status: input.run.status,
    ...(positions.length > 0
      ? {
          messageStartPosition: Math.min(...positions),
          messageEndPosition: Math.max(...positions)
        }
      : {}),
    ...(firstEvent ? { firstEventSeq: firstEvent.seq } : {}),
    ...(lastEvent ? { lastEventSeq: lastEvent.seq } : {}),
    startedAt: input.run.started_at,
    ...(input.run.finished_at ? { finishedAt: input.run.finished_at } : {}),
    ...(input.run.error_message ? { errorMessage: input.run.error_message } : {})
  };
};

const RESTORABLE_CUSTOM_EVENT_NAMES = new Set([
  "token_usage",
  "token_usage.correlation",
  "workspace.metadata",
  "sandbox.output",
  "goal.updated",
  "sql_audit"
]);

const pendingInteractionDto = (interaction: InteractionRecord): Record<string, unknown> => {
  const payload = parseJsonValue(interaction.payload_json);
  const interruptEvent = interaction.interrupt_event_json
    ? parseJsonValue(interaction.interrupt_event_json)
    : undefined;
  const resumeSchema =
    interruptEvent && typeof interruptEvent === "object" && interruptEvent !== null
      ? (interruptEvent as Record<string, unknown>).resumeSchema
      : undefined;
  return {
    interactionId: interaction.id,
    runId: interaction.run_id,
    toolCallId: interaction.tool_call_id,
    toolName: interaction.tool_name,
    ...(interruptEvent !== undefined ? { interruptEvent } : {}),
    ...(payload !== undefined ? { payload } : {}),
    ...(resumeSchema !== undefined ? { resumeSchema } : {})
  };
};

const restorableCustomEventDtos = (
  runId: string,
  events: RunEventRecord[]
): Array<Record<string, unknown>> =>
  events.flatMap((eventRecord) => {
    const event = parseRecord(eventRecord.payload_json);
    if (stringValue(event.type) !== "CUSTOM") {
      return [];
    }
    const name = stringValue(event.name);
    if (!name || !RESTORABLE_CUSTOM_EVENT_NAMES.has(name)) {
      return [];
    }
    const value = event.value ?? event.payload ?? event.content;
    if (value === undefined) {
      return [];
    }
    return [{
      runId,
      seq: eventRecord.seq,
      name,
      value
    }];
  });

const parseJsonValue = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const toolCallPairDtos = (runId: string, events: RunEventRecord[]): Array<Record<string, unknown>> => {
  const calls = new Map<string, {
    args?: unknown;
    callEventSeq?: number;
    endEventSeq?: number;
    parentMessageId?: string;
    result?: unknown;
    resultEventSeq?: number;
    resultMessageId?: string;
    resultPreview?: string;
    status: "completed" | "failed" | "pending";
    toolCallId: string;
    toolName?: string;
  }>();

  events.forEach((eventRecord) => {
    const event = parseRecord(eventRecord.payload_json);
    const type = stringValue(event.type);
    const toolCallId = stringValue(event.toolCallId);
    if (!type || !toolCallId) {
      return;
    }
    const existing = calls.get(toolCallId) ?? { status: "pending" as const, toolCallId };
    const toolName = stringValue(event.toolCallName) ?? existing.toolName;

    if (type === "TOOL_CALL_START" || type === "TOOL_CALL_END") {
      // AG-UI tool-call events are passthrough; capture args if the middleware populated
      // `args` / `input` / `argsText` (R-027 conversation-restore wants stable args).
      const args = existing.args ?? toolCallArgs(event);
      const parentMessageId =
        type === "TOOL_CALL_START"
          ? stringValue(event.parentMessageId) ?? existing.parentMessageId
          : existing.parentMessageId;
      calls.set(toolCallId, {
        ...existing,
        ...(toolName ? { toolName } : {}),
        ...(args !== undefined ? { args } : {}),
        ...(type === "TOOL_CALL_START" ? { callEventSeq: eventRecord.seq } : {}),
        ...(type === "TOOL_CALL_END" ? { endEventSeq: eventRecord.seq } : {}),
        ...(parentMessageId ? { parentMessageId } : {})
      });
      return;
    }

    if (type === "TOOL_CALL_RESULT") {
      const resultMessageId = stringValue(event.messageId);
      const resultPreview = previewToolResult(event.content);
      calls.set(toolCallId, {
        ...existing,
        ...(toolName ? { toolName } : {}),
        resultEventSeq: eventRecord.seq,
        ...(resultMessageId ? { resultMessageId } : {}),
        ...(resultPreview ? { resultPreview } : {}),
        // R-027: full result (may be large; frontend truncates as needed).
        result: event.content,
        status: isToolResultError(event.content) ? "failed" : "completed"
      });
    }
  });

  return [...calls.values()].map((call) => ({
    runId,
    // R-027: stable id/name/args/result fields plus the legacy toolCallId/toolName aliases.
    id: call.toolCallId,
    toolCallId: call.toolCallId,
    status: call.status,
    ...(call.toolName ? { name: call.toolName, toolName: call.toolName } : {}),
    ...(call.args !== undefined ? { args: call.args } : {}),
    ...(call.result !== undefined ? { result: call.result } : {}),
    ...(call.callEventSeq !== undefined ? { callEventSeq: call.callEventSeq } : {}),
    ...(call.endEventSeq !== undefined ? { endEventSeq: call.endEventSeq } : {}),
    ...(call.resultEventSeq !== undefined ? { resultEventSeq: call.resultEventSeq } : {}),
    ...(call.parentMessageId ? { parentMessageId: call.parentMessageId } : {}),
    ...(call.resultMessageId ? { resultMessageId: call.resultMessageId } : {}),
    ...(call.resultPreview ? { resultPreview: call.resultPreview } : {})
  }));
};

/**
 * Extract tool-call args from a passthrough AG-UI tool-call event (R-027). The schema is
 * passthrough, so args may appear as a structured `args`/`input` object or as `argsText`.
 * Returns undefined when none is present.
 */
const toolCallArgs = (event: Record<string, unknown>): unknown => {
  if (event.args !== undefined) {
    return event.args;
  }
  if (event.input !== undefined) {
    return event.input;
  }
  if (typeof event.argsText === "string" && event.argsText.length > 0) {
    return event.argsText;
  }
  return undefined;
};

const previewToolResult = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 1000
    ? `${text.slice(0, 1000)}\n[tool result preview truncated: original_chars=${text.length}]`
    : text;
};

const isToolResultError = (value: unknown): boolean => {
  const parsed = typeof value === "string" ? tryParseRecord(value) : recordValue(value);
  return Boolean(parsed && (parsed.isError === true || typeof parsed.error === "string"));
};

const queueArtifactExportJob = (input: {
  artifact: ArtifactRecord;
  context: Required<ConfigApiContext>;
  format: "csv" | "xlsx";
  job: JobRecord;
}): void => {
  void Promise.resolve().then(async () => {
    const { artifact, context, format, job } = input;
    try {
      if (isJobCanceled(context, job.id)) {
        return;
      }
      context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "running",
        progress: 10
      });
      const file = artifact.file_asset_ref_id
        ? context.fileAssetService.readRef({
            user_id: context.userId,
            workspace_id: context.workspaceId,
            id: artifact.file_asset_ref_id
          })
        : artifactFileContent(artifact.storage_path);
      const preview = artifact.preview_json ? JSON.parse(artifact.preview_json) as unknown : null;
      const content = format === "xlsx"
        ? await serializeArtifactXlsx(artifact.name, file, preview)
        : serializeArtifactCsv(artifact.name, file, preview);
      const filename = format === "xlsx"
        ? safeDownloadNameWithExtension(artifact.name, "xlsx")
        : safeDownloadNameWithExtension(artifact.name, "csv");
      if (isJobCanceled(context, job.id)) {
        return;
      }
      context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "running",
        progress: 80
      });
      const resolved = context.fileAssetService.createRef({
        user_id: context.userId,
        workspace_id: context.workspaceId,
        filename,
        content: content.body,
        declared_mime_type: content.mimeType,
        source: "artifact",
        ...(artifact.session_id ? { session_id: artifact.session_id } : {}),
        ...(artifact.run_id ? { run_id: artifact.run_id } : {}),
        metadata: {
          artifact_id: artifact.id,
          export_format: format,
          job_id: job.id
        }
      });
      if (isJobCanceled(context, job.id)) {
        return;
      }
      context.metadataStore.configJobs.update({
        id: job.id,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        status: "completed",
        progress: 100,
        result: {
          artifactId: artifact.id,
          downloadUrl: `/api/v1/files/${resolved.ref.id}/download`,
          fileId: resolved.ref.id,
          filename: resolved.ref.filename,
          format,
          mimeType: content.mimeType,
          sizeBytes: resolved.asset.size_bytes
        }
      });
    } catch (error) {
      if (isJobCanceled(input.context, input.job.id)) {
        return;
      }
      input.context.metadataStore.configJobs.update({
        id: input.job.id,
        workspace_id: input.context.workspaceId,
        user_id: input.context.userId,
        status: "failed",
        progress: 100,
        error: {
          message: error instanceof Error ? error.message : "ARTIFACT_EXPORT_FAILED"
        }
      });
    }
  });
};

const isJobCanceled = (context: Required<ConfigApiContext>, jobId: string): boolean =>
  context.metadataStore.configJobs.get({
    id: jobId,
    workspace_id: context.workspaceId,
    user_id: context.userId
  }).status === "canceled";

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

const serializeArtifactCsv = (
  artifactName: string,
  file: { body: Buffer; mimeType: string } | undefined,
  preview: unknown
): { body: Buffer; mimeType: string } => {
  if (file && (file.mimeType.startsWith("text/csv") || artifactName.toLowerCase().endsWith(".csv"))) {
    return { body: file.body, mimeType: "text/csv; charset=utf-8" };
  }
  const csv = previewCsv(preview);
  if (csv !== undefined) {
    return { body: Buffer.from(csv, "utf8"), mimeType: "text/csv; charset=utf-8" };
  }
  const sheetData = file ? sheetDataFromFileContent(artifactName, file) : sheetDataFromPreview(preview);
  const rows = sheetData.map((row) => row.map((cell) => {
    if (cell === null || cell === undefined) {
      return "";
    }
    if (typeof cell === "object" && "value" in cell) {
      return csvCellValue(cell.value);
    }
    return csvCellValue(cell);
  }));
  const body = `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
  return { body: Buffer.from(body, "utf8"), mimeType: "text/csv; charset=utf-8" };
};

const serializeArtifactXlsx = async (
  artifactName: string,
  file: { body: Buffer; mimeType: string } | undefined,
  preview: unknown
): Promise<{ body: Buffer; mimeType: string }> => {
  if (file && isXlsxContent(artifactName, file.mimeType)) {
    return { body: file.body, mimeType: XLSX_MIME_TYPE };
  }
  const sheetData = file
    ? sheetDataFromFileContent(artifactName, file)
    : sheetDataFromPreview(preview);
  const body = await writeXlsxFile(sheetData, {
    sheet: safeSheetName(artifactName),
    columns: inferSheetColumns(sheetData)
  }).toBuffer();
  return { body, mimeType: XLSX_MIME_TYPE };
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

const csvCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const escapeCsvCell = (value: string): string =>
  /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

const sheetDataFromFileContent = (artifactName: string, file: { body: Buffer; mimeType: string }): SheetData => {
  const lowerName = artifactName.toLowerCase();
  const mimeType = file.mimeType.toLowerCase();
  if (mimeType.startsWith("text/csv") || lowerName.endsWith(".csv")) {
    return csvToSheetData(file.body.toString("utf8"));
  }
  if (mimeType.includes("json") || lowerName.endsWith(".json")) {
    return sheetDataFromJsonText(file.body.toString("utf8"));
  }
  if (mimeType.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return file.body.toString("utf8").split(/\r?\n/u).map((line) => [line]);
  }
  return [["content"], [`Binary artifact cannot be converted to tabular XLSX: ${artifactName}`]];
};

const sheetDataFromPreview = (preview: unknown): SheetData => {
  if (isRecord(preview) && Array.isArray(preview.columns) && Array.isArray(preview.rows)) {
    const columns = preview.columns.map((column) => String(column));
    const rows = preview.rows.map((row) => {
      if (Array.isArray(row)) {
        return row.map(spreadsheetCellValue);
      }
      if (isRecord(row)) {
        return columns.map((column) => spreadsheetCellValue(row[column]));
      }
      return [spreadsheetCellValue(row)];
    });
    return [columns, ...rows];
  }
  return unknownToSheetData(preview);
};

const sheetDataFromJsonText = (text: string): SheetData => {
  try {
    return unknownToSheetData(JSON.parse(text) as unknown);
  } catch {
    return [["content"], [text]];
  }
};

const unknownToSheetData = (value: unknown): SheetData => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [["value"]];
    }
    if (value.every(isRecord)) {
      const columns = [...new Set(value.flatMap((entry) => Object.keys(entry)))];
      return [columns, ...value.map((entry) => columns.map((column) => spreadsheetCellValue(entry[column])))];
    }
    return [["value"], ...value.map((entry) => [spreadsheetCellValue(entry)])];
  }
  if (isRecord(value)) {
    return [["key", "value"], ...Object.entries(value).map(([key, entry]) => [key, spreadsheetCellValue(entry)])];
  }
  return [["value"], [spreadsheetCellValue(value)]];
};

const csvToSheetData = (text: string): SheetData => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length > 0 ? rows.map((cells) => cells.map(spreadsheetCellValue)) : [["value"]];
};

const spreadsheetCellValue = (value: unknown): string | number | boolean | Date | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(trimmed) && !/^0\d/u.test(trimmed)) {
    const numberValue = Number(trimmed);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return value;
};

const inferSheetColumns = (sheetData: SheetData): Array<{ width: number }> => {
  const columnCount = sheetData.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxLength = sheetData.reduce((max, row) => {
      const cell = row[columnIndex];
      const text = cell === null || cell === undefined
        ? ""
        : typeof cell === "object" && "value" in cell
          ? String(cell.value ?? "")
          : String(cell);
      return Math.max(max, text.length);
    }, 8);
    return { width: Math.min(Math.max(maxLength + 2, 10), 40) };
  });
};

const isXlsxContent = (artifactName: string, mimeType: string): boolean =>
  mimeType === XLSX_MIME_TYPE || artifactName.toLowerCase().endsWith(".xlsx");

const safeSheetName = (name: string): string => {
  const sheet = basename(name).replace(/[:\\/?*[\]]/gu, " ").trim();
  return (sheet || "Artifact").slice(0, 31);
};

const resolveArtifactContentType = (
  artifact: { type: string; mime_type?: string | undefined },
  contentMimeType: string,
): string => {
  if (artifact.mime_type && artifact.mime_type !== "application/octet-stream") {
    return artifact.mime_type;
  }
  if (contentMimeType && contentMimeType !== "application/octet-stream") {
    return contentMimeType;
  }
  switch (artifact.type) {
    case "table":
      return "text/csv; charset=utf-8";
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "html":
      return "text/html; charset=utf-8";
    default:
      return contentMimeType || "application/octet-stream";
  }
};

const safeDownloadName = (
  name: string,
  mimeType: string,
  artifactType?: string,
  declaredMimeType?: string | null,
): string => {
  const safe = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-") || "artifact";
  if (safe.includes(".")) {
    return safe;
  }
  const effectiveMime = declaredMimeType && declaredMimeType !== "application/octet-stream"
    ? declaredMimeType
    : mimeType;
  if (effectiveMime === XLSX_MIME_TYPE || effectiveMime.includes("spreadsheetml")) {
    return `${safe}.xlsx`;
  }
  if (effectiveMime.startsWith("text/csv") || artifactType === "table") {
    return `${safe}.csv`;
  }
  if (effectiveMime.startsWith("text/markdown") || artifactType === "markdown") {
    return `${safe}.md`;
  }
  if (effectiveMime.startsWith("text/html") || artifactType === "html") {
    return `${safe}.html`;
  }
  if (effectiveMime.startsWith("text/")) {
    return `${safe}.txt`;
  }
  return `${safe}.json`;
};

const safeDownloadNameWithExtension = (name: string, extension: string): string => {
  const safe = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-") || "artifact";
  const extensionWithDot = extension.startsWith(".") ? extension : `.${extension}`;
  const dot = safe.lastIndexOf(".");
  return `${dot > 0 ? safe.slice(0, dot) : safe}${extensionWithDot}`;
};

const textContentFromFile = (filename: string, mimeType: string, body: Buffer): string => {
  const lower = filename.toLowerCase();
  const textual = mimeType.startsWith("text/")
    || mimeType.includes("json")
    || lower.endsWith(".csv")
    || lower.endsWith(".json")
    || lower.endsWith(".md")
    || lower.endsWith(".txt");
  if (!textual) {
    throw new Error(`KNOWLEDGE_FILE_TYPE_UNSUPPORTED:${filename}`);
  }
  return body.toString("utf8");
};

const numberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

const devIdentityUserDto = (user: UserRecord): Record<string, unknown> => ({
  id: user.id,
  ...(user.email ? { email: user.email } : {}),
  ...(user.display_name ? { displayName: user.display_name } : {}),
  ...(user.dev_token ? { devToken: user.dev_token } : {})
});

const defaultWorkspaceDto = (workspaceId: string): Record<string, unknown> => ({
  id: workspaceId,
  name: workspaceId === DEFAULT_WORKSPACE_ID ? "Default workspace" : workspaceId
});

const sanitizeDevUserId = (value: string): string => {
  const id = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/u.test(id)) {
    throw new Error("INVALID_DEV_USER_ID");
  }
  return id;
};

const sanitizeDisplayName = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("DEV_USER_DISPLAY_NAME_REQUIRED");
  }
  return normalized.slice(0, 80);
};

const sanitizeOptionalEmail = (value: string | undefined, id: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    return `${id}@local.dev`;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    throw new Error("INVALID_DEV_USER_EMAIL");
  }
  return normalized.slice(0, 254);
};

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
  context: Required<ConfigApiContext>
): Promise<Record<string, unknown>> => {
  if (!isMultipart(request)) {
    throw new Error("SKILL_MULTIPART_REQUIRED");
  }
  const upload = await readMultipartUpload(request);
  const parsed = await parseSkillPackage(upload.file);
  const knownTools = new Set<string>(STATIC_AGENT_TOOL_NAMES);
  const unknownTools = parsed.allowedTools.filter((tool) => !knownTools.has(tool) && !tool.startsWith("mcp__"));
  if (unknownTools.length > 0) {
    throw new Error(`SKILL_ALLOWED_TOOL_UNKNOWN:${unknownTools.join(",")}`);
  }
  const packageRef = context.fileAssetService.createRef({
    user_id: context.userId,
    workspace_id: context.workspaceId,
    filename: parsed.packageFileName,
    content: upload.file.content,
    declared_mime_type: upload.file.mimeType || mimeTypeForFilename(parsed.packageFileName),
    source: "upload",
    metadata: { kind: "skill-package", skill: parsed.name, version: parsed.version }
  });
  await materializeSkillPackages({
    fileAssetService: context.fileAssetService,
    runDir: resolveConfigSkillCacheDir(context),
    skills: [{
      allowedTools: parsed.allowedTools,
      builtin: false,
      defaultDbIds: [],
      defaultEnabled: true,
      defaultKbIds: [],
      defaultMcpIds: [],
      deniedTools: parsed.deniedTools,
      description: parsed.description,
      id: slugify(parsed.name),
      name: parsed.name,
      packageEntry: parsed.manifest.entry,
      packageFileRefId: packageRef.ref.id,
      packageFiles: parsed.manifest.files,
      packageFormat: parsed.packageFormat,
      revision: 1,
      scope: "workspace",
      status: "valid",
      tags: parsed.tags,
      userInvocable: parsed.userInvocable,
      version: parsed.version
    }],
    userId: context.userId,
    workspaceId: context.workspaceId
  });
  return {
    ...upload.fields,
    ...buildSkillResourcePayload({
      fields: upload.fields,
      packageFileRefId: packageRef.ref.id,
      parsed
    }),
    description: parsed.description,
    name: parsed.name,
    status: "valid"
  };
};

const resolveConfigSkillCacheDir = (context: Required<ConfigApiContext>): string => {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces");
  return resolveSkillCacheDir({
    runContext: {
      user_id: context.userId,
      workspace_id: context.workspaceId,
      session_id: "skill-cache",
      run_id: "skill-cache",
      selected_datasource_id: "",
      enabled_datasource_ids: [],
      user_input: "",
      chat_mode: "config",
      model_name: "skill-cache"
    },
    workspaceRoot
  });
};

const handleSkillSelectionPreview = async (
  request: IncomingMessage,
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const body = await readJsonBody(request);
  const userInput = stringValue(body.user_input) ?? stringValue(body.userInput) ?? "";
  const runConfig = recordValue(body.run_config) ?? recordValue(body.runConfig) ?? {};
  const effectiveRunConfig = resolveEffectiveRunConfig(
    {
      context: [],
      forwardedProps: { run_config: runConfig },
      messages: [{ id: "skill-selection-preview", role: "user", content: userInput }],
      runId: "skill-selection-preview",
      threadId: "skill-selection-preview"
    } as never,
    context.metadataStore,
    context.userId,
    "api-duckdb-demo",
    context.workspaceId
  );
  const selection = selectSkillsForRun({
    metadataStore: context.metadataStore,
    runConfig: effectiveRunConfig,
    userId: context.userId,
    userInput,
    workspaceId: context.workspaceId
  });
  return ok({
    audit: selection.audit,
    effectivePolicy: selection.effectiveToolPolicy,
    skills: selection.selectedSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      revision: skill.revision,
      tags: skill.tags
    }))
  });
};

const errorResponse = (error: unknown): ConfigApiResponse => {
  const message = messageOf(error);
  if (message.startsWith("REVISION_CONFLICT")) {
    return fail(409, "REVISION_CONFLICT", message);
  }
  if (message.startsWith("RUN_NOT_BRANCHABLE")) {
    return fail(409, "RUN_NOT_BRANCHABLE", message);
  }
  if (message.startsWith("RUN_NOT_VISIBLE")) {
    return fail(404, "RESOURCE_NOT_FOUND", message);
  }
  if (message.startsWith("SESSION_BRANCH_CYCLE")) {
    return fail(409, "REVISION_CONFLICT", message);
  }
  if (message.startsWith("SESSION_BRANCH_PARENT_NOT_VISIBLE")) {
    return fail(404, "RESOURCE_NOT_FOUND", message);
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
  if (message.startsWith("UNSUPPORTED_FILE_TYPE")) {
    return fail(415, "UNSUPPORTED_FILE_TYPE", message);
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
const arrayValue = (value: unknown): unknown[] | undefined => Array.isArray(value) ? value : undefined;
const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const booleanValue = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
const clampInteger = (value: number, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
const stringArrayValue = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
const evidenceRefsFromUnknown = (value: unknown): EvidenceRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isEvidenceRef);
};
const isEvidenceRef = (value: unknown): value is EvidenceRef => {
  if (!isRecord(value) || !isRecord(value.source)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    isEvidenceKind(value.kind) &&
    typeof value.label === "string" &&
    typeof value.sessionId === "string"
  );
};
const isEvidenceKind = (value: unknown): value is EvidenceKind =>
  value === "table" ||
  value === "chart" ||
  value === "report" ||
  value === "file" ||
  value === "sql" ||
  value === "schema" ||
  value === "preview" ||
  value === "knowledge" ||
  value === "step";
const parseRecord = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  return isRecord(parsed) ? parsed : {};
};
const tryParseRecord = (value: string): Record<string, unknown> | undefined => {
  try {
    return parseRecord(value);
  } catch {
    return undefined;
  }
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

const isSupportedChatUpload = (filename: string, mimeType: string): boolean => {
  const lowerName = filename.toLowerCase();
  const dot = lowerName.lastIndexOf(".");
  const extension = dot >= 0 ? lowerName.slice(dot) : "";
  return CHAT_UPLOAD_TYPES.has(mimeType.toLowerCase()) || CHAT_UPLOAD_EXTENSIONS.has(extension);
};

const uniqueUploadFilename = (directory: string, filename: string): string => {
  const safe = safeUploadFilename(filename);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  let candidate = safe;
  let counter = 2;
  while (existsSync(resolve(directory, candidate))) {
    candidate = `${stem}-${counter}${extension}`;
    counter += 1;
  }
  return candidate;
};

const safeUploadFilename = (filename: string): string => {
  const safe = basename(filename).replace(/[^a-zA-Z0-9._ -]+/gu, "-").trim();
  if (!safe || safe === "." || safe === "..") {
    return `upload-${randomUUID()}`;
  }
  return safe;
};

const stringHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

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
  if ((type === "sqlite" || type === "duckdb" || type === "access") && filePath) {
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
  const urlOrCommand = stringValue(resource.payload.serverUrl) ?? stringValue(resource.payload.url);
  const transport = stringValue(resource.payload.transport) ?? "streamable-http";
  if (!urlOrCommand || (transport !== "streamable-http" && transport !== "sse" && transport !== "stdio")) {
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
  const client = new Client({ name: "open-data-foundry-config", version: "0.1.0" });
  try {
    const clientTransport = transport === "stdio"
      ? new StdioClientTransport({
          ...resolveStdioCommand(resource.payload, urlOrCommand),
          stderr: "pipe"
        })
      : transport === "sse"
        ? new SSEClientTransport(new URL(urlOrCommand), requestOptions)
        : new StreamableHTTPClientTransport(new URL(urlOrCommand), requestOptions);
    await client.connect(clientTransport as unknown as Transport);
    const result = await client.listTools();
    const allowlist = mcpToolAllowlistValue(resource.payload.toolAllowlist);
    return result.tools
      .filter((tool) => matchesMcpToolAllowlist(resource.id, tool.name, allowlist))
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema
      }));
  } finally {
    await client.close().catch(() => undefined);
  }
};

const resolveStdioCommand = (
  payload: Record<string, unknown>,
  fallbackCommand: string
): { args?: string[]; command: string; cwd?: string; env?: Record<string, string> } => {
  const command = stringValue(payload.command);
  const args = stringArrayValue(payload.args);
  const cwd = stringValue(payload.cwd);
  const env = recordStringMapValue(payload.env);
  if (command) {
    return {
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {})
    };
  }
  const parts = splitCommandLine(fallbackCommand);
  const head = parts[0];
  if (!head) {
    throw new Error("MCP_STDIO_COMMAND_REQUIRED");
  }
  return {
    command: head,
    ...(parts.length > 1 ? { args: parts.slice(1) } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {})
  };
};

const mcpToolAllowlistValue = (value: unknown): string[] | undefined => {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : csvStringValue(value);
  return values.length > 0 ? values : undefined;
};

const csvStringValue = (value: unknown): string[] => {
  if (typeof value !== "string") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
};

const matchesMcpToolAllowlist = (
  serverId: string,
  toolName: string,
  allowlist: string[] | undefined
): boolean => {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }
  const namespaced = `mcp__${sanitizeMcpName(serverId)}__${sanitizeMcpName(toolName)}`;
  return allowlist.includes(toolName) || allowlist.includes(namespaced);
};

const recordStringMapValue = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const splitCommandLine = (value: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (/\s/u.test(char ?? "") && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
};

const sanitizeMcpName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_");

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
