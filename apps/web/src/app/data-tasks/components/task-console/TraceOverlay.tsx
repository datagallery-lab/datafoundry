import { useEffect, useMemo } from "react";
import type { DataArtifact } from "../../data-task-state";
import type { LiveRun } from "../../live-run-state";
import { buildTraceTimeline, traceTimelineStats } from "../../trace-timeline";
import { TraceList } from "./TraceList";

type TraceOverlayProps = {
  artifacts: DataArtifact[];
  liveRun: LiveRun;
  isOpen: boolean;
  onClose: () => void;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
};

function runStatusLabel(status: LiveRun["runStatus"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "空闲";
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TraceOverlay({
  artifacts,
  liveRun,
  isOpen,
  onClose,
  onSelectArtifact,
  onSelectEvent,
}: TraceOverlayProps) {
  const stats = useMemo(
    () => traceTimelineStats(liveRun, buildTraceTimeline(liveRun)),
    [liveRun],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                完整任务链追溯
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                按时间查看数据操作、SQL、原始结果与产出血缘；对话区结果缺失时可在此排障。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              关闭
            </button>
          </div>

          {stats.runStatus !== "idle" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                {runStatusLabel(stats.runStatus)}
              </span>
              <span className="text-slate-500">
                运行耗时 {formatDuration(stats.durationMs)}
              </span>
              {liveRun.errorMessage ? (
                <span className="text-red-600">{liveRun.errorMessage}</span>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TraceList
            artifacts={artifacts}
            liveRun={liveRun}
            onSelectArtifact={onSelectArtifact}
            onSelectEvent={onSelectEvent}
          />
        </div>

        {stats.entryCount > 0 ? (
          <footer className="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500">
            {stats.entryCount} 条记录 · {stats.toolCount} 次数据操作 ·{" "}
            {stats.artifactCount} 项产出
          </footer>
        ) : null}
      </div>
    </div>
  );
}
