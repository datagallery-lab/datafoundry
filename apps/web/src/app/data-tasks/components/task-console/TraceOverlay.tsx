import { useEffect, useMemo } from "react";
import type { DataArtifact } from "../../data-task-state";
import type { LiveRun } from "../../live-run-state";
import { buildTraceTimeline, traceTimelineStats } from "../../trace-timeline";
import { overlayBackdropClass, overlayPanelClass, statusTone } from "../../ui-tokens";
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
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Idle";
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
    <div className={`${overlayBackdropClass} p-4`}>
      <div className={`mx-auto h-full max-w-5xl ${overlayPanelClass}`}>
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Full Task Trace
              </h2>
              <p className="mt-1 text-xs text-muted-light">
                Review data operations, SQL, raw results, and artifact lineage by time. Use this when chat results need investigation.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-subtle"
            >
              Close
            </button>
          </div>

          {stats.runStatus !== "idle" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2.5 py-1 font-semibold ${
                  stats.runStatus === "completed"
                    ? statusTone("success")
                    : stats.runStatus === "failed"
                      ? statusTone("error")
                      : stats.runStatus === "running"
                        ? statusTone("info")
                        : statusTone("muted")
                }`}
              >
                {runStatusLabel(stats.runStatus)}
              </span>
              <span className="text-muted-light">
                Run duration {formatDuration(stats.durationMs)}
              </span>
              {liveRun.errorMessage ? (
                <span className="text-step-error">{liveRun.errorMessage}</span>
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
          <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-light">
            {stats.entryCount} records · {stats.toolCount} data operations ·{" "}
            {stats.artifactCount} artifacts
          </footer>
        ) : null}
      </div>
    </div>
  );
}
