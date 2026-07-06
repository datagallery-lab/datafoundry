import type { EvidenceRef } from "@datafoundry/contracts";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "DATASOURCE_TEST_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "JOB_NOT_FOUND"
  | "NOT_ENABLED"
  | "PARSE_FAILED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_RATE_LIMITED"
  | "RATE_LIMITED"
  | "PROVIDER_TEST_FAILED"
  | "REINDEX_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "SECRET_MASTER_KEY_REQUIRED"
  | "SQL_BLOCKED"
  | "SQL_TIMEOUT"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_FILE_TYPE";

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: ApiErrorCode; message: string } };

export class ConfigApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ConfigApiError";
    this.code = code;
    this.status = status;
  }
}

export type DevIdentityUser = {
  id: string;
  email?: string;
  displayName?: string;
  devToken?: string;
};

export type IdentityWorkspace = {
  id: string;
  name?: string;
};

export type MeResponseDto = {
  user: DevIdentityUser;
  workspace: IdentityWorkspace;
};

export type DevIdentitiesResponseDto = {
  users: DevIdentityUser[];
  currentUserId: string;
  workspace: IdentityWorkspace;
};

export type BackendCapabilitiesResponse = {
  "artifact.export"?: boolean;
  "artifact.list"?: boolean;
  "artifact.promote"?: boolean;
  "chat.fileUpload"?: boolean;
  "chat.imageInput"?: boolean;
  "conversation.memory"?: boolean;
  "conversation.title"?: boolean;
  "interaction.resume"?: boolean;
  "datasource.fieldMasking"?: boolean;
  "datasource.extendedTypes"?: boolean;
  "datasource.introspectionPolicy"?: boolean;
  "datasource.queryPolicy"?: boolean;
  "datasource.samplePolicy"?: boolean;
  "datasource.server"?: boolean;
  "kb.chunking"?: boolean;
  "kb.citationPolicy"?: boolean;
  "kb.scope"?: boolean;
  "llm.advancedSampling"?: boolean;
  "mcp.stdio"?: boolean;
  "mcp.toolPolicy"?: boolean;
  "skill.resourceBinding"?: boolean;
  "llm.samplingParams"?: boolean;
  knowledge?: boolean;
  mcp?: boolean;
  skills?: boolean;
  files?: boolean;
};

export type FileAssetRefDto = {
  id: string;
  assetId?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source?: string;
  origin?: string;
  scope?: "session" | "workspace";
  status?: string;
  sessionId?: string;
  runId?: string;
  createdAt?: string;
};

export type DatasourceDto = {
  id: string;
  name: string;
  description?: string;
  type: string;
  mode?: string;
  config?: Record<string, unknown>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatasourceTypeParamDto = {
  name: string;
  label: string;
  type: "string" | "password" | "select" | "number" | "boolean" | "file";
  required: boolean;
  default_value?: string | number | boolean;
  options?: string[];
};

export type DatasourceTypeDto = {
  name: string;
  label: string;
  enabled: boolean;
  description?: string;
  parameters: DatasourceTypeParamDto[];
};

export type KnowledgeBaseDto = {
  id: string;
  name: string;
  description?: string;
  retrievalTopK?: number;
  scoreThreshold?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  citationRequired?: boolean;
  chunkOverlap?: number;
  chunkSize?: number;
  graphRagEnabled?: boolean;
  rerankEnabled?: boolean;
  rerankModel?: string;
  scope?: string;
  vectorStore?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  indexStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type McpServerDto = {
  id: string;
  name: string;
  description?: string;
  transport?: string;
  serverUrl?: string;
  authType?: string;
  toolManifest?: unknown[];
  toolAllowlist?: string[] | string;
  timeoutMs?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  healthStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ModelProfileDto = {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  fallbackProfileId?: string;
  frequencyPenalty?: number;
  maxTokens?: number;
  presencePenalty?: number;
  contextLength?: number;
  reasoningModel?: boolean;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SkillDto = {
  id: string;
  name: string;
  description?: string;
  allowedTools?: string[];
  version?: string;
  packageFileRefId?: string;
  packageFileName?: string;
  packageFormat?: "skill-md" | "zip";
  packageSource?: string;
  manifest?: Record<string, unknown>;
  defaultDbIds?: string[];
  defaultKbIds?: string[];
  defaultMcpIds?: string[];
  modelProfileId?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  validationStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceConfigDto = {
  datasources: DatasourceDto[];
  knowledgeBases: KnowledgeBaseDto[];
  mcpServers: McpServerDto[];
  modelProfiles: ModelProfileDto[];
  skills: SkillDto[];
};

export type RunDefaultsDto = {
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
  activeDatasourceId: string;
  activeLlmProfileId: string | null;
  activeSkillId: string;
};

export type ConversationMessageDto = {
  id: string;
  runId: string;
  role: "assistant" | "user";
  source: "agent" | "client";
  messageId?: string;
  contentText: string;
  evidenceRefs?: EvidenceRef[];
  position: number;
  createdAt: string;
};

export type ConversationSummaryDto = {
  id: string;
  sourceRunId?: string;
  fromPosition: number;
  toPosition: number;
  summaryText: string;
  createdAt: string;
};

export type ConversationRunEventRefDto = {
  runId: string;
  eventCount: number;
  firstSeq?: number;
  lastSeq?: number;
};

export type ConversationCheckpointDto = {
  runId: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "canceled";
  messageStartPosition?: number;
  messageEndPosition?: number;
  firstEventSeq?: number;
  lastEventSeq?: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
};

export type ConversationBranchDto = {
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkMessageEndPosition: number;
  isOriginal?: boolean;
  createdAt: string;
  title?: string;
};

export type SessionBranchDto = {
  id: string;
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkMessageEndPosition: number;
  createdAt: string;
  title?: string;
  session: SessionListItemDto;
};

export type ConversationToolCallDto = {
  runId: string;
  id?: string;
  toolCallId: string;
  status: "completed" | "failed" | "pending";
  name?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  callEventSeq?: number;
  endEventSeq?: number;
  resultEventSeq?: number;
  parentMessageId?: string;
  resultMessageId?: string;
  resultPreview?: string;
};

export type RestorableCustomEventDto = {
  runId: string;
  seq: number;
  name: string;
  value: unknown;
};

export type PendingInteractionDto = {
  interactionId: string;
  runId: string;
  toolCallId: string;
  toolName: "ask_user" | "submit_plan";
  interruptEvent?: unknown;
  payload?: unknown;
  resumeSchema?: unknown;
};

export type SessionConversationDto = {
  sessionId: string;
  title?: string;
  titleSource?: string;
  updatedAt?: string;
  messages: ConversationMessageDto[];
  summary?: ConversationSummaryDto;
  runEventRefs: ConversationRunEventRefDto[];
  checkpoints?: ConversationCheckpointDto[];
  branch?: Omit<ConversationBranchDto, "isOriginal"> & { id: string };
  branches?: ConversationBranchDto[];
  toolCalls: ConversationToolCallDto[];
  pendingInteractions?: PendingInteractionDto[];
  restorableCustomEvents?: RestorableCustomEventDto[];
};

export type SessionListItemDto = {
  id: string;
  threadId: string;
  title?: string;
  titleSource?: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string;
};

export type SessionListResponseDto = {
  sessions: SessionListItemDto[];
  nextCursor?: string;
};

export type SessionTitleDto = {
  sessionId: string;
  title: string;
  titleSource?: string;
  updatedAt?: string;
};

export type JobDto = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  type: string;
  resource_id: string;
  resourceId?: string;
  artifactId?: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  result?: Record<string, unknown>;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
};

export type ArtifactExportFormat = "csv" | "xlsx";

export type RunCancelDto = {
  canceled: boolean;
  runId: string;
  sessionId?: string;
  persistedOnly?: boolean;
  reason?: string;
};

export type DatasourceSchemaColumnDto = {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
};

export type DatasourceSchemaTableDto = {
  name: string;
  table?: string;
  description?: string;
  sampleAvailable?: boolean;
  columns: DatasourceSchemaColumnDto[];
  stats?: {
    rowCount?: number;
    sizeBytes?: number;
  };
};

export type DatasourceSchemaDto = {
  datasourceId?: string;
  datasource_id?: string;
  tables: DatasourceSchemaTableDto[];
  inspectedAt?: string;
  adapterSchemaVersion?: number;
};

export type DatasourceTablePreviewColumnDto = {
  name: string;
  type?: string;
};

export type DatasourceTablePreviewDto = {
  columns: DatasourceTablePreviewColumnDto[];
  rows: Array<Record<string, unknown>>;
  total?: number;
  hasMore?: boolean;
};

export type QueryHistoryItemDto = {
  id: string;
  sessionId?: string;
  runId?: string;
  datasourceId?: string;
  sql: string;
  rowCount?: number;
  elapsedMs?: number;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type QueryHistoryListResponseDto = {
  queries: QueryHistoryItemDto[];
};

export type ArtifactDto = {
  id: string;
  type?: string;
  name?: string;
  fileId?: string;
  downloadUrl?: string;
  preview_json?: Record<string, unknown>;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};
