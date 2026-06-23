import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ArtifactDetail,
  DataArtifact,
  GenericStepPayload,
  TimelineEvent,
} from "../../data-task-state";
import { dataStepKindForTool, dataStepLabel, hasCapability } from "../../data-task-state";
import {
  deriveRunUsage,
  resolveProducedArtifacts,
  resolveToolCallForEvent,
  resolveTraceToolStatus,
  type LiveRun,
  type LiveToolCallRecord,
  type SessionUsageStats,
} from "../../live-run-state";
import type { TaskSelection } from "../../page";
import { TraceList } from "./TraceList";
import {
  consoleCodeBlockBaseClass,
  consoleCodeInnerClass,
  consoleScrollXShellClass,
  consoleTableShellClass,
} from "./console-scroll-styles";

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
  onOpenTrace: () => void;
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
  onOpenTrace,
  onSelectEvent,
}: TaskConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("overview");
  const [outputsExpandedId, setOutputsExpandedId] = useState<string | null>(null);

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
    <section className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">任务控制台</h2>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭任务控制台"
            title="关闭任务控制台"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        ) : null}
      </header>

      <nav className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-3 py-2">
        <TabButton active={activeTab === "overview"} onClick={() => handleTabClick("overview")}>
          概览
        </TabButton>
        <TabButton active={activeTab === "trace"} onClick={() => handleTabClick("trace")}>
          追溯
        </TabButton>
        <TabButton
          active={activeTab === "outputs"}
          badge={artifacts.length}
          onClick={() => handleTabClick("outputs")}
        >
          产出
        </TabButton>
        <TabButton active={activeTab === "detail"} onClick={() => handleTabClick("detail")}>
          详情
        </TabButton>
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        {activeTab === "overview" ? (
          <div className="grid gap-4">
            <ConclusionZone
              currentQuestion={currentQuestion}
              liveRun={liveRun}
              sessionUsage={sessionUsage}
            />
            <DynamicStepsList
              toolCalls={liveRun.toolCalls}
              events={visibleEvents}
              onSelectEvent={onSelectEvent}
            />
            <ToolDistributionZone liveRun={liveRun} />
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
            onSelectEvent={onSelectEvent}
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
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      ].join(" ")}
    >
      {children}
      {badge !== undefined && badge > 0 ? (
        <span
          className={[
            "rounded-full px-1.5 text-[10px] font-bold leading-4",
            active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function StatusBadge({ status }: { status: LiveRun["runStatus"] }) {
  const tone =
    status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : status === "running"
        ? "bg-blue-50 text-blue-700"
        : status === "failed"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-500";
  const dot =
    status === "completed"
      ? "bg-emerald-500"
      : status === "running"
        ? "bg-blue-500"
        : status === "failed"
          ? "bg-red-500"
          : "bg-slate-400";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        tone,
      ].join(" ")}
    >
      <span className={["h-1.5 w-1.5 rounded-full", dot].join(" ")} />
      {runStatusLabel(status)}
    </span>
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

  const tokenReported = runUsage.tokenUsageReported || sessionUsage.tokenUsageReported;
  const tokenLine = tokenReported
    ? `整轮 Token：输入 ${formatCount(runUsage.tokens.inputTokens)} · 输出 ${formatCount(
        runUsage.tokens.outputTokens,
      )}`
    : "整轮 Token 用量待后端通过 token_usage 事件上报";

  return (
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={liveRun.runStatus} />
        <span className="text-xs text-slate-500">
          {hasRun ? `运行耗时 ${formatDuration(runUsage.durationMs)}` : "尚未开始"}
        </span>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          当前问题
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-900">
          {currentQuestion ?? (
            <span className="text-slate-400">发送问题以启动 dataAgent。</span>
          )}
        </p>
      </div>

      {liveRun.errorMessage ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {liveRun.errorMessage}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="步骤数" value={hasRun ? formatCount(runUsage.toolCalls.total) : "—"} />
        <Metric label="工具成功" value={toolRatio} />
        <Metric label="运行耗时" value={hasRun ? formatDuration(runUsage.durationMs) : "—"} />
        <Metric label="产出" value={hasRun ? `${runUsage.artifactCount} 项` : "—"} />
      </div>

      <p className="mt-2 text-[11px] leading-4 text-slate-400">{tokenLine}</p>
    </section>
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

  return (
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-950">进展</h3>
        {toolCalls.length > 0 ? (
          <span className="text-xs font-medium text-slate-500">
            {toolCalls.filter((call) => call.status === "success").length}/{toolCalls.length}
          </span>
        ) : null}
      </div>
      {toolCalls.length === 0 ? (
        <EmptyState
          title="尚无步骤"
          description="发送问题后，Agent 实际执行的每个数据工具会在这里按顺序出现。"
        />
      ) : (
        <ol className="grid gap-1.5">
          {toolCalls.map((call) => {
            const event = eventById.get(call.id);
            const title = event?.title ?? call.name;
            const kindLabel = dataStepLabel(dataStepKindForTool(call.name));
            const body = (
              <>
                <StepStatusDot status={call.status} />
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block truncate text-xs leading-5",
                      call.status === "failed"
                        ? "font-medium text-red-700"
                        : call.status === "running"
                          ? "font-medium text-slate-900"
                          : "text-slate-700",
                    ].join(" ")}
                  >
                    {title}
                  </span>
                  <span className="text-[10px] text-slate-400">{kindLabel}</span>
                </span>
                <span className="shrink-0 text-right text-[10px] text-slate-400">
                  <span className="block">{toolStatusLabel(call.status)}</span>
                  <span className="block font-mono">{stepDurationLabel(call)}</span>
                </span>
              </>
            );
            return (
              <li key={call.id}>
                {event ? (
                  <button
                    type="button"
                    onClick={() => onSelectEvent(call.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
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
    </section>
  );
}

// 区块 3：按工具分布 —— 谁跑了显示谁，工具无关。
function ToolDistributionZone({ liveRun }: { liveRun: LiveRun }) {
  const runUsage = useMemo(() => deriveRunUsage(liveRun), [liveRun]);
  const entries = Object.entries(runUsage.toolCalls.byTool);
  if (entries.length === 0) return null;

  return (
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">按工具分布</h3>
      <div className="grid gap-1.5">
        {entries.map(([name, bucket]) => {
          const kindLabel = dataStepLabel(dataStepKindForTool(name));
          return (
            <div
              key={name}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-slate-900">{name}</span>
                <span className="text-[10px] text-slate-400">{kindLabel}</span>
              </span>
              <span className="shrink-0 text-[11px] text-slate-600">{bucket.calls} 次</span>
              {bucket.failed > 0 ? (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  失败 {bucket.failed}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepStatusDot({ status }: { status: LiveToolCallRecord["status"] }) {
  const tone =
    status === "success"
      ? "border-emerald-500 bg-emerald-500"
      : status === "running"
        ? "border-blue-500 bg-blue-100"
        : "border-red-500 bg-red-500";
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
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
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
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-950">数据足迹 · 证据链</h3>
        <button
          type="button"
          onClick={onOpenTrace}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          放大全屏
        </button>
      </div>
      <TraceList
        artifacts={artifacts}
        liveRun={liveRun}
        onSelectArtifact={onSelectArtifact}
        onSelectEvent={onSelectEvent}
      />
    </section>
  );
}

// 区块 4：产物 —— 在本 Tab 内展开查看内容，不跳转到「详情」。
function DeliverablesZone({
  artifacts,
  events,
  expandedId,
  onExpandedIdChange,
  onSelectEvent,
}: {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  expandedId: string | null;
  onExpandedIdChange: (artifactId: string | null) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const exportReady = hasCapability("artifact.export");

  return (
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-950">产物</h3>
        {artifacts.length > 0 ? (
          <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold leading-4 text-slate-700">
            {artifacts.length}
          </span>
        ) : null}
      </div>
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
                  "overflow-hidden rounded-xl border transition",
                  expanded
                    ? "border-slate-300 bg-white shadow-sm"
                    : "border-slate-200 bg-slate-50",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() =>
                    onExpandedIdChange(
                      expandedId === artifact.id ? null : artifact.id,
                    )
                  }
                  className="w-full p-3 text-left transition hover:bg-white"
                >
                  <ArtifactCardHeader
                    artifact={artifact}
                    expanded={expanded}
                    sourceEvent={sourceEvent}
                  />
                </button>
                {expanded ? (
                  <div className="border-t border-slate-200 px-3 pb-3 pt-2">
                    {sourceEvent ? (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                          来源步骤
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectEvent(sourceEvent.id)}
                          className="mt-1 text-left text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
                        >
                          {sourceEvent.title} → 在详情中查看
                        </button>
                      </div>
                    ) : null}
                    {artifact.detail ? (
                      <ArtifactDetailView detail={artifact.detail} />
                    ) : (
                      <EmptyState
                        title="暂无详情"
                        description="该产出物尚未包含可查看的详细内容。"
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          <p className="text-[11px] leading-4 text-slate-400">
            {exportReady
              ? "展开产物后可导出 / 下载。"
              : "导出 / 下载待后端 artifact 预览接口（#9）支持。"}
          </p>
        </div>
      )}
    </section>
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {artifact.type ?? artifact.kind} · {artifact.version ?? "v1"}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">
            {artifact.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {artifact.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          返回
        </button>
      </div>

      {sourceEvent && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            来源
          </div>
          <button
            type="button"
            onClick={() => onSelectEvent(sourceEvent.id)}
            className="mt-1 text-left text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
          >
            {sourceEvent.title} →
          </button>
        </div>
      )}

      {artifact.detail ? (
        <ArtifactDetailView detail={artifact.detail} />
      ) : (
        <EmptyState
          title="暂无详情"
          description="该产出物尚未包含可查看的详细内容。"
        />
      )}
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
  producedArtifacts,
  toolCall,
  onBack,
}: {
  event: TimelineEvent | null;
  producedArtifacts: DataArtifact[];
  toolCall?: LiveToolCallRecord;
  onBack: () => void;
}) {
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(
    null,
  );

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
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {dataStepLabel(event.kind)} · {event.ts}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">
            {event.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {event.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
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
          <p className="text-sm italic leading-6 text-slate-600">
            {event.thought}
          </p>
        </Panel>
      )}

      <Panel title="动作详情">
        <EventPayloadView event={event} toolCall={toolCall} />
      </Panel>

      <Panel title="用量">
        <p className="text-xs leading-5 text-slate-500">
          按步骤 Token 用量待后端支持（当前仅在 run 级通过 token_usage 上报，整轮汇总见「概览」）。
        </p>
      </Panel>

      <Panel title="产出血缘">
        {producedArtifacts.length > 0 ? (
          <div className="grid gap-2">
            {producedArtifacts.map((artifact) => {
              const expanded = expandedArtifactId === artifact.id;
              return (
                <div
                  key={artifact.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedArtifactId((current) =>
                        current === artifact.id ? null : artifact.id,
                      )
                    }
                    className="w-full px-3 py-2 text-left transition hover:bg-white"
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      {artifact.title}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      {artifact.summary}
                    </p>
                    <span className="mt-1 inline-block text-[10px] font-medium text-slate-600">
                      {expanded ? "收起" : artifact.detail ? "展开内容" : "无详情"}
                    </span>
                  </button>
                  {expanded && artifact.detail ? (
                    <div className="border-t border-slate-200 px-3 pb-3 pt-2">
                      <ArtifactDetailView detail={artifact.detail} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[11px] leading-4 text-slate-400">
              完整列表见「产出」Tab。
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">该动作未直接生成产出物。</p>
        )}
      </Panel>
    </div>
  );
}

function EventPayloadView({
  event,
  toolCall,
}: {
  event: TimelineEvent;
  toolCall?: LiveToolCallRecord;
}) {
  if (event.kind === "inspect") {
    const payload = event.payload as {
      tables: Array<{ name: string; description: string; fields: string[] }>;
    };
    if (payload.tables.length === 0) {
      return (
        <p className="text-xs leading-5 text-slate-500">
          Agent 正在检查所选数据源的表结构（inspect_schema）。
        </p>
      );
    }
    return (
      <div className="grid gap-2">
        {payload.tables.map((table) => (
          <div key={table.name} className="rounded-lg bg-slate-50 p-3">
            <div className="font-mono text-xs font-semibold text-slate-900">
              {table.name}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-slate-600">
              {table.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {table.fields.map((field) => (
                <span
                  key={field}
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                >
                  {field}
                </span>
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
          <p className="text-xs leading-5 text-red-700">
            {errorMessage || "只读 SQL 执行失败，未返回 SQL 参数。"}
          </p>
        ) : (
          <p className="text-xs leading-5 text-slate-500">
            正在生成只读 SQL，参数返回后会显示在这里。
          </p>
        )}
        {failed && errorMessage && payload.sql ? (
          <p className="rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-800">
            {errorMessage}
          </p>
        ) : null}
        {(payload.scannedRows > 0 || payload.durationMs > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>扫描 {payload.scannedRows.toLocaleString()} 行</span>
            <span>·</span>
            <span>{payload.durationMs}ms</span>
          </div>
        )}
      </div>
    );
  }

  const payload = event.payload as GenericStepPayload;
  return (
    <div className="grid gap-3">
      {payload.description ? (
        <p className="text-xs leading-5 text-slate-600">{payload.description}</p>
      ) : (
        <p className="text-xs leading-5 text-slate-500">
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

function ArtifactDetailView({ detail }: { detail: ArtifactDetail }) {
  if (detail.type === "sql") {
    return (
      <div className="grid min-w-0 gap-3">
        <div className={consoleScrollXShellClass}>
          <pre className={[consoleCodeBlockBaseClass, "max-h-80"].join(" ")}>
            <code className={consoleCodeInnerClass}>{detail.sql}</code>
          </pre>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
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
    return (
      <div className={consoleTableShellClass}>
        <div className="max-h-[min(480px,60vh)] overflow-y-auto">
          <table className="min-w-max w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                {detail.columns.map((column) => (
                  <th
                    key={column}
                    className="whitespace-nowrap px-3 py-2 font-semibold"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-slate-100">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={[
                        "whitespace-nowrap px-3 py-2",
                        cellIndex === 0
                          ? "font-medium text-slate-900"
                          : "text-slate-600",
                      ].join(" ")}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (detail.type === "chart") {
    const maxValue = Math.max(...detail.points.map((point) => point.value));

    return (
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {detail.points.map((point) => (
          <div
            key={point.label}
            className="grid grid-cols-[42px_1fr_56px] items-center gap-3"
          >
            <span className="text-xs font-medium text-slate-500">
              {point.label}
            </span>
            <div className="h-3 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${(point.value / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-right text-xs font-semibold text-slate-700">
              {detail.unit}
              {point.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {detail.sections.map((section) => (
        <div
          key={section.heading}
          className="rounded-xl border border-slate-200 bg-white p-3"
        >
          <div className="text-xs font-semibold text-slate-950">
            {section.heading}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {section.body}
          </p>
        </div>
      ))}
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

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">
            {artifact.title}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {artifact.summary}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
          {label}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
        {sourceEvent ? (
          <>
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
              {dataStepLabel(sourceEvent.kind)}
            </span>
            <span className="min-w-0 truncate text-slate-500" title={sourceEvent.title}>
              来自 {sourceEvent.title}
            </span>
          </>
        ) : (
          <span className="text-slate-400">来源步骤未关联</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>{artifact.version ?? "v1"}</span>
        <span className="font-medium text-slate-600">
          {expanded ? "收起 ↑" : artifact.detail ? "展开内容 ↓" : "无详情"}
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
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}
