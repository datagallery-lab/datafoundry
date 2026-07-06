import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EvidenceRef } from "@datafoundry/contracts";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ArtifactDetail,
  DataArtifact,
  GenericStepPayload,
  TimelineEvent,
} from "../../data-task-state";
import type { ArtifactExportFormat, JobDto } from "../../../../lib/config-api";
import { dataStepKindForTool, dataStepLabel, hasCapability, toolDisplayTitle } from "../../data-task-state";
import { artifactExportClient } from "../../artifact-export-client";
import {
  artifactDetailFromPreview,
  artifactDetailNeedsPreviewFetch,
  deriveLiveSessionView,
  deriveRunUsage,
  formatSandboxOutputText,
  formatWorkspaceMetadataSummary,
  mergeArtifactDetail,
  parseCsvTextPreview,
  resolveProducedArtifacts,
  resolveSandboxOutputsForToolCall,
  resolveTokenUsageForEvent,
  resolveTokenUsageForToolCallIds,
  resolveToolCallForEvent,
  resolveTraceToolStatus,
  resolveWorkspaceMetadataForToolCall,
  type LiveRun,
  type LiveToolCallRecord,
  type SessionUsageStats,
} from "../../live-run-state";
import {
  deriveProcessGroupUsage,
  type ProcessToolGroup,
} from "../../process-tool-groups";
import type { TaskSelection } from "../../page";
import { overviewSectionPlan } from "../../task-console-layout";
import {
  filterTableRows,
  sortTableRows,
  tableToCsv,
  type TableSortState,
} from "../../table-rows";
import { RunConfigurationPanel } from "./RunConfigurationPanel";
import { TraceList } from "./TraceList";
import { ArtifactMarkdownPreview } from "./ArtifactMarkdownPreview";
import {
  consoleCodeBlockBaseClass,
  consoleCodeInnerClass,
  consoleScrollXShellClass,
  consoleStepsListClass,
  consoleTableShellClass,
} from "./console-scroll-styles";
import { ToolFormattedResult, ToolFailureResult } from "../../tool-result-format";
import { parseSqlToolResult, sqlFromToolPayload } from "../../tool-result-normalize";
import { toolResultLooksLikeError } from "../../tool-call-display";
import type { EvidenceCard } from "../../evidence";
import {
  btnGhostClass,
  btnSecondaryClass,
  emptyStateClass,
  artifactToneForType,
  kpiValueClass,
  metricLabelClass,
  metricValueClass,
  panelShellClass,
  panelTitleClass,
  sectionLabelClass,
  stepKindTone,
} from "../../ui-tokens";

type ActiveSelection = Exclude<TaskSelection, null>;

type ConsoleTab = "overview" | "trace" | "outputs" | "detail";

type TaskConsoleProps = {
  artifacts: DataArtifact[];
  evidenceCards: EvidenceCard[];
  liveRun: LiveRun;
  toolGroups: ProcessToolGroup[];
  sessionUsage: SessionUsageStats;
  selection: TaskSelection;
  visibleEvents: TimelineEvent[];
  currentQuestion?: string;
  /** When set (e.g. from TraceOverlay), jump to Outputs and expand this artifact. */
  artifactFocusId?: string | null;
  onArtifactFocusHandled?: () => void;
  onClearSelection: () => void;
  onClose?: () => void;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onToggleEvidenceRef?: (ref: EvidenceRef) => void;
  onClearEvidenceRefs?: () => void;
  onOpenTrace: () => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
  onArtifactExportJob?: (job: JobDto) => void;
  onSelectEvent: (eventId: string) => void;
  onSelectToolGroup: (groupId: string) => void;
  promotedArtifactIds?: ReadonlySet<string>;
  selectedEvidenceRefs?: EvidenceRef[];
};

function runStatusLabel(status: LiveRun["runStatus"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "suspended":
      return "Waiting";
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

function toolStatusLabel(status: LiveToolCallRecord["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "success":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/** Single-step elapsed time; running/unfinished steps show a soft placeholder. */
function stepDurationLabel(call?: LiveToolCallRecord): string {
  if (!call) return "—";
  if (call.startedAtMs !== undefined && call.finishedAtMs !== undefined) {
    return formatDuration(Math.max(0, call.finishedAtMs - call.startedAtMs));
  }
  if (call.status === "running") return "Running";
  return "—";
}

export function TaskConsole({
  artifacts,
  evidenceCards,
  liveRun,
  toolGroups,
  sessionUsage,
  selection,
  visibleEvents,
  currentQuestion,
  artifactFocusId,
  onArtifactFocusHandled,
  onClearSelection,
  onClose,
  onMentionArtifact,
  onToggleEvidenceRef,
  onClearEvidenceRefs,
  onOpenTrace,
  onPromoteArtifact,
  onArtifactExportJob,
  onSelectEvent,
  onSelectToolGroup,
  promotedArtifactIds,
  selectedEvidenceRefs = [],
}: TaskConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("overview");
  const [outputsExpandedId, setOutputsExpandedId] = useState<string | null>(null);
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const sessionView = useMemo(
    () => deriveLiveSessionView(sessionUsage, liveRun),
    [liveRun, sessionUsage],
  );
  const workspaceHasSignals =
    liveRun.workspaceMetadata.length > 0 || liveRun.sandboxOutputs.length > 0;
  const overviewSections = overviewSectionPlan({
    hasWorkspaceSignals: workspaceHasSignals,
    hasToolDistribution: Object.keys(runUsage.toolCalls.byTool).length > 0,
  });

  // Only step/action selection drives the detail tab; artifacts expand in-place on Outputs.
  useEffect(() => {
    if (selection?.type === "action" || selection?.type === "toolGroup") {
      setActiveTab("detail");
    }
  }, [selection]);

  useEffect(() => {
    if (!artifactFocusId) return;
    onClearSelection();
    setOutputsExpandedId(artifactFocusId);
    setActiveTab("outputs");
    onArtifactFocusHandled?.();
  }, [artifactFocusId, onArtifactFocusHandled, onClearSelection]);

  const viewArtifactInOutputs = (artifactId: string) => {
    onClearSelection();
    setOutputsExpandedId(artifactId);
    setActiveTab("outputs");
  };

  const handleTabClick = (tab: ConsoleTab) => {
    if (tab !== "detail") onClearSelection();
    if (tab !== "outputs") setOutputsExpandedId(null);
    setActiveTab(tab);
  };

  const selectedEvent =
    selection?.type === "action"
      ? visibleEvents.find((event) => event.id === selection.id) ?? null
      : null;
  const selectedGroup =
    selection?.type === "toolGroup"
      ? toolGroups.find((group) => group.id === selection.id) ?? null
      : null;

  return (
    <section
      data-guide-id="run-console"
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-l border-border bg-surface"
    >
      <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <div className="min-w-0">
          <h2 className={panelTitleClass}>Task Console</h2>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-light">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  liveRun.runStatus === "running"
                    ? "bg-primary-light"
                    : liveRun.runStatus === "failed"
                      ? "bg-step-error"
                      : liveRun.runStatus === "completed"
                        ? "bg-step-success"
                        : "bg-muted-light",
                ].join(" ")}
              />
              {runStatusLabel(liveRun.runStatus)}
            </span>
            <span className="text-border">/</span>
            <span className="tabular">
              {liveRun.runStatus !== "idle" ? formatDuration(runUsage.durationMs) : "Not started"}
            </span>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Task Console"
            title="Close Task Console"
            className={`flex h-8 w-8 shrink-0 items-center justify-center ${btnGhostClass}`}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        ) : null}
      </header>

      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <TabButton active={activeTab === "overview"} onClick={() => handleTabClick("overview")}>
          Overview
        </TabButton>
        <TabButton
          active={activeTab === "trace"}
          badge={liveRun.toolCalls.length}
          onClick={() => handleTabClick("trace")}
        >
          Trace
        </TabButton>
        <TabButton
          active={activeTab === "outputs"}
          badge={artifacts.length}
          onClick={() => handleTabClick("outputs")}
        >
          Outputs
        </TabButton>
        <TabButton
          active={activeTab === "detail"}
          badge={selection?.type === "action" || selection?.type === "toolGroup" ? 1 : undefined}
          onClick={() => handleTabClick("detail")}
        >
          Details
        </TabButton>
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        {activeTab === "overview" ? (
          <div className="grid gap-4">
            {overviewSections.map((section) => {
              if (section.id === "conclusion") {
                return (
                  <ConclusionZone
                    key={section.id}
                    currentQuestion={currentQuestion}
                    liveRun={liveRun}
                    toolGroups={toolGroups}
                    sessionUsage={sessionUsage}
                  />
                );
              }
              if (section.id === "progress") {
                return (
                  <DynamicStepsList
                    key={section.id}
                    liveRun={liveRun}
                    toolGroups={toolGroups}
                    events={visibleEvents}
                    onSelectEvent={onSelectEvent}
                    onSelectToolGroup={onSelectToolGroup}
                  />
                );
              }
              if (section.id === "workspace-signals") {
                return <WorkspaceRunSignalsSummary key={section.id} liveRun={liveRun} />;
              }
              return <ToolDistributionZone key={section.id} liveRun={liveRun} />;
            })}
          </div>
        ) : null}

        {activeTab === "trace" ? (
          <EvidenceZone
            artifacts={artifacts}
            evidenceCards={evidenceCards}
            liveRun={liveRun}
            onClearEvidenceRefs={onClearEvidenceRefs}
            onOpenTrace={onOpenTrace}
            onSelectArtifact={viewArtifactInOutputs}
            onSelectEvent={onSelectEvent}
            onToggleEvidenceRef={onToggleEvidenceRef}
            selectedEvidenceRefs={selectedEvidenceRefs}
          />
        ) : null}

        {activeTab === "outputs" ? (
          <DeliverablesZone
            artifacts={artifacts}
            events={visibleEvents}
            expandedId={outputsExpandedId}
            onExpandedIdChange={setOutputsExpandedId}
            onMentionArtifact={onMentionArtifact}
            onPromoteArtifact={onPromoteArtifact}
            onArtifactExportJob={onArtifactExportJob}
            onSelectEvent={onSelectEvent}
            promotedArtifactIds={promotedArtifactIds}
          />
        ) : null}

        {activeTab === "detail" ? (
          selection?.type === "toolGroup" ? (
            <ToolGroupDetailView
              artifacts={artifacts}
              events={visibleEvents}
              group={selectedGroup}
              liveRun={liveRun}
              onBack={onClearSelection}
              onSelectEvent={onSelectEvent}
            />
          ) : selection?.type === "action" ? (
            <DetailView
              artifacts={artifacts}
              event={selectedEvent}
              events={visibleEvents}
              liveRun={liveRun}
              selection={selection}
              onBack={onClearSelection}
              onSelectEvent={onSelectEvent}
            />
          ) : (
            <EmptyState
              title="No step selected"
              description="Select a step from the center tool card or Trace timeline to inspect duration, action details, and output lineage."
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function TabButton({
  active,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200",
        active
          ? "bg-primary text-white"
          : "text-muted hover:bg-surface-subtle hover:text-foreground",
      ].join(" ")}
    >
      {children}
      {badge !== undefined && badge > 0 ? (
        <span
          className={[
            "rounded-full px-1.5 text-[10px] font-bold leading-4",
            active ? "bg-white/20 text-white" : "bg-surface-subtle text-muted",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ConsoleSection({
  title,
  badge,
  collapsible = false,
  defaultExpanded = true,
  children,
}: {
  title: string;
  badge?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  const headerContent = (
    <>
      <h3 className={panelTitleClass}>{title}</h3>
      <span className="flex min-w-0 shrink-0 items-center gap-2">
        {badge}
        {collapsible ? (
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-light transition-transform duration-200",
              expanded ? "rotate-180" : "",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <section className={panelShellClass}>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg text-left transition-colors duration-200 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/50"
        >
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3 px-1 py-1">
            {headerContent}
          </span>
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">{headerContent}</div>
      )}
      {expanded ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

// Section 1: Summary first - current question, status, and run-level metrics.
function ConclusionZone({
  currentQuestion,
  liveRun,
  toolGroups,
  sessionUsage,
}: {
  currentQuestion?: string;
  liveRun: LiveRun;
  toolGroups: ProcessToolGroup[];
  sessionUsage: SessionUsageStats;
}) {
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const groupUsage = useMemo(
    () => deriveProcessGroupUsage(toolGroups, liveRun),
    [liveRun, toolGroups],
  );
  const hasRun = liveRun.runStatus !== "idle";
  const toolRatio =
    runUsage.toolCalls.total > 0
      ? `${runUsage.toolCalls.success}/${runUsage.toolCalls.total}`
      : "—";
  const successRate =
    runUsage.toolCalls.total > 0
      ? `${Math.round((runUsage.toolCalls.success / runUsage.toolCalls.total) * 100)}%`
      : "—";

  const sessionView = useMemo(
    () => deriveLiveSessionView(sessionUsage, liveRun),
    [liveRun, sessionUsage],
  );
  const tokenReported = sessionView.tokenUsageReported;
  const displayTokens = sessionView.tokens;
  const displayModels = sessionView.models;
  const totalTokens = displayTokens.inputTokens + displayTokens.outputTokens;
  const tokenKpi =
    hasRun && tokenReported ? formatCount(totalTokens) : "—";
  const tokenLine =
    hasRun && tokenReported
      ? `In ${formatCount(displayTokens.inputTokens)} / Out ${formatCount(
          displayTokens.outputTokens,
        )}${displayModels.length > 0 ? ` · ${displayModels.slice(0, 2).join(" / ")}` : ""}${
          displayTokens.costUsd !== undefined ? ` · $${displayTokens.costUsd.toFixed(4)}` : ""
        }`
      : undefined;

  return (
    <ConsoleSection title="Summary">
      <div>
        <div className={sectionLabelClass}>Current question</div>
        <p className="mt-1 text-sm leading-6 text-foreground">
          {currentQuestion ?? (
            <span className="text-muted-light">Send a question to start dataFoundry.</span>
          )}
        </p>
      </div>

      {liveRun.errorMessage ? (
        <p className="mt-3 rounded-lg bg-step-error/10 px-3 py-2 text-xs leading-5 text-step-error">
          {liveRun.errorMessage}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <KpiMetric
          label={liveRun.runHistory?.length ? "Steps (session)" : "Steps"}
          value={hasRun ? formatCount(groupUsage.stepCount) : "—"}
          meta={
            hasRun && groupUsage.toolCallCount > 0
              ? `${formatCount(groupUsage.toolCallCount)} tool calls`
              : undefined
          }
          accentClass="text-primary"
        />
        <KpiMetric
          label="Success rate"
          value={successRate}
          meta={toolRatio}
          accentClass="text-step-success"
        />
        <KpiMetric
          label={liveRun.runHistory?.length ? "Outputs (session)" : "Outputs"}
          value={hasRun ? formatCount(runUsage.artifactCount) : "—"}
          meta="items"
          accentClass="text-step-query"
        />
        <KpiMetric
          label="Token / Cost"
          value={tokenKpi}
          meta={tokenLine}
          accentClass={tokenReported ? "text-step-knowledge" : "text-muted-light"}
          stackMeta
        />
      </div>
    </ConsoleSection>
  );
}

function WorkspaceRunSignalsSummary({ liveRun }: { liveRun: LiveRun }) {
  const metadata = liveRun.workspaceMetadata.slice(0, 4);
  const sandbox = liveRun.sandboxOutputs.slice(0, 4);

  return (
    <ConsoleSection title="Workspace signals" collapsible defaultExpanded={false}>
      <p className="mt-1 text-[11px] leading-4 text-muted-light">
        From AG-UI CUSTOM events: workspace.metadata (file/workspace operations) and sandbox.output (command output).
      </p>
      {metadata.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-foreground">Workspace metadata</div>
          <ul className="mt-1 grid gap-1.5">
            {metadata.map((entry, index) => (
              <li
                key={`${entry.toolCallId ?? "meta"}-${entry.receivedAt}-${index}`}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] leading-4 text-muted"
              >
                {formatWorkspaceMetadataSummary(entry)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sandbox.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-foreground">Sandbox output</div>
          <ul className="mt-1 grid gap-1.5">
            {sandbox.map((entry, index) => (
              <li
                key={`${entry.kind}-${entry.receivedAt}-${index}`}
                className="rounded-lg border border-border bg-surface px-2.5 py-2"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                  {entry.kind}
                </div>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-muted">
                  {formatSandboxOutputText(entry)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ConsoleSection>
  );
}

// Section 2: Progress derived from actual tool calls; each step can open details.
function DynamicStepsList({
  liveRun,
  toolGroups,
  events,
  onSelectEvent,
  onSelectToolGroup,
}: {
  liveRun: LiveRun;
  toolGroups: ProcessToolGroup[];
  events: TimelineEvent[];
  onSelectEvent: (eventId: string) => void;
  onSelectToolGroup: (groupId: string) => void;
}) {
  const eventById = useMemo(
    () => new Map(events.map((event) => [event.id, event] as const)),
    [events],
  );
  const toolCallById = useMemo(
    () => new Map(liveRun.toolCalls.map((call) => [call.id, call] as const)),
    [liveRun.toolCalls],
  );
  const badge = toolGroups.length > 0 ? (
    <span className="tabular text-xs font-medium text-muted-light">
      {toolGroups.filter((group) => group.status === "success").length}/{toolGroups.length}
    </span>
  ) : null;

  return (
    <ConsoleSection title="Progress" badge={badge}>
      {toolGroups.length === 0 ? (
        <EmptyState
          title="No steps yet"
          description="After you send a question, process steps appear here in order. Parallel tools are grouped under one step."
        />
      ) : (
        <ol className={["grid gap-1.5", consoleStepsListClass].join(" ")}>
          {toolGroups.map((group) => {
            const calls = group.toolCallIds
              .map((id) => toolCallById.get(id))
              .filter((call): call is LiveToolCallRecord => Boolean(call));
            const primaryCall = calls[0];
            const primaryEvent = primaryCall ? eventById.get(primaryCall.id) : undefined;
            const rawName = primaryEvent?.toolName ?? primaryCall?.name;
            const kind = calls.length > 1 ? "other" : dataStepKindForTool(rawName);
            const kindLabel = dataStepLabel(kind);
            const tone = stepKindTone(kind);
            const groupDuration =
              group.startedAtMs !== undefined && group.finishedAtMs !== undefined
                ? formatDuration(Math.max(0, group.finishedAtMs - group.startedAtMs))
                : group.status === "running"
                  ? "Running"
                  : "—";
            const body = (
              <>
                <span className={["h-8 w-1 shrink-0 rounded-full", tone.bar].join(" ")} />
                <StepStatusDot status={group.status} />
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block truncate text-xs leading-5",
                      group.status === "failed"
                        ? "font-medium text-step-error"
                        : group.status === "running"
                          ? "font-medium text-foreground"
                          : "text-muted",
                    ].join(" ")}
                  >
                    {group.title}
                  </span>
                  <span className="text-[10px] text-muted-light">
                    Step {group.stepNumber} · {kindLabel}
                    {calls.length > 1 ? ` · ${calls.length} tool calls` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[10px] text-muted-light">
                  <span className="block">{toolStatusLabel(group.status)}</span>
                  <span className="tabular block font-mono">{groupDuration}</span>
                </span>
              </>
            );
            return (
              <li
                key={group.id}
                className={group.status === "running" ? "step-streaming rounded-lg" : "step-enter"}
              >
                <button
                  type="button"
                  onClick={() => onSelectToolGroup(group.id)}
                  className={[
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors duration-200",
                    tone.border,
                    group.status === "running" ? tone.bg : "border-transparent hover:bg-surface-subtle",
                  ].join(" ")}
                >
                  {body}
                </button>
                {calls.length > 1 ? (
                  <div className="ml-5 mt-1 grid gap-1 border-l border-border pl-2">
                    {calls.map((call) => {
                      const event = eventById.get(call.id);
                      const title =
                        event?.title && event.title !== "tool" && event.title !== "unknown"
                          ? event.title
                          : toolDisplayTitle(event?.toolName ?? call.name);
                      return (
                        <button
                          key={call.id}
                          type="button"
                          onClick={() => onSelectEvent(call.id)}
                          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors duration-150 hover:bg-surface"
                        >
                          <StepStatusDot status={call.status} compact />
                          <span className="min-w-0 flex-1 truncate text-muted">{title}</span>
                          <span className="shrink-0 tabular font-mono text-muted-light">
                            {stepDurationLabel(call)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </ConsoleSection>
  );
}

// Section 3: Tool distribution, derived from whatever tools ran.
function ToolDistributionZone({ liveRun }: { liveRun: LiveRun }) {
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const entries = Object.entries(runUsage.toolCalls.byTool);
  if (entries.length === 0) return null;

  return (
    <ConsoleSection title="Tool distribution" collapsible defaultExpanded={false}>
      <div className="grid gap-1.5">
        {entries.map(([name, bucket]) => {
          const kind = dataStepKindForTool(name);
          const kindLabel = dataStepLabel(kind);
          const tone = stepKindTone(kind);
          const share = runUsage.toolCalls.total > 0
            ? Math.max(8, Math.round((bucket.calls / runUsage.toolCalls.total) * 100))
            : 0;
          return (
            <div
              key={name}
              className="grid gap-2 rounded-lg border border-border bg-surface-subtle px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-foreground">{name}</span>
                  <span className={["text-[10px]", tone.text].join(" ")}>{kindLabel}</span>
                </span>
                <span className="tabular shrink-0 text-[11px] text-muted">{bucket.calls} calls</span>
                {bucket.failed > 0 ? (
                  <span className="shrink-0 rounded-full bg-step-error/10 px-2 py-0.5 text-[10px] font-semibold text-step-error">
                    Failed {bucket.failed}
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div className={["h-full rounded-full", tone.bar].join(" ")} style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </ConsoleSection>
  );
}

function StepStatusDot({
  status,
  compact = false,
}: {
  status: LiveToolCallRecord["status"];
  compact?: boolean;
}) {
  const tone =
    status === "success"
      ? "border-step-success bg-step-success"
      : status === "running"
        ? "border-primary-light bg-primary-light/20"
        : "border-step-error bg-step-error";
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center rounded-full border-2",
        compact ? "h-3 w-3" : "h-4 w-4",
        tone,
      ].join(" ")}
    >
      {status === "success" ? (
        <svg viewBox="0 0 12 12" className={compact ? "h-2 w-2 text-white" : "h-2.5 w-2.5 text-white"} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m2.5 6.5 2.5 2.5 4.5-5" />
        </svg>
      ) : status === "running" ? (
        <span className={compact ? "h-1 w-1 rounded-full bg-primary-light" : "h-1.5 w-1.5 rounded-full bg-primary-light"} />
      ) : (
        <span className="text-[9px] font-bold leading-none text-white">!</span>
      )}
    </span>
  );
}

function EvidenceReferencePanel({
  cards,
  onClear,
  onToggle,
  selectedRefs,
}: {
  cards: EvidenceCard[];
  onClear?: () => void;
  onToggle?: (ref: EvidenceRef) => void;
  selectedRefs: EvidenceRef[];
}) {
  const selectedIds = useMemo(() => new Set(selectedRefs.map((ref) => ref.id)), [selectedRefs]);
  const selectedCount = selectedRefs.length;

  return (
    <ConsoleSection
      title="Evidence"
      badge={
        selectedCount > 0 ? (
          <button type="button" onClick={onClear} className={btnSecondaryClass}>
            Clear {selectedCount}
          </button>
        ) : null
      }
    >
      {cards.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="Tables, SQL, files, schema, previews, and knowledge snippets appear here after a run."
        />
      ) : (
        <div className="grid min-w-0 gap-2">
          {cards.map((card) => {
            const selected = selectedIds.has(card.ref.id);
            return (
              <div
                key={card.ref.id}
                className={[
                  "min-w-0 max-w-full overflow-hidden rounded-lg border px-2.5 py-2 transition-colors",
                  selected ? "border-primary-light/50 bg-primary-light/10" : "border-border bg-surface-subtle",
                ].join(" ")}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle?.(card.ref)}
                    className="mt-1 h-3.5 w-3.5 cursor-pointer accent-primary"
                    aria-label={`Select ${card.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                        {card.title}
                      </span>
                      <span className="shrink-0 rounded bg-surface px-1 text-[10px] text-muted-light">
                        {card.origin}
                      </span>
                    </div>
                    {card.subtitle ? (
                      <p className="mt-1 line-clamp-2 break-words text-[11px] leading-4 text-muted">
                        {card.subtitle}
                      </p>
                    ) : null}
                    {card.preview ? (
                      <p className="mt-1 line-clamp-2 break-all font-mono text-[10px] leading-4 text-muted-light">
                        {card.preview}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggle?.(card.ref)}
                    className={selected ? btnSecondaryClass : btnGhostClass}
                  >
                    {selected ? "Remove" : "Ask"}
                  </button>
                </div>
              </div>
            );
          })}
          {selectedCount > 0 ? (
            <p className="text-[11px] leading-4 text-muted-light">
              Selected evidence will appear as chips in the input and focus the next run.
            </p>
          ) : null}
        </div>
      )}
    </ConsoleSection>
  );
}

// Section 3: Data trail, an inline trace that can expand full-screen.
function EvidenceZone({
  artifacts,
  evidenceCards,
  liveRun,
  onClearEvidenceRefs,
  onOpenTrace,
  onSelectArtifact,
  onSelectEvent,
  onToggleEvidenceRef,
  selectedEvidenceRefs,
}: {
  artifacts: DataArtifact[];
  evidenceCards: EvidenceCard[];
  liveRun: LiveRun;
  onClearEvidenceRefs?: () => void;
  onOpenTrace: () => void;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
  onToggleEvidenceRef?: (ref: EvidenceRef) => void;
  selectedEvidenceRefs: EvidenceRef[];
}) {
  return (
    <div className="grid gap-4">
      <RunConfigurationPanel liveRun={liveRun} />
      <EvidenceReferencePanel
        cards={evidenceCards}
        onClear={onClearEvidenceRefs}
        onToggle={onToggleEvidenceRef}
        selectedRefs={selectedEvidenceRefs}
      />
      <ConsoleSection
        title="Data trail"
        badge={
          <button
            type="button"
            onClick={onOpenTrace}
            className={btnSecondaryClass}
          >
            Open full screen
          </button>
        }
      >
        <TraceList
          artifacts={artifacts}
          liveRun={liveRun}
          onSelectArtifact={onSelectArtifact}
          onSelectEvent={onSelectEvent}
        />
      </ConsoleSection>
    </div>
  );
}

// Section 4: Outputs expand in place without jumping to Details.
function DeliverablesZone({
  artifacts,
  events,
  expandedId,
  onExpandedIdChange,
  onMentionArtifact,
  onPromoteArtifact,
  onArtifactExportJob,
  onSelectEvent,
  promotedArtifactIds,
}: {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  expandedId: string | null;
  onExpandedIdChange: (artifactId: string | null) => void;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
  onArtifactExportJob?: (job: JobDto) => void;
  onSelectEvent: (eventId: string) => void;
  promotedArtifactIds?: ReadonlySet<string>;
}) {
  const exportReady = hasCapability("artifact.export");
  const badge = artifacts.length > 0 ? (
    <span className="tabular rounded-full bg-primary-light/15 px-1.5 text-[10px] font-bold leading-4 text-primary">
      {artifacts.length}
    </span>
  ) : null;

  return (
    <div data-guide-id="run-output" className="grid gap-4">
      <ConsoleSection title="Outputs" badge={badge}>
        {artifacts.length === 0 ? (
          <EmptyState
            title="No outputs yet"
            description="SQL, datasets, charts, and reports appear here after a question. Expand an item to inspect it."
          />
        ) : (
          <div className="grid gap-3">
            {artifacts.map((artifact) => {
              const expanded = expandedId === artifact.id;
              const sourceEvent = artifact.createdByEventId
                ? events.find((event) => event.id === artifact.createdByEventId)
                : null;
              return (
                <div
                  key={artifact.id}
                  className={[
                    "overflow-hidden rounded-xl border transition-colors duration-200",
                    expanded
                      ? "border-primary-light/40 bg-surface shadow-sm"
                      : "border-border bg-surface-subtle",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onExpandedIdChange(
                        expandedId === artifact.id ? null : artifact.id,
                      )
                    }
                    className="w-full cursor-pointer p-3 text-left transition-colors duration-200 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/50"
                  >
                    <ArtifactCardHeader
                      artifact={artifact}
                      expanded={expanded}
                      sourceEvent={sourceEvent}
                    />
                  </button>
                  {isFileBackedArtifact(artifact) ? (
                    <ArtifactFileActions
                      artifact={artifact}
                      exportReady={exportReady}
                      promoted={promotedArtifactIds?.has(artifact.id) ?? false}
                      onMentionArtifact={onMentionArtifact}
                      onPromoteArtifact={onPromoteArtifact}
                    />
                  ) : null}
                  {expanded ? (
                    <div className="max-h-[min(480px,55vh)] overflow-y-auto overflow-x-hidden border-t border-border px-3 pb-3 pt-2">
                      {sourceEvent ? (
                        <div className="mb-3 rounded-lg border border-border bg-surface-subtle p-2.5">
                          <div className={sectionLabelClass}>Source step</div>
                          <button
                            type="button"
                            onClick={() => onSelectEvent(sourceEvent.id)}
                            className="mt-1 cursor-pointer rounded-sm text-left text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/50"
                          >
                            {sourceEvent.title} → View in Details
                          </button>
                        </div>
                      ) : null}
                      <ArtifactExpandedDetail
                        artifact={artifact}
                        exportReady={exportReady}
                      />
                      {exportReady ? (
                        <ArtifactExportActions
                          artifact={artifact}
                          onExportJob={onArtifactExportJob}
                        />
                      ) : (
                        <p className="mt-3 text-[11px] leading-4 text-muted-light">
                          Connect the configuration API to preview and download complete outputs.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[11px] leading-4 text-muted-light">
              {exportReady
                ? "Expand an output to view or download the full content."
                : "Preview and download require the backend artifact API."}
            </p>
          </div>
        )}
      </ConsoleSection>
    </div>
  );
}

function isFileBackedArtifact(artifact: DataArtifact): boolean {
  return Boolean(
    artifact.fileId &&
      (artifact.type === "file" ||
        artifact.kind === "file" ||
        artifact.detail?.type === "file"),
  );
}

function ArtifactFileActions({
  artifact,
  exportReady,
  promoted,
  onMentionArtifact,
  onPromoteArtifact,
}: {
  artifact: DataArtifact;
  exportReady: boolean;
  promoted: boolean;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"download" | "promote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promoteReady = hasCapability("artifact.promote");
  const canMention = artifact.detail?.type === "file" && Boolean(artifact.detail.path);

  const handleDownload = async () => {
    if (!exportReady) return;
    setBusy("download");
    setError(null);
    try {
      const { blob, filename } = await artifactExportClient.download(artifact.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || artifact.title;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DownloadFailed");
    } finally {
      setBusy(null);
    }
  };

  const handlePromote = async () => {
    if (!promoteReady || promoted || !onPromoteArtifact) return;
    setBusy("promote");
    setError(null);
    try {
      await onPromoteArtifact(artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add to workspaceFailed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={!exportReady || busy === "download"}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={exportReady ? "Download output file" : "Backend unsupported: artifact.export"}
        >
          {busy === "download" ? "Downloading" : "Download"}
        </button>
        <button
          type="button"
          onClick={() => onMentionArtifact?.(artifact)}
          disabled={!canMention}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={canMention ? "Reference this chat output path" : "Missing a workspace path that can be pinned"}
        >
          @ Mention
        </button>
        <button
          type="button"
          onClick={handlePromote}
          disabled={!promoteReady || promoted || busy === "promote"}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={promoteReady ? "Add as reusable workspace file" : "Backend unsupported: artifact.promote"}
        >
          {promoted ? "Added to workspace" : busy === "promote" ? "Adding" : "Add to workspace"}
        </button>
        {!promoteReady ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
            Add to workspace is backend unsupported
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 rounded bg-step-error/10 px-2 py-1.5 text-[11px] text-step-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function eventForToolCall(
  events: TimelineEvent[],
  call: LiveToolCallRecord | undefined,
): TimelineEvent | undefined {
  if (!call) return undefined;
  return (
    events.find((event) => event.id === call.id) ??
    (call.stepId ? events.find((event) => event.stepId === call.stepId) : undefined)
  );
}

function resolveGroupProducedArtifacts(
  liveRun: LiveRun,
  group: ProcessToolGroup,
  events: TimelineEvent[],
  artifacts: DataArtifact[],
): DataArtifact[] {
  const artifactIds = new Set<string>();
  const linkedEventIds = new Set(group.toolCallIds);
  for (const event of events) {
    if (group.toolCallIds.includes(event.id)) {
      linkedEventIds.add(event.id);
      event.artifactIds?.forEach((id) => artifactIds.add(id));
    }
  }
  for (const call of liveRun.toolCalls) {
    if (!group.toolCallIds.includes(call.id) || !call.stepId) continue;
    for (const event of events) {
      if (event.stepId === call.stepId) {
        linkedEventIds.add(event.id);
        event.artifactIds?.forEach((id) => artifactIds.add(id));
      }
    }
  }
  for (const artifact of artifacts) {
    if (artifact.createdByEventId && linkedEventIds.has(artifact.createdByEventId)) {
      artifactIds.add(artifact.id);
    }
  }
  return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

function resolveTokenUsageForGroup(
  liveRun: LiveRun,
  group: ProcessToolGroup,
): ReturnType<typeof resolveTokenUsageForEvent> {
  return resolveTokenUsageForToolCallIds(liveRun, group.toolCallIds);
}

function ToolGroupDetailView({
  artifacts,
  events,
  group,
  liveRun,
  onBack,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  group: ProcessToolGroup | null;
  liveRun: LiveRun;
  onBack: () => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const calls = useMemo(
    () =>
      group
        ? group.toolCallIds
            .map((id) => liveRun.toolCalls.find((call) => call.id === id))
            .filter((call): call is LiveToolCallRecord => Boolean(call))
        : [],
    [group, liveRun.toolCalls],
  );
  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(
    calls[0]?.id ?? null,
  );

  useEffect(() => {
    setSelectedToolCallId(calls[0]?.id ?? null);
  }, [calls, group?.id]);

  if (!group) {
    return (
      <EmptyState
        title="No step selected"
        description="Select a process step to inspect batch duration, child tools, and output lineage."
      />
    );
  }

  const selectedCall =
    calls.find((call) => call.id === selectedToolCallId) ?? calls[0];
  const selectedEvent = eventForToolCall(events, selectedCall);
  const producedArtifacts = resolveGroupProducedArtifacts(liveRun, group, events, artifacts);
  const selectedProducedArtifacts = selectedEvent
    ? resolveProducedArtifacts(liveRun, selectedEvent, artifacts)
    : [];
  const tokenUsage = resolveTokenUsageForGroup(liveRun, group);
  const groupDuration =
    group.startedAtMs !== undefined && group.finishedAtMs !== undefined
      ? formatDuration(Math.max(0, group.finishedAtMs - group.startedAtMs))
      : group.status === "running"
        ? "Running"
        : "—";

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={sectionLabelClass}>Step details · Step {group.stepNumber}</div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {group.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">{group.summary}</p>
        </div>
        <button type="button" onClick={onBack} className={btnSecondaryClass}>
          Back
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Step duration" value={groupDuration} />
        <Metric label="Status" value={toolStatusLabel(group.status)} />
        <Metric label="Tool calls" value={`${calls.length} calls`} />
        <Metric label="Outputs" value={`${producedArtifacts.length} items`} />
      </div>

      <Panel title="Tool calls">
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {calls.map((call) => {
            const event = eventForToolCall(events, call);
            const active = selectedCall?.id === call.id;
            return (
              <button
                key={call.id}
                type="button"
                onClick={() => setSelectedToolCallId(call.id)}
                className={[
                  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors duration-150",
                  active ? "bg-surface-subtle" : "hover:bg-surface-subtle",
                ].join(" ")}
              >
                <StepStatusDot status={call.status} compact />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {event?.title ?? toolDisplayTitle(call.name)}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-light">
                    {call.name}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[10px] text-muted-light">
                  <span className="block">{toolStatusLabel(call.status)}</span>
                  <span className="tabular block font-mono">{stepDurationLabel(call)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Usage">
        <TokenUsagePanel usage={tokenUsage} />
      </Panel>

      <Panel title="Tool details">
        {selectedEvent && selectedCall ? (
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={sectionLabelClass}>
                  {dataStepLabel(selectedEvent.kind)} · {selectedEvent.ts}
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-foreground">
                  {selectedEvent.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectEvent(selectedEvent.id)}
                className={btnSecondaryClass}
              >
                Tool details
              </button>
            </div>
            <EventPayloadView
              event={selectedEvent}
              producedArtifacts={selectedProducedArtifacts}
              toolCall={selectedCall}
            />
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-light">
            This tool call is not yet linked to a displayable step event.
          </p>
        )}
      </Panel>

      <Panel title="Output lineage">
        {producedArtifacts.length > 0 ? (
          <div className="grid gap-2">
            {producedArtifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="border-b border-border pb-2 last:border-b-0 last:pb-0"
              >
                <div className="truncate text-xs font-semibold text-foreground">
                  {artifact.title}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted-light">
                  {artifact.summary}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-light">This step has not directly produced outputs yet.</p>
        )}
      </Panel>
    </div>
  );
}

function DetailView({
  artifacts,
  event,
  events,
  liveRun,
  selection,
  onBack,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  event: TimelineEvent | null;
  events: TimelineEvent[];
  liveRun: LiveRun;
  selection: ActiveSelection;
  onBack: () => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const toolCall = event ? resolveToolCallForEvent(liveRun, event) : undefined;
  const producedArtifacts = event
    ? resolveProducedArtifacts(liveRun, event, artifacts)
    : [];

  return (
    <ActionDetail
      event={event}
      liveRun={liveRun}
      producedArtifacts={producedArtifacts}
      toolCall={toolCall}
      onBack={onBack}
    />
  );
}

function ArtifactDetailPanel({
  artifact,
  events,
  onBack,
  onSelectEvent,
}: {
  artifact: DataArtifact | null;
  events: TimelineEvent[];
  onBack: () => void;
  onSelectEvent: (eventId: string) => void;
}) {
  if (!artifact) {
    return (
      <EmptyState
        title="No content selected"
        description="Select a visible output to inspect the full SQL, dataset, chart, or report."
      />
    );
  }
  const sourceEvent = artifact.createdByEventId
    ? events.find((event) => event.id === artifact.createdByEventId)
    : null;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={sectionLabelClass}>
            {artifact.type ?? artifact.kind} · {artifact.version ?? "v1"}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {artifact.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {artifact.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className={btnSecondaryClass}
        >
          Back
        </button>
      </div>

      {sourceEvent && (
        <div className="rounded-lg border border-border bg-surface-subtle p-3">
          <div className={sectionLabelClass}>
            Source
          </div>
          <button
            type="button"
            onClick={() => onSelectEvent(sourceEvent.id)}
            className="mt-1 text-left text-xs font-semibold text-primary underline-offset-2 hover:underline"
          >
            {sourceEvent.title} →
          </button>
        </div>
      )}

      <ArtifactExpandedDetail artifact={artifact} />
    </div>
  );
}

function detailStatusLabel(
  toolCall: LiveToolCallRecord | undefined,
  activityStatus?: TimelineEvent["activityStatus"],
): string {
  if (toolCall) {
    return toolStatusLabel(resolveTraceToolStatus(toolCall.status, activityStatus));
  }
  if (activityStatus === "failed") return "Failed";
  if (activityStatus === "completed") return "Completed";
  if (activityStatus === "running") return "Running";
  return "—";
}

function ActionDetail({
  event,
  liveRun,
  producedArtifacts,
  toolCall,
  onBack,
}: {
  event: TimelineEvent | null;
  liveRun: LiveRun;
  producedArtifacts: DataArtifact[];
  toolCall?: LiveToolCallRecord;
  onBack: () => void;
}) {
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(
    null,
  );
  const workspaceMetadata = resolveWorkspaceMetadataForToolCall(
    liveRun,
    toolCall?.id,
  );
  const sandboxOutputs = resolveSandboxOutputsForToolCall(liveRun, toolCall);

  if (!event) {
    return (
      <EmptyState
        title="No action selected"
        description="Select a data action to inspect its parameters, observations, and outputs."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={sectionLabelClass}>
            {dataStepLabel(event.kind)} · {event.ts}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {event.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {event.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className={btnSecondaryClass}
        >
          Back
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Step duration" value={stepDurationLabel(toolCall)} />
        <Metric
          label="Status"
          value={detailStatusLabel(toolCall, event.activityStatus)}
        />
      </div>

      {event.thought && (
        <Panel title="Reasoning">
          <p className="text-sm italic leading-6 text-muted">
            {event.thought}
          </p>
        </Panel>
      )}

      <Panel title="Action details">
        <EventPayloadView
          event={event}
          producedArtifacts={producedArtifacts}
          toolCall={toolCall}
        />
      </Panel>

      {workspaceMetadata ? (
        <Panel title="Workspace metadata">
          <p className="text-xs leading-5 text-muted">
            {formatWorkspaceMetadataSummary(workspaceMetadata)}
          </p>
          <div className={consoleScrollXShellClass}>
            <pre className={[consoleCodeBlockBaseClass, "max-h-48"].join(" ")}>
              <code className={consoleCodeInnerClass}>
                {JSON.stringify(workspaceMetadata.payload, null, 2)}
              </code>
            </pre>
          </div>
        </Panel>
      ) : null}

      {sandboxOutputs.length > 0 ? (
        <Panel title="Sandbox output">
          <div className="grid gap-2">
            {sandboxOutputs.map((output, index) => (
              <div
                key={`${output.kind}-${output.receivedAt}-${index}`}
                className="rounded-lg border border-border bg-surface-subtle p-2.5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                  {output.kind}
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-muted">
                  {formatSandboxOutputText(output)}
                </pre>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Output lineage">
        {producedArtifacts.length > 0 ? (
          <div className="grid gap-2">
            {producedArtifacts.map((artifact) => {
              const expanded = expandedArtifactId === artifact.id;
              return (
                <div
                  key={artifact.id}
                  className="overflow-hidden rounded-lg border border-border bg-surface-subtle"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedArtifactId((current) =>
                        current === artifact.id ? null : artifact.id,
                      )
                    }
                    className="w-full cursor-pointer px-3 py-2 text-left transition-colors duration-200 hover:bg-surface"
                  >
                    <div className="text-xs font-semibold text-foreground">
                      {artifact.title}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-light">
                      {artifact.summary}
                    </p>
                    <span className="mt-1 inline-block text-[10px] font-medium text-muted">
                      {expanded
                        ? "Collapse"
                        : artifact.detail || artifact.previewAvailable
                          ? "Expand content"
                          : "No details"}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="max-h-[min(480px,55vh)] overflow-y-auto overflow-x-hidden border-t border-border px-3 pb-3 pt-2">
                      <ArtifactExpandedDetail artifact={artifact} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[11px] leading-4 text-muted-light">
              See the Outputs tab for the full list.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-light">This action did not directly produce outputs.</p>
        )}
      </Panel>
    </div>
  );
}

function TokenUsagePanel({
  usage,
}: {
  usage: ReturnType<typeof resolveTokenUsageForEvent>;
}) {
  if (!usage.reported) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-subtle p-3">
        <div className="mb-2 inline-flex rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted-light">
          Backend unsupported
        </div>
        <p className="text-xs leading-5 text-muted-light">
          Per-step token, model, and cost usage require backend token_usage events. Run-level usage is shown in Overview.
        </p>
      </div>
    );
  }

  const total = usage.inputTokens + usage.outputTokens;
  const inputShare =
    total > 0 ? Math.max(8, Math.round((usage.inputTokens / total) * 100)) : 0;
  const outputShare =
    total > 0 ? Math.max(8, Math.round((usage.outputTokens / total) * 100)) : 0;

  return (
    <div className="grid gap-3">
      {usage.approximate ? (
        <div className="inline-flex w-fit rounded-full bg-step-warning/10 px-2 py-0.5 text-[10px] font-semibold text-step-warning">
          Approximate match (step_number only)
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Input tokens" value={formatCount(usage.inputTokens)} />
        <Metric label="Output tokens" value={formatCount(usage.outputTokens)} />
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-surface-subtle p-3">
        <TokenUsageBar
          label="Input"
          value={usage.inputTokens}
          width={inputShare}
          tone="bg-step-knowledge"
        />
        <TokenUsageBar
          label="Output"
          value={usage.outputTokens}
          width={outputShare}
          tone="bg-primary-light"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-light">
        {usage.models.length > 0 ? (
          usage.models.map((model) => (
            <span
              key={model}
              className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-muted"
            >
              {model}
            </span>
          ))
        ) : null}
        {usage.costUsd !== undefined ? (
          <span className="rounded-full bg-step-knowledge/10 px-2 py-0.5 font-semibold text-step-knowledge">
            ${usage.costUsd.toFixed(4)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TokenUsageBar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: number;
  width: number;
  tone: string;
}) {
  return (
    <div className="grid grid-cols-[42px_1fr_64px] items-center gap-2">
      <span className="text-[11px] font-medium text-muted-light">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-surface">
        <div
          className={["h-full rounded-full", tone].join(" ")}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="tabular text-right text-[11px] font-semibold text-muted">
        {formatCount(value)}
      </span>
    </div>
  );
}

function SchemaFieldChip({ field }: { field: string }) {
  const [name, type] = field.split(" · ");
  return (
    <span className="inline-flex overflow-hidden rounded border border-border bg-surface font-mono text-[10px]">
      <span className="px-1.5 py-0.5 text-muted">{name}</span>
      {type ? (
        <span className="border-l border-border bg-surface-subtle px-1.5 py-0.5 text-muted-light">
          {type}
        </span>
      ) : null}
    </span>
  );
}

function EventPayloadView({
  event,
  producedArtifacts = [],
  toolCall,
}: {
  event: TimelineEvent;
  producedArtifacts?: DataArtifact[];
  toolCall?: LiveToolCallRecord;
}) {
  if (event.kind === "inspect") {
    const payload = event.payload as {
      tables: Array<{ name: string; description: string; fields: string[] }>;
    };
    if (payload.tables.length === 0) {
      if (toolCall?.result) {
        if (toolResultLooksLikeError(toolCall.result)) {
          return (
            <ToolFailureResult
              toolName={toolCall.name ?? event.toolName ?? "inspect_schema"}
              result={toolCall.result}
            />
          );
        }
        return (
          <ToolFormattedResult
            toolName={toolCall.name ?? event.toolName ?? "inspect_schema"}
            result={toolCall.result}
            variant="console"
          />
        );
      }
      return (
        <p className="text-xs leading-5 text-muted-light">
          Agent is inspecting the selected data source schema (inspect_schema).
        </p>
      );
    }
    return (
      <div className="grid gap-2">
        {payload.tables.map((table) => (
          <div key={table.name} className="rounded-lg border border-border bg-surface-subtle p-3">
            <div className="font-mono text-xs font-semibold text-foreground">
              {table.name}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {table.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {table.fields.map((field) => (
                <SchemaFieldChip key={field} field={field} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (event.kind === "query") {
    const payload = event.payload as {
      question: string;
      sql: string;
      scannedRows: number;
      durationMs: number;
      errorMessage?: string;
    };
    const failed = event.activityStatus === "failed" || toolCall?.status === "failed";
    const errorMessage = payload.errorMessage;
    const resolvedSql =
      payload.sql ||
      (toolCall?.result ? sqlFromToolPayload(undefined, toolCall.result) : undefined) ||
      "";
    const datasetDetail = producedArtifacts.find(
      (artifact) => artifact.detail?.type === "dataset",
    )?.detail;
    return (
      <div className="grid gap-3">
        {payload.question && <Metric label="Question" value={payload.question} />}
        {resolvedSql ? (
          <div className={[consoleScrollXShellClass, "min-w-0"].join(" ")}>
            <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
              <code className={consoleCodeInnerClass}>{resolvedSql}</code>
            </pre>
          </div>
        ) : failed ? (
          <p className="text-xs leading-5 text-step-error">
            {errorMessage || "Read-only SQL execution failed and returned no SQL parameters."}
          </p>
        ) : (
          <p className="text-xs leading-5 text-muted-light">
            Generating read-only SQL. Parameters will appear here after they arrive.
          </p>
        )}
        {failed && errorMessage && resolvedSql ? (
          <p className="rounded-lg bg-step-error/10 px-2.5 py-2 text-xs leading-5 text-step-error">
            {errorMessage}
          </p>
        ) : null}
        {(payload.scannedRows > 0 || payload.durationMs > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Scanned {payload.scannedRows.toLocaleString()} rows</span>
            <span>·</span>
            <span>{payload.durationMs}ms</span>
          </div>
        )}
        {datasetDetail?.type === "dataset" ? (
          <div className="grid gap-2">
            <div className={sectionLabelClass}>Result preview</div>
            <ArtifactDetailView detail={datasetDetail} />
          </div>
        ) : toolCall?.result && toolResultLooksLikeError(toolCall.result) ? (
          <ToolFailureResult
            toolName={toolCall.name ?? event.toolName ?? "run_sql_readonly"}
            result={toolCall.result}
          />
        ) : toolCall?.result && parseSqlToolResult(toolCall.result) ? (
          <div className="grid gap-2">
            <div className={sectionLabelClass}>Result preview</div>
            <ToolFormattedResult
              toolName={toolCall.name ?? event.toolName ?? "run_sql_readonly"}
              result={toolCall.result}
              variant="console"
            />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-2.5 py-2 text-[11px] leading-4 text-muted-light">
            SQL result tables are shown from linked dataset artifacts. This step has not returned preview rows yet.
          </p>
        )}
      </div>
    );
  }

  const payload = event.payload as GenericStepPayload;
  const toolName = event.toolName ?? toolCall?.name;
  const formattedResult = toolCall?.result ?? payload.rawResult;

  if (toolName && formattedResult) {
    if (toolResultLooksLikeError(formattedResult)) {
      return (
        <div className="grid gap-3">
          {payload.description ? (
            <p className="text-xs leading-5 text-muted">{payload.description}</p>
          ) : null}
          <ToolFailureResult toolName={toolName} result={formattedResult} />
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        {payload.description ? (
          <p className="text-xs leading-5 text-muted">{payload.description}</p>
        ) : null}
        <ToolFormattedResult
          toolName={toolName}
          result={formattedResult}
          variant="console"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {payload.description ? (
        <p className="text-xs leading-5 text-muted">{payload.description}</p>
      ) : (
        <p className="text-xs leading-5 text-muted-light">
          This data operation has no additional parameters yet.
        </p>
      )}
      {payload.rawResult ? (
        <div className={consoleScrollXShellClass}>
          <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
            <code className={consoleCodeInnerClass}>{payload.rawResult}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactExportActions({
  artifact,
  onExportJob,
}: {
  artifact: DataArtifact;
  onExportJob?: (job: JobDto) => void;
}) {
  const [previewDetail, setPreviewDetail] = useState<ArtifactDetail | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ArtifactExportFormat | "job" | null>(null);
  const canFormatExport =
    artifact.type === "dataset" ||
    artifact.type === "sql" ||
    artifact.kind === "csv" ||
    artifact.detail?.type === "dataset";

  const handleView = () => {
    setLoadingPreview(true);
    setPreviewError(null);
    void artifactExportClient
      .fetchPreview(artifact.id)
      .then((preview) => {
        const loaded = artifactDetailFromPreview(artifact, preview);
        if (loaded) {
          setPreviewDetail(loaded);
          return;
        }
        setPreviewError("Preview data is empty or unsupported.");
      })
      .catch((error: unknown) => {
        setPreviewError(
          error instanceof Error ? error.message : "Failed to load preview",
        );
      })
      .finally(() => {
        setLoadingPreview(false);
      });
  };

  const handleDownload = (format?: ArtifactExportFormat) => {
    setBusyFormat(format ?? "job");
    setPreviewError(null);
    void artifactExportClient.download(artifact.id, format).then(({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }).catch((error: unknown) => {
      setPreviewError(error instanceof Error ? error.message : "DownloadFailed");
    }).finally(() => {
      setBusyFormat(null);
    });
  };

  const handleExportJob = (format: ArtifactExportFormat) => {
    setBusyFormat("job");
    setPreviewError(null);
    void artifactExportClient.export(artifact.id, format)
      .then((job) => onExportJob?.(job))
      .catch((error: unknown) => {
        setPreviewError(error instanceof Error ? error.message : "Failed to create export job");
      })
      .finally(() => {
        setBusyFormat(null);
      });
  };

  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={handleView}
          disabled={loadingPreview}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {loadingPreview ? "Loading..." : "Preview"}
        </button>
        <button
          type="button"
          onClick={() => handleDownload()}
          disabled={busyFormat !== null}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {busyFormat === "job" ? "Downloading…" : "Download"}
        </button>
        {canFormatExport ? (
          <>
            <button
              type="button"
              onClick={() => handleDownload("csv")}
              disabled={busyFormat !== null}
              className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busyFormat === "csv" ? "Preparing CSV..." : "Download CSV"}
            </button>
            <button
              type="button"
              onClick={() => handleDownload("xlsx")}
              disabled={busyFormat !== null}
              className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busyFormat === "xlsx" ? "Preparing XLSX..." : "Download XLSX"}
            </button>
            <button
              type="button"
              onClick={() => handleExportJob("xlsx")}
              disabled={busyFormat !== null}
              className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Background export
            </button>
          </>
        ) : null}
      </div>
      {previewError ? (
        <p className="rounded-lg bg-step-error/10 px-2.5 py-2 text-xs text-step-error">
          {previewError}
        </p>
      ) : null}
      {previewDetail ? (
        <ArtifactDetailView detail={previewDetail} artifact={artifact} />
      ) : null}
    </div>
  );
}

function ArtifactExpandedDetail({
  artifact,
  exportReady = hasCapability("artifact.export"),
}: {
  artifact: DataArtifact;
  exportReady?: boolean;
}) {
  const [detail, setDetail] = useState<ArtifactDetail | undefined>(artifact.detail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(artifact.detail);
    setError(null);
  }, [artifact.detail, artifact.id]);

  useEffect(() => {
    if (!exportReady || !artifactDetailNeedsPreviewFetch(artifact, detail)) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void artifactExportClient
      .fetchPreview(artifact.id)
      .then((preview) => {
        if (cancelled) {
          return;
        }
        const loaded = artifactDetailFromPreview(artifact, preview);
        if (loaded) {
          setDetail((current) => mergeArtifactDetail(current, loaded));
          return;
        }
        setError("Preview data is empty or unsupported.");
      })
      .catch((fetchError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load preview",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    artifact.id,
    artifact.kind,
    artifact.previewAvailable,
    artifact.title,
    artifact.type,
    detail,
    exportReady,
  ]);

  if (detail) {
    return <ArtifactDetailView detail={detail} artifact={artifact} />;
  }

  if (loading) {
    return <p className="text-xs text-muted-light">Loading preview...</p>;
  }

  if (error) {
    return (
      <p className="rounded-lg bg-step-error/10 px-2.5 py-2 text-xs text-step-error">
        {error}
      </p>
    );
  }

  return (
    <EmptyState
      title="No details"
      description={
        artifact.previewAvailable && exportReady
          ? "Preview could not be loaded after expanding. Try again later."
          : "This output does not include viewable details yet."
      }
    />
  );
}

function ArtifactDetailView({
  detail,
  artifact,
}: {
  detail: ArtifactDetail;
  artifact?: DataArtifact;
}) {
  if (detail.type === "sql") {
    return (
      <div className="grid min-w-0 gap-3">
        <div className={consoleScrollXShellClass}>
          <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
            <code className={consoleCodeInnerClass}>{detail.sql}</code>
          </pre>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-step-success/10 px-2.5 py-1 font-semibold text-step-success">
            Executed
          </span>
          <span>Scanned {detail.scannedRows.toLocaleString()} rows</span>
          <span>·</span>
          <span>{detail.durationMs}ms</span>
        </div>
      </div>
    );
  }

  if (detail.type === "dataset") {
    return <DatasetDetailView detail={detail} />;
  }

  if (detail.type === "chart") {
    return <ChartDetailView detail={detail} />;
  }

  if (detail.type === "file") {
    return <FileDetailView detail={detail} artifact={artifact} />;
  }

  return (
    <div className="grid gap-2">
      {detail.sections.map((section) => (
        <div
          key={section.heading}
          className="rounded-xl border border-border bg-surface p-3"
        >
          <div className="text-xs font-semibold text-foreground">
            {section.heading}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted">
            <ArtifactMarkdownPreview content={section.body} />
          </div>
        </div>
      ))}
    </div>
  );
}

type FileKind = "image" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "html" | "text";

function classifyFileKind(path: string): FileKind {
  const ext = /\.([a-z0-9]+)$/u.exec(path.toLowerCase())?.[1];
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "bmp":
    case "ico":
      return "image";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "csv":
      return "csv";
    case "tsv":
      return "tsv";
    case "json":
    case "jsonl":
    case "geojson":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "html":
    case "htm":
      return "html";
    default:
      return "text";
  }
}

function tryFormatJson(content: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return undefined;
  }
}

function FileCodeBlock({ content }: { content: string }) {
  return (
    <div className={consoleScrollXShellClass}>
      <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
        <code className={consoleCodeInnerClass}>{content}</code>
      </pre>
    </div>
  );
}

function FileNotEmbeddedNote({ downloadable }: { downloadable: boolean }) {
  return (
    <p className="text-[11px] leading-4 text-muted-light">
      {downloadable
        ? "Inline preview is unavailable for this file (binary or too large). Use Download to get the full file."
        : "File content is not embedded for preview (too large or non-text)."}
    </p>
  );
}

function HtmlFilePreview({ content }: { content: string }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowSource((value) => !value)}
          className={`h-7 ${btnSecondaryClass}`}
        >
          {showSource ? "Rendered" : "Source"}
        </button>
      </div>
      {showSource ? (
        <FileCodeBlock content={content} />
      ) : (
        <iframe
          sandbox=""
          srcDoc={content}
          title="HTML preview"
          className="h-80 w-full rounded-lg border border-border bg-white"
        />
      )}
    </div>
  );
}

function FileDetailView({
  detail,
  artifact,
}: {
  detail: Extract<ArtifactDetail, { type: "file" }>;
  artifact?: DataArtifact;
}) {
  const kind = classifyFileKind(detail.path);
  const fileBacked = Boolean(artifact?.fileId);
  const imageSrc =
    kind === "image" && artifact?.fileId
      ? artifactExportClient.contentUrl(artifact.id)
      : undefined;

  const renderBody = () => {
    if (kind === "image") {
      if (!imageSrc) {
        return <FileNotEmbeddedNote downloadable={fileBacked} />;
      }
      return (
        <a href={imageSrc} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={detail.path}
            className="max-h-80 w-auto max-w-full rounded-lg border border-border bg-white object-contain"
          />
        </a>
      );
    }

    if (!detail.content) {
      return <FileNotEmbeddedNote downloadable={fileBacked} />;
    }

    if (kind === "markdown") {
      return <ArtifactMarkdownPreview content={detail.content} />;
    }

    if (kind === "csv" || kind === "tsv") {
      const parsed = parseCsvTextPreview(detail.content, kind === "tsv" ? "\t" : ",");
      if (parsed) {
        return (
          <DatasetDetailView
            detail={{ type: "dataset", columns: parsed.columns, rows: parsed.rows }}
          />
        );
      }
      return <FileCodeBlock content={detail.content} />;
    }

    if (kind === "json") {
      return <FileCodeBlock content={tryFormatJson(detail.content) ?? detail.content} />;
    }

    if (kind === "html") {
      return <HtmlFilePreview content={detail.content} />;
    }

    return <FileCodeBlock content={detail.content} />;
  };

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3 text-xs text-muted">
      <div className="font-mono font-semibold text-foreground">{detail.path}</div>
      <div className="flex flex-wrap gap-3 text-muted">
        {detail.size !== undefined ? <span>{detail.size.toLocaleString()} bytes</span> : null}
        {detail.mtime ? <span>modified {detail.mtime}</span> : null}
        {detail.tool ? <span>via {detail.tool}</span> : null}
      </div>
      {renderBody()}
    </div>
  );
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type ChartDisplayType = "bar" | "line" | "pie";

function isChartDisplayType(value: string | undefined): value is ChartDisplayType {
  return value === "bar" || value === "line" || value === "pie";
}

async function downloadSvgAsPng(container: HTMLDivElement | null, filename: string) {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to export chart"));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(svg.getBoundingClientRect().width));
  canvas.height = Math.max(1, Math.ceil(svg.getBoundingClientRect().height));
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(url);
    return;
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const pngUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = filename;
  link.click();
}

function ChartDetailView({
  detail,
}: {
  detail: Extract<ArtifactDetail, { type: "chart" }>;
}) {
  const points = detail.points.length > 0
    ? detail.points
    : detail.series?.[0]?.points ?? [];
  const initialType = isChartDisplayType(detail.chartType) ? detail.chartType : "bar";
  const [chartType, setChartType] = useState<ChartDisplayType>(initialType);
  const chartRef = useRef<HTMLDivElement | null>(null);

  if (points.length === 0) {
    return (
      <EmptyState
        title="No chart data"
        description="The backend declared a chart artifact but has not reported points/series preview data yet."
      />
    );
  }

  const unit = detail.unit ?? "";
  const chartData = points.map((point) => ({
    label: point.label,
    value: point.value,
  }));

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["bar", "line", "pie"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setChartType(type)}
              className={[
                "h-7 rounded-md px-2 text-[11px] font-semibold transition",
                chartType === type
                  ? "bg-slate-900 text-white"
                  : "border border-border bg-surface text-muted hover:text-foreground",
              ].join(" ")}
            >
              {type}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            void downloadSvgAsPng(chartRef.current, "chart-preview.png").catch(() => undefined);
          }}
          className={`h-7 ${btnSecondaryClass}`}
        >
          Export PNG
        </button>
      </div>
      <div ref={chartRef} className="h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "line" ? (
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${unit}${value}`, "value"]} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--step-visualize)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          ) : chartType === "pie" ? (
            <PieChart>
              <Tooltip formatter={(value) => [`${unit}${value}`, "value"]} />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                outerRadius={86}
                label={(entry) => String((entry as { name?: unknown }).name ?? "")}
              >
                {chartData.map((point, index) => (
                  <Cell
                    key={point.label}
                    fill={index % 2 === 0 ? "var(--step-visualize)" : "var(--primary-light)"}
                  />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${unit}${value}`, "value"]} />
              <Bar dataKey="value" fill="var(--step-visualize)" radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {detail.series && detail.series.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {detail.series.map((series) => (
            <span
              key={series.name}
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted"
            >
              {series.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DatasetDetailView({
  detail,
}: {
  detail: Extract<ArtifactDetail, { type: "dataset" }>;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSortState | null>(null);
  const rows = useMemo(
    () => sortTableRows(filterTableRows(detail.rows, query), sort),
    [detail.rows, query, sort],
  );

  const toggleSort = (columnIndex: number) => {
    setSort((current) => {
      if (!current || current.columnIndex !== columnIndex) {
        return { columnIndex, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { columnIndex, direction: "desc" };
      }
      return null;
    });
  };

  const exportCsv = () => {
    downloadTextFile(
      "dataset-preview.csv",
      tableToCsv(detail.columns, rows),
      "text/csv;charset=utf-8",
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="sr-only">Search result table</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-white px-2.5 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
            placeholder="Search result table"
          />
        </label>
        <button type="button" onClick={exportCsv} className={`h-8 ${btnSecondaryClass}`}>
          Export CSV
        </button>
        <span className="text-[11px] text-muted-light">
          {rows.length.toLocaleString()} / {detail.rows.length.toLocaleString()} rows
        </span>
      </div>
      <div className={consoleTableShellClass}>
        <div className="max-h-[min(480px,60vh)] overflow-y-auto">
          <table className="min-w-max w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-subtle text-muted-light shadow-[0_1px_0_0_var(--border)]">
              <tr>
                {detail.columns.map((column, columnIndex) => {
                  const active = sort?.columnIndex === columnIndex;
                  const suffix = active
                    ? sort.direction === "asc"
                      ? " ↑"
                      : " ↓"
                    : "";
                  return (
                    <th key={column} className="whitespace-nowrap px-3 py-2 font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSort(columnIndex)}
                        className="cursor-pointer text-left transition hover:text-foreground"
                        title={`Sort by ${column} `}
                      >
                        {column}
                        {suffix}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(detail.columns.length, 1)}
                    className="border-t border-border px-3 py-6 text-center text-muted-light"
                  >
                    No matching result rows.
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-border">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={[
                          "whitespace-nowrap px-3 py-2",
                          cellIndex === 0
                            ? "font-medium text-foreground"
                            : "text-muted",
                        ].join(" ")}
                      >
                        {formatConsoleTableCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatConsoleTableCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ArtifactCardHeader({
  artifact,
  expanded,
  sourceEvent,
}: {
  artifact: DataArtifact;
  expanded: boolean;
  sourceEvent?: TimelineEvent | null;
}) {
  const label = artifact.type ?? artifact.kind;
  const tone = artifactToneForType(artifact.type ?? artifact.kind);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {artifact.title}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {artifact.summary}
          </p>
        </div>
        <span
          className={[
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
            tone.bg,
            tone.border,
            tone.text,
          ].join(" ")}
        >
          <span className="text-[10px] leading-none">{tone.icon}</span>
          {label}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
        {sourceEvent ? (
          <>
            <span
              className={[
                "shrink-0 rounded-full px-2 py-0.5 font-semibold",
                stepKindTone(sourceEvent.kind).bg,
                stepKindTone(sourceEvent.kind).text,
              ].join(" ")}
            >
              {dataStepLabel(sourceEvent.kind)}
            </span>
            <span className="min-w-0 truncate text-muted-light" title={sourceEvent.title}>
              From {sourceEvent.title}
            </span>
          </>
        ) : (
          <span className="text-muted-light">Source step not linked</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-light">
        <span>{artifact.version ?? "v1"}</span>
        <span className="font-medium text-muted">
          {expanded ? "Collapse ↑" : artifact.detail || artifact.previewAvailable ? "Expand content ↓" : "No details"}
        </span>
      </div>
    </>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={`${emptyStateClass} p-5`}>
      <div
        aria-hidden="true"
        className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-sm font-semibold text-muted-light"
      >
        ·
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={panelShellClass}>
      <h3 className={`mb-3 ${panelTitleClass}`}>{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-3">
      <div className={metricLabelClass}>{label}</div>
      <div className={`mt-1 ${metricValueClass}`}>{value}</div>
    </div>
  );
}

function KpiMetric({
  label,
  value,
  meta,
  accentClass,
  stackMeta = false,
}: {
  label: string;
  value: string;
  meta?: string;
  accentClass: string;
  stackMeta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-subtle p-3 shadow-sm">
      <div className={metricLabelClass}>{label}</div>
      {stackMeta ? (
        <div className="mt-1 grid min-w-0 gap-0.5">
          <span className={`${kpiValueClass} ${accentClass}`}>{value}</span>
          {meta ? (
            <span className="break-all text-[11px] font-medium leading-snug text-muted-light">
              {meta}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 flex min-w-0 items-end gap-1.5">
          <span className={`${kpiValueClass} ${accentClass}`}>{value}</span>
          {meta ? (
            <span className="mb-1 shrink text-[11px] font-medium text-muted-light">
              {meta}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
