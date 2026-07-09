import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  configApi,
  type TraceDagDto,
  type TraceDagEdgeDto,
  type TraceDagNodeDto,
} from "../../../../lib/config-api";
import type { DataArtifact } from "../../data-task-state";
import type { LiveRun } from "../../live-run-state";
import { buildTraceTimeline, traceTimelineStats } from "../../trace-timeline";
import {
  formatPayload,
  ToolFormattedParams,
  ToolFormattedResult,
  ToolRawFallback,
} from "../../tool-result-format";
import { overlayBackdropClass, overlayPanelClass, statusTone } from "../../ui-tokens";
import { ArtifactMarkdownPreview, isMarkdownFilePath } from "./ArtifactMarkdownPreview";
import { TraceDagCanvas, traceDagNodeKindLabel } from "./TraceDagCanvas";
import { TraceList } from "./TraceList";

type TraceOverlayProps = {
  artifacts: DataArtifact[];
  liveRun: LiveRun;
  isOpen: boolean;
  onClose: () => void;
  onCreateCheckpointBranch?: (checkpointId: string) => Promise<void> | void;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
  sessionId?: string;
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

type TraceContextDetail = Extract<NonNullable<TraceDagNodeDto["detail"]>, { type: "context" }>;
type TraceToolDetail = Extract<NonNullable<TraceDagNodeDto["detail"]>, { type: "tool" }>;
type TraceArtifactDetail = Extract<NonNullable<TraceDagNodeDto["detail"]>, { type: "artifact" }>;
type TraceTerminalDetail = Extract<NonNullable<TraceDagNodeDto["detail"]>, { type: "terminal" }>;

export function TraceOverlay({
  artifacts,
  liveRun,
  isOpen,
  onClose,
  onCreateCheckpointBranch,
  onSelectArtifact,
  onSelectEvent,
  sessionId,
}: TraceOverlayProps) {
  const [branchingCheckpointId, setBranchingCheckpointId] = useState<string | null>(null);
  const [dagError, setDagError] = useState<string | null>(null);
  const [isDagLoading, setIsDagLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [traceDag, setTraceDag] = useState<TraceDagDto | null>(null);
  const stats = useMemo(
    () => traceTimelineStats(liveRun, buildTraceTimeline(liveRun)),
    [liveRun],
  );
  const selectedNode = useMemo(
    () => traceDag?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, traceDag],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !sessionId) {
      setTraceDag(null);
      setDagError(null);
      setSelectedNodeId(null);
      return;
    }
    let canceled = false;
    setIsDagLoading(true);
    setDagError(null);
    configApi.getSessionTraceDag(sessionId)
      .then((dag) => {
        if (canceled) return;
        setTraceDag(dag);
        setSelectedNodeId((current) =>
          current && dag.nodes.some((node) => node.id === current)
            ? current
            : dag.nodes.find((node) => node.prominent)?.id ?? dag.nodes[0]?.id ?? null,
        );
      })
      .catch((error) => {
        if (canceled) return;
        setDagError(error instanceof Error ? error.message : "Failed to load trace graph");
      })
      .finally(() => {
        if (!canceled) setIsDagLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [isOpen, sessionId]);

  const handleCreateCheckpointBranch = async (checkpointId: string) => {
    if (!onCreateCheckpointBranch) return;
    setBranchingCheckpointId(checkpointId);
    try {
      await onCreateCheckpointBranch(checkpointId);
      onClose();
    } finally {
      setBranchingCheckpointId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`${overlayBackdropClass} p-4`}>
      <div className={`mx-auto h-full max-w-7xl ${overlayPanelClass}`}>
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Full Task Trace
              </h2>
              <p className="mt-1 text-xs text-muted-light">
                Review data operations, SQL, raw results, and artifact lineage by time.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={[
                "shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted",
                "transition hover:bg-surface-subtle",
              ].join(" ")}
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
            <TraceDagCanvas
              dag={traceDag}
              error={dagError}
              isLoading={isDagLoading}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
            <TraceDagNodeDetails
              branchingCheckpointId={branchingCheckpointId}
              dag={traceDag}
              node={selectedNode}
              onCreateCheckpointBranch={handleCreateCheckpointBranch}
            />
          </div>

          <div className="mt-5">
            <TraceList
              artifacts={artifacts}
              liveRun={liveRun}
              onSelectArtifact={onSelectArtifact}
              onSelectEvent={onSelectEvent}
            />
          </div>
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

function TraceDagNodeDetails({
  branchingCheckpointId,
  dag,
  node,
  onCreateCheckpointBranch,
}: {
  branchingCheckpointId: string | null;
  dag: TraceDagDto | null;
  node: TraceDagNodeDto | null;
  onCreateCheckpointBranch: (checkpointId: string) => Promise<void>;
}) {
  if (!node) {
    return (
      <aside className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        Select a trace node
      </aside>
    );
  }
  const incoming = dag?.edges.filter((edge) => edge.target === node.id) ?? [];
  const outgoing = dag?.edges.filter((edge) => edge.source === node.id) ?? [];
  const canBranch = Boolean(node.checkpointId && node.rollbackable);
  return (
    <aside className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-light">
            {traceDagNodeKindLabel(node)}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-foreground">{node.label}</h3>
        </div>
        {node.status ? (
          <span className="shrink-0 rounded bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-muted">
            {node.status}
          </span>
        ) : null}
      </div>

      <TraceNodeReadableDetail node={node} />

      {node.checkpointId ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-3">
          <div className="text-[11px] font-semibold text-muted-light">Checkpoint</div>
          <div className="mt-1 break-all font-mono text-xs text-foreground">{node.checkpointId}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(node.checkpointId!)}
              className="rounded border border-border px-2.5 py-1 text-[11px] font-semibold text-muted hover:bg-surface"
            >
              Copy id
            </button>
            <button
              type="button"
              disabled={!canBranch || branchingCheckpointId === node.checkpointId}
              onClick={() => node.checkpointId && onCreateCheckpointBranch(node.checkpointId)}
              className={[
                "rounded px-2.5 py-1 text-[11px] font-semibold transition",
                canBranch
                  ? "bg-primary text-white hover:bg-primary-light"
                  : "cursor-not-allowed bg-surface text-muted-light",
              ].join(" ")}
            >
              {branchingCheckpointId === node.checkpointId ? "Creating..." : "Continue from here"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 border-t border-border pt-4 text-xs">
        <TraceField label="Run" value={node.runId} />
        <TraceField label="Event" value={node.eventSeq !== undefined ? String(node.eventSeq) : undefined} />
        <TraceField label="Tool" value={node.toolCallId} />
      </div>

      <TraceEdgeList title="Incoming" edges={incoming} />
      <TraceEdgeList title="Outgoing" edges={outgoing} />
    </aside>
  );
}

function TraceNodeReadableDetail({ node }: { node: TraceDagNodeDto }) {
  const detail = node.detail;
  if (detail?.type === "context") {
    return <TraceContextReadableDetail detail={detail} summary={node.summary} />;
  }
  if (detail?.type === "tool") {
    return <TraceToolReadableDetail detail={detail} node={node} />;
  }
  if (detail?.type === "artifact") {
    return <TraceArtifactReadableDetail detail={detail} node={node} />;
  }
  if (detail?.type === "terminal") {
    return <TraceTerminalReadableDetail detail={detail} summary={node.summary} />;
  }
  return node.summary ? <p className="mt-3 text-xs leading-5 text-muted">{node.summary}</p> : null;
}

function TraceContextReadableDetail({
  detail,
  summary,
}: {
  detail: TraceContextDetail;
  summary?: string;
}) {
  const metrics = [
    detail.model ? { label: "Model", value: detail.model } : null,
    detail.modelProfileId ? { label: "Profile", value: detail.modelProfileId } : null,
    detail.stepNumber !== undefined ? { label: "Step", value: String(detail.stepNumber) } : null,
    detail.promptTokens !== undefined ? { label: "Prompt", value: formatCount(detail.promptTokens) } : null,
    detail.remainingTokens !== undefined ? { label: "Remaining", value: formatCount(detail.remainingTokens) } : null,
    detail.packageRevision !== undefined ? { label: "Package rev", value: String(detail.packageRevision) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="mt-4 grid gap-4">
      {summary ? <p className="text-xs leading-5 text-muted">{summary}</p> : null}
      <TraceMetricGrid metrics={metrics} />
      <TraceTextPreview
        emptyText="No reasoning chunks were recorded for this step."
        text={detail.reasoning}
        title="Model reasoning"
      />
      <TraceTextPreview title="Assistant output" markdown text={detail.assistantOutput} />
      <TraceChipSection title="Selected context groups" values={detail.selectedGroupIds} />
      <TraceContextPackageDetail detail={detail} />
    </div>
  );
}

function TraceToolReadableDetail({
  detail,
  node,
}: {
  detail: TraceToolDetail;
  node: TraceDagNodeDto;
}) {
  const labelToolName = node.label.replace(/^Tool:\s*/u, "").trim();
  const toolName = detail.toolName ?? (labelToolName || "tool");
  const parameters = detail.arguments ?? detail.argumentsText;
  const result = detail.result ?? detail.resultText;

  return (
    <div className="mt-4 grid gap-4">
      {node.summary ? <TraceTextPreview title="Latest event" text={node.summary} /> : null}
      <TraceDetailSection title="Tool parameters">
        {parameters !== undefined ? (
          <ToolFormattedParams parameters={parameters} />
        ) : (
          <TraceEmptyLine text="No parameters were recorded for this tool call." />
        )}
      </TraceDetailSection>
      <TraceDetailSection title="Tool result">
        {result !== undefined ? (
          <ToolFormattedResult toolName={toolName} result={result} variant="console" />
        ) : (
          <TraceEmptyLine text="No result has been recorded yet." />
        )}
      </TraceDetailSection>
    </div>
  );
}

function TraceContextPackageDetail({ detail }: { detail: TraceContextDetail }) {
  const sourceMetrics = [
    detail.selectedSources ? { label: "Selected sources", value: String(detail.selectedSources.length) } : null,
    detail.omittedSources ? { label: "Omitted sources", value: String(detail.omittedSources.length) } : null,
    detail.omittedGroupIds ? { label: "Omitted groups", value: String(detail.omittedGroupIds.length) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <TraceDetailSection title="Context package">
      <div className="grid gap-2 text-xs">
        <TraceField label="Package" value={detail.packageId} />
        <TraceField label="Plan" value={detail.planId} />
      </div>
      <TraceMetricGrid metrics={sourceMetrics} />
      <TraceTokenReport value={detail.tokenReport} />
      <TraceDecisionList decisions={detail.decisions} />
    </TraceDetailSection>
  );
}

function TraceMetricGrid({ metrics }: { metrics: Array<{ label: string; value: string }> }) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-lg border border-border bg-surface-subtle p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
            {metric.label}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-foreground">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

function TraceDetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-light">{title}</div>
      {children}
    </section>
  );
}

function TraceTextPreview({
  emptyText,
  markdown = false,
  text,
  title,
}: {
  emptyText?: string;
  markdown?: boolean;
  text?: string;
  title: string;
}) {
  const trimmed = text?.trim();
  if (!trimmed) {
    return emptyText ? (
      <TraceDetailSection title={title}>
        <TraceEmptyLine text={emptyText} />
      </TraceDetailSection>
    ) : null;
  }
  return (
    <TraceDetailSection title={title}>
      {markdown ? (
        <ArtifactMarkdownPreview content={trimmed} />
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-subtle p-3 text-xs">
          {trimmed}
        </pre>
      )}
    </TraceDetailSection>
  );
}

function TraceChipSection({
  title,
  values,
}: {
  title: string;
  values?: string[];
}) {
  if (!values || values.length === 0) return null;
  return (
    <TraceDetailSection title={title}>
      <div className="flex flex-wrap gap-1.5">
        {values.slice(0, 8).map((value) => (
          <span
            key={value}
            className="max-w-full truncate rounded border border-border bg-surface-subtle px-2 py-1 text-[11px]"
          >
            {value}
          </span>
        ))}
        {values.length > 8 ? (
          <span className="rounded bg-surface-subtle px-2 py-1 text-[11px] text-muted-light">
            +{values.length - 8}
          </span>
        ) : null}
      </div>
    </TraceDetailSection>
  );
}

function TraceTokenReport({ value }: { value: unknown }) {
  const record = recordValue(value);
  if (!record) return null;
  const entries = Object.entries(record)
    .flatMap(([key, entryValue]) => {
      if (typeof entryValue === "number") {
        return [{ label: formatKeyLabel(key), value: formatCount(entryValue) }];
      }
      if (typeof entryValue === "string") {
        return [{ label: formatKeyLabel(key), value: entryValue }];
      }
      return [];
    })
    .slice(0, 6);
  if (entries.length === 0) return null;
  return <TraceMetricGrid metrics={entries} />;
}

function TraceDecisionList({ decisions }: { decisions?: unknown[] }) {
  if (!decisions || decisions.length === 0) return null;
  return (
    <div className="grid gap-2">
      <div className="text-[11px] font-semibold text-muted-light">Selection decisions</div>
      {decisions.slice(0, 5).map((decision, index) => {
        const record = recordValue(decision);
        const label = stringValue(record?.decision) ?? stringValue(record?.kind) ?? `Decision ${index + 1}`;
        const reason = decisionReasonText(record) ?? truncateText(formatPayload(decision), 180);
        return (
          <div key={index} className="rounded-lg border border-border bg-surface-subtle p-2 text-xs">
            <div className="font-semibold text-foreground">{label}</div>
            {reason ? <div className="mt-1 leading-5 text-muted">{reason}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function TracePreviewValue({
  artifactName,
  value,
}: {
  artifactName: string;
  value: unknown;
}) {
  const record = recordValue(value);
  const content = stringValue(record?.content);
  const path = stringValue(record?.path) ?? artifactName;

  if (record && isPreviewTable(record)) {
    return <ToolFormattedResult toolName="preview_table" result={record} variant="console" />;
  }
  if (content) {
    if (isMarkdownFilePath(path)) {
      return <ArtifactMarkdownPreview content={content} />;
    }
    return (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-subtle p-3 text-xs">
        {content}
      </pre>
    );
  }
  if (typeof value === "string") {
    if (isMarkdownFilePath(artifactName)) {
      return <ArtifactMarkdownPreview content={value} />;
    }
    return (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-subtle p-3 text-xs">
        {value}
      </pre>
    );
  }
  return <ToolRawFallback result={value} variant="console" collapsible={false} />;
}

function TraceEmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-2.5 py-2 text-xs text-muted-light">
      {text}
    </p>
  );
}

function isPreviewTable(value: Record<string, unknown>): boolean {
  return Array.isArray(value.columns) && Array.isArray(value.rows);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function decisionReasonText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined;
  const direct = stringValue(record.reason) ?? stringValue(record.message) ?? stringValue(record.summary);
  if (direct) return direct;
  if (Array.isArray(record.reasons)) {
    const reasons = record.reasons.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    return reasons.length > 0 ? reasons.join(", ") : undefined;
  }
  return undefined;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKeyLabel(value: string): string {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function TraceArtifactReadableDetail({
  detail,
  node,
}: {
  detail: TraceArtifactDetail;
  node: TraceDagNodeDto;
}) {
  return (
    <div className="mt-4 grid gap-4">
      <TraceMetricGrid
        metrics={[
          detail.artifactType ? { label: "Type", value: detail.artifactType } : null,
          detail.mimeType ? { label: "MIME", value: detail.mimeType } : null,
        ].filter(Boolean) as Array<{ label: string; value: string }>}
      />
      <TraceDetailSection title="Output preview">
        {detail.preview !== undefined ? (
          <TracePreviewValue artifactName={detail.name ?? node.label} value={detail.preview} />
        ) : (
          <TraceEmptyLine text="This output does not have a stored preview." />
        )}
      </TraceDetailSection>
    </div>
  );
}

function TraceTerminalReadableDetail({
  detail,
  summary,
}: {
  detail: TraceTerminalDetail;
  summary?: string;
}) {
  const message = detail.error ?? detail.message ?? summary;
  return (
    <div className="mt-4">
      <TraceTextPreview title={detail.error ? "Run error" : "Run result"} text={message ?? "Run completed."} />
    </div>
  );
}

function TraceField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 text-muted-light">{label}</span>
      <span className="truncate font-mono text-muted">{value}</span>
    </div>
  );
}

function TraceEdgeList({ title, edges }: { title: string; edges: TraceDagEdgeDto[] }) {
  if (edges.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold text-muted-light">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {edges.map((edge) => (
          <span key={edge.id} className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted">
            {edge.label ?? edge.kind}
          </span>
        ))}
      </div>
    </div>
  );
}
