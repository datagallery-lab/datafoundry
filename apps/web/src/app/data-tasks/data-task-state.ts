import {
  clampRightPanelWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from "./workspace-layout";

export type ArtifactKind = "chart" | "csv" | "memo" | "dashboard" | "file";
export type DataArtifactType = "dataset" | "chart" | "sql" | "report" | "file";
export type ChartArtifactType = "bar" | "line" | "pie";
export type ChartArtifactPoint = { label: string; value: number };
export type ChartArtifactSeries = {
  name: string;
  points: ChartArtifactPoint[];
};

/**
 * Tool-agnostic data step kinds. The console is organized around the data-task
 * lifecycle, not around specific SQL tools, so any backend data operation maps
 * to one of these. Today the backend only emits `inspect` (inspect_schema) and
 * `query` (run_sql_readonly); the remaining kinds light up as the backend ships
 * more data tools (see docs/engineering/2026-06-25-backend-requirements.md). Unknown
 * tools degrade to `other` instead of masquerading as a schema inspection.
 */
export type DataStepKind =
  | "inspect" // structure / schema inspection
  | "query" // SQL / data query
  | "transform" // data shaping / cleaning
  | "fetch" // table / row fetch
  | "visualize" // chart / visualization
  | "knowledge" // RAG / knowledge retrieval
  | "other"; // any other backend data operation

/** Maps a backend tool name to a tool-agnostic data step kind. */
export function dataStepKindForTool(toolName?: string): DataStepKind {
  switch (toolName) {
    case "inspect_schema":
    case "list_data_sources":
      return "inspect";
    case "run_sql_readonly":
      return "query";
    case "preview_table":
      return "fetch";
    case "retrieve_knowledge":
      return "knowledge";
    default:
      return "other";
  }
}

/** Short human label for a data step kind (used in trace/console chips). */
export function dataStepLabel(kind: DataStepKind): string {
  switch (kind) {
    case "inspect":
      return "结构检查";
    case "query":
      return "数据查询";
    case "transform":
      return "数据加工";
    case "fetch":
      return "取数";
    case "visualize":
      return "可视化";
    case "knowledge":
      return "知识检索";
    case "other":
      return "数据操作";
  }
}

/** Human-readable title for a backend tool name (console / trace / progress). */
export function toolDisplayTitle(toolName?: string): string {
  switch (toolName) {
    case "inspect_schema":
      return "检查数据源 Schema";
    case "run_sql_readonly":
      return "生成并执行 SQL";
    case "ask_user":
      return "询问用户";
    case "submit_plan":
      return "提交计划";
    default:
      if (!toolName || toolName === "tool" || toolName === "unknown") {
        return "执行工具";
      }
      return toolName;
  }
}

export type ArtifactDetail =
  | {
      type: "sql";
      sql: string;
      scannedRows: number;
      durationMs: number;
    }
  | {
      type: "dataset";
      columns: string[];
      rows: string[][];
    }
  | {
      type: "chart";
      chartType?: ChartArtifactType;
      unit?: string;
      points: ChartArtifactPoint[];
      series?: ChartArtifactSeries[];
    }
  | {
      type: "report";
      sections: Array<{ heading: string; body: string }>;
    }
  | {
      type: "file";
      path: string;
      size?: number;
      mtime?: string;
      tool?: string;
      content?: string;
    };

export interface DataArtifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  type?: DataArtifactType;
  summary: string;
  version?: string;
  /** FileAssetRef id behind file-backed artifacts, when the backend provides one. */
  fileId?: string;
  /** Backend download URL for file-backed artifacts, when available. */
  downloadUrl?: string;
  createdByEventId?: string;
  detail?: ArtifactDetail;
  /** When true, full preview can be fetched via artifact REST API. */
  previewAvailable?: boolean;
  /** Milliseconds since epoch when the artifact event was received. */
  recordedAtMs?: number;
}

export interface TimelineStep {
  id: string;
  label: string;
  /** The timeline event whose appearance marks this step complete. */
  linkedEventId: string;
}

export interface SchemaTable {
  name: string;
  description: string;
  fields: string[];
}

/** Schema/inspect step payload. */
export interface SchemaStepPayload {
  tables: SchemaTable[];
}

/** SQL/query step payload. */
export interface QueryStepPayload {
  question: string;
  sql: string;
  scannedRows: number;
  durationMs: number;
  errorMessage?: string;
}

/** Generic data step payload for any non-SQL/non-schema operation. */
export interface GenericStepPayload {
  description: string;
  rawResult?: string;
}

export type DataStepPayload =
  | SchemaStepPayload
  | QueryStepPayload
  | GenericStepPayload;

export type ActivityStepStatus = "running" | "completed" | "failed";

export interface TimelineEvent {
  id: string;
  kind: DataStepKind;
  ts: string;
  title: string;
  summary: string;
  /** Backend tool name behind this step, when known. */
  toolName?: string;
  /** Backend ACTIVITY STEP `step_id` (e.g. sql-1), when distinct from AG-UI toolCallId. */
  stepId?: string;
  /** Latest status from ACTIVITY_SNAPSHOT STEP content.status. */
  activityStatus?: ActivityStepStatus;
  /** The agent's reasoning shown above the action — the ReAct signature. */
  thought?: string;
  artifactIds?: string[];
  payload: DataStepPayload;
}

/** An empty payload sized to the step kind, for steps not yet resolved. */
export function emptyStepPayload(kind: DataStepKind): DataStepPayload {
  if (kind === "query") {
    return { question: "", sql: "", scannedRows: 0, durationMs: 0 };
  }
  if (kind === "inspect") {
    return { tables: [] };
  }
  return { description: "" };
}

/**
 * Client-side chat session. The backend has no session list / persistence API,
 * only a per-run `threadId`. Each session here owns its own `threadId`, which
 * keeps CopilotKit's per-(agentId, threadId) agent clone isolated.
 */
/** Per-session disabled resource ids (store "off" list; default = all enabled). */
export type SessionDisabledMap = Record<
  Exclude<WorkspaceConfigKind, "llm">,
  string[]
>;

export interface SessionConfigOverride {
  disabled: SessionDisabledMap;
}

export type ChatSessionTitleSource = "default" | "auto-snippet" | "llm" | "user";

export interface ChatSession {
  id: string;
  threadId: string;
  title: string;
  titleSource?: ChatSessionTitleSource;
  createdAt: number;
  /** Pinned sessions stay at the top of the sidebar list. */
  pinned?: boolean;
  /** When the session was pinned; used to order multiple pinned sessions. */
  pinnedAt?: number;
  /** Per-session resource enablement; omitted = all workspace resources enabled. */
  config?: SessionConfigOverride;
}

const SESSIONS_STORAGE_KEY = "data-tasks:sessions:v1";

function newThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createChatSession(title = "新数据任务"): ChatSession {
  const threadId = newThreadId();
  return {
    id: threadId,
    threadId,
    title,
    titleSource: "default",
    createdAt: Date.now(),
  };
}

function normalizeSessionTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

export function deriveSnippetTitle(text: string): string {
  const normalized = normalizeSessionTitle(text);
  if (!normalized) return "新数据任务";
  const maxChars = 23;
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}…`
    : normalized;
}

export function deleteChatSession(
  sessions: ChatSession[],
  id: string,
): ChatSession[] {
  return sessions.filter((session) => session.id !== id);
}

export function togglePinChatSession(
  sessions: ChatSession[],
  id: string,
): ChatSession[] {
  const now = Date.now();
  return sessions.map((session) => {
    if (session.id !== id) return session;
    const nextPinned = !session.pinned;
    return {
      ...session,
      pinned: nextPinned,
      pinnedAt: nextPinned ? now : undefined,
    };
  });
}

export function sortChatSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => {
    const leftPinned = Boolean(left.pinned);
    const rightPinned = Boolean(right.pinned);
    if (leftPinned !== rightPinned) {
      return Number(rightPinned) - Number(leftPinned);
    }
    if (leftPinned && rightPinned) {
      return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
    }
    return right.createdAt - left.createdAt;
  });
}

export function renameChatSession(
  sessions: ChatSession[],
  id: string,
  title: string,
): ChatSession[] {
  const normalized = normalizeSessionTitle(title);
  if (!normalized) return sessions;
  return sessions.map((session) =>
    session.id === id
      ? { ...session, title: normalized, titleSource: "user" }
      : session,
  );
}

export function applyAutoTitle(
  sessions: ChatSession[],
  id: string,
  title: string,
  source: Exclude<ChatSessionTitleSource, "default" | "user">,
): ChatSession[] {
  const normalized = normalizeSessionTitle(title);
  if (!normalized) return sessions;
  return sessions.map((session) => {
    if (session.id !== id || session.titleSource === "user") return session;
    return { ...session, title: normalized, titleSource: source };
  });
}

export function dedupeChatSessions(sessions: ChatSession[]): ChatSession[] {
  const seenIds = new Set<string>();
  const seenThreadIds = new Set<string>();
  const unique: ChatSession[] = [];

  for (const session of sessions) {
    if (seenIds.has(session.id) || seenThreadIds.has(session.threadId)) {
      continue;
    }
    seenIds.add(session.id);
    seenThreadIds.add(session.threadId);
    unique.push(session);
  }

  return unique;
}

export function loadChatSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortChatSessions(dedupeChatSessions(parsed.filter(isChatSession)));
  } catch {
    return [];
  }
}

export function persistChatSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SESSIONS_STORAGE_KEY,
      JSON.stringify(sessions),
    );
  } catch {
    // Ignore quota / serialization errors — sessions stay in-memory.
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSessionDisabledMap(value: unknown): value is SessionDisabledMap {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isStringArray(record.db) &&
    isStringArray(record.kb) &&
    isStringArray(record.mcp) &&
    isStringArray(record.skill)
  );
}

function isSessionConfigOverride(value: unknown): value is SessionConfigOverride {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isSessionDisabledMap(record.disabled);
}

function isChatSession(value: unknown): value is ChatSession {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.threadId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.createdAt !== "number"
  ) {
    return false;
  }
  if (record.config !== undefined && !isSessionConfigOverride(record.config)) {
    return false;
  }
  if (record.pinned !== undefined && typeof record.pinned !== "boolean") {
    return false;
  }
  if (record.pinnedAt !== undefined && typeof record.pinnedAt !== "number") {
    return false;
  }
  if (
    record.titleSource !== undefined &&
    record.titleSource !== "default" &&
    record.titleSource !== "auto-snippet" &&
    record.titleSource !== "llm" &&
    record.titleSource !== "user"
  ) {
    return false;
  }
  return true;
}

/** Client-side skill catalog. Backend skill execution is not wired yet. */
export interface DataSkill {
  id: string;
  name: string;
  description: string;
}

export type SkillPackageFormat = "skill-md" | "zip" | "builtin";

export interface ParsedSkillPackage {
  fileName: string;
  format: Exclude<SkillPackageFormat, "builtin">;
  name: string;
  description: string;
  version: string;
  allowedTools: string;
  content: string;
}

const SKILL_FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/;

function readFrontmatterScalar(frontmatter: string, key: string): string {
  const lines = frontmatter.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(
      new RegExp(`^${key}:\\s*(.+?)\\s*$`),
    );
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

export function parseSkillMdContent(
  content: string,
  fileName: string,
): ParsedSkillPackage | { error: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: "文件为空。" };
  }

  const match = trimmed.match(SKILL_FRONTMATTER_RE);
  if (!match) {
    return { error: "缺少 YAML frontmatter（文件须以 --- 开头并闭合）。" };
  }

  const frontmatter = match[1];
  const body = match[2].trim();
  const name =
    readFrontmatterScalar(frontmatter, "name") ||
    fileName.replace(/\.md$/i, "") ||
    "未命名 Skill";
  const description =
    readFrontmatterScalar(frontmatter, "description") ||
    body.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ||
    name;

  return {
    fileName,
    format: "skill-md",
    name,
    description,
    version: readFrontmatterScalar(frontmatter, "version") || "1.0.0",
    allowedTools:
      readFrontmatterScalar(frontmatter, "allowed-tools") ||
      readFrontmatterScalar(frontmatter, "allowedTools"),
    content: trimmed,
  };
}

export async function parseSkillPackageFile(
  file: File,
): Promise<ParsedSkillPackage | { error: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".md")) {
    return parseSkillMdContent(await file.text(), file.name);
  }
  if (lower.endsWith(".zip")) {
    return {
      error:
        "ZIP 包导入需后端 POST /api/v1/skills 支持，当前请先上传 SKILL.md 文件。",
    };
  }
  return { error: "仅支持 .md（SKILL.md）或 .zip 技能包。" };
}

export function skillSettingsFromPackage(
  pkg: ParsedSkillPackage,
): Record<string, string> {
  return {
    packageFileName: pkg.fileName,
    packageFormat: pkg.format,
    packageVersion: pkg.version,
    allowedTools: pkg.allowedTools,
    packageContent: pkg.content,
  };
}

export function builtinSkillSettings(skillId: string): Record<string, string> {
  return {
    packageFileName: "SKILL.md",
    packageFormat: "builtin",
    packageVersion: "1.0.0",
    packageSource: `builtin://${skillId}`,
    allowedTools: "",
    packageContent: "",
  };
}

export function normalizeSkillSettings(
  settings?: Record<string, string>,
): Record<string, string> {
  return {
    packageFileName: settings?.packageFileName ?? "",
    packageFormat: settings?.packageFormat ?? "",
    packageVersion: settings?.packageVersion ?? "",
    packageSource: settings?.packageSource ?? "",
    allowedTools: settings?.allowedTools ?? "",
    packageContent: settings?.packageContent ?? "",
    defaultDbIds: settings?.defaultDbIds ?? "",
    defaultKbIds: settings?.defaultKbIds ?? "",
    defaultMcpIds: settings?.defaultMcpIds ?? "",
    modelProfileId: settings?.modelProfileId ?? "",
  };
}

export function isSkillSettingsValid(settings: Record<string, string>): boolean {
  if (settings.packageFormat === "builtin") return true;
  return (settings.packageContent ?? "").trim().length > 0;
}

export const SKILL_PACKAGE_LOCAL_ONLY_KEYS = ["packageContent"] as const;

export const DATA_SKILLS: DataSkill[] = [
  {
    id: "data-agent-default",
    name: "通用数据分析",
    description: "默认 ReAct 数据问答与探索",
  },
  {
    id: "schema-explore",
    name: "Schema 探索",
    description: "优先检查表结构与字段含义",
  },
  {
    id: "sql-analysis",
    name: "SQL 分析",
    description: "聚焦只读查询与指标计算",
  },
  {
    id: "report-draft",
    name: "报告草稿",
    description: "偏向结论整理与报告产出",
  },
];

export const DEFAULT_SKILL_ID = DATA_SKILLS[0].id;

const ACTIVE_LLM_STORAGE_KEY = "data-tasks:active-llm:v1";
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "data-tasks:right-panel-width:v1";

export function loadRightPanelWidth(): number {
  if (typeof window === "undefined") return RIGHT_PANEL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    const fallback = RIGHT_PANEL_DEFAULT_WIDTH;
    const stored =
      raw && Number.isFinite(Number.parseFloat(raw)) && Number.parseFloat(raw) > 0
        ? Number.parseFloat(raw)
        : fallback;
    return clampRightPanelWidth(stored);
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

export function persistRightPanelWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RIGHT_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(width)),
    );
  } catch {
    // Ignore quota errors — width stays in-memory.
  }
}

export type WorkspaceConfigKind = "db" | "kb" | "mcp" | "llm" | "skill";

/** Connectivity status; populated once backend `test`/`introspect` lands. */
export type ConfigItemStatus = "connected" | "failed" | "untested";

export interface WorkspaceConfigItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  builtin?: boolean;
  settings?: Record<string, string>;
  secretRef?: string;
  hasSecret?: boolean;
  revision?: number;
  /** Connectivity result from backend `test`. Defaults to untested. */
  status?: ConfigItemStatus;
}

export type ConfigFieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  inputType?: "text" | "password" | "url" | "select" | "number" | "boolean" | "textarea";
  options?: Array<{ value: string; label: string }>;
  /** Select option values rendered disabled until pendingCapability activates. */
  pendingOptionValues?: string[];
  fullWidth?: boolean;
  required?: boolean;
  /** Field is only rendered/validated when this predicate passes (conditional fields). */
  visibleWhen?: (settings: Record<string, string>) => boolean;
  /**
   * Gates the field behind a backend capability. While the capability is off
   * the field is hidden/not validated. Flip the flag in BACKEND_CAPABILITIES
   * once the backend supports it — no field re-authoring needed.
   */
  requiresCapability?: BackendCapability;
  /**
   * Placeholder capability: field stays visible but disabled with a badge until
   * the backend ships. Flip matching entry in PENDING_CAPABILITIES to true.
   */
  pendingCapability?: PendingCapability;
  /** When set, pending state applies only if this predicate is true. */
  pendingWhen?: (settings: Record<string, string>) => boolean;
  /** Dynamic select options (e.g. fallback profile list). */
  getOptions?: (context: ConfigFieldOptionsContext) => Array<{ value: string; label: string }>;
  readOnly?: (item: WorkspaceConfigItem) => boolean;
};

export type ConfigFieldOptionsContext = {
  workspaceConfig?: WorkspaceConfigStore;
  currentItemId?: string;
};

/**
 * Backend capability flags. All false today (see
 * docs/engineering/2026-06-25-backend-requirements.md). Flip to true when the matching
 * backend capability ships; gated fields/options then appear automatically.
 */
export type BackendCapability =
  | "datasource.server" // PostgreSQL / MySQL adapters (#2)
  | "datasource.queryPolicy" // per-datasource maxRows/timeout wired (#5)
  | "llm.samplingParams" // temperature/maxTokens consumed (#4)
  | "artifact.export" // artifact preview/download API (#9)
  | "artifact.list" // session artifact list/restore API
  | "artifact.promote" // promote artifact-backed file into workspace assets
  | "chat.imageInput" // chat multimodal image parts consumed (#13a)
  | "chat.fileUpload" // chat file upload endpoint to session workspace (#13b)
  | "conversation.title" // LLM-generated session title sync
  | "files"; // workspace FileAssetRef library API

export const BACKEND_CAPABILITIES: Record<BackendCapability, boolean> = {
  "datasource.server": false,
  "datasource.queryPolicy": false,
  "llm.samplingParams": false,
  "artifact.export": true,
  "artifact.list": false,
  "artifact.promote": false,
  "chat.imageInput": false,
  "chat.fileUpload": false,
  "conversation.title": false,
  files: false,
};

export function hasCapability(capability: BackendCapability): boolean {
  return BACKEND_CAPABILITIES[capability];
}

/** Applies runtime capability flags from `GET /api/v1/capabilities`. */
export function setLiveBackendCapabilities(
  mapped: Record<BackendCapability, boolean>,
): void {
  for (const capability of Object.keys(mapped) as BackendCapability[]) {
    BACKEND_CAPABILITIES[capability] = mapped[capability];
  }
}

/**
 * Placeholder capabilities for DB-GPT parity fields not yet implemented on the
 * backend. Flip to true when the matching backend feature ships.
 */
export type PendingCapability =
  | "datasource.extendedTypes"
  | "datasource.introspectionPolicy"
  | "datasource.samplePolicy"
  | "datasource.fieldMasking"
  | "kb.vectorStore"
  | "kb.rerank"
  | "kb.citationPolicy"
  | "kb.chunking"
  | "kb.graphRag"
  | "kb.scope"
  | "mcp.stdio"
  | "mcp.toolPolicy"
  | "llm.advancedSampling"
  | "skill.resourceBinding";

export const PENDING_CAPABILITIES: Record<PendingCapability, boolean> = {
  "datasource.extendedTypes": false,
  "datasource.introspectionPolicy": false,
  "datasource.samplePolicy": false,
  "datasource.fieldMasking": false,
  "kb.vectorStore": false,
  "kb.rerank": false,
  "kb.citationPolicy": false,
  "kb.chunking": false,
  "kb.graphRag": false,
  "kb.scope": false,
  "mcp.stdio": false,
  "mcp.toolPolicy": false,
  "llm.advancedSampling": false,
  "skill.resourceBinding": false,
};

export function hasPendingCapability(capability: PendingCapability): boolean {
  return PENDING_CAPABILITIES[capability];
}

/** Applies runtime pending flags (future API hook; defaults stay false). */
export function setLivePendingCapabilities(
  mapped: Partial<Record<PendingCapability, boolean>>,
): void {
  for (const capability of Object.keys(mapped) as PendingCapability[]) {
    const value = mapped[capability];
    if (typeof value === "boolean") {
      PENDING_CAPABILITIES[capability] = value;
    }
  }
}

export function isFieldHiddenByCapability(field: ConfigFieldDef): boolean {
  return Boolean(field.requiresCapability && !hasCapability(field.requiresCapability));
}

export function isFieldPending(
  field: ConfigFieldDef,
  settings: Record<string, string> = {},
): boolean {
  if (field.pendingWhen && !field.pendingWhen(settings)) {
    return false;
  }
  if (!field.pendingCapability) {
    return false;
  }
  return !hasPendingCapability(field.pendingCapability);
}

export function isFieldDisabled(
  field: ConfigFieldDef,
  item: WorkspaceConfigItem,
  settings: Record<string, string>,
): boolean {
  return Boolean(field.readOnly?.(item) || isFieldPending(field, settings));
}

/**
 * Datasource engine types supported by the backend today plus DB-GPT roadmap
 * types shown as disabled placeholders until adapters land.
 */
export const DB_TYPE_OPTIONS = [
  { value: "duckdb", label: "DuckDB（内置 demo）" },
  { value: "sqlite", label: "SQLite（文件）" },
  { value: "csv", label: "CSV 文件" },
  { value: "xlsx", label: "Excel 文件" },
] as const;

/** Server DB types, gated behind `datasource.server` capability. */
export const DB_SERVER_TYPE_OPTIONS = [
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
] as const;

/** DB-GPT extended types — visible in UI, pending backend adapters. */
export const DB_PENDING_TYPE_OPTIONS = [
  { value: "clickhouse", label: "ClickHouse" },
  { value: "oracle", label: "Oracle" },
  { value: "mssql", label: "SQL Server" },
  { value: "hive", label: "Hive" },
  { value: "spark", label: "Spark" },
  { value: "vertica", label: "Vertica" },
  { value: "bigquery", label: "BigQuery" },
  { value: "snowflake", label: "Snowflake" },
] as const;

export const DB_MODE_OPTIONS = [
  { value: "readonly", label: "只读（当前唯一支持）" },
] as const;

const DB_SERVER_TYPES = DB_SERVER_TYPE_OPTIONS.map((option) => option.value);
const DB_PENDING_TYPES = DB_PENDING_TYPE_OPTIONS.map((option) => option.value);
const DB_FILE_TYPES = DB_TYPE_OPTIONS.map((option) => option.value);
let liveDbTypeOptions: Array<{ value: string; label: string; enabled: boolean }> = [
  ...DB_TYPE_OPTIONS.map((option) => ({ ...option, enabled: true })),
  ...DB_SERVER_TYPE_OPTIONS.map((option) => ({ ...option, enabled: true })),
  ...DB_PENDING_TYPE_OPTIONS.map((option) => ({ ...option, enabled: false })),
];

export function setLiveDatasourceTypes(
  types: Array<{ enabled: boolean; label: string; name: string }>,
): void {
  if (types.length === 0) {
    return;
  }
  liveDbTypeOptions = types.map((type) => ({
    value: type.name,
    label: type.label,
    enabled: type.enabled,
  }));
}

function dbTypeOf(settings: Record<string, string>): string {
  return settings.type ?? "duckdb";
}

function isDbExtendedPendingType(settings: Record<string, string>): boolean {
  const type = dbTypeOf(settings);
  return isDbExtendedType(type) && !isDbTypeEnabled(type);
}

function isDbBigQueryType(settings: Record<string, string>): boolean {
  return dbTypeOf(settings) === "bigquery";
}

function isDbSnowflakeType(settings: Record<string, string>): boolean {
  return dbTypeOf(settings) === "snowflake";
}

function isDbClickHouseType(settings: Record<string, string>): boolean {
  return dbTypeOf(settings) === "clickhouse";
}

function isDbServerType(settings: Record<string, string>): boolean {
  const type = dbTypeOf(settings);
  return (
    DB_SERVER_TYPES.includes(type as (typeof DB_SERVER_TYPES)[number]) ||
    isDbExtendedType(type)
  );
}

function isDbExtendedType(type: string): boolean {
  return (
    DB_PENDING_TYPES.includes(type as (typeof DB_PENDING_TYPES)[number]) ||
    liveDbTypeOptions.some((option) =>
      option.value === type && !DB_FILE_TYPES.includes(type as (typeof DB_FILE_TYPES)[number])
        && !DB_SERVER_TYPES.includes(type as (typeof DB_SERVER_TYPES)[number]))
  );
}

function isDbTypeEnabled(type: string): boolean {
  return liveDbTypeOptions.some((option) => option.value === type && option.enabled);
}

/** DB type list grows with backend capability (server types appear when on). */
function dbTypeOptions(): Array<{ value: string; label: string }> {
  return liveDbTypeOptions
    .filter((option) => option.enabled || isDbExtendedType(option.value))
    .filter((option) => !DB_SERVER_TYPES.includes(option.value as (typeof DB_SERVER_TYPES)[number])
      || hasCapability("datasource.server"))
    .map((option) => ({
      value: option.value,
      label: option.label,
    }));
}

export const EMBEDDING_PROVIDER_OPTIONS = [
  { value: "bailian", label: "百炼 DashScope (bailian)" },
  { value: "openai-compatible", label: "OpenAI 兼容" },
  { value: "openai", label: "OpenAI" },
] as const;

export const KB_VECTOR_STORE_OPTIONS = [
  { value: "local-sqlite", label: "本地 SQLite（当前默认）" },
  { value: "chroma", label: "Chroma" },
  { value: "milvus", label: "Milvus" },
  { value: "pgvector", label: "pgvector" },
  { value: "elasticsearch", label: "Elasticsearch" },
] as const;

export const KB_SCOPE_OPTIONS = [
  { value: "personal", label: "个人" },
  { value: "workspace", label: "工作区" },
  { value: "project", label: "项目" },
] as const;

export const MCP_AUTH_TYPE_OPTIONS = [
  { value: "none", label: "无认证" },
  { value: "bearer", label: "Bearer Token" },
  { value: "custom-header", label: "自定义 Header（待后端）" },
] as const;

/** Aligns with dataAgent `LLM_PROVIDER` env and Mastra router provider ids. */
export const LLM_PROVIDER_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI 兼容 (LLM_PROVIDER=openai-compatible)" },
  { value: "bailian", label: "百炼 DashScope (bailian)" },
  { value: "deepseek", label: "DeepSeek (deepseek)" },
  { value: "openai", label: "OpenAI (openai)" },
  { value: "anthropic", label: "Anthropic (anthropic)" },
  { value: "google", label: "Google Gemini (google)" },
] as const;

export function normalizeLlmSettings(
  settings?: Record<string, string>,
): {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
} {
  return {
    provider: settings?.provider ?? "openai-compatible",
    baseUrl: settings?.baseUrl ?? settings?.base_url ?? "",
    apiKey: settings?.apiKey ?? settings?.api_key ?? "",
    modelName:
      settings?.modelName ?? settings?.model ?? settings?.model_name ?? "",
  };
}

export function summarizeLlmItems(
  items: WorkspaceConfigItem[],
  emptyLabel: string,
): string {
  if (items.length === 0) return emptyLabel;
  if (items.length === 1) {
    return getLlmDisplayLabel(items[0]);
  }
  return `${items.length} 项默认可用`;
}

export function getLlmDisplayLabel(item: WorkspaceConfigItem): string {
  const normalized = normalizeLlmSettings(item.settings);
  return normalized.modelName || item.name;
}

export function getLlmOptionSubtitle(item: WorkspaceConfigItem): string {
  if (item.builtin) return "服务端环境变量";
  const normalized = normalizeLlmSettings(item.settings);
  return [normalized.provider, item.description].filter(Boolean).join(" · ");
}

export function getEnabledLlmItems(
  workspaceConfig: WorkspaceConfigStore,
): WorkspaceConfigItem[] {
  return workspaceConfig.llm;
}

export function loadActiveLlmId(workspaceConfig: WorkspaceConfigStore): string {
  const enabled = getEnabledLlmItems(workspaceConfig);
  const fallback = enabled[0]?.id ?? "server-default";
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(ACTIVE_LLM_STORAGE_KEY);
    if (!raw) return fallback;
    return enabled.some((item) => item.id === raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function persistActiveLlmId(llmId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_LLM_STORAGE_KEY, llmId);
  } catch {
    // Ignore quota errors.
  }
}

/** Keeps a valid dialog selection; otherwise falls back to server/local default. */
export function resolveActiveLlmProfileId(
  enabledProfiles: WorkspaceConfigItem[],
  activeLlmId: string | null,
  fallback: string,
): string {
  const enabledIds = new Set(enabledProfiles.map((profile) => profile.id));
  if (activeLlmId && enabledIds.has(activeLlmId)) return activeLlmId;
  if (enabledIds.has(fallback)) return fallback;
  return enabledProfiles[0]?.id ?? fallback;
}

/** MCP transport types aligned with common MCP client configs. */
export const MCP_TRANSPORT_OPTIONS = [
  { value: "sse", label: "SSE (Server-Sent Events)" },
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "stdio", label: "stdio（本地命令）" },
] as const;

export function normalizeMcpSettings(
  settings?: Record<string, string>,
): {
  transport: string;
  serverUrl: string;
  apiKey: string;
  authType: string;
  toolAllowlist: string;
  timeoutMs: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
} {
  return {
    transport: settings?.transport ?? "sse",
    serverUrl: settings?.serverUrl ?? settings?.url ?? settings?.endpoint ?? "",
    apiKey: settings?.apiKey ?? settings?.api_key ?? settings?.token ?? "",
    authType: settings?.authType ?? "none",
    toolAllowlist: settings?.toolAllowlist ?? "",
    timeoutMs: settings?.timeoutMs ?? "",
    command: settings?.command ?? "",
    args: settings?.args ?? "",
    cwd: settings?.cwd ?? "",
    env: settings?.env ?? "",
  };
}

export function isMcpStdioTransport(settings: Record<string, string>): boolean {
  return settings.transport === "stdio";
}

export function normalizeKbSettings(
  settings?: Record<string, string>,
): Record<string, string> {
  return {
    indexName: settings?.indexName ?? "",
    retrievalTopK: settings?.retrievalTopK ?? "5",
    scoreThreshold: settings?.scoreThreshold ?? "0.3",
    embeddingProvider: settings?.embeddingProvider ?? "bailian",
    embeddingModel: settings?.embeddingModel ?? "text-embedding-v4",
    embeddingBaseUrl:
      settings?.embeddingBaseUrl ??
      settings?.embedding_base_url ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    embeddingApiKey: settings?.embeddingApiKey ?? settings?.embedding_api_key ?? "",
    vectorStore: settings?.vectorStore ?? "local-sqlite",
    rerankEnabled: settings?.rerankEnabled ?? "false",
    rerankModel: settings?.rerankModel ?? "",
    citationRequired: settings?.citationRequired ?? "true",
    chunkSize: settings?.chunkSize ?? "1600",
    chunkOverlap: settings?.chunkOverlap ?? "200",
    scope: settings?.scope ?? "workspace",
    graphRagEnabled: settings?.graphRagEnabled ?? "false",
    indexStatus: settings?.indexStatus ?? "",
  };
}

export function normalizeLlmSettingsExtended(
  settings?: Record<string, string>,
): Record<string, string> {
  const base = normalizeLlmSettings(settings);
  return {
    ...base,
    fallbackProfileId: settings?.fallbackProfileId ?? "",
    timeoutMs: settings?.timeoutMs ?? "60000",
    temperature: settings?.temperature ?? "",
    maxTokens: settings?.maxTokens ?? "",
    topP: settings?.topP ?? "",
    frequencyPenalty: settings?.frequencyPenalty ?? "",
    presencePenalty: settings?.presencePenalty ?? "",
    reasoningModel: settings?.reasoningModel ?? "false",
    contextLength: settings?.contextLength ?? "",
  };
}

export function summarizeMcpItems(
  items: WorkspaceConfigItem[],
  emptyLabel: string,
): string {
  if (items.length === 0) return emptyLabel;
  if (items.length === 1) return items[0].name;
  return `${items.length} 项默认可用`;
}

export const WORKSPACE_CONFIG_FIELDS: Record<
  WorkspaceConfigKind,
  ConfigFieldDef[]
> = {
  db: [
    {
      key: "datasourceId",
      label: "数据源 ID",
      placeholder: "my-dataset",
      helpText: "传给 Agent 的稳定标识（forwardedProps.datasourceId）。",
      required: true,
      fullWidth: true,
    },
    {
      key: "type",
      label: "数据源类型",
      inputType: "select",
      getOptions: () => dbTypeOptions(),
      pendingOptionValues: [...DB_PENDING_TYPES],
      helpText:
        "已实现：DuckDB / SQLite / CSV / Excel / PostgreSQL / MySQL / ClickHouse。未启用扩展类型标「待后端」。",
      required: true,
    },
    {
      key: "mode",
      label: "访问模式",
      inputType: "select",
      options: [...DB_MODE_OPTIONS],
      helpText: "当前后端仅支持只读查询（run_sql_readonly）。",
    },
    {
      key: "filePath",
      label: "文件路径",
      placeholder: "/data/sales.sqlite 或 /data/orders.csv",
      helpText: "SQLite / CSV / Excel 的本地文件路径。DuckDB 为内置 demo，无需路径。",
      required: true,
      fullWidth: true,
      visibleWhen: (s) => dbTypeOf(s) !== "duckdb" && !isDbServerType(s),
    },
    {
      key: "host",
      label: "Host",
      placeholder: "127.0.0.1",
      required: true,
      requiresCapability: "datasource.server",
      visibleWhen: isDbServerType,
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "port",
      label: "Port",
      inputType: "number",
      placeholder: "5432",
      required: true,
      requiresCapability: "datasource.server",
      visibleWhen: isDbServerType,
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "database",
      label: "Database",
      placeholder: "analytics",
      required: true,
      requiresCapability: "datasource.server",
      visibleWhen: isDbServerType,
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "schema",
      label: "Schema",
      placeholder: "public",
      requiresCapability: "datasource.server",
      visibleWhen: (s) =>
        isDbServerType(s) && !isDbBigQueryType(s) && !isDbSnowflakeType(s) && !isDbClickHouseType(s),
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "username",
      label: "用户名",
      placeholder: "readonly_user",
      required: true,
      requiresCapability: "datasource.server",
      visibleWhen: (s) => isDbServerType(s) && !isDbBigQueryType(s),
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "password",
      label: "密码",
      inputType: "password",
      placeholder: "••••••",
      helpText: "写入 secretRef，读接口不回传明文。",
      requiresCapability: "datasource.server",
      visibleWhen: (s) => isDbServerType(s) && !isDbBigQueryType(s),
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "secure",
      label: "HTTPS",
      inputType: "boolean",
      requiresCapability: "datasource.server",
      visibleWhen: isDbClickHouseType,
      pendingWhen: isDbExtendedPendingType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "projectId",
      label: "Project ID",
      placeholder: "my-gcp-project",
      required: true,
      visibleWhen: isDbBigQueryType,
      pendingWhen: isDbBigQueryType,
      pendingCapability: "datasource.extendedTypes",
      fullWidth: true,
    },
    {
      key: "dataset",
      label: "Dataset",
      placeholder: "analytics",
      required: true,
      visibleWhen: isDbBigQueryType,
      pendingWhen: isDbBigQueryType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "credentialsJson",
      label: "Credentials JSON",
      inputType: "password",
      placeholder: "{ ... }",
      visibleWhen: isDbBigQueryType,
      pendingWhen: isDbBigQueryType,
      pendingCapability: "datasource.extendedTypes",
      fullWidth: true,
    },
    {
      key: "account",
      label: "Account",
      placeholder: "xy12345.us-east-1",
      required: true,
      visibleWhen: isDbSnowflakeType,
      pendingWhen: isDbSnowflakeType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "warehouse",
      label: "Warehouse",
      placeholder: "COMPUTE_WH",
      required: true,
      visibleWhen: isDbSnowflakeType,
      pendingWhen: isDbSnowflakeType,
      pendingCapability: "datasource.extendedTypes",
    },
    {
      key: "tableAllowlist",
      label: "表白名单",
      placeholder: "orders, customers",
      helpText: "逗号分隔；为空表示允许全部表。",
      pendingCapability: "datasource.introspectionPolicy",
      fullWidth: true,
    },
    {
      key: "refreshIntervalSec",
      label: "Schema 刷新间隔 (秒)",
      inputType: "number",
      placeholder: "3600",
      pendingCapability: "datasource.introspectionPolicy",
    },
    {
      key: "denyWrite",
      label: "拒绝写入",
      inputType: "boolean",
      helpText: "当前后端强制只读；此开关待策略下沉。",
      pendingCapability: "datasource.introspectionPolicy",
    },
    {
      key: "maskFields",
      label: "脱敏字段",
      placeholder: "phone, email",
      helpText: "逗号分隔字段名，查询结果脱敏。",
      pendingCapability: "datasource.fieldMasking",
      fullWidth: true,
    },
    {
      key: "allowSample",
      label: "允许采样",
      inputType: "boolean",
      pendingCapability: "datasource.samplePolicy",
    },
    {
      key: "maxSampleRows",
      label: "最大采样行数",
      inputType: "number",
      placeholder: "100",
      visibleWhen: (s) => s.allowSample === "true",
      pendingCapability: "datasource.samplePolicy",
    },
    {
      key: "maxRows",
      label: "最大返回行数",
      inputType: "number",
      placeholder: "10000",
      requiresCapability: "datasource.queryPolicy",
    },
    {
      key: "timeoutMs",
      label: "查询超时 (ms)",
      inputType: "number",
      placeholder: "30000",
      requiresCapability: "datasource.queryPolicy",
    },
  ],
  kb: [
    {
      key: "indexName",
      label: "索引名称",
      placeholder: "metrics-docs",
      required: true,
      fullWidth: true,
    },
    {
      key: "scope",
      label: "作用域",
      inputType: "select",
      options: [...KB_SCOPE_OPTIONS],
      pendingCapability: "kb.scope",
    },
    {
      key: "retrievalTopK",
      label: "检索 Top K",
      inputType: "number",
      placeholder: "5",
    },
    {
      key: "scoreThreshold",
      label: "分数阈值",
      inputType: "number",
      placeholder: "0.3",
      helpText: "用于 knowledge search 和 retrieve_knowledge 的默认过滤阈值。",
    },
    {
      key: "embeddingProvider",
      label: "Embedding Provider",
      inputType: "select",
      options: [...EMBEDDING_PROVIDER_OPTIONS],
      fullWidth: true,
    },
    {
      key: "embeddingModel",
      label: "Embedding Model",
      placeholder: "text-embedding-v4",
      fullWidth: true,
    },
    {
      key: "embeddingBaseUrl",
      label: "Embedding Base URL",
      inputType: "url",
      placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fullWidth: true,
    },
    {
      key: "embeddingApiKey",
      label: "Embedding API Key",
      inputType: "password",
      placeholder: "sk-...",
      helpText: "写入 secretRef；未配置时回退服务端 EMBEDDING_* 环境变量。",
      fullWidth: true,
    },
    {
      key: "vectorStore",
      label: "向量库类型",
      inputType: "select",
      options: [...KB_VECTOR_STORE_OPTIONS],
      pendingCapability: "kb.vectorStore",
      fullWidth: true,
    },
    {
      key: "rerankEnabled",
      label: "启用 Rerank",
      inputType: "boolean",
      pendingCapability: "kb.rerank",
    },
    {
      key: "rerankModel",
      label: "Rerank Model",
      placeholder: "gte-rerank",
      visibleWhen: (s) => s.rerankEnabled === "true",
      pendingCapability: "kb.rerank",
      fullWidth: true,
    },
    {
      key: "citationRequired",
      label: "强制引用",
      inputType: "boolean",
      helpText: "回答必须附带 KB 引用。",
      pendingCapability: "kb.citationPolicy",
    },
    {
      key: "chunkSize",
      label: "分块大小",
      inputType: "number",
      placeholder: "1600",
      pendingCapability: "kb.chunking",
    },
    {
      key: "chunkOverlap",
      label: "分块重叠",
      inputType: "number",
      placeholder: "200",
      pendingCapability: "kb.chunking",
    },
    {
      key: "graphRagEnabled",
      label: "GraphRAG",
      inputType: "boolean",
      pendingCapability: "kb.graphRag",
    },
  ],
  mcp: [
    {
      key: "transport",
      label: "Transport",
      inputType: "select",
      options: [...MCP_TRANSPORT_OPTIONS],
      pendingOptionValues: ["stdio"],
      helpText: "远程 MCP 常用 SSE 或 Streamable HTTP；stdio 使用本地启动命令。",
      required: true,
      fullWidth: true,
    },
    {
      key: "serverUrl",
      label: "Endpoint / 启动命令",
      placeholder: "https://example.com/mcp/sse",
      helpText: "远程传输填 MCP 服务 URL；stdio 时也可填整行启动命令作为 fallback。",
      visibleWhen: (settings) => !isMcpStdioTransport(settings),
      required: true,
      fullWidth: true,
    },
    {
      key: "command",
      label: "可执行文件",
      placeholder: "/usr/bin/npx",
      helpText: "stdio 模式下优先使用 command + args；为空时回退到上方整行命令。",
      visibleWhen: isMcpStdioTransport,
      pendingCapability: "mcp.stdio",
      required: true,
      fullWidth: true,
    },
    {
      key: "args",
      label: "启动参数",
      placeholder: "-y @modelcontextprotocol/server-filesystem /data",
      helpText: "空格分隔；会写入后端 args 数组。",
      visibleWhen: isMcpStdioTransport,
      pendingCapability: "mcp.stdio",
      fullWidth: true,
    },
    {
      key: "cwd",
      label: "工作目录",
      placeholder: "/home/agent/workspace",
      visibleWhen: isMcpStdioTransport,
      pendingCapability: "mcp.stdio",
      fullWidth: true,
    },
    {
      key: "env",
      label: "环境变量 (JSON)",
      inputType: "textarea",
      placeholder: '{ "NODE_ENV": "production" }',
      helpText: "JSON object，键值均为字符串。",
      visibleWhen: isMcpStdioTransport,
      pendingCapability: "mcp.stdio",
      fullWidth: true,
    },
    {
      key: "authType",
      label: "认证方式",
      inputType: "select",
      options: [...MCP_AUTH_TYPE_OPTIONS],
      pendingOptionValues: ["custom-header"],
      visibleWhen: (settings) => !isMcpStdioTransport(settings),
    },
    {
      key: "apiKey",
      label: "Token / API Key",
      inputType: "password",
      placeholder: "••••••",
      helpText: "Bearer 认证时写入 secretRef。",
      visibleWhen: (settings) =>
        !isMcpStdioTransport(settings) && (settings.authType ?? "none") !== "none",
      fullWidth: true,
    },
    {
      key: "toolAllowlist",
      label: "工具白名单",
      placeholder: "search, fetch_page",
      helpText: "逗号分隔；为空表示允许 manifest 中全部工具。",
      pendingCapability: "mcp.toolPolicy",
      fullWidth: true,
    },
    {
      key: "timeoutMs",
      label: "单工具超时 (ms)",
      inputType: "number",
      placeholder: "30000",
      pendingCapability: "mcp.toolPolicy",
    },
  ],
  llm: [
    {
      key: "provider",
      label: "Provider",
      inputType: "select",
      options: [...LLM_PROVIDER_OPTIONS],
      helpText:
        "openai-compatible / bailian 走 OpenAI 兼容路径；anthropic/google 等待集成验证。",
      required: true,
      fullWidth: true,
    },
    {
      key: "baseUrl",
      label: "Base URL",
      inputType: "url",
      placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      helpText: "OpenAI 兼容 Chat Completions 根路径（不含 /chat/completions）。",
      required: true,
      fullWidth: true,
    },
    {
      key: "apiKey",
      label: "API Key",
      inputType: "password",
      placeholder: "sk-...",
      helpText: "写入 secretRef；run 时不经 AG-UI 外发。",
      fullWidth: true,
    },
    {
      key: "modelName",
      label: "Model Name",
      placeholder: "qwen-plus",
      helpText: "Chat model id（如 gpt-4o、qwen-plus、deepseek-chat）。",
      required: true,
      fullWidth: true,
    },
    {
      key: "fallbackProfileId",
      label: "Fallback Profile",
      inputType: "select",
      placeholder: "无",
      helpText: "主 profile 失败时按链式 fallback 切换。",
      getOptions: ({ workspaceConfig, currentItemId }) => {
        const profiles = workspaceConfig?.llm ?? [];
        return profiles
          .filter((profile) => profile.id !== currentItemId)
          .map((profile) => ({
            value: profile.id,
            label: profile.name || profile.id,
          }));
      },
      fullWidth: true,
    },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      inputType: "number",
      placeholder: "60000",
      helpText: "用于 provider test 和 run 阶段超时控制。",
    },
    {
      key: "temperature",
      label: "Temperature",
      inputType: "number",
      placeholder: "0.2",
      requiresCapability: "llm.samplingParams",
    },
    {
      key: "maxTokens",
      label: "Max Tokens",
      inputType: "number",
      placeholder: "4096",
      requiresCapability: "llm.samplingParams",
    },
    {
      key: "topP",
      label: "Top P",
      inputType: "number",
      placeholder: "1.0",
      requiresCapability: "llm.samplingParams",
    },
    {
      key: "frequencyPenalty",
      label: "Frequency Penalty",
      inputType: "number",
      placeholder: "0",
      requiresCapability: "llm.samplingParams",
    },
    {
      key: "presencePenalty",
      label: "Presence Penalty",
      inputType: "number",
      placeholder: "0",
      requiresCapability: "llm.samplingParams",
    },
    {
      key: "reasoningModel",
      label: "Reasoning Model",
      inputType: "boolean",
      pendingCapability: "llm.advancedSampling",
    },
    {
      key: "contextLength",
      label: "Context Length",
      inputType: "number",
      placeholder: "128000",
      pendingCapability: "llm.advancedSampling",
    },
  ],
  skill: [
    {
      key: "packageFileName",
      label: "包文件",
      readOnly: () => true,
      fullWidth: true,
    },
    {
      key: "packageFormat",
      label: "格式",
      readOnly: () => true,
    },
    {
      key: "packageVersion",
      label: "版本",
      readOnly: () => true,
    },
    {
      key: "allowedTools",
      label: "允许工具",
      readOnly: () => true,
      fullWidth: true,
      visibleWhen: (settings) => (settings.allowedTools ?? "").trim().length > 0,
    },
    {
      key: "defaultDbIds",
      label: "默认数据源",
      placeholder: "api-duckdb-demo, sales-pg",
      helpText: "逗号分隔 datasource id；skill 命中后自动并入本次 run。",
      pendingCapability: "skill.resourceBinding",
      fullWidth: true,
    },
    {
      key: "defaultKbIds",
      label: "默认知识库",
      placeholder: "metrics-docs",
      pendingCapability: "skill.resourceBinding",
      fullWidth: true,
    },
    {
      key: "defaultMcpIds",
      label: "默认 MCP",
      placeholder: "notion",
      pendingCapability: "skill.resourceBinding",
      fullWidth: true,
    },
    {
      key: "modelProfileId",
      label: "默认模型 Profile",
      placeholder: "qwen-plus-default",
      pendingCapability: "skill.resourceBinding",
      fullWidth: true,
    },
  ],
};

export function defaultSettingsForKind(
  kind: WorkspaceConfigKind,
  name = "",
): Record<string, string> {
  switch (kind) {
    case "db":
      return {
        datasourceId: name || "custom-datasource",
        type: "sqlite",
        mode: "readonly",
        filePath: "",
        denyWrite: "true",
        allowSample: "true",
        maxSampleRows: "100",
      };
    case "kb":
      return normalizeKbSettings({ indexName: name || "custom-kb" });
    case "mcp":
      return {
        transport: "sse",
        serverUrl: name ? `https://${name}` : "",
        apiKey: "",
        authType: "none",
        command: "",
        args: "",
        cwd: "",
        env: "",
      };
    case "llm":
      return normalizeLlmSettingsExtended({
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        modelName: name || "qwen-plus",
      });
    case "skill":
      return normalizeSkillSettings({
        packageFileName: "",
        packageFormat: "",
        packageVersion: "",
        packageSource: "",
        allowedTools: "",
        packageContent: "",
      });
  }
}

/** Fields visible in the detail form (includes pending placeholders). */
export function renderableConfigFields(
  panel: WorkspaceConfigKind,
  settings: Record<string, string>,
): ConfigFieldDef[] {
  return WORKSPACE_CONFIG_FIELDS[panel].filter(
    (field) =>
      (panel === "skill" ? !isFieldHiddenByCapability(field) : true) &&
      (!field.visibleWhen || field.visibleWhen(settings)),
  );
}

/** Fields that should currently render/validate given the item's settings. */
export function visibleConfigFields(
  panel: WorkspaceConfigKind,
  settings: Record<string, string>,
): ConfigFieldDef[] {
  const fields = renderableConfigFields(panel, settings);
  if (panel !== "skill") {
    return fields;
  }
  return fields.filter((field) => !isFieldPending(field, settings));
}

export function resolveConfigFieldOptions(
  field: ConfigFieldDef,
  context: ConfigFieldOptionsContext,
): Array<{ value: string; label: string }> {
  if (field.getOptions) {
    return field.getOptions(context);
  }
  return field.options ?? [];
}

export function isSelectOptionPending(
  field: ConfigFieldDef,
  optionValue: string,
): boolean {
  if (!field.pendingOptionValues?.includes(optionValue)) {
    return false;
  }
  if (optionValue === "stdio") {
    return !hasPendingCapability("mcp.stdio");
  }
  if (optionValue === "custom-header") {
    return true;
  }
  if (field.pendingCapability) {
    return !hasPendingCapability(field.pendingCapability);
  }
  return DB_PENDING_TYPES.includes(optionValue as (typeof DB_PENDING_TYPES)[number])
    && !isDbTypeEnabled(optionValue);
}

/**
 * Unified validation: name present, plus every visible required field filled.
 * Builtin read-only fields are exempt (their values are server-managed).
 */
export function isWorkspaceConfigItemValid(
  panel: WorkspaceConfigKind,
  item: WorkspaceConfigItem,
  settings: Record<string, string>,
): boolean {
  if (!item.name.trim()) return false;
  if (panel === "skill") {
    return isSkillSettingsValid(settings);
  }
  return visibleConfigFields(panel, settings).every((field) => {
    if (!field.required) return true;
    if (field.readOnly?.(item)) return true;
    return (settings[field.key] ?? "").trim().length > 0;
  });
}

/** Compare editable fields for save/cancel dirty detection (ignores revision/status). */
export function workspaceConfigItemDraftEquals(
  a: WorkspaceConfigItem,
  b: WorkspaceConfigItem,
): boolean {
  if (a.name.trim() !== b.name.trim()) return false;
  if (a.description.trim() !== b.description.trim()) return false;
  if (a.enabled !== b.enabled) return false;
  const aSettings = a.settings ?? {};
  const bSettings = b.settings ?? {};
  const keys = new Set([...Object.keys(aSettings), ...Object.keys(bSettings)]);
  for (const key of keys) {
    if ((aSettings[key] ?? "").trim() !== (bSettings[key] ?? "").trim()) {
      return false;
    }
  }
  return true;
}

export type WorkspaceConfigStore = Record<
  WorkspaceConfigKind,
  WorkspaceConfigItem[]
>;

export function defaultWorkspaceConfig(): WorkspaceConfigStore {
  return {
    db: [
      {
        id: "api-duckdb-demo",
        name: "api-duckdb-demo",
        description: "DuckDB 演示数据源",
        enabled: true,
        builtin: true,
        settings: {
          datasourceId: "api-duckdb-demo",
          type: "duckdb",
          mode: "readonly",
        },
      },
    ],
    kb: [],
    mcp: [],
    llm: [
      {
        id: "server-default",
        name: "服务端默认",
        description: "使用 dataAgent 服务端 .env 中的 LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL",
        enabled: true,
        builtin: true,
        settings: {
          provider: "服务端 (LLM_PROVIDER)",
          baseUrl: "服务端 (LLM_BASE_URL)",
          apiKey: "",
          modelName: "服务端 (LLM_MODEL)",
        },
      },
    ],
    skill: DATA_SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      enabled: true,
      builtin: true,
      settings: builtinSkillSettings(skill.id),
    })),
  };
}

export function summarizeConfigItems(
  items: WorkspaceConfigItem[],
  emptyLabel: string,
): string {
  if (items.length === 0) return emptyLabel;
  if (items.length === 1) return items[0].name;
  return `${items.length} 项默认可用`;
}

export function createWorkspaceConfigItem(
  kind: WorkspaceConfigKind,
  name: string,
  description: string,
): WorkspaceConfigItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `custom-${Date.now()}`;
  return {
    id,
    name,
    description,
    enabled: true,
    settings: defaultSettingsForKind(kind, name),
  };
}

// ---------------------------------------------------------------------------
// Session config — layer between workspace defaults and per-run @ mentions.
// Each chat session stores a per-kind *disabled* list (default = all enabled).
// ---------------------------------------------------------------------------

export function emptySessionDisabledMap(): SessionDisabledMap {
  return { db: [], kb: [], mcp: [], skill: [] };
}

export function getSessionDisabled(
  session: ChatSession | null | undefined,
): SessionDisabledMap {
  return session?.config?.disabled ?? emptySessionDisabledMap();
}

export function sessionEnabledItems(
  store: WorkspaceConfigStore,
  kind: PerRunMentionKind,
  session: ChatSession | null | undefined,
): WorkspaceConfigItem[] {
  const disabled = new Set(getSessionDisabled(session)[kind]);
  return store[kind].filter((item) => !disabled.has(item.id));
}

export function sessionEnabledIds(
  store: WorkspaceConfigStore,
  kind: PerRunMentionKind,
  session: ChatSession | null | undefined,
): string[] {
  return sessionEnabledItems(store, kind, session).map((item) => item.id);
}

export function toggleSessionResource(
  session: ChatSession,
  kind: PerRunMentionKind,
  id: string,
): ChatSession {
  const disabled = getSessionDisabled(session);
  const current = disabled[kind];
  const nextIds = current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
  return {
    ...session,
    config: {
      disabled: { ...disabled, [kind]: nextIds },
    },
  };
}

export function sessionResourceCounts(
  store: WorkspaceConfigStore,
  kind: PerRunMentionKind,
  session: ChatSession | null | undefined,
): { enabled: number; total: number } {
  const total = store[kind].length;
  const enabled = sessionEnabledItems(store, kind, session).length;
  return { enabled, total };
}

// ---------------------------------------------------------------------------
// Per-run @ mentions — layer-3 override: specify active/mentioned for one run.
// `@` picks from the session-enabled set only; it does not narrow `enabled*Ids`.
// LLM is excluded — it has its own model picker.
// ---------------------------------------------------------------------------

export type PerRunMentionKind = Exclude<WorkspaceConfigKind, "llm">;

export const PER_RUN_MENTION_KINDS: PerRunMentionKind[] = [
  "db",
  "kb",
  "mcp",
  "skill",
];

export type PerRunSelection = Record<PerRunMentionKind, string[]>;

export function emptyPerRunSelection(): PerRunSelection {
  return { db: [], kb: [], mcp: [], skill: [] };
}

export function countPerRunMentions(selection: PerRunSelection): number {
  return PER_RUN_MENTION_KINDS.reduce(
    (total, kind) => total + selection[kind].length,
    0,
  );
}

/**
 * Per-kind metadata for the `@` picker. `backendSupported` reflects whether the
 * selection has a real runtime effect today: only `db` is honored (via
 * `datasource_id` / `forwardedProps`). The rest ride along in `run_config` for
 * forward-compatibility and are surfaced with a 「后端未支持」 hint so the UI never
 * implies an effect the backend can't yet deliver.
 */
export const PER_RUN_MENTION_META: Record<
  PerRunMentionKind,
  { label: string; token: string; backendSupported: boolean }
> = {
  db: { label: "数据源", token: "db", backendSupported: true },
  kb: { label: "知识库", token: "kb", backendSupported: false },
  mcp: { label: "MCP", token: "mcp", backendSupported: false },
  skill: { label: "技能", token: "skill", backendSupported: false },
};

export type MentionSupportMap = Record<PerRunMentionKind, boolean>;

/** Updates `@` picker hints from runtime knowledge/mcp/skills capability flags. */
export function setLiveMentionSupport(support: MentionSupportMap): void {
  for (const kind of PER_RUN_MENTION_KINDS) {
    PER_RUN_MENTION_META[kind].backendSupported = support[kind];
  }
}

/** Shared per-kind palette for sidebar labels and session/@ pills. */
const CONFIG_APPEARANCE = {
  db: {
    badge:
      "bg-sky-200 text-sky-800 ring-1 ring-inset ring-sky-300/80 dark:bg-sky-500/25 dark:text-sky-200 dark:ring-sky-500/40",
    pill: "border-sky-300 bg-sky-100 text-sky-900 hover:border-sky-400 hover:bg-sky-200 dark:border-sky-600 dark:bg-sky-500/20 dark:text-sky-100 dark:hover:bg-sky-500/30",
    pillOpen:
      "border-sky-400 bg-sky-200 text-sky-950 dark:border-sky-500 dark:bg-sky-500/35 dark:text-sky-50",
    chip: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-600 dark:bg-sky-500/20 dark:text-sky-100",
  },
  kb: {
    badge:
      "bg-violet-200 text-violet-800 ring-1 ring-inset ring-violet-300/80 dark:bg-violet-500/25 dark:text-violet-200 dark:ring-violet-500/40",
    pill: "border-violet-300 bg-violet-100 text-violet-900 hover:border-violet-400 hover:bg-violet-200 dark:border-violet-600 dark:bg-violet-500/20 dark:text-violet-100 dark:hover:bg-violet-500/30",
    pillOpen:
      "border-violet-400 bg-violet-200 text-violet-950 dark:border-violet-500 dark:bg-violet-500/35 dark:text-violet-50",
    chip: "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-600 dark:bg-violet-500/20 dark:text-violet-100",
  },
  mcp: {
    badge:
      "bg-emerald-200 text-emerald-800 ring-1 ring-inset ring-emerald-300/80 dark:bg-emerald-500/25 dark:text-emerald-200 dark:ring-emerald-500/40",
    pill: "border-emerald-300 bg-emerald-100 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-200 dark:border-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:bg-emerald-500/30",
    pillOpen:
      "border-emerald-400 bg-emerald-200 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-500/35 dark:text-emerald-50",
    chip: "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-100",
  },
  llm: {
    badge:
      "bg-red-200 text-red-800 ring-1 ring-inset ring-red-300/80 dark:bg-red-500/25 dark:text-red-200 dark:ring-red-500/40",
    pill: "border-red-300 bg-red-100 text-red-900 hover:border-red-400 hover:bg-red-200 dark:border-red-600 dark:bg-red-500/20 dark:text-red-100 dark:hover:bg-red-500/30",
    pillOpen:
      "border-red-400 bg-red-200 text-red-950 dark:border-red-500 dark:bg-red-500/35 dark:text-red-50",
    chip: "border-red-300 bg-red-100 text-red-900 dark:border-red-600 dark:bg-red-500/20 dark:text-red-100",
  },
  skill: {
    badge:
      "bg-amber-200 text-amber-900 ring-1 ring-inset ring-amber-300/80 dark:bg-amber-500/25 dark:text-amber-200 dark:ring-amber-500/40",
    pill: "border-amber-300 bg-amber-100 text-amber-950 hover:border-amber-400 hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30",
    pillOpen:
      "border-amber-400 bg-amber-200 text-amber-950 dark:border-amber-500 dark:bg-amber-500/35 dark:text-amber-50",
    chip: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-600 dark:bg-amber-500/20 dark:text-amber-100",
  },
} as const satisfies Record<
  WorkspaceConfigKind,
  {
    badge: string;
    pill: string;
    pillOpen: string;
    chip: string;
  }
>;

export const WORKSPACE_CONFIG_SHORT_LABEL: Record<WorkspaceConfigKind, string> = {
  db: "DB",
  kb: "KB",
  mcp: "MCP",
  llm: "LLM",
  skill: "SKILL",
};

export const WORKSPACE_CONFIG_BADGE_CLASS: Record<WorkspaceConfigKind, string> =
  {
    db: CONFIG_APPEARANCE.db.badge,
    kb: CONFIG_APPEARANCE.kb.badge,
    mcp: CONFIG_APPEARANCE.mcp.badge,
    llm: CONFIG_APPEARANCE.llm.badge,
    skill: CONFIG_APPEARANCE.skill.badge,
  };

export const PER_RUN_MENTION_APPEARANCE: Record<
  PerRunMentionKind,
  { badge: string; pill: string; pillOpen: string; chip: string }
> = {
  db: CONFIG_APPEARANCE.db,
  kb: CONFIG_APPEARANCE.kb,
  mcp: CONFIG_APPEARANCE.mcp,
  skill: CONFIG_APPEARANCE.skill,
};

export interface MentionResource {
  kind: PerRunMentionKind;
  id: string;
  name: string;
  description: string;
  backendSupported: boolean;
}

export type FileMentionScope = "workspace" | "session";

export interface FileMentionResource {
  id: string;
  fileId: string;
  name: string;
  description: string;
  scope: FileMentionScope;
  path?: string;
  backendSupported: boolean;
}

export interface PerRunFileSelection {
  fileIds: string[];
  pinnedPaths: string[];
}

export type FileAssetRefLike = {
  id: string;
  filename: string;
  source?: string;
  sessionId?: string;
  mimeType?: string;
  sizeBytes?: number;
};

/** Lists session-enabled resources for the `@` picker. */
export function buildMentionResources(
  store: WorkspaceConfigStore,
  session: ChatSession | null | undefined,
): MentionResource[] {
  const resources: MentionResource[] = [];
  for (const kind of PER_RUN_MENTION_KINDS) {
    for (const item of sessionEnabledItems(store, kind, session)) {
      resources.push({
        kind,
        id: item.id,
        name: item.name,
        description: item.description,
        backendSupported: PER_RUN_MENTION_META[kind].backendSupported,
      });
    }
  }
  return resources;
}

export function emptyPerRunFileSelection(): PerRunFileSelection {
  return { fileIds: [], pinnedPaths: [] };
}

export function filterWorkspaceAssetFiles<T extends FileAssetRefLike>(files: T[]): T[] {
  return files.filter((file) =>
    !file.sessionId && (file.source === "upload" || file.source === "workspace"),
  );
}

export function fileMentionFromWorkspaceAsset(file: FileAssetRefLike): FileMentionResource {
  return {
    id: `workspace:${file.id}`,
    fileId: file.id,
    name: file.filename,
    description: [file.mimeType, file.sizeBytes !== undefined ? `${file.sizeBytes} B` : ""]
      .filter(Boolean)
      .join(" · "),
    scope: "workspace",
    backendSupported: true,
  };
}

export function fileMentionFromArtifact(artifact: DataArtifact): FileMentionResource | null {
  if (!artifact.fileId) return null;
  const path = artifact.detail?.type === "file" ? artifact.detail.path : undefined;
  if (!path) return null;
  return {
    id: `session:${artifact.id}`,
    fileId: artifact.fileId,
    name: artifact.title,
    description: artifact.summary,
    scope: "session",
    ...(path ? { path } : {}),
    backendSupported: false,
  };
}

export function togglePerRunFileMention(
  selection: PerRunFileSelection,
  resource: FileMentionResource,
): PerRunFileSelection {
  if (resource.scope === "workspace") {
    const exists = selection.fileIds.includes(resource.fileId);
    return {
      ...selection,
      fileIds: exists
        ? selection.fileIds.filter((id) => id !== resource.fileId)
        : [...selection.fileIds, resource.fileId],
    };
  }

  const pinnedPath = resource.path;
  if (!pinnedPath) return selection;
  const exists = selection.pinnedPaths.includes(pinnedPath);
  return {
    ...selection,
    pinnedPaths: exists
      ? selection.pinnedPaths.filter((path) => path !== pinnedPath)
      : [...selection.pinnedPaths, pinnedPath],
  };
}

export function removePerRunFileMention(
  selection: PerRunFileSelection,
  resource: FileMentionResource,
): PerRunFileSelection {
  if (resource.scope === "workspace") {
    return {
      ...selection,
      fileIds: selection.fileIds.filter((id) => id !== resource.fileId),
    };
  }
  return {
    ...selection,
    pinnedPaths: resource.path
      ? selection.pinnedPaths.filter((path) => path !== resource.path)
      : selection.pinnedPaths,
  };
}

export function countPerRunFileMentions(selection: PerRunFileSelection): number {
  return selection.fileIds.length + selection.pinnedPaths.length;
}

export function togglePerRunMention(
  selection: PerRunSelection,
  kind: PerRunMentionKind,
  id: string,
): PerRunSelection {
  const current = selection[kind];
  const next = current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
  return { ...selection, [kind]: next };
}

export function removePerRunMention(
  selection: PerRunSelection,
  kind: PerRunMentionKind,
  id: string,
): PerRunSelection {
  return { ...selection, [kind]: selection[kind].filter((v) => v !== id) };
}

/** Drops @ mentions for resources no longer session-enabled or removed from workspace. */
export function prunePerRunSelection(
  store: WorkspaceConfigStore,
  session: ChatSession | null | undefined,
  selection: PerRunSelection,
): PerRunSelection {
  const next = emptyPerRunSelection();
  let changed = false;
  for (const kind of PER_RUN_MENTION_KINDS) {
    const available = new Set(sessionEnabledIds(store, kind, session));
    const kept = selection[kind].filter((id) => available.has(id));
    if (kept.length !== selection[kind].length) changed = true;
    next[kind] = kept;
  }
  return changed ? next : selection;
}

export type RunConfigPayload = {
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
  activeDatasourceId: string;
  activeLlmProfileId: string | null;
  activeSkillId: string;
  mentioned: PerRunSelection;
  fileIds: string[];
  pinnedPaths: string[];
};

export interface BuildRunConfigOptions {
  activeLlmId: string | null;
  defaultDatasourceId: string;
  session?: ChatSession | null;
  perRunSelection?: PerRunSelection;
  perRunFiles?: PerRunFileSelection;
  defaultSkillId?: string;
}

function filterMentionedIds(
  ids: readonly string[],
  available: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => available.has(id));
}

/**
 * Builds the forward-compatible `run_config` payload (config-management-api.md
 * §5). Ids / selections only — never credentials.
 *
 * - `enabled*Ids` = session-enabled set (all available this session); `@` does
 *   not narrow these.
 * - `active*` = first `@` mention for that kind, else default.
 * - `mentioned` = this run's `@` picks (subset of session-enabled).
 */
export function buildRunConfig(
  store: WorkspaceConfigStore,
  options: BuildRunConfigOptions,
): RunConfigPayload {
  const selection = options.perRunSelection ?? emptyPerRunSelection();
  const fileSelection = options.perRunFiles ?? emptyPerRunFileSelection();
  const session = options.session;
  const enabledDb = sessionEnabledIds(store, "db", session);
  const enabledKb = sessionEnabledIds(store, "kb", session);
  const enabledMcp = sessionEnabledIds(store, "mcp", session);
  const enabledSkill = sessionEnabledIds(store, "skill", session);
  const enabledDbSet = new Set(enabledDb);
  const enabledKbSet = new Set(enabledKb);
  const enabledMcpSet = new Set(enabledMcp);
  const enabledSkillSet = new Set(enabledSkill);

  const mentioned: PerRunSelection = {
    db: filterMentionedIds(selection.db, enabledDbSet),
    kb: filterMentionedIds(selection.kb, enabledKbSet),
    mcp: filterMentionedIds(selection.mcp, enabledMcpSet),
    skill: filterMentionedIds(selection.skill, enabledSkillSet),
  };

  const activeDatasourceId =
    mentioned.db[0] ??
    (enabledDbSet.has(options.defaultDatasourceId)
      ? options.defaultDatasourceId
      : (enabledDb[0] ?? options.defaultDatasourceId));

  const activeSkillId =
    mentioned.skill[0] ??
    (options.defaultSkillId && enabledSkillSet.has(options.defaultSkillId)
      ? options.defaultSkillId
      : (enabledSkill[0] ?? options.defaultSkillId ?? DEFAULT_SKILL_ID));

  return {
    enabledDatasourceIds: enabledDb,
    enabledKnowledgeIds: enabledKb,
    enabledMcpServerIds: enabledMcp,
    enabledSkillIds: enabledSkill,
    activeDatasourceId,
    activeLlmProfileId: options.activeLlmId,
    activeSkillId,
    mentioned,
    fileIds: uniqueStrings(fileSelection.fileIds),
    pinnedPaths: uniqueStrings(fileSelection.pinnedPaths),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Honors a per-run `@db` mention within the session-enabled db set. */
export function resolveActiveDatasourceId(
  store: WorkspaceConfigStore,
  session: ChatSession | null | undefined,
  selection: PerRunSelection,
  fallback: string,
): string {
  const enabled = sessionEnabledIds(store, "db", session);
  const enabledSet = new Set(enabled);
  const mentioned = selection.db.find((id) => enabledSet.has(id));
  if (mentioned) return mentioned;
  if (enabledSet.has(fallback)) return fallback;
  return enabled[0] ?? fallback;
}
