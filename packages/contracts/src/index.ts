export const RUN_EVENT_TYPES = [
  "plan.update",
  "step.start",
  "step.meta",
  "step.output",
  "step.chunk",
  "step.done",
  "final",
  "done",
  "error",
  "cancel"
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type ApiResult<T> = {
  success: boolean;
  data?: T;
  err_code?: string;
  err_msg?: string;
};

export type MeResponse = {
  id: string;
  email?: string;
  display_name?: string;
};

export type PlanTaskStatus = "pending" | "running" | "completed" | "failed";

export type PlanUpdatePayload = {
  tasks: Array<{
    id: string;
    title: string;
    status: PlanTaskStatus;
  }>;
};

export type StepKind = "knowledge" | "schema" | "sql" | "analysis" | "chart" | "report" | "tool" | "final";

export type StepStartPayload = {
  step_id: string;
  title: string;
  kind: StepKind;
  tool_name?: string;
};

export type Citation = {
  document_id: string;
  chunk_id: string;
  filename: string;
  quote: string;
  page_number?: number;
  section_title?: string;
  score?: number;
};

export type StepMetaPayload = {
  step_id: string;
  status?: "running" | "completed" | "failed";
  input?: unknown;
  sql?: string;
  datasource_id?: string;
  collection_id?: string;
  citations?: Citation[];
};

export type StepOutputPayload = {
  step_id: string;
  output_type: "text" | "markdown" | "json" | "table" | "chart" | "sql" | "citation" | "error";
  content: unknown;
};

export type StepChunkPayload = {
  step_id: string;
  delta: string;
};

export type StepDonePayload = {
  step_id: string;
  status: "completed" | "failed" | "canceled";
  error_message?: string;
  artifact_ids?: string[];
};

export type FinalPayload = {
  content: string;
  citations?: Citation[];
  artifact_ids?: string[];
};

export type DonePayload = {
  status: "completed";
  artifact_ids?: string[];
};

export type ErrorPayload = {
  code: string;
  message: string;
  recoverable: boolean;
  step_id?: string;
};

export type CancelPayload = {
  reason?: string;
};

export type RunEventPayloadMap = {
  "plan.update": PlanUpdatePayload;
  "step.start": StepStartPayload;
  "step.meta": StepMetaPayload;
  "step.output": StepOutputPayload;
  "step.chunk": StepChunkPayload;
  "step.done": StepDonePayload;
  final: FinalPayload;
  done: DonePayload;
  error: ErrorPayload;
  cancel: CancelPayload;
};

export type RunEventEnvelope<TPayload = unknown> = {
  type: RunEventType;
  run_id: string;
  session_id: string;
  seq: number;
  ts: string;
  payload: TPayload;
};

export type TypedRunEventEnvelope<TType extends RunEventType> = RunEventEnvelope<RunEventPayloadMap[TType]> & {
  type: TType;
};

export type DataSourceSummary = {
  id: string;
  name: string;
  type: string;
  status: "ready" | "disabled" | "failed";
  description?: string;
};

export type ToolName =
  | "retrieve_knowledge"
  | "list_data_sources"
  | "inspect_schema"
  | "preview_table"
  | "run_sql_readonly"
  | "profile_dataset"
  | "create_chart"
  | "generate_report"
  | "export_artifact";

export type RetrieveKnowledgeToolInput = {
  collection_id: string;
  query: string;
  top_k?: number;
};

export type ListDataSourcesToolInput = {
  enabled_only?: boolean;
};

export type InspectSchemaToolInput = {
  datasource_id: string;
  table_names?: string[];
};

export type PreviewTableToolInput = {
  datasource_id: string;
  table: string;
  limit?: number;
};

export type RunSqlReadonlyToolInput = {
  datasource_id: string;
  sql: string;
  limit?: number;
  timeout_ms?: number;
};

export type ProfileDatasetToolInput = {
  datasource_id: string;
  table?: string;
  file_id?: string;
};

export type CreateChartToolInput = {
  source_artifact_id?: string;
  table_data?: unknown;
  chart_type: "bar" | "line" | "pie" | "scatter" | "table";
  x?: string;
  y?: string;
  title?: string;
};

export type GenerateReportToolInput = {
  title: string;
  summary: string;
  artifact_ids?: string[];
  citations?: Citation[];
  format: "markdown" | "html";
};

export type ExportArtifactToolInput = {
  artifact_id: string;
  format?: "json" | "csv" | "html" | "md" | "png";
};

export type ToolInputMap = {
  retrieve_knowledge: RetrieveKnowledgeToolInput;
  list_data_sources: ListDataSourcesToolInput;
  inspect_schema: InspectSchemaToolInput;
  preview_table: PreviewTableToolInput;
  run_sql_readonly: RunSqlReadonlyToolInput;
  profile_dataset: ProfileDatasetToolInput;
  create_chart: CreateChartToolInput;
  generate_report: GenerateReportToolInput;
  export_artifact: ExportArtifactToolInput;
};

export type ArtifactType = "table" | "chart" | "markdown" | "html" | "file" | "image" | "citation_bundle";

export type ArtifactSummary = {
  id: string;
  type: ArtifactType;
  name: string;
  preview_json?: unknown;
};

export type AppErrorCode =
  | "UNAUTHORIZED"
  | "RESOURCE_NOT_FOUND"
  | "NOT_ENABLED"
  | "UNSUPPORTED_FILE_TYPE"
  | "PARSE_FAILED"
  | "REINDEX_REQUIRED"
  | "SQL_BLOCKED"
  | "SQL_TIMEOUT"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_RATE_LIMITED";

export const createSuccessResult = <T>(data: T): ApiResult<T> => ({
  success: true,
  data
});

export const createErrorResult = (err_code: AppErrorCode, err_msg: string): ApiResult<never> => ({
  success: false,
  err_code,
  err_msg
});

export type EnvVariableSpec = {
  name: string;
  required: boolean;
  default_value?: string;
  description: string;
};

export type EnvConfig = {
  api: {
    host: string;
    port: number;
  };
  llm: {
    provider: string;
    model: string;
    base_url: string;
    api_key?: string;
  };
  embedding: {
    provider: string;
    model: string;
    dim: number;
    output_type: "dense";
    base_url: string;
    api_key?: string;
  };
  storage: {
    root_dir: string;
  };
  sql: {
    default_limit: number;
    max_limit: number;
    timeout_ms: number;
  };
};

export const ENV_VARIABLE_SPECS: EnvVariableSpec[] = [
  { name: "API_HOST", required: false, default_value: "127.0.0.1", description: "Agent runtime bind host." },
  { name: "API_PORT", required: false, default_value: "8787", description: "Agent runtime bind port." },
  { name: "LLM_PROVIDER", required: false, default_value: "bailian", description: "Chat model provider." },
  { name: "LLM_MODEL", required: false, default_value: "qwen-plus", description: "Chat model name." },
  { name: "LLM_BASE_URL", required: true, description: "OpenAI-compatible chat completions base URL." },
  { name: "LLM_API_KEY", required: true, description: "Chat provider API key." },
  { name: "EMBEDDING_PROVIDER", required: false, default_value: "bailian", description: "Embedding provider." },
  { name: "EMBEDDING_MODEL", required: false, default_value: "text-embedding-v4", description: "Embedding model name." },
  { name: "EMBEDDING_DIM", required: false, default_value: "1024", description: "Embedding vector dimension." },
  { name: "EMBEDDING_OUTPUT_TYPE", required: false, default_value: "dense", description: "Embedding output type." },
  { name: "EMBEDDING_BASE_URL", required: true, description: "OpenAI-compatible embeddings base URL." },
  { name: "EMBEDDING_API_KEY", required: true, description: "Embedding provider API key." },
  { name: "STORAGE_ROOT_DIR", required: false, default_value: "storage", description: "Local storage root." },
  { name: "METADATA_DB_PATH", required: false, description: "SQLite metadata database path." },
  { name: "SQL_DEFAULT_LIMIT", required: false, default_value: "100", description: "Default read-only SQL row limit." },
  { name: "SQL_MAX_LIMIT", required: false, default_value: "1000", description: "Maximum read-only SQL row limit." },
  { name: "SQL_TIMEOUT_MS", required: false, default_value: "10000", description: "Read-only SQL timeout in ms." }
];

export const createEnvConfig = (env: Record<string, string | undefined>): EnvConfig => ({
  api: {
    host: env.API_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.API_PORT ?? "8787", 10)
  },
  llm: {
    provider: env.LLM_PROVIDER ?? "bailian",
    model: env.LLM_MODEL ?? "qwen-plus",
    base_url: env.LLM_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ...(env.LLM_API_KEY ? { api_key: env.LLM_API_KEY } : {})
  },
  embedding: {
    provider: env.EMBEDDING_PROVIDER ?? "bailian",
    model: env.EMBEDDING_MODEL ?? "text-embedding-v4",
    dim: Number.parseInt(env.EMBEDDING_DIM ?? "1024", 10),
    output_type: "dense",
    base_url: env.EMBEDDING_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ...(env.EMBEDDING_API_KEY ? { api_key: env.EMBEDDING_API_KEY } : {})
  },
  storage: {
    root_dir: env.STORAGE_ROOT_DIR ?? "storage"
  },
  sql: {
    default_limit: Number.parseInt(env.SQL_DEFAULT_LIMIT ?? "100", 10),
    max_limit: Number.parseInt(env.SQL_MAX_LIMIT ?? "1000", 10),
    timeout_ms: Number.parseInt(env.SQL_TIMEOUT_MS ?? "10000", 10)
  }
});
