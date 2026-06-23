import type {
  DataArtifact,
  DataStepKind,
  DataStepPayload,
  SchemaTable,
  TimelineEvent,
  TimelineStep,
} from "./data-task-state";
import { dataStepKindForTool, emptyStepPayload } from "./data-task-state";

export type LiveTaskStatus = "pending" | "running" | "completed" | "failed";

export type LivePlanTask = {
  id: string;
  title: string;
  status: LiveTaskStatus;
};

export type LiveAudit = {
  id: string;
  datasourceId?: string;
  status?: string;
  rowCount?: number;
  elapsedMs?: number;
};

export type LiveRunStatus = "idle" | "running" | "completed" | "failed";

export type LiveToolCallRecord = {
  id: string;
  name: string;
  status: "running" | "success" | "failed";
  /** Linked ACTIVITY STEP step_id when correlated with a backend tool wrapper. */
  stepId?: string;
  /** Raw payload from AG-UI TOOL_CALL_RESULT when CopilotKit thread lacks tool message. */
  result?: string;
  startedAtMs?: number;
  finishedAtMs?: number;
};

export type ToolCallStats = {
  total: number;
  success: number;
  failed: number;
  byTool: Record<string, { calls: number; success: number; failed: number }>;
};

export type SqlUsageStats = {
  total: number;
  success: number;
  failed: number;
  rowsScanned: number;
  elapsedMs: number;
};

export type TokenUsageStats = {
  inputTokens: number;
  outputTokens: number;
};

export type RunUsageSnapshot = {
  runStatus: LiveRunStatus;
  errorMessage?: string;
  durationMs?: number;
  toolCalls: ToolCallStats;
  sql: SqlUsageStats;
  artifactCount: number;
  tokens: TokenUsageStats;
  tokenUsageReported: boolean;
};

export type SessionUsageStats = {
  runCount: number;
  completedRuns: number;
  failedRuns: number;
  toolCalls: ToolCallStats;
  sql: SqlUsageStats;
  artifactCount: number;
  tokens: TokenUsageStats;
  tokenUsageReported: boolean;
};

export type LiveRun = {
  plan: LivePlanTask[];
  events: TimelineEvent[];
  artifacts: DataArtifact[];
  audits: LiveAudit[];
  runStatus: LiveRunStatus;
  errorMessage?: string;
  toolCalls: LiveToolCallRecord[];
  runStartedAt?: number;
  runFinishedAt?: number;
  tokenUsage?: TokenUsageStats;
};

type AgUiLikeEvent = {
  type?: string;
  [key: string]: unknown;
};

const defaultPlan: LivePlanTask[] = [
  { id: "schema", title: "检查数据源 schema", status: "pending" },
  { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
  { id: "final", title: "生成最终回答", status: "pending" },
];

export function createInitialLiveRun(): LiveRun {
  return {
    plan: defaultPlan,
    events: [],
    artifacts: [],
    audits: [],
    runStatus: "idle",
    toolCalls: [],
  };
}

export function createInitialSessionUsage(): SessionUsageStats {
  return {
    runCount: 0,
    completedRuns: 0,
    failedRuns: 0,
    toolCalls: emptyToolCallStats(),
    sql: emptySqlUsageStats(),
    artifactCount: 0,
    tokens: emptyTokenUsageStats(),
    tokenUsageReported: false,
  };
}

function tokenUsageFromRun(liveRun: LiveRun): {
  tokens: TokenUsageStats;
  tokenUsageReported: boolean;
} {
  const tokens = liveRun.tokenUsage ?? emptyTokenUsageStats();
  const tokenUsageReported =
    tokens.inputTokens > 0 ||
    tokens.outputTokens > 0;
  return { tokens, tokenUsageReported };
}

export function deriveRunUsage(liveRun: LiveRun): RunUsageSnapshot {
  const durationMs =
    liveRun.runStartedAt !== undefined && liveRun.runFinishedAt !== undefined
      ? Math.max(0, liveRun.runFinishedAt - liveRun.runStartedAt)
      : liveRun.runStartedAt !== undefined && liveRun.runStatus === "running"
        ? Math.max(0, Date.now() - liveRun.runStartedAt)
        : undefined;

  const { tokens, tokenUsageReported } = tokenUsageFromRun(liveRun);

  return {
    runStatus: liveRun.runStatus,
    errorMessage: liveRun.errorMessage,
    durationMs,
    toolCalls: toolCallsToStats(liveRun.toolCalls),
    sql: sqlAuditsToStats(liveRun.audits),
    artifactCount: liveRun.artifacts.length,
    tokens,
    tokenUsageReported,
  };
}

export function accumulateSessionUsage(
  session: SessionUsageStats,
  run: RunUsageSnapshot,
  runOutcome: "completed" | "failed",
): SessionUsageStats {
  return {
    runCount: session.runCount + 1,
    completedRuns: session.completedRuns + (runOutcome === "completed" ? 1 : 0),
    failedRuns: session.failedRuns + (runOutcome === "failed" ? 1 : 0),
    toolCalls: mergeToolCallStats(session.toolCalls, run.toolCalls),
    sql: mergeSqlUsageStats(session.sql, run.sql),
    artifactCount: session.artifactCount + run.artifactCount,
    tokens: mergeTokenUsageStats(session.tokens, run.tokens),
    tokenUsageReported: session.tokenUsageReported || run.tokenUsageReported,
  };
}

/** Session totals for overview; merges in-progress run without double-counting completed runs. */
export function deriveLiveSessionView(
  session: SessionUsageStats,
  liveRun: LiveRun,
): SessionUsageStats & { includesInProgressRun: boolean } {
  if (liveRun.runStatus !== "running") {
    return { ...session, includesInProgressRun: false };
  }

  const run = deriveRunUsage(liveRun);
  return {
    runCount: session.runCount + 1,
    completedRuns: session.completedRuns,
    failedRuns: session.failedRuns,
    toolCalls: mergeToolCallStats(session.toolCalls, run.toolCalls),
    sql: mergeSqlUsageStats(session.sql, run.sql),
    artifactCount: session.artifactCount + run.artifactCount,
    tokens: mergeTokenUsageStats(session.tokens, run.tokens),
    tokenUsageReported: session.tokenUsageReported || run.tokenUsageReported,
    includesInProgressRun: true,
  };
}

export function reduceLiveRunEvent(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        ...createInitialLiveRun(),
        runStatus: "running",
        runStartedAt: Date.now(),
      };
    case "RUN_FINISHED":
      return {
        ...state,
        runStatus: "completed",
        runFinishedAt: Date.now(),
        plan: state.plan.map((task) =>
          task.status === "running" || task.id === "final"
            ? { ...task, status: "completed" }
            : task,
        ),
        toolCalls: finalizeRunningToolCalls(state.toolCalls, "success"),
      };
    case "RUN_ERROR":
      return {
        ...state,
        runStatus: "failed",
        runFinishedAt: Date.now(),
        errorMessage: stringValue(event.message) ?? "Agent 运行失败",
        toolCalls: finalizeRunningToolCalls(state.toolCalls, "failed"),
      };
    case "STATE_SNAPSHOT":
      return reduceStateSnapshot(state, event);
    case "STATE_DELTA":
      return reduceStateDelta(state, event);
    case "ACTIVITY_SNAPSHOT":
      return reduceActivitySnapshot(state, event);
    case "ACTIVITY_DELTA":
      return reduceActivityDelta(state, event);
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
    case "TOOL_CALL_RESULT":
      return reduceToolEvent(state, event);
    case "CUSTOM":
      return reduceCustomEvent(state, event);
    default:
      return state;
  }
}

export function planTasksToTimelineSteps(tasks: LivePlanTask[]): TimelineStep[] {
  return tasks.map((task) => ({
    id: task.id,
    label: task.title,
    linkedEventId: task.id,
  }));
}

function reduceStateSnapshot(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  const snapshot = recordValue(event.snapshot);
  const status = liveStatusFromValue(snapshot?.runStatus);
  return status ? { ...state, runStatus: status } : state;
}

function reduceStateDelta(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  const patch = patchArray(event.delta);
  if (!patch.length) return state;

  let next = state;
  for (const op of patch) {
    if (op.path === "/runStatus") {
      const status = liveStatusFromValue(op.value);
      if (status) next = { ...next, runStatus: status };
    }
    if (op.path === "/errorMessage") {
      const errorMessage = stringValue(op.value);
      if (errorMessage) next = { ...next, errorMessage };
    }
  }
  return next;
}

function reduceActivitySnapshot(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  if (event.activityType === "PLAN") {
    const content = recordValue(event.content);
    const tasks = arrayValue(content?.tasks)
      .map(parsePlanTask)
      .filter((task): task is LivePlanTask => Boolean(task));
    return tasks.length ? { ...state, plan: tasks } : state;
  }

  if (event.activityType === "STEP") {
    const content = recordValue(event.content);
    if (!content) return state;

    const stepId = stringValue(content.step_id);
    const title = stringValue(content.title) ?? stringValue(content.tool_name) ?? "执行工具";
    const toolName = stringValue(content.tool_name);
    const kind = dataStepKindForTool(toolName);
    const activityStatus = activityStatusFromValue(content.status);
    const fallbackId =
      stepId ?? stringValue(event.messageId) ?? `step-${state.events.length + 1}`;

    const toolCall = findCorrelatedToolCall(state.toolCalls, toolName, stepId) ??
      findMisnamedToolCall(state.toolCalls, toolName);
    const eventId = toolCall?.id ?? fallbackId;

    let nextState = state;

    if (toolCall && toolName && toolCall.name !== toolName) {
      nextState = upsertToolCallRecord(nextState, { ...toolCall, name: toolName });
    }

    if (toolCall && stepId) {
      const toolUpdate: LiveToolCallRecord = { ...toolCall, stepId };
      if (activityStatus === "failed" && toolCall.status === "running") {
        const errorMessage = stringValue(content.error_message) ?? "Tool execution failed";
        toolUpdate.status = "failed";
        toolUpdate.finishedAtMs = Date.now();
        if (!toolCall.result) {
          toolUpdate.result = JSON.stringify({ error: errorMessage });
        }
      }
      nextState = upsertToolCallRecord(nextState, toolUpdate);
    }

    if (toolCall && stepId && stepId !== toolCall.id) {
      nextState = {
        ...nextState,
        events: nextState.events.filter((item) => item.id !== stepId),
      };
    }

    const existing = nextState.events.find((item) => item.id === eventId);

    return upsertTimelineEvent(nextState, {
      id: eventId,
      kind,
      toolName,
      title,
      summary: statusSummary(content.status),
      thought: thoughtForActivityStatus(activityStatus, kind),
      stepId,
      activityStatus,
      payload: mergeActivityPayload(kind, content, existing),
      ...(existing?.artifactIds ? { artifactIds: existing.artifactIds } : {}),
    });
  }

  return state;
}

function reduceActivityDelta(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  if (event.activityType !== "PLAN") return state;
  const patch = patchArray(event.patch);
  if (!patch.length) return state;
  return { ...state, plan: applyPlanPatch(state.plan, patch) };
}

function reduceToolEvent(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  const id = stringValue(event.toolCallId) ?? `${state.events.length + 1}`;
  const existing = state.toolCalls.find((item) => item.id === id);
  const existingEvent = state.events.find((item) => item.id === id);
  const toolName = resolveIncomingToolName(event, existing, existingEvent);
  const eventType = stringValue(event.type);

  let nextState = state;
  const resultPayload =
    stringValue(event.result) ?? stringValue(event.content) ?? "";
  if (eventType === "TOOL_CALL_START") {
    nextState = upsertToolCallRecord(nextState, {
      id,
      name: toolName,
      status: "running",
      startedAtMs: Date.now(),
    });
  } else if (eventType === "TOOL_CALL_END") {
    nextState = upsertToolCallRecord(nextState, {
      id,
      name: toolName,
      status: existing?.status === "failed" ? "failed" : "running",
      startedAtMs: existing?.startedAtMs ?? Date.now(),
    });
  } else if (eventType === "TOOL_CALL_RESULT") {
    const parsed = parseResultObject(resultPayload);
    const failed = toolResultPayloadLooksFailed(parsed);
    nextState = upsertToolCallRecord(nextState, {
      id,
      name: toolName,
      status: failed ? "failed" : "success",
      startedAtMs: existing?.startedAtMs ?? Date.now(),
      finishedAtMs: Date.now(),
      ...(resultPayload ? { result: resultPayload } : {}),
    });
  }

  const kind =
    dataStepKindForTool(toolName) !== "other"
      ? dataStepKindForTool(toolName)
      : existingEvent?.kind ?? dataStepKindForTool(toolName);
  const effectiveToolName =
    toolName !== "tool" && toolName !== "unknown"
      ? toolName
      : (existingEvent?.toolName ?? toolName);
  const title =
    effectiveToolName === "run_sql_readonly"
      ? "生成并执行 SQL"
      : effectiveToolName === "inspect_schema"
        ? "检查数据源 Schema"
        : effectiveToolName;
  const args = recordValue(event.args) ?? recordValue(event.parameters);
  const sql = stringValue(args?.sql) ?? stringValue(event.delta) ?? "";
  const result = resultPayload;

  if (kind === "query") {
    const existing = nextState.events.find((item) => item.id === id);
    const parsed = parseResultObject(result);
    const rowCount = numberValue(parsed?.row_count) ?? latestAudit(state)?.rowCount ?? 0;
    const elapsedMs = numberValue(parsed?.elapsed_ms) ?? latestAudit(state)?.elapsedMs ?? 0;
    return upsertTimelineEvent(nextState, {
      id,
      kind,
      toolName: effectiveToolName,
      title,
      summary: summarizeSqlResult(result, parsed, event.type),
      thought: "Agent 将自然语言问题转换成只读 SQL，并通过后端 Data Gateway 执行。",
      payload: {
        question: "",
        sql: sql || extractSql(existing),
        scannedRows: rowCount,
        durationMs: elapsedMs,
      },
      ...(existingEvent?.artifactIds ? { artifactIds: existingEvent.artifactIds } : {}),
      ...(existingEvent?.stepId ? { stepId: existingEvent.stepId } : {}),
      ...(existingEvent?.activityStatus ? { activityStatus: existingEvent.activityStatus } : {}),
    });
  }

  if (kind === "inspect") {
    const parsedSchema = parseResultObject(result);
    const tables = parseSchemaTables(parsedSchema);
    return upsertTimelineEvent(nextState, {
      id,
      kind,
      toolName: effectiveToolName,
      title,
      summary: summarizeSchemaResult(result, tables, event.type),
      thought: "Agent 先确认数据源结构，避免在不可靠字段上直接下结论。",
      payload: { tables },
      ...(existingEvent?.artifactIds ? { artifactIds: existingEvent.artifactIds } : {}),
      ...(existingEvent?.stepId ? { stepId: existingEvent.stepId } : {}),
      ...(existingEvent?.activityStatus ? { activityStatus: existingEvent.activityStatus } : {}),
    });
  }

  return upsertTimelineEvent(nextState, {
    id,
    kind,
    toolName: effectiveToolName,
    title,
    summary: summarizeGenericResult(result, event.type),
    thought: "Agent 正在执行一次数据操作。",
    payload: { description: result || "", rawResult: result || undefined },
    ...(existingEvent?.artifactIds ? { artifactIds: existingEvent.artifactIds } : {}),
    ...(existingEvent?.stepId ? { stepId: existingEvent.stepId } : {}),
    ...(existingEvent?.activityStatus ? { activityStatus: existingEvent.activityStatus } : {}),
  });
}

function summarizeGenericResult(result: string, eventType?: string): string {
  if (result) return result.length > 160 ? `${result.slice(0, 160)}…` : result;
  if (eventType === "TOOL_CALL_RESULT" || eventType === "TOOL_CALL_END") {
    return "数据操作已完成。";
  }
  return "正在执行数据操作。";
}

function parseResultObject(result: string): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return recordValue(parsed);
  } catch {
    return null;
  }
}

function toolResultPayloadLooksFailed(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  if (parsed.status === "error") return true;
  return parsed.error !== undefined;
}

function summarizeSqlResult(
  result: string,
  parsed: Record<string, unknown> | null,
  eventType?: string,
): string {
  const rowCount = numberValue(parsed?.row_count);
  if (rowCount !== undefined) return `已执行，返回 ${rowCount} 行。`;
  // Non-JSON results are usually human-readable text (or an error); keep them.
  if (result && !parsed) return result;
  if (eventType === "TOOL_CALL_RESULT") return "SQL 已执行。";
  return "正在准备只读 SQL 查询。";
}

function summarizeSchemaResult(
  result: string,
  tables: SchemaTable[],
  eventType?: string,
): string {
  if (tables.length > 0) return `已检查 ${tables.length} 张表。`;
  if (result && !parseResultObject(result)) return result;
  if (eventType === "TOOL_CALL_RESULT") return "已检查数据源 schema。";
  return "正在调用后端数据工具。";
}

function parseSchemaTables(parsed: Record<string, unknown> | null): SchemaTable[] {
  const rawTables = arrayValue(parsed?.tables);
  const tables: SchemaTable[] = [];
  for (const rawTable of rawTables) {
    const table = recordValue(rawTable);
    const name = stringValue(table?.name);
    if (!name) continue;
    const fields = arrayValue(table?.columns)
      .map((rawColumn) => {
        const column = recordValue(rawColumn);
        const columnName = stringValue(column?.name);
        if (!columnName) return undefined;
        const type = stringValue(column?.type);
        return type ? `${columnName} · ${type}` : columnName;
      })
      .filter((field): field is string => Boolean(field));
    tables.push({ name, description: "", fields });
  }
  return tables;
}

function reduceCustomEvent(state: LiveRun, event: AgUiLikeEvent): LiveRun {
  if (event.name === "sql_audit") {
    const value = recordValue(event.value);
    const audit: LiveAudit = {
      id: stringValue(value?.audit_log_id) ?? `audit-${state.audits.length + 1}`,
      datasourceId: stringValue(value?.datasource_id),
      status: stringValue(value?.status),
      rowCount: numberValue(value?.row_count),
      elapsedMs: numberValue(value?.elapsed_ms),
    };
    return { ...state, audits: [audit, ...state.audits] };
  }

  if (event.name === "artifact") {
    const value = recordValue(event.value);
    if (!value) return state;

    const artifact = parseArtifactFromCustom(value);
    const sqlTool = findSqlToolForArtifact(state);
    let nextState: LiveRun = {
      ...state,
      artifacts: [
        artifact,
        ...state.artifacts.filter((item) => item.id !== artifact.id),
      ],
    };
    if (sqlTool) {
      nextState = linkArtifactToToolCall(nextState, artifact.id, sqlTool.id);
    }
    return nextState;
  }

  if (event.name === "token_usage") {
    const value = recordValue(event.value);
    const delta: TokenUsageStats = {
      inputTokens:
        numberValue(value?.input_tokens) ??
        numberValue(value?.prompt_tokens) ??
        0,
      outputTokens:
        numberValue(value?.output_tokens) ??
        numberValue(value?.completion_tokens) ??
        0,
    };
    return {
      ...state,
      tokenUsage: mergeTokenUsageStats(state.tokenUsage ?? emptyTokenUsageStats(), delta),
    };
  }

  return state;
}

function parseTablePreview(
  preview: unknown,
): { columns: string[]; rows: string[][] } | null {
  const record = recordValue(preview);
  if (!record) return null;

  const columns = arrayValue(record.columns)
    .map((column) => (typeof column === "string" ? column : undefined))
    .filter((column): column is string => Boolean(column));
  const rawRows = arrayValue(record.rows);
  if (columns.length === 0 || rawRows.length === 0) return null;

  const rows = rawRows
    .map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) =>
          cell === null || cell === undefined ? "" : String(cell),
        );
      }
      const objectRow = recordValue(row);
      if (!objectRow) return [];
      return columns.map((column) => {
        const value = objectRow[column];
        return value === null || value === undefined ? "" : String(value);
      });
    })
    .filter((row) => row.length > 0);

  if (rows.length === 0) return null;
  return { columns, rows };
}

function parseArtifactFromCustom(value: Record<string, unknown>): DataArtifact {
  const id =
    stringValue(value.id) ??
    stringValue(value.artifact_id) ??
    `artifact-${Date.now()}`;
  const title =
    stringValue(value.title) ?? stringValue(value.name) ?? "Agent 产出物";
  const backendType = stringValue(value.type);
  const preview = value.preview_json;
  const previewRecord = recordValue(preview);
  const rowCount = numberValue(previewRecord?.row_count);

  let type: DataArtifact["type"];
  let kind: DataArtifact["kind"] = "memo";
  let detail: DataArtifact["detail"];
  let summary = stringValue(value.summary) ?? stringValue(value.description);

  const tablePreview = parseTablePreview(preview);
  if (backendType === "table" || tablePreview) {
    type = "dataset";
    kind = "csv";
    if (tablePreview) {
      detail = {
        type: "dataset",
        columns: tablePreview.columns,
        rows: tablePreview.rows,
      };
      summary =
        summary ??
        `${tablePreview.rows.length.toLocaleString()} 行 × ${tablePreview.columns.length} 列`;
    } else if (rowCount !== undefined) {
      summary = summary ?? `数据集，${rowCount.toLocaleString()} 行`;
    }
  } else if (backendType === "chart") {
    type = "chart";
    kind = "chart";
    summary = summary ?? "图表产出";
  } else if (backendType === "markdown" || backendType === "html") {
    type = "report";
    kind = "memo";
    summary = summary ?? `${backendType} 报告`;
  }

  return {
    id,
    title,
    kind,
    type,
    summary: summary ?? "后端通过 AG-UI artifact 事件返回的产出物。",
    version: stringValue(value.version) ?? "v1",
    detail,
    recordedAtMs: Date.now(),
  };
}

function findSqlToolForArtifact(state: LiveRun): LiveToolCallRecord | undefined {
  const isSqlToolCall = (tool: LiveToolCallRecord): boolean =>
    tool.name === "run_sql_readonly" ||
    state.events.some((event) => event.id === tool.id && event.kind === "query");

  for (let index = state.toolCalls.length - 1; index >= 0; index -= 1) {
    const tool = state.toolCalls[index];
    if (!isSqlToolCall(tool)) continue;
    const event = state.events.find((item) => item.id === tool.id);
    if (!event?.artifactIds?.length) return tool;
  }
  return state.toolCalls.filter(isSqlToolCall).at(-1);
}

function linkArtifactToToolCall(
  state: LiveRun,
  artifactId: string,
  toolCallId: string,
): LiveRun {
  const events = state.events.map((event) =>
    event.id === toolCallId
      ? {
          ...event,
          artifactIds: [...(event.artifactIds ?? []), artifactId].filter(
            (id, index, array) => array.indexOf(id) === index,
          ),
        }
      : event,
  );
  const artifacts = state.artifacts.map((artifact) =>
    artifact.id === artifactId
      ? { ...artifact, createdByEventId: toolCallId }
      : artifact,
  );
  return { ...state, events, artifacts };
}

function upsertTimelineEvent(
  state: LiveRun,
  event: Omit<TimelineEvent, "ts">,
): LiveRun {
  const existingIndex = state.events.findIndex((item) => item.id === event.id);
  if (existingIndex === -1) {
    return { ...state, events: [...state.events, { ...event, ts: currentTime() }] };
  }
  const events = [...state.events];
  events[existingIndex] = {
    ...events[existingIndex],
    ...event,
    ts: events[existingIndex].ts,
  };
  return { ...state, events };
}

function applyPlanPatch(tasks: LivePlanTask[], patch: PlanPatch[]): LivePlanTask[] {
  const next = tasks.map((task) => ({ ...task }));
  for (const op of patch) {
    const match = op.path.match(/^\/tasks\/(\d+)\/status$/);
    if (!match) continue;
    const index = Number(match[1]);
    const status = planStatusFromValue(op.value);
    if (!Number.isInteger(index) || !next[index] || !status) continue;
    next[index] = { ...next[index], status };
  }
  return next;
}

type PlanPatch = { op?: string; path: string; value?: unknown };

function patchArray(value: unknown): PlanPatch[] {
  return arrayValue(value).filter(
    (item): item is PlanPatch =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { path?: unknown }).path === "string",
  );
}

function parsePlanTask(value: unknown): LivePlanTask | null {
  const record = recordValue(value);
  const id = stringValue(record?.id);
  const title = stringValue(record?.title);
  const status = planStatusFromValue(record?.status);
  return id && title && status ? { id, title, status } : null;
}

function planStatusFromValue(value: unknown): LiveTaskStatus | null {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed") {
    return value;
  }
  return null;
}

function liveStatusFromValue(value: unknown): LiveRunStatus | null {
  if (value === "running" || value === "completed" || value === "failed") return value;
  return null;
}

function statusSummary(value: unknown): string {
  const status = stringValue(value);
  if (status === "running") return "正在执行。";
  if (status === "completed") return "已完成。";
  if (status === "failed") return "执行失败。";
  return "等待执行。";
}

export function resolveIncomingToolName(
  event: AgUiLikeEvent,
  existing?: LiveToolCallRecord,
  existingEvent?: TimelineEvent,
): string {
  const fromEvent =
    stringValue(event.toolCallName) ??
    stringValue(event.toolName) ??
    stringValue(event.name);
  if (fromEvent && fromEvent !== "tool" && fromEvent !== "unknown") {
    return fromEvent;
  }
  if (existing?.name && existing.name !== "tool" && existing.name !== "unknown") {
    return existing.name;
  }
  if (
    existingEvent?.toolName &&
    existingEvent.toolName !== "tool" &&
    existingEvent.toolName !== "unknown"
  ) {
    return existingEvent.toolName;
  }
  return fromEvent ?? existing?.name ?? existingEvent?.toolName ?? "tool";
}

function findMisnamedToolCall(
  toolCalls: LiveToolCallRecord[],
  toolName: string | undefined,
): LiveToolCallRecord | undefined {
  if (!toolName) return undefined;
  const candidates = toolCalls.filter(
    (call) =>
      !call.stepId &&
      (call.name === "tool" || call.name === "unknown") &&
      (call.status === "running" || call.status === "success"),
  );
  if (candidates.length === 1) return candidates[0];
  return candidates.find((call) => call.status === "running") ?? candidates.at(-1);
}

export function resolveProducedArtifacts(
  liveRun: LiveRun,
  event: TimelineEvent | null,
  artifacts: DataArtifact[],
): DataArtifact[] {
  if (!event) return [];

  const toolCall = resolveToolCallForEvent(liveRun, event);
  const linkedEventIds = new Set<string>([event.id]);
  if (toolCall) linkedEventIds.add(toolCall.id);
  if (event.stepId) {
    for (const timelineEvent of liveRun.events) {
      if (timelineEvent.stepId === event.stepId) linkedEventIds.add(timelineEvent.id);
    }
  }
  if (toolCall?.stepId) {
    for (const timelineEvent of liveRun.events) {
      if (timelineEvent.stepId === toolCall.stepId) linkedEventIds.add(timelineEvent.id);
    }
  }

  const artifactIds = new Set<string>();
  for (const eventId of linkedEventIds) {
    const timelineEvent = liveRun.events.find((item) => item.id === eventId);
    timelineEvent?.artifactIds?.forEach((id) => artifactIds.add(id));
  }
  for (const artifact of artifacts) {
    if (artifact.createdByEventId && linkedEventIds.has(artifact.createdByEventId)) {
      artifactIds.add(artifact.id);
    }
  }

  return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export function findCorrelatedToolCall(
  toolCalls: LiveToolCallRecord[],
  toolName: string | undefined,
  stepId: string | undefined,
): LiveToolCallRecord | undefined {
  if (!toolName) return undefined;
  const sameName = toolCalls.filter((call) => call.name === toolName);
  if (stepId) {
    const byStep = sameName.find((call) => call.stepId === stepId);
    if (byStep) return byStep;
  }
  const runningUnlinked = sameName.find((call) => call.status === "running" && !call.stepId);
  if (runningUnlinked) return runningUnlinked;
  const unlinked = sameName.find((call) => !call.stepId);
  if (unlinked) return unlinked;
  return sameName.at(-1);
}

export function resolveToolCallForEvent(
  liveRun: LiveRun,
  event: TimelineEvent | null | undefined,
): LiveToolCallRecord | undefined {
  if (!event) return undefined;
  const direct = liveRun.toolCalls.find((call) => call.id === event.id);
  if (direct) return direct;
  if (event.stepId) {
    const byStep = liveRun.toolCalls.find((call) => call.stepId === event.stepId);
    if (byStep) return byStep;
  }
  return findCorrelatedToolCall(liveRun.toolCalls, event.toolName, event.stepId);
}

export function resolveTraceToolStatus(
  toolStatus: LiveToolCallRecord["status"],
  activityStatus?: TimelineEvent["activityStatus"],
): LiveToolCallRecord["status"] {
  if (activityStatus === "failed" || toolStatus === "failed") return "failed";
  if (activityStatus === "completed" && toolStatus === "running") return "success";
  return toolStatus;
}

function activityStatusFromValue(value: unknown): TimelineEvent["activityStatus"] | undefined {
  const status = stringValue(value);
  if (status === "running" || status === "completed" || status === "failed") {
    return status;
  }
  return undefined;
}

function thoughtForActivityStatus(
  status: TimelineEvent["activityStatus"] | undefined,
  kind: DataStepKind,
): string {
  if (status === "failed") {
    return kind === "query"
      ? "只读 SQL 执行未成功，Agent 将根据错误信息调整策略。"
      : "数据工具步骤未成功完成。";
  }
  if (status === "completed") {
    return kind === "query"
      ? "Agent 已通过后端 Data Gateway 完成只读 SQL 查询。"
      : "Agent 已通过后端数据工具完成当前步骤。";
  }
  return kind === "query"
    ? "Agent 将自然语言问题转换成只读 SQL，并通过后端 Data Gateway 执行。"
    : "Agent 正在通过后端数据工具推进当前分析。";
}

function mergeActivityPayload(
  kind: DataStepKind,
  content: Record<string, unknown>,
  existing?: TimelineEvent,
): DataStepPayload {
  const base = existing?.payload ?? emptyStepPayload(kind);

  if (kind === "query") {
    const payload = base as {
      question: string;
      sql: string;
      scannedRows: number;
      durationMs: number;
      errorMessage?: string;
    };
    const sql = stringValue(content.sql) ?? payload.sql;
    const output = recordValue(content.content);
    const scannedRows = numberValue(output?.row_count) ?? payload.scannedRows;
    const durationMs = numberValue(output?.elapsed_ms) ?? payload.durationMs;
    const errorMessage = stringValue(content.error_message) ?? payload.errorMessage;
    return { ...payload, sql, scannedRows, durationMs, errorMessage };
  }

  if (kind === "inspect") {
    const output = recordValue(content.content);
    const tables = output ? parseSchemaTables(output) : [];
    if (tables.length > 0) {
      return { tables };
    }
    return base;
  }

  const errorMessage = stringValue(content.error_message);
  if (errorMessage) {
    return { description: errorMessage, rawResult: errorMessage };
  }

  return base;
}

function latestAudit(state: LiveRun): LiveAudit | undefined {
  return state.audits[0];
}

function extractSql(event?: TimelineEvent): string {
  if (!event || event.kind !== "query") return "";
  const payload = event.payload as { sql?: string };
  return payload.sql ?? "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function currentTime(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function emptyToolCallStats(): ToolCallStats {
  return { total: 0, success: 0, failed: 0, byTool: {} };
}

function emptySqlUsageStats(): SqlUsageStats {
  return { total: 0, success: 0, failed: 0, rowsScanned: 0, elapsedMs: 0 };
}

function emptyTokenUsageStats(): TokenUsageStats {
  return { inputTokens: 0, outputTokens: 0 };
}

function mergeTokenUsageStats(
  left: TokenUsageStats,
  right: TokenUsageStats,
): TokenUsageStats {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function upsertToolCallRecord(
  state: LiveRun,
  record: LiveToolCallRecord,
): LiveRun {
  const existingIndex = state.toolCalls.findIndex((item) => item.id === record.id);
  if (existingIndex === -1) {
    return { ...state, toolCalls: [...state.toolCalls, record] };
  }
  const toolCalls = [...state.toolCalls];
  toolCalls[existingIndex] = { ...toolCalls[existingIndex], ...record };
  return { ...state, toolCalls };
}

function finalizeRunningToolCalls(
  toolCalls: LiveToolCallRecord[],
  finalStatus: "success" | "failed",
): LiveToolCallRecord[] {
  return toolCalls.map((call) =>
    call.status === "running" ? { ...call, status: finalStatus } : call,
  );
}

function toolCallsToStats(toolCalls: LiveToolCallRecord[]): ToolCallStats {
  const stats = emptyToolCallStats();
  for (const call of toolCalls) {
    stats.total += 1;
    if (call.status === "success") stats.success += 1;
    if (call.status === "failed") stats.failed += 1;
    if (call.status === "running") stats.success += 0;

    const bucket = stats.byTool[call.name] ?? { calls: 0, success: 0, failed: 0 };
    bucket.calls += 1;
    if (call.status === "success") bucket.success += 1;
    if (call.status === "failed") bucket.failed += 1;
    stats.byTool[call.name] = bucket;
  }
  return stats;
}

function mergeToolCallStats(left: ToolCallStats, right: ToolCallStats): ToolCallStats {
  const byTool = { ...left.byTool };
  for (const [name, bucket] of Object.entries(right.byTool)) {
    const existing = byTool[name] ?? { calls: 0, success: 0, failed: 0 };
    byTool[name] = {
      calls: existing.calls + bucket.calls,
      success: existing.success + bucket.success,
      failed: existing.failed + bucket.failed,
    };
  }
  return {
    total: left.total + right.total,
    success: left.success + right.success,
    failed: left.failed + right.failed,
    byTool,
  };
}

function isSqlAuditFailure(status?: string): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized !== "success" && normalized !== "succeeded";
}

function sqlAuditsToStats(audits: LiveAudit[]): SqlUsageStats {
  const stats = emptySqlUsageStats();
  for (const audit of audits) {
    stats.total += 1;
    if (isSqlAuditFailure(audit.status)) stats.failed += 1;
    else stats.success += 1;
    stats.rowsScanned += audit.rowCount ?? 0;
    stats.elapsedMs += audit.elapsedMs ?? 0;
  }
  return stats;
}

function mergeSqlUsageStats(left: SqlUsageStats, right: SqlUsageStats): SqlUsageStats {
  return {
    total: left.total + right.total,
    success: left.success + right.success,
    failed: left.failed + right.failed,
    rowsScanned: left.rowsScanned + right.rowsScanned,
    elapsedMs: left.elapsedMs + right.elapsedMs,
  };
}
