import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import { dataStepKindForTool, dataStepLabel, hasCapability, toolDisplayTitle } from "../../data-task-state";
import { artifactExportClient } from "../../artifact-export-client";
import {
  artifactDetailFromPreview,
  deriveRunUsage,
  formatSandboxOutputText,
  formatWorkspaceMetadataSummary,
  resolveProducedArtifacts,
  resolveSandboxOutputsForToolCall,
  resolveTokenUsageForEvent,
  resolveToolCallForEvent,
  resolveTraceToolStatus,
  resolveWorkspaceMetadataForToolCall,
  type LiveRun,
  type LiveToolCallRecord,
  type SessionUsageStats,
} from "../../live-run-state";
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
import {
  consoleCodeBlockBaseClass,
  consoleCodeInnerClass,
  consoleScrollXShellClass,
  consoleTableShellClass,
} from "./console-scroll-styles";
import { ToolFormattedResult } from "../../tool-result-format";
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
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  selection: TaskSelection;
  visibleEvents: TimelineEvent[];
  currentQuestion?: string;
  /** When set (e.g. from TraceOverlay), jump to 产出 and expand this artifact. */
  artifactFocusId?: string | null;
  onArtifactFocusHandled?: () => void;
  onClearSelection: () => void;
  onClose?: () => void;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onOpenTrace: () => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
  onSelectEvent: (eventId: string) => void;
  promotedArtifactIds?: ReadonlySet<string>;
};

function runStatusLabel(status: LiveRun["runStatus"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "suspended":
      return "等待回复";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "空闲";
  }
}

function toolStatusLabel(status: LiveToolCallRecord["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
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

/** Single-step elapsed time; running/未结束 steps show a soft placeholder. */
function stepDurationLabel(call?: LiveToolCallRecord): string {
  if (!call) return "—";
  if (call.startedAtMs !== undefined && call.finishedAtMs !== undefined) {
    return formatDuration(Math.max(0, call.finishedAtMs - call.startedAtMs));
  }
  if (call.status === "running") return "进行中";
  return "—";
}

export function TaskConsole({
  artifacts,
  liveRun,
  sessionUsage,
  selection,
  visibleEvents,
  currentQuestion,
  artifactFocusId,
  onArtifactFocusHandled,
  onClearSelection,
  onClose,
  onMentionArtifact,
  onOpenTrace,
  onPromoteArtifact,
  onSelectEvent,
  promotedArtifactIds,
}: TaskConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("overview");
  const [outputsExpandedId, setOutputsExpandedId] = useState<string | null>(null);
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const workspaceHasSignals =
    liveRun.workspaceMetadata.length > 0 || liveRun.sandboxOutputs.length > 0;
  const overviewSections = overviewSectionPlan({
    hasWorkspaceSignals: workspaceHasSignals,
    hasToolDistribution: Object.keys(runUsage.toolCalls.byTool).length > 0,
  });

  // Only step/action selection drives the detail tab; artifacts expand in-place on 产出.
  useEffect(() => {
    if (selection?.type === "action") setActiveTab("detail");
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

  return (
    <section className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-l border-border bg-surface">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <div className="min-w-0">
          <h2 className={panelTitleClass}>任务控制台</h2>
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
              {liveRun.runStatus !== "idle" ? formatDuration(runUsage.durationMs) : "尚未开始"}
            </span>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭任务控制台"
            title="关闭任务控制台"
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
          概览
        </TabButton>
        <TabButton
          active={activeTab === "trace"}
          badge={liveRun.toolCalls.length}
          onClick={() => handleTabClick("trace")}
        >
          追溯
        </TabButton>
        <TabButton
          active={activeTab === "outputs"}
          badge={artifacts.length}
          onClick={() => handleTabClick("outputs")}
        >
          产出
        </TabButton>
        <TabButton
          active={activeTab === "detail"}
          badge={selection?.type === "action" ? 1 : undefined}
          onClick={() => handleTabClick("detail")}
        >
          详情
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
                    sessionUsage={sessionUsage}
                  />
                );
              }
              if (section.id === "progress") {
                return (
                  <DynamicStepsList
                    key={section.id}
                    toolCalls={liveRun.toolCalls}
                    events={visibleEvents}
                    onSelectEvent={onSelectEvent}
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
            liveRun={liveRun}
            onOpenTrace={onOpenTrace}
            onSelectArtifact={viewArtifactInOutputs}
            onSelectEvent={onSelectEvent}
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
            onSelectEvent={onSelectEvent}
            promotedArtifactIds={promotedArtifactIds}
          />
        ) : null}

        {activeTab === "detail" ? (
          selection?.type === "action" ? (
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
              title="未选择步骤"
              description="在中间栏的工具卡或「追溯」时间线中点选一个步骤，即可在此查看单步耗时、动作详情与产出血缘。"
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

// 区块 1：结论前置 —— 当前问题、状态、与工具无关的整轮汇总指标。
function ConclusionZone({
  currentQuestion,
  liveRun,
  sessionUsage,
}: {
  currentQuestion?: string;
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
}) {
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const hasRun = liveRun.runStatus !== "idle";
  const toolRatio =
    runUsage.toolCalls.total > 0
      ? `${runUsage.toolCalls.success}/${runUsage.toolCalls.total}`
      : "—";
  const successRate =
    runUsage.toolCalls.total > 0
      ? `${Math.round((runUsage.toolCalls.success / runUsage.toolCalls.total) * 100)}%`
      : "—";

  const tokenReported = runUsage.tokenUsageReported || sessionUsage.tokenUsageReported;
  const displayTokens = runUsage.tokenUsageReported ? runUsage.tokens : sessionUsage.tokens;
  const displayModels = runUsage.models.length > 0 ? runUsage.models : sessionUsage.models;
  const totalTokens = displayTokens.inputTokens + displayTokens.outputTokens;
  const tokenKpi = tokenReported ? formatCount(totalTokens) : "待上报";
  const costKpi =
    displayTokens.costUsd !== undefined
      ? `$${displayTokens.costUsd.toFixed(4)}`
      : "待上报";
  const tokenLine = tokenReported
    ? `入 ${formatCount(displayTokens.inputTokens)} / 出 ${formatCount(
        displayTokens.outputTokens,
      )}${displayModels.length > 0 ? ` · ${displayModels.slice(0, 2).join(" / ")}` : ""}`
    : costKpi;

  return (
    <ConsoleSection title="结论">
      <div>
        <div className={sectionLabelClass}>当前问题</div>
        <p className="mt-1 text-sm leading-6 text-foreground">
          {currentQuestion ?? (
            <span className="text-muted-light">发送问题以启动 dataAgent。</span>
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
          label={liveRun.runHistory?.length ? "步骤数（会话）" : "步骤数"}
          value={hasRun ? formatCount(runUsage.toolCalls.total) : "—"}
          accentClass="text-primary"
        />
        <KpiMetric
          label="成功率"
          value={successRate}
          meta={toolRatio}
          accentClass="text-step-success"
        />
        <KpiMetric
          label={liveRun.runHistory?.length ? "产出（会话）" : "产出"}
          value={hasRun ? formatCount(runUsage.artifactCount) : "—"}
          meta="项"
          accentClass="text-step-query"
        />
        <KpiMetric
          label="Token / 成本"
          value={tokenKpi}
          meta={tokenLine}
          accentClass={tokenReported ? "text-step-knowledge" : "text-muted-light"}
        />
      </div>
    </ConsoleSection>
  );
}

function WorkspaceRunSignalsSummary({ liveRun }: { liveRun: LiveRun }) {
  const metadata = liveRun.workspaceMetadata.slice(0, 4);
  const sandbox = liveRun.sandboxOutputs.slice(0, 4);

  return (
    <ConsoleSection title="工作区信号" collapsible defaultExpanded={false}>
      <p className="mt-1 text-[11px] leading-4 text-muted-light">
        来自 AG-UI CUSTOM 事件：workspace.metadata（文件/工作区操作）与 sandbox.output（命令输出）。
      </p>
      {metadata.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-foreground">工作区元数据</div>
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
          <div className="text-[11px] font-semibold text-foreground">沙箱输出</div>
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

// 区块 2：进展 —— 从真实执行的工具调用派生（tool-agnostic），每步可跳到详情。
function DynamicStepsList({
  toolCalls,
  events,
  onSelectEvent,
}: {
  toolCalls: LiveToolCallRecord[];
  events: TimelineEvent[];
  onSelectEvent: (eventId: string) => void;
}) {
  const eventById = useMemo(
    () => new Map(events.map((event) => [event.id, event] as const)),
    [events],
  );
  const badge = toolCalls.length > 0 ? (
    <span className="tabular text-xs font-medium text-muted-light">
      {toolCalls.filter((call) => call.status === "success").length}/{toolCalls.length}
    </span>
  ) : null;

  return (
    <ConsoleSection title="进展" badge={badge}>
      {toolCalls.length === 0 ? (
        <EmptyState
          title="尚无步骤"
          description="发送问题后，Agent 实际执行的每个数据工具会在这里按顺序出现。"
        />
      ) : (
        <ol className="grid gap-1.5">
          {toolCalls.map((call) => {
            const event = eventById.get(call.id);
            const rawName = event?.toolName ?? call.name;
            const title =
              event?.title && event.title !== "tool" && event.title !== "unknown"
                ? event.title
                : toolDisplayTitle(rawName);
            const kind = dataStepKindForTool(rawName);
            const kindLabel = dataStepLabel(kind);
            const tone = stepKindTone(kind);
            const body = (
              <>
                <span className={["h-8 w-1 shrink-0 rounded-full", tone.bar].join(" ")} />
                <StepStatusDot status={call.status} />
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block truncate text-xs leading-5",
                      call.status === "failed"
                        ? "font-medium text-step-error"
                        : call.status === "running"
                          ? "font-medium text-foreground"
                          : "text-muted",
                    ].join(" ")}
                  >
                    {title}
                  </span>
                  <span className="text-[10px] text-muted-light">{kindLabel}</span>
                </span>
                <span className="shrink-0 text-right text-[10px] text-muted-light">
                  <span className="block">{toolStatusLabel(call.status)}</span>
                  <span className="tabular block font-mono">{stepDurationLabel(call)}</span>
                </span>
              </>
            );
            return (
              <li
                key={call.id}
                className={call.status === "running" ? "step-streaming rounded-lg" : "step-enter"}
              >
                {event ? (
                  <button
                    type="button"
                    onClick={() => onSelectEvent(call.id)}
                    className={[
                      "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors duration-200",
                      tone.border,
                      call.status === "running" ? tone.bg : "border-transparent hover:bg-primary-light/5",
                    ].join(" ")}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </ConsoleSection>
  );
}

// 区块 3：按工具分布 —— 谁跑了显示谁，工具无关。
function ToolDistributionZone({ liveRun }: { liveRun: LiveRun }) {
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const entries = Object.entries(runUsage.toolCalls.byTool);
  if (entries.length === 0) return null;

  return (
    <ConsoleSection title="按工具分布" collapsible defaultExpanded={false}>
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
                <span className="tabular shrink-0 text-[11px] text-muted">{bucket.calls} 次</span>
                {bucket.failed > 0 ? (
                  <span className="shrink-0 rounded-full bg-step-error/10 px-2 py-0.5 text-[10px] font-semibold text-step-error">
                    失败 {bucket.failed}
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

function StepStatusDot({ status }: { status: LiveToolCallRecord["status"] }) {
  const tone =
    status === "success"
      ? "border-step-success bg-step-success"
      : status === "running"
        ? "border-primary-light bg-primary-light/20"
        : "border-step-error bg-step-error";
  return (
    <span
      className={[
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
        tone,
      ].join(" ")}
    >
      {status === "success" ? (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m2.5 6.5 2.5 2.5 4.5-5" />
        </svg>
      ) : status === "running" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-primary-light" />
      ) : (
        <span className="text-[9px] font-bold leading-none text-white">!</span>
      )}
    </span>
  );
}

// 区块 3：数据足迹 / 证据链 —— 持久内联时间线，可放大为全屏。
function EvidenceZone({
  artifacts,
  liveRun,
  onOpenTrace,
  onSelectArtifact,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  liveRun: LiveRun;
  onOpenTrace: () => void;
  onSelectArtifact: (artifactId: string) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <RunConfigurationPanel liveRun={liveRun} />
      <ConsoleSection
        title="数据足迹 · 证据链"
        badge={
          <button
            type="button"
            onClick={onOpenTrace}
            className={btnSecondaryClass}
          >
            放大全屏
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

// 区块 4：产物 —— 在本 Tab 内展开查看内容，不跳转到「详情」。
function DeliverablesZone({
  artifacts,
  events,
  expandedId,
  onExpandedIdChange,
  onMentionArtifact,
  onPromoteArtifact,
  onSelectEvent,
  promotedArtifactIds,
}: {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  expandedId: string | null;
  onExpandedIdChange: (artifactId: string | null) => void;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
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
    <div className="grid gap-4">
      <ConsoleSection title="产物" badge={badge}>
        {artifacts.length === 0 ? (
          <EmptyState
            title="暂无产出"
            description="发送问题后，SQL、数据集、图表和报告会在这里显示，可点击展开查看完整内容。"
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
                    <div className="border-t border-border px-3 pb-3 pt-2">
                      {sourceEvent ? (
                        <div className="mb-3 rounded-lg border border-border bg-surface-subtle p-2.5">
                          <div className={sectionLabelClass}>来源步骤</div>
                          <button
                            type="button"
                            onClick={() => onSelectEvent(sourceEvent.id)}
                            className="mt-1 cursor-pointer rounded-sm text-left text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/50"
                          >
                            {sourceEvent.title} → 在详情中查看
                          </button>
                        </div>
                      ) : null}
                      <ArtifactExpandedDetail
                        artifact={artifact}
                        exportReady={exportReady}
                      />
                      {exportReady ? (
                        <ArtifactExportActions artifact={artifact} />
                      ) : (
                        <p className="mt-3 text-[11px] leading-4 text-muted-light">
                          连接配置 API 后可预览与下载完整产物。
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[11px] leading-4 text-muted-light">
              {exportReady
                ? "展开产物后可查看或下载完整内容。"
                : "预览与下载需后端 artifact 接口可用。"}
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
      setError(err instanceof Error ? err.message : "下载失败");
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
      setError(err instanceof Error ? err.message : "加入工作区失败");
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
          title={exportReady ? "下载产物文件" : "后端未支持 artifact.export"}
        >
          {busy === "download" ? "下载中" : "下载"}
        </button>
        <button
          type="button"
          onClick={() => onMentionArtifact?.(artifact)}
          disabled={!canMention}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={canMention ? "引用本对话产物路径" : "缺少可 pin 的工作区路径"}
        >
          @ 引用
        </button>
        <button
          type="button"
          onClick={handlePromote}
          disabled={!promoteReady || promoted || busy === "promote"}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={promoteReady ? "加入跨会话工作区文件" : "后端未支持 artifact.promote"}
        >
          {promoted ? "已加入工作区" : busy === "promote" ? "加入中" : "加入工作区"}
        </button>
        {!promoteReady ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
            加入工作区后端未支持
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
  const tokenUsage = resolveTokenUsageForEvent(liveRun, event);

  return (
    <ActionDetail
      event={event}
      liveRun={liveRun}
      producedArtifacts={producedArtifacts}
      tokenUsage={tokenUsage}
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
        title="未选择内容"
        description="选择一个可见产出物，即可在此查看完整 SQL、数据集、图表或报告。"
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
          返回
        </button>
      </div>

      {sourceEvent && (
        <div className="rounded-lg border border-border bg-surface-subtle p-3">
          <div className={sectionLabelClass}>
            来源
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
  if (activityStatus === "failed") return "失败";
  if (activityStatus === "completed") return "已完成";
  if (activityStatus === "running") return "进行中";
  return "—";
}

function ActionDetail({
  event,
  liveRun,
  producedArtifacts,
  tokenUsage,
  toolCall,
  onBack,
}: {
  event: TimelineEvent | null;
  liveRun: LiveRun;
  producedArtifacts: DataArtifact[];
  tokenUsage: ReturnType<typeof resolveTokenUsageForEvent>;
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
        title="未选择动作"
        description="选择一个数据动作，即可查看它的参数、观察结果与产出。"
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
          返回
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="单步耗时" value={stepDurationLabel(toolCall)} />
        <Metric
          label="状态"
          value={detailStatusLabel(toolCall, event.activityStatus)}
        />
      </div>

      {event.thought && (
        <Panel title="推理">
          <p className="text-sm italic leading-6 text-muted">
            {event.thought}
          </p>
        </Panel>
      )}

      <Panel title="动作详情">
        <EventPayloadView
          event={event}
          producedArtifacts={producedArtifacts}
          toolCall={toolCall}
        />
      </Panel>

      {workspaceMetadata ? (
        <Panel title="工作区元数据">
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
        <Panel title="沙箱输出">
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

      <Panel title="用量">
        <TokenUsagePanel usage={tokenUsage} />
      </Panel>

      <Panel title="产出血缘">
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
                        ? "收起"
                        : artifact.detail || artifact.previewAvailable
                          ? "展开内容"
                          : "无详情"}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-border px-3 pb-3 pt-2">
                      <ArtifactExpandedDetail artifact={artifact} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[11px] leading-4 text-muted-light">
              完整列表见「产出」Tab。
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-light">该动作未直接生成产出物。</p>
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
          后端未支持
        </div>
        <p className="text-xs leading-5 text-muted-light">
          按步骤 Token、模型与成本用量待后端通过 token_usage 事件上报。整轮用量见「概览」。
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
          近似匹配（仅 step_number）
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="输入 Token" value={formatCount(usage.inputTokens)} />
        <Metric label="输出 Token" value={formatCount(usage.outputTokens)} />
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-surface-subtle p-3">
        <TokenUsageBar
          label="输入"
          value={usage.inputTokens}
          width={inputShare}
          tone="bg-step-knowledge"
        />
        <TokenUsageBar
          label="输出"
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
        ) : (
          <span>模型待上报</span>
        )}
        {usage.costUsd !== undefined ? (
          <span className="rounded-full bg-step-knowledge/10 px-2 py-0.5 font-semibold text-step-knowledge">
            ${usage.costUsd.toFixed(4)}
          </span>
        ) : (
          <span>成本待上报</span>
        )}
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
      return (
        <p className="text-xs leading-5 text-muted-light">
          Agent 正在检查所选数据源的表结构（inspect_schema）。
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
    const datasetDetail = producedArtifacts.find(
      (artifact) => artifact.detail?.type === "dataset",
    )?.detail;
    return (
      <div className="grid gap-3">
        {payload.question && <Metric label="问题" value={payload.question} />}
        {payload.sql ? (
          <div className={[consoleScrollXShellClass, "min-w-0"].join(" ")}>
            <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
              <code className={consoleCodeInnerClass}>{payload.sql}</code>
            </pre>
          </div>
        ) : failed ? (
          <p className="text-xs leading-5 text-step-error">
            {errorMessage || "只读 SQL 执行失败，未返回 SQL 参数。"}
          </p>
        ) : (
          <p className="text-xs leading-5 text-muted-light">
            正在生成只读 SQL，参数返回后会显示在这里。
          </p>
        )}
        {failed && errorMessage && payload.sql ? (
          <p className="rounded-lg bg-step-error/10 px-2.5 py-2 text-xs leading-5 text-step-error">
            {errorMessage}
          </p>
        ) : null}
        {(payload.scannedRows > 0 || payload.durationMs > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>扫描 {payload.scannedRows.toLocaleString()} 行</span>
            <span>·</span>
            <span>{payload.durationMs}ms</span>
          </div>
        )}
        {datasetDetail?.type === "dataset" ? (
          <div className="grid gap-2">
            <div className={sectionLabelClass}>结果预览</div>
            <ArtifactDetailView detail={datasetDetail} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-2.5 py-2 text-[11px] leading-4 text-muted-light">
            SQL 结果表将从关联的 dataset artifact 展示；当前步骤尚未返回可预览结果行。
          </p>
        )}
      </div>
    );
  }

  const payload = event.payload as GenericStepPayload;
  const toolName = event.toolName ?? toolCall?.name;
  const formattedResult = toolCall?.result ?? payload.rawResult;

  if (toolName && formattedResult) {
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
          该数据操作暂无更多参数。
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

function ArtifactExportActions({ artifact }: { artifact: DataArtifact }) {
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const handleView = () => {
    setLoadingPreview(true);
    setPreviewError(null);
    void artifactExportClient
      .fetchPreview(artifact.id)
      .then((preview) => {
        if (typeof preview.content === "string") {
          setPreviewText(preview.content);
          return;
        }
        setPreviewText(JSON.stringify(preview, null, 2));
      })
      .catch((error: unknown) => {
        setPreviewError(
          error instanceof Error ? error.message : "预览加载失败",
        );
      })
      .finally(() => {
        setLoadingPreview(false);
      });
  };

  const handleDownload = () => {
    void artifactExportClient.download(artifact.id).then(({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
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
          {loadingPreview ? "加载中…" : "预览"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className={btnSecondaryClass}
        >
          下载
        </button>
      </div>
      {previewError ? (
        <p className="rounded-lg bg-step-error/10 px-2.5 py-2 text-xs text-step-error">
          {previewError}
        </p>
      ) : null}
      {previewText ? (
        <div className={consoleScrollXShellClass}>
          <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
            <code className={consoleCodeInnerClass}>{previewText}</code>
          </pre>
        </div>
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
    if (detail || !artifact.previewAvailable || !exportReady) {
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
          setDetail(loaded);
          return;
        }
        setError("预览数据为空或格式暂不支持。");
      })
      .catch((fetchError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          fetchError instanceof Error ? fetchError.message : "预览加载失败",
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
    return <ArtifactDetailView detail={detail} />;
  }

  if (loading) {
    return <p className="text-xs text-muted-light">正在加载预览…</p>;
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
      title="暂无详情"
      description={
        artifact.previewAvailable && exportReady
          ? "展开时未能加载预览，请稍后重试。"
          : "该产出物尚未包含可查看的详细内容。"
      }
    />
  );
}

function ArtifactDetailView({ detail }: { detail: ArtifactDetail }) {
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
            已执行
          </span>
          <span>扫描 {detail.scannedRows.toLocaleString()} 行</span>
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
    return (
      <div className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3 text-xs text-muted">
        <div className="font-mono font-semibold text-foreground">{detail.path}</div>
        <div className="flex flex-wrap gap-3 text-muted">
          {detail.size !== undefined ? <span>{detail.size.toLocaleString()} bytes</span> : null}
          {detail.mtime ? <span>modified {detail.mtime}</span> : null}
          {detail.tool ? <span>via {detail.tool}</span> : null}
        </div>
        {detail.content ? (
          <div className={consoleScrollXShellClass}>
            <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
              <code className={consoleCodeInnerClass}>{detail.content}</code>
            </pre>
          </div>
        ) : (
          <p className="text-[11px] leading-4 text-muted-light">
            文件内容未内嵌预览（体积过大或非文本）。完整查看 / 下载需后端 artifact 接口（#9）。
          </p>
        )}
      </div>
    );
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
          <p className="mt-1 text-xs leading-5 text-muted">
            {section.body}
          </p>
        </div>
      ))}
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
    image.onerror = () => reject(new Error("图表导出失败"));
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
        title="暂无图表数据"
        description="后端已声明 chart artifact，但尚未上报 points/series 预览数据。"
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
          导出 PNG
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
          <span className="sr-only">搜索结果表</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-white px-2.5 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
            placeholder="搜索结果表"
          />
        </label>
        <button type="button" onClick={exportCsv} className={`h-8 ${btnSecondaryClass}`}>
          导出 CSV
        </button>
        <span className="text-[11px] text-muted-light">
          {rows.length.toLocaleString()} / {detail.rows.length.toLocaleString()} 行
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
                        title={`按 ${column} 排序`}
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
                    没有匹配的结果行。
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
                        {cell}
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
              来自 {sourceEvent.title}
            </span>
          </>
        ) : (
          <span className="text-muted-light">来源步骤未关联</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-light">
        <span>{artifact.version ?? "v1"}</span>
        <span className="font-medium text-muted">
          {expanded ? "收起 ↑" : artifact.detail || artifact.previewAvailable ? "展开内容 ↓" : "无详情"}
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
}: {
  label: string;
  value: string;
  meta?: string;
  accentClass: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-subtle p-3 shadow-sm">
      <div className={metricLabelClass}>{label}</div>
      <div className="mt-1 flex min-w-0 items-end gap-1.5">
        <span className={`${kpiValueClass} ${accentClass}`}>{value}</span>
        {meta ? (
          <span className="mb-1 truncate text-[11px] font-medium text-muted-light">
            {meta}
          </span>
        ) : null}
      </div>
    </div>
  );
}
