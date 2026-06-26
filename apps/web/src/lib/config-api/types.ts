export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "DATASOURCE_TEST_FAILED"
  | "INTERNAL_ERROR"
  | "JOB_NOT_FOUND"
  | "NOT_ENABLED"
  | "PARSE_FAILED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_RATE_LIMITED"
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

export type BackendCapabilitiesResponse = {
  "artifact.export"?: boolean;
  "artifact.list"?: boolean;
  "artifact.promote"?: boolean;
  "chat.fileUpload"?: boolean;
  "chat.imageInput"?: boolean;
  "conversation.memory"?: boolean;
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

export type ConversationToolCallDto = {
  runId: string;
  toolCallId: string;
  status: "completed" | "failed" | "pending";
  toolName?: string;
  callEventSeq?: number;
  endEventSeq?: number;
  resultEventSeq?: number;
  resultMessageId?: string;
  resultPreview?: string;
};

export type SessionConversationDto = {
  sessionId: string;
  messages: ConversationMessageDto[];
  summary?: ConversationSummaryDto;
  runEventRefs: ConversationRunEventRefDto[];
  toolCalls: ConversationToolCallDto[];
};

export type JobDto = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  type: string;
  resource_id: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  result?: Record<string, unknown>;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
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
