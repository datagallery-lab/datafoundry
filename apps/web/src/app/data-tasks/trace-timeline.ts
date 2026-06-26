import type {
  ArtifactDetail,
  DataArtifact,
  GenericStepPayload,
  SchemaTable,
  TimelineEvent,
} from "./data-task-state";
import { dataStepKindForTool, dataStepLabel } from "./data-task-state";
import type { LiveAudit, LiveRun, LiveToolCallRecord } from "./live-run-state";
import { deriveRunUsage, resolveTraceToolStatus } from "./live-run-state";

export type TraceEntryKind =
  | "run_started"
  | "run_finished"
  | "run_suspended"
  | "run_failed"
  | "tool"
  | "artifact";

export type TraceEntry = {
  id: string;
  kind: TraceEntryKind;
  ts?: string;
  tsMs?: number;
  title: string;
  summary: string;
  toolName?: string;
  toolStatus?: LiveToolCallRecord["status"];
  toolCallId?: string;
  eventId?: string;
  artifactIds?: string[];
  artifactDetail?: ArtifactDetail;
  sql?: string;
  scannedRows?: number;
  durationMs?: number;
  auditStatus?: string;
  datasourceId?: string;
  rawResult?: string;
  schemaTables?: SchemaTable[];
  errorMessage?: string;
};

export function formatTraceTime(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function toolTitle(name: string): string {
  switch (name) {
    case "inspect_schema":
      return "检查数据源 Schema";
    case "run_sql_readonly":
      return "生成并执行 SQL";
    default:
      return name;
  }
}

function toolKindLabel(name: string): string {
  switch (name) {
    case "inspect_schema":
      return "Tool · Schema";
    case "run_sql_readonly":
      return "Tool · SQL";
    default:
      return `Tool · ${dataStepLabel(dataStepKindForTool(name))}`;
  }
}

function activityStatusToToolStatus(
  activityStatus?: TimelineEvent["activityStatus"],
): LiveToolCallRecord["status"] | undefined {
  if (activityStatus === "failed") return "failed";
  if (activityStatus === "completed") return "success";
  if (activityStatus === "running") return "running";
  return undefined;
}

function toolStatusLabel(status: LiveToolCallRecord["status"]): string {
  switch (status) {
    case "running":
      return "执行中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function auditStatusLabel(status?: string): string {
  if (!status) return "—";
  switch (status.toLowerCase()) {
    case "success":
    case "succeeded":
      return "成功";
    case "error":
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function parseResultObject(result?: string): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseSchemaTables(parsed: Record<string, unknown> | null): SchemaTable[] {
  const rawTables = parsed?.tables;
  if (!Array.isArray(rawTables)) return [];
  const tables: SchemaTable[] = [];
  for (const rawTable of rawTables) {
    if (typeof rawTable !== "object" || rawTable === null) continue;
    const table = rawTable as Record<string, unknown>;
    const name = typeof table.name === "string" ? table.name : undefined;
    if (!name) continue;
    const fields = Array.isArray(table.columns)
      ? table.columns
          .map((rawColumn) => {
            if (typeof rawColumn !== "object" || rawColumn === null) return undefined;
            const column = rawColumn as Record<string, unknown>;
            const columnName = typeof column.name === "string" ? column.name : undefined;
            if (!columnName) return undefined;
            const type = typeof column.type === "string" ? column.type : undefined;
            return type ? `${columnName} · ${type}` : columnName;
          })
          .filter((field): field is string => Boolean(field))
      : [];
    tables.push({
      name,
      description: typeof table.description === "string" ? table.description : "",
      fields,
    });
  }
  return tables;
}

function pickAuditForSql(
  audits: LiveAudit[],
  usedAuditIds: Set<string>,
  scannedRows?: number,
): LiveAudit | undefined {
  if (scannedRows !== undefined && scannedRows > 0) {
    const matched = audits.find(
      (audit) =>
        !usedAuditIds.has(audit.id) && audit.rowCount === scannedRows,
    );
    if (matched) return matched;
  }
  return audits.find((audit) => !usedAuditIds.has(audit.id));
}

function resolveToolTimestamp(toolCall: LiveToolCallRecord): number | undefined {
  return toolCall.finishedAtMs ?? toolCall.startedAtMs;
}

function withTimestamp(
  entry: TraceEntry,
  tsMs?: number,
  fallbackMs?: number,
): TraceEntry {
  const resolved = tsMs ?? fallbackMs;
  if (resolved === undefined) return entry;
  return {
    ...entry,
    tsMs: resolved,
    ts: formatTraceTime(resolved),
  };
}

function buildToolEntry(
  toolCall: LiveToolCallRecord,
  event: TimelineEvent | undefined,
  audits: LiveAudit[],
  usedAuditIds: Set<string>,
  artifactsById: Map<string, DataArtifact>,
  fallbackMs?: number,
): TraceEntry {
  const parsed = parseResultObject(toolCall.result);
  const artifactIds = event?.artifactIds ?? [];
  const linkedArtifact = artifactIds
    .map((artifactId) => artifactsById.get(artifactId))
    .find(Boolean);
  const tsMs = resolveToolTimestamp(toolCall);

  if (toolCall.name === "run_sql_readonly" || event?.kind === "query") {
    const payload = event?.payload as
      | { sql?: string; scannedRows?: number; durationMs?: number }
      | undefined;
    const sql =
      payload?.sql ||
      (typeof parsed?.sql === "string" ? parsed.sql : "") ||
      "";
    const scannedRows =
      payload?.scannedRows ??
      (typeof parsed?.row_count === "number" ? parsed.row_count : undefined);
    const durationMs =
      payload?.durationMs ??
      (typeof parsed?.elapsed_ms === "number" ? parsed.elapsed_ms : undefined);
    const audit = pickAuditForSql(audits, usedAuditIds, scannedRows);
    if (audit) usedAuditIds.add(audit.id);

    const summary =
      event?.summary ||
      (scannedRows !== undefined
        ? `已执行，返回 ${scannedRows.toLocaleString()} 行。`
        : toolCall.result && !parsed
          ? toolCall.result.slice(0, 160)
          : "正在准备只读 SQL 查询。");

    return withTimestamp(
      {
        id: `tool-${toolCall.id}`,
        kind: "tool",
        ts: event?.ts,
        title: event?.title ?? toolTitle(toolCall.name),
        summary,
        toolName: toolCall.name,
        toolStatus: resolveTraceToolStatus(toolCall.status, event?.activityStatus),
        toolCallId: toolCall.id,
        eventId: event?.id,
        artifactIds,
        artifactDetail: linkedArtifact?.detail,
        sql: sql || undefined,
        scannedRows,
        durationMs: durationMs ?? audit?.elapsedMs,
        auditStatus: audit?.status,
        datasourceId: audit?.datasourceId,
        rawResult: toolCall.result,
      },
      tsMs,
      fallbackMs,
    );
  }

  if (toolCall.name === "inspect_schema" || event?.kind === "inspect") {
    const payload = event?.payload as { tables?: SchemaTable[] } | undefined;
    const schemaTables =
      payload?.tables && payload.tables.length > 0
        ? payload.tables
        : parseSchemaTables(parsed);
    const summary =
      event?.summary ||
      (schemaTables.length > 0
        ? `已加载 ${schemaTables.length} 张表的结构。`
        : "正在检查数据源表结构。");

    return withTimestamp(
      {
        id: `tool-${toolCall.id}`,
        kind: "tool",
        ts: event?.ts,
        title: event?.title ?? toolTitle(toolCall.name),
        summary,
        toolName: toolCall.name,
        toolStatus: resolveTraceToolStatus(toolCall.status, event?.activityStatus),
        toolCallId: toolCall.id,
        eventId: event?.id,
        artifactIds,
        schemaTables,
        rawResult: toolCall.result,
      },
      tsMs,
      fallbackMs,
    );
  }

  return withTimestamp(
    {
      id: `tool-${toolCall.id}`,
      kind: "tool",
      ts: event?.ts,
      title: event?.title ?? toolTitle(toolCall.name),
      summary:
        event?.summary ||
        (toolCall.result
          ? toolCall.result.slice(0, 160)
          : `${toolTitle(toolCall.name)} ${toolStatusLabel(toolCall.status)}`),
      toolName: toolCall.name,
      toolStatus: resolveTraceToolStatus(toolCall.status, event?.activityStatus),
      toolCallId: toolCall.id,
      eventId: event?.id,
      artifactIds,
      rawResult: toolCall.result,
    },
    tsMs,
    fallbackMs,
  );
}

function buildEventOnlyEntry(
  event: TimelineEvent,
  artifactsById: Map<string, DataArtifact>,
  fallbackMs?: number,
): TraceEntry {
  const linkedArtifact = event.artifactIds
    ?.map((artifactId) => artifactsById.get(artifactId))
    .find(Boolean);

  if (event.kind === "query") {
    const payload = event.payload as {
      sql?: string;
      scannedRows?: number;
      durationMs?: number;
    };
    return withTimestamp(
      {
        id: `event-${event.id}`,
        kind: "tool",
        ts: event.ts,
        title: event.title,
        summary: event.summary,
        toolName: event.toolName ?? "run_sql_readonly",
        toolStatus: activityStatusToToolStatus(event.activityStatus) ?? "running",
        eventId: event.id,
        artifactIds: event.artifactIds,
        artifactDetail: linkedArtifact?.detail,
        sql: payload.sql || undefined,
        scannedRows: payload.scannedRows,
        durationMs: payload.durationMs,
      },
      undefined,
      fallbackMs,
    );
  }

  if (event.kind === "inspect") {
    const payload = event.payload as { tables?: SchemaTable[] };
    return withTimestamp(
      {
        id: `event-${event.id}`,
        kind: "tool",
        ts: event.ts,
        title: event.title,
        summary: event.summary,
        toolName: event.toolName ?? "inspect_schema",
        toolStatus: activityStatusToToolStatus(event.activityStatus) ?? "running",
        eventId: event.id,
        artifactIds: event.artifactIds,
        schemaTables: payload.tables,
      },
      undefined,
      fallbackMs,
    );
  }

  const payload = event.payload as GenericStepPayload;
  return withTimestamp(
    {
      id: `event-${event.id}`,
      kind: "tool",
      ts: event.ts,
      title: event.title,
      summary: event.summary,
      toolName: event.toolName,
      toolStatus: activityStatusToToolStatus(event.activityStatus) ?? "running",
      eventId: event.id,
      artifactIds: event.artifactIds,
      artifactDetail: linkedArtifact?.detail,
      rawResult: payload?.rawResult,
    },
    undefined,
    fallbackMs,
  );
}

function buildArtifactEntry(artifact: DataArtifact, fallbackMs?: number): TraceEntry {
  return withTimestamp(
    {
      id: `artifact-${artifact.id}`,
      kind: "artifact",
      title: artifact.title,
      summary: artifact.summary,
      artifactIds: [artifact.id],
      artifactDetail: artifact.detail,
    },
    artifact.recordedAtMs,
    fallbackMs,
  );
}

function sortTraceEntries(entries: TraceEntry[]): TraceEntry[] {
  return [...entries].sort((left, right) => (left.tsMs ?? 0) - (right.tsMs ?? 0));
}

function pushRunBoundaryEntries(
  entries: TraceEntry[],
  segment: {
    startedAt?: number;
    finishedAt?: number;
    status: LiveRun["runStatus"];
    errorMessage?: string;
  },
  idPrefix: string,
  options?: { resumeAfterSuspend?: boolean },
): void {
  if (segment.startedAt !== undefined) {
    entries.push({
      id: `${idPrefix}-started`,
      kind: "run_started",
      tsMs: segment.startedAt,
      ts: formatTraceTime(segment.startedAt),
      title: options?.resumeAfterSuspend ? "运行继续" : "运行开始",
      summary: options?.resumeAfterSuspend
        ? "Agent 已收到你的回答，继续执行。"
        : "Agent 开始处理本轮请求。",
    });
  }
  if (segment.status === "suspended" && segment.finishedAt !== undefined) {
    entries.push({
      id: `${idPrefix}-suspended`,
      kind: "run_suspended",
      tsMs: segment.finishedAt,
      ts: formatTraceTime(segment.finishedAt),
      title: "运行暂停",
      summary: "Agent 等待你的回答后继续。",
    });
  } else if (segment.status === "completed" && segment.finishedAt !== undefined) {
    entries.push({
      id: `${idPrefix}-finished`,
      kind: "run_finished",
      tsMs: segment.finishedAt,
      ts: formatTraceTime(segment.finishedAt),
      title: "运行完成",
      summary: "Agent 已完成本轮任务。",
    });
  } else if (segment.status === "failed") {
    entries.push({
      id: `${idPrefix}-failed`,
      kind: "run_failed",
      tsMs: segment.finishedAt,
      ts:
        segment.finishedAt !== undefined
          ? formatTraceTime(segment.finishedAt)
          : undefined,
      title: "运行失败",
      summary: segment.errorMessage ?? "Agent 运行失败。",
      errorMessage: segment.errorMessage,
    });
  }
}

export function buildTraceTimeline(liveRun: LiveRun): TraceEntry[] {
  const hasActivity =
    liveRun.runStatus !== "idle" ||
    liveRun.toolCalls.length > 0 ||
    liveRun.events.length > 0 ||
    liveRun.artifacts.length > 0 ||
    (liveRun.runHistory?.length ?? 0) > 0;

  if (!hasActivity) return [];

  const entries: TraceEntry[] = [];
  const eventById = new Map(liveRun.events.map((event) => [event.id, event]));
  const artifactsById = new Map(liveRun.artifacts.map((artifact) => [artifact.id, artifact]));
  const usedAuditIds = new Set<string>();
  const linkedArtifactIds = new Set<string>();
  let sequenceFallbackMs = liveRun.runStartedAt ?? Date.now();

  for (const [index, segment] of liveRun.runHistory?.entries() ?? []) {
    const resumeAfterSuspend =
      index > 0 && liveRun.runHistory?.[index - 1]?.status === "suspended";
    pushRunBoundaryEntries(entries, segment, `run-history-${index}`, {
      resumeAfterSuspend,
    });
  }

  if (liveRun.runStartedAt !== undefined) {
    const resumeAfterSuspend = liveRun.runHistory?.at(-1)?.status === "suspended";
    entries.push({
      id: "run-started-current",
      kind: "run_started",
      tsMs: liveRun.runStartedAt,
      ts: formatTraceTime(liveRun.runStartedAt),
      title: resumeAfterSuspend ? "运行继续" : "运行开始",
      summary: resumeAfterSuspend
        ? "Agent 已收到你的回答，继续执行。"
        : "Agent 开始处理本轮请求。",
    });
  }

  for (const toolCall of liveRun.toolCalls) {
    const event = eventById.get(toolCall.id);
    event?.artifactIds?.forEach((artifactId) => linkedArtifactIds.add(artifactId));
    entries.push(
      buildToolEntry(
        toolCall,
        event,
        liveRun.audits,
        usedAuditIds,
        artifactsById,
        (sequenceFallbackMs += 1),
      ),
    );
  }

  for (const event of liveRun.events) {
    if (liveRun.toolCalls.some((toolCall) => toolCall.id === event.id)) continue;
    event.artifactIds?.forEach((artifactId) => linkedArtifactIds.add(artifactId));
    entries.push(
      buildEventOnlyEntry(event, artifactsById, (sequenceFallbackMs += 1)),
    );
  }

  for (const artifact of liveRun.artifacts) {
    if (linkedArtifactIds.has(artifact.id)) continue;
    entries.push(buildArtifactEntry(artifact, (sequenceFallbackMs += 1)));
  }

  if (liveRun.runStatus === "suspended" && liveRun.runFinishedAt !== undefined) {
    entries.push({
      id: "run-suspended-current",
      kind: "run_suspended",
      tsMs: liveRun.runFinishedAt,
      ts: formatTraceTime(liveRun.runFinishedAt),
      title: "运行暂停",
      summary: "Agent 等待你的回答后继续。",
    });
  } else if (liveRun.runStatus === "completed" && liveRun.runFinishedAt !== undefined) {
    entries.push({
      id: "run-finished-current",
      kind: "run_finished",
      tsMs: liveRun.runFinishedAt,
      ts: formatTraceTime(liveRun.runFinishedAt),
      title: "运行完成",
      summary: "Agent 已完成本轮任务。",
    });
  } else if (liveRun.runStatus === "failed") {
    entries.push({
      id: "run-failed-current",
      kind: "run_failed",
      tsMs: liveRun.runFinishedAt,
      ts:
        liveRun.runFinishedAt !== undefined
          ? formatTraceTime(liveRun.runFinishedAt)
          : undefined,
      title: "运行失败",
      summary: liveRun.errorMessage ?? "Agent 运行失败。",
      errorMessage: liveRun.errorMessage,
    });
  }

  return sortTraceEntries(entries);
}

export function traceTimelineStats(liveRun: LiveRun, entries: TraceEntry[]) {
  const runUsage = deriveRunUsage(liveRun);
  return {
    toolCount: liveRun.toolCalls.length,
    artifactCount: liveRun.artifacts.length,
    entryCount: entries.length,
    durationMs: runUsage.durationMs,
    runStatus: liveRun.runStatus,
  };
}

export {
  auditStatusLabel,
  toolKindLabel,
  toolStatusLabel,
  toolTitle,
};
