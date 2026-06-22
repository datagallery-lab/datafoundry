import { useMemo, useState } from "react";
import type { ArtifactDetail, DataArtifact } from "../../data-task-state";
import type { LiveRun } from "../../live-run-state";
import {
  auditStatusLabel,
  buildTraceTimeline,
  toolKindLabel,
  toolStatusLabel,
  type TraceEntry,
} from "../../trace-timeline";
import {
  consoleCodeBlockBaseClass,
  consoleCodeInnerClass,
  consoleScrollXShellClass,
} from "./console-scroll-styles";

function entryKindLabel(entry: TraceEntry): string {
  switch (entry.kind) {
    case "run_started":
      return "运行";
    case "run_finished":
      return "运行";
    case "run_failed":
      return "运行";
    case "tool":
      return entry.toolName ? toolKindLabel(entry.toolName) : "数据操作";
    case "artifact":
      return "产出";
  }
}

function entryKindTone(entry: TraceEntry): string {
  switch (entry.kind) {
    case "run_started":
      return "bg-slate-100 text-slate-700";
    case "run_finished":
      return "bg-emerald-50 text-emerald-700";
    case "run_failed":
      return "bg-red-50 text-red-700";
    case "artifact":
      return "bg-amber-50 text-amber-700";
    case "tool":
      if (entry.toolStatus === "failed") return "bg-red-50 text-red-700";
      if (entry.toolStatus === "running") return "bg-blue-50 text-blue-700";
      return "bg-violet-50 text-violet-700";
  }
}

function toolStatusTone(status: TraceEntry["toolStatus"]): string {
  switch (status) {
    case "failed":
      return "bg-red-50 text-red-700";
    case "running":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-emerald-50 text-emerald-700";
  }
}

function CompactDatasetPreview({
  detail,
}: {
  detail: Extract<ArtifactDetail, { type: "dataset" }>;
}) {
  const previewRows = detail.rows.slice(0, 5);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
        数据预览 · {detail.rows.length.toLocaleString()} 行 × {detail.columns.length} 列
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-max w-full text-left text-[11px]">
          <thead className="bg-white text-slate-500">
            <tr>
              {detail.columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-2 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-100">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.rows.length > previewRows.length ? (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          另有 {detail.rows.length - previewRows.length} 行未展示，可在产物区查看完整内容。
        </div>
      ) : null}
    </div>
  );
}

function resolveArtifactDetail(
  entry: TraceEntry,
  producedArtifacts: DataArtifact[],
): Extract<ArtifactDetail, { type: "dataset" }> | undefined {
  if (entry.artifactDetail?.type === "dataset") {
    return entry.artifactDetail;
  }
  return producedArtifacts.find((artifact) => artifact.detail?.type === "dataset")
    ?.detail as Extract<ArtifactDetail, { type: "dataset" }> | undefined;
}

export function TraceEntryCard({
  artifacts,
  entry,
  index,
  onSelectArtifact,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  entry: TraceEntry;
  index: number;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const [showRawResult, setShowRawResult] = useState(false);
  const producedArtifacts = artifacts.filter((artifact) =>
    entry.artifactIds?.includes(artifact.id),
  );
  const canOpenDetail = entry.eventId !== undefined;
  const datasetDetail = resolveArtifactDetail(entry, producedArtifacts);

  return (
    <article className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {index + 1}
        </span>
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            entryKindTone(entry),
          ].join(" ")}
        >
          {entryKindLabel(entry)}
        </span>
        {entry.toolStatus ? (
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              toolStatusTone(entry.toolStatus),
            ].join(" ")}
          >
            {toolStatusLabel(entry.toolStatus)}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] font-semibold text-slate-500">
          {entry.ts ?? "—"}
        </span>
        {entry.toolCallId ? (
          <span className="font-mono text-[10px] text-slate-400">
            {entry.toolCallId.slice(0, 8)}
          </span>
        ) : null}
      </div>

      {canOpenDetail ? (
        <button
          type="button"
          onClick={() => onSelectEvent(entry.eventId!)}
          className="mt-2 text-left text-sm font-semibold text-slate-950 underline-offset-2 hover:underline"
        >
          {entry.title}
        </button>
      ) : (
        <h3 className="mt-2 text-sm font-semibold text-slate-950">{entry.title}</h3>
      )}

      <div className={[consoleScrollXShellClass, "mt-1"].join(" ")}>
        <p className="min-w-max whitespace-pre text-xs leading-5 text-slate-600">
          {entry.summary}
        </p>
      </div>

      {entry.errorMessage ? (
        <div className={[consoleScrollXShellClass, "mt-2"].join(" ")}>
          <p className="min-w-max whitespace-pre rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
            {entry.errorMessage}
          </p>
        </div>
      ) : null}

      {entry.sql ? (
        <div className="mt-3 min-w-0 max-w-full">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            SQL
          </div>
          <pre className={[consoleCodeBlockBaseClass, "max-h-56"].join(" ")}>
            <code className={consoleCodeInnerClass}>{entry.sql}</code>
          </pre>
        </div>
      ) : null}

      {(entry.scannedRows !== undefined ||
        entry.durationMs !== undefined ||
        entry.auditStatus ||
        entry.datasourceId) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {entry.auditStatus ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              审计 {auditStatusLabel(entry.auditStatus)}
            </span>
          ) : null}
          {entry.scannedRows !== undefined && entry.scannedRows > 0 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              扫描 {entry.scannedRows.toLocaleString()} 行
            </span>
          ) : null}
          {entry.durationMs !== undefined && entry.durationMs > 0 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              耗时 {entry.durationMs}ms
            </span>
          ) : null}
          {entry.datasourceId ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              数据源 {entry.datasourceId}
            </span>
          ) : null}
        </div>
      )}

      {entry.schemaTables && entry.schemaTables.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {entry.schemaTables.map((table) => (
            <div key={table.name} className="rounded-lg bg-slate-50 p-3">
              <div className="font-mono text-xs font-semibold text-slate-900">
                {table.name}
              </div>
              {table.description ? (
                <p className="mt-1 text-[11px] leading-4 text-slate-600">
                  {table.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {table.fields.slice(0, 12).map((field) => (
                  <span
                    key={field}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                  >
                    {field}
                  </span>
                ))}
                {table.fields.length > 12 ? (
                  <span className="text-[10px] text-slate-400">
                    +{table.fields.length - 12} 字段
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {datasetDetail ? <CompactDatasetPreview detail={datasetDetail} /> : null}

      {entry.rawResult && !entry.sql && !datasetDetail ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRawResult((current) => !current)}
            className="text-[11px] font-semibold text-slate-600 underline-offset-2 hover:underline"
          >
            {showRawResult ? "收起原始结果" : "查看原始结果"}
          </button>
          {showRawResult ? (
            <pre className={[consoleCodeBlockBaseClass, "mt-2 max-h-48"].join(" ")}>
              <code className={consoleCodeInnerClass}>{entry.rawResult}</code>
            </pre>
          ) : null}
        </div>
      ) : null}

      {producedArtifacts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {producedArtifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onSelectArtifact(artifact.id)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-white"
            >
              {artifact.title}
            </button>
          ))}
        </div>
      ) : null}

      {entry.kind === "artifact" && entry.artifactIds?.[0] ? (
        <button
          type="button"
          onClick={() => onSelectArtifact(entry.artifactIds![0])}
          className="mt-3 text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
        >
          查看产出详情 →
        </button>
      ) : null}
    </article>
  );
}

/**
 * The chronological evidence chain (data footprint) for one run. Shared by the
 * right-panel inline zone and the full-screen TraceOverlay.
 */
export function TraceList({
  artifacts,
  liveRun,
  emptyHint,
  onSelectArtifact,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  liveRun: LiveRun;
  emptyHint?: string;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const entries = useMemo(() => buildTraceTimeline(liveRun), [liveRun]);

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
        <div className="text-sm font-semibold text-slate-950">尚无可追溯事件</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {emptyHint ?? "发送问题后，Agent 的数据足迹会按时间显示在这里。"}
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      {entries.map((entry, index) => (
        <TraceEntryCard
          key={entry.id}
          artifacts={artifacts}
          entry={entry}
          index={index}
          onSelectArtifact={onSelectArtifact}
          onSelectEvent={onSelectEvent}
        />
      ))}
    </div>
  );
}
