import type { EvidenceKind, EvidenceRef } from "@datafoundry/contracts";

import type { DataArtifact } from "./data-task-state";
import type { LiveAudit, LiveRun } from "./live-run-state";
import { buildTraceTimeline, type TraceEntry } from "./trace-timeline";

export type EvidenceOrigin = "artifact" | "audit" | "trace" | "knowledge";

export type EvidenceCard = {
  ref: EvidenceRef;
  title: string;
  subtitle?: string;
  preview?: string;
  origin: EvidenceOrigin;
  sortKey: number;
};

/** Builds the frontend evidence catalog from the live run state without mutating it. */
export function buildEvidenceCardsFromLiveRun(liveRun: LiveRun, sessionId?: string | null): EvidenceCard[] {
  const cards: EvidenceCard[] = [];
  const seen = new Set<string>();
  const runId = liveRun.runId;
  const refSessionId = sessionId ?? "";

  const addCard = (card: EvidenceCard): void => {
    if (!card.ref.id || seen.has(card.ref.id)) return;
    seen.add(card.ref.id);
    cards.push(card);
  };

  liveRun.artifacts.forEach((artifact, index) => {
    addCard(artifactEvidenceCard(artifact, refSessionId, runId, index));
  });

  const traceEntries = buildTraceTimeline(liveRun);
  const usedAuditIds = new Set<string>();
  traceEntries.forEach((entry, index) => {
    if (entry.kind !== "tool") return;
    const audit = entryIsSql(entry) ? pickAuditForSql(liveRun.audits, usedAuditIds, entry.scannedRows) : undefined;
    if (audit) usedAuditIds.add(audit.id);
    for (const card of traceEvidenceCards(entry, refSessionId, runId, audit, index)) {
      addCard(card);
    }
  });

  return cards.sort((left, right) => left.sortKey - right.sortKey || left.title.localeCompare(right.title));
}

/** Adds or removes an evidence ref by its stable id. */
export function toggleEvidenceRef(refs: readonly EvidenceRef[], ref: EvidenceRef): EvidenceRef[] {
  return refs.some((entry) => entry.id === ref.id)
    ? refs.filter((entry) => entry.id !== ref.id)
    : uniqueEvidenceRefs([...refs, ref]);
}

/** Removes one evidence ref by id. */
export function removeEvidenceRef(refs: readonly EvidenceRef[], id: string): EvidenceRef[] {
  return refs.filter((entry) => entry.id !== id);
}

/** Removes duplicate evidence refs while preserving first-seen order. */
export function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const uniqueRefs: EvidenceRef[] = [];
  for (const ref of refs) {
    if (!ref.id || seen.has(ref.id)) continue;
    seen.add(ref.id);
    uniqueRefs.push(ref);
  }
  return uniqueRefs;
}

/** Formats a compact label suitable for input chips. */
export function evidenceChipLabel(ref: EvidenceRef): string {
  return `${evidenceKindLabel(ref.kind)}: ${ref.label}`;
}

export function evidenceKindLabel(kind: EvidenceKind): string {
  switch (kind) {
    case "table":
      return "Table";
    case "chart":
      return "Chart";
    case "report":
      return "Report";
    case "file":
      return "File";
    case "sql":
      return "SQL";
    case "schema":
      return "Schema";
    case "preview":
      return "Preview";
    case "knowledge":
      return "Knowledge";
    case "step":
      return "Step";
  }
}

const artifactEvidenceCard = (
  artifact: DataArtifact,
  sessionId: string,
  runId: string | undefined,
  index: number,
): EvidenceCard => {
  const kind = artifactEvidenceKind(artifact);
  const ref: EvidenceRef = {
    id: `artifact:${artifact.id}`,
    kind,
    label: artifact.title,
    summary: artifact.summary,
    sessionId,
    ...(runId ? { runId } : {}),
    source: {
      artifactId: artifact.id,
      ...(artifact.fileId ? { fileId: artifact.fileId } : {}),
      ...(artifact.createdByEventId ? { eventId: artifact.createdByEventId } : {}),
    },
  };
  return {
    ref,
    title: `${evidenceKindLabel(kind)} · ${artifact.title}`,
    subtitle: artifact.summary || undefined,
    preview: artifactPreviewText(artifact),
    origin: "artifact",
    sortKey: artifact.recordedAtMs ?? 10_000 + index,
  };
};

const artifactEvidenceKind = (artifact: DataArtifact): EvidenceKind => {
  if (artifact.detail?.type === "dataset" || artifact.type === "dataset" || artifact.type === "sql") return "table";
  if (artifact.detail?.type === "chart" || artifact.type === "chart") return "chart";
  if (artifact.detail?.type === "report" || artifact.type === "report") return "report";
  if (artifact.detail?.type === "file" || artifact.type === "file" || artifact.kind === "file") return "file";
  return "report";
};

const artifactPreviewText = (artifact: DataArtifact): string | undefined => {
  if (artifact.detail?.type === "dataset") {
    const columns = artifact.detail.columns.slice(0, 6).join(", ");
    return `Columns: ${columns}; sample rows: ${artifact.detail.rows.length}`;
  }
  if (artifact.detail?.type === "chart") {
    const pointCount = (artifact.detail.series ?? []).reduce((sum, series) => sum + series.points.length, 0);
    return `${artifact.detail.chartType ?? "chart"} · ${pointCount || artifact.detail.points.length} points`;
  }
  if (artifact.detail?.type === "file") {
    return artifact.detail.path;
  }
  return artifact.summary || undefined;
};

const traceEvidenceCards = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  audit: LiveAudit | undefined,
  index: number,
): EvidenceCard[] => {
  const cards: EvidenceCard[] = [stepEvidenceCard(entry, sessionId, runId, index)];
  if (entryIsSql(entry)) {
    cards.push(sqlEvidenceCard(entry, sessionId, runId, audit, index));
  }
  if (entry.schemaTables && entry.schemaTables.length > 0) {
    cards.push(schemaEvidenceCard(entry, sessionId, runId, index));
  }
  if (entry.toolName === "preview_table") {
    cards.push(previewEvidenceCard(entry, sessionId, runId, index));
  }
  if (entry.toolName === "retrieve_knowledge") {
    cards.push(knowledgeEvidenceCard(entry, sessionId, runId, index));
  }
  return cards;
};

const stepEvidenceCard = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  index: number,
): EvidenceCard => {
  const id = entry.toolCallId ? `step:${entry.toolCallId}` : `step:${entry.eventId ?? entry.id}`;
  return {
    ref: {
      id,
      kind: "step",
      label: entry.title,
      summary: entry.summary,
      sessionId,
      ...(runId ? { runId } : {}),
      source: {
        ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
        ...(entry.eventId ? { eventId: entry.eventId } : {}),
      },
    },
    title: `Step · ${entry.title}`,
    subtitle: entry.summary,
    preview: entry.sql ?? entry.rawResult,
    origin: "trace",
    sortKey: (entry.tsMs ?? 20_000 + index) + 0.1,
  };
};

const sqlEvidenceCard = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  audit: LiveAudit | undefined,
  index: number,
): EvidenceCard => {
  const id = audit?.id ? `sql-audit:${audit.id}` : `sql:${entry.toolCallId ?? entry.eventId ?? entry.id}`;
  const label = entry.title || "Run query";
  const datasourceId = entry.datasourceId ?? audit?.datasourceId;
  return {
    ref: {
      id,
      kind: "sql",
      label,
      summary: entry.summary,
      sessionId,
      ...(runId ? { runId } : {}),
      source: {
        ...(audit?.id ? { auditLogId: audit.id } : {}),
        ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
        ...(entry.eventId ? { eventId: entry.eventId } : {}),
        ...(datasourceId ? { datasourceId } : {}),
      },
    },
    title: `SQL · ${label}`,
    subtitle: entry.summary,
    preview: entry.sql,
    origin: audit ? "audit" : "trace",
    sortKey: (entry.tsMs ?? 20_000 + index) + 0.2,
  };
};

const schemaEvidenceCard = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  index: number,
): EvidenceCard => {
  const tables = entry.schemaTables ?? [];
  const id = `schema:${entry.toolCallId ?? entry.eventId ?? entry.id}`;
  return {
    ref: {
      id,
      kind: "schema",
      label: tables.length === 1 ? tables[0]?.name ?? "Schema" : `${tables.length} tables`,
      summary: entry.summary,
      sessionId,
      ...(runId ? { runId } : {}),
      source: {
        ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
        ...(entry.eventId ? { eventId: entry.eventId } : {}),
        ...(tables.length === 1 && tables[0]?.name ? { tableName: tables[0].name } : {}),
      },
    },
    title: `Schema · ${tables.length} tables`,
    subtitle: entry.summary,
    preview: tables.map((table) => table.name).slice(0, 8).join(", "),
    origin: "trace",
    sortKey: (entry.tsMs ?? 20_000 + index) + 0.3,
  };
};

const previewEvidenceCard = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  index: number,
): EvidenceCard => ({
  ref: {
    id: `preview:${entry.toolCallId ?? entry.eventId ?? entry.id}`,
    kind: "preview",
    label: entry.title,
    summary: entry.summary,
    sessionId,
    ...(runId ? { runId } : {}),
    source: {
      ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
      ...(entry.eventId ? { eventId: entry.eventId } : {}),
    },
  },
  title: `Preview · ${entry.title}`,
  subtitle: entry.summary,
  preview: entry.rawResult,
  origin: "trace",
  sortKey: (entry.tsMs ?? 20_000 + index) + 0.4,
});

const knowledgeEvidenceCard = (
  entry: TraceEntry,
  sessionId: string,
  runId: string | undefined,
  index: number,
): EvidenceCard => ({
  ref: {
    id: `knowledge:${entry.toolCallId ?? entry.eventId ?? entry.id}`,
    kind: "knowledge",
    label: entry.title,
    summary: entry.summary,
    sessionId,
    ...(runId ? { runId } : {}),
    source: {
      ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
      ...(entry.eventId ? { eventId: entry.eventId } : {}),
    },
  },
  title: `Knowledge · ${entry.title}`,
  subtitle: entry.summary,
  preview: entry.rawResult,
  origin: "knowledge",
  sortKey: (entry.tsMs ?? 20_000 + index) + 0.5,
});

const entryIsSql = (entry: TraceEntry): boolean =>
  entry.toolName === "run_sql_readonly" || Boolean(entry.sql);

const pickAuditForSql = (
  audits: LiveAudit[],
  usedAuditIds: Set<string>,
  scannedRows?: number,
): LiveAudit | undefined => {
  if (scannedRows !== undefined && scannedRows > 0) {
    const matched = audits.find((audit) => !usedAuditIds.has(audit.id) && audit.rowCount === scannedRows);
    if (matched) return matched;
  }
  return audits.find((audit) => !usedAuditIds.has(audit.id));
};
