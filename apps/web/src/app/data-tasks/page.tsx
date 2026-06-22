"use client";

import {
  CopilotChat,
  CopilotChatAssistantMessage,
  CopilotChatInput,
  CopilotChatToolCallsView,
  CopilotKit,
  useAgentContext,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { z } from "zod";
import {
  createChatSession,
  createWorkspaceConfigItem,
  DEFAULT_SKILL_ID,
  defaultSettingsForKind,
  getEnabledLlmItems,
  loadActiveLlmId,
  loadChatSessions,
  loadWorkspaceConfig,
  normalizeLlmSettings,
  normalizeMcpSettings,
  persistActiveLlmId,
  persistChatSessions,
  persistWorkspaceConfig,
  isWorkspaceConfigItemValid,
  normalizeSkillSettings,
  parseSkillPackageFile,
  skillSettingsFromPackage,
  SKILL_PACKAGE_LOCAL_ONLY_KEYS,
  summarizeConfigItems,
  summarizeLlmItems,
  summarizeMcpItems,
  visibleConfigFields,
} from "./data-task-state";
import type {
  CopilotChatAssistantMessageProps,
  JsonSerializable,
} from "@copilotkit/react-core/v2";
import type {
  ChatSession,
  ParsedSkillPackage,
  WorkspaceConfigItem,
  WorkspaceConfigKind,
  WorkspaceConfigStore,
} from "./data-task-state";
import { TaskConsole } from "./components/task-console/TaskConsole";
import { TraceOverlay } from "./components/task-console/TraceOverlay";
import { DataTaskChatInput } from "./components/chat/DataTaskChatInput";
import {
  BackendToolRuntimeProvider,
  useBackendToolPhase,
  useBackendToolResult,
} from "./backend-tool-runtime-context";
import {
  buildBackendToolPhaseMap,
  buildBackendToolResultMap,
  resolveToolDisplayStatus,
  toolDisplayStatusLabel,
  toolPendingHint,
  toolResultLooksLikeError,
  resolveToolFailurePresentation,
  type CopilotToolStatus,
  type ToolDisplayStatus,
} from "./tool-call-display";
import { useDataAgentRun } from "./use-data-agent-run";
import {
  chatPaneClassName,
  getWorkspaceGridTemplateColumns,
} from "./workspace-layout";
import { usePanelResize } from "./hooks/use-panel-resize";
import { useWorkspaceResponsiveLayout } from "./hooks/use-workspace-responsive-layout";
import { useWorkspaceViewportWidth } from "./hooks/use-workspace-viewport-width";
import { PanelResizeHandle } from "./components/layout/PanelResizeHandle";

export const dynamic = "force-dynamic";

const agentId = "dataAgent";
const defaultDatasourceId = "api-duckdb-demo";
const runtimeUrl =
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ??
  "http://127.0.0.1:8787/api/copilotkit";

export type TaskSelection =
  | { type: "artifact"; id: string }
  | { type: "action"; id: string }
  | null;

export type WorkspaceConfigPanelKey = "db" | "kb" | "mcp" | "skill" | "llm";

const NEW_CONFIG_ITEM_ID = "__new__";

function configSummary(
  kind: WorkspaceConfigKind,
  workspaceConfig: WorkspaceConfigStore,
): string {
  if (kind === "kb" && workspaceConfig.kb.length === 0) {
    return "后端未支持";
  }
  if (kind === "llm") {
    return summarizeLlmItems(workspaceConfig.llm, "未配置");
  }
  if (kind === "mcp") {
    return summarizeMcpItems(workspaceConfig.mcp, "后端未支持");
  }
  const emptyLabels: Record<WorkspaceConfigKind, string> = {
    db: "未配置",
    kb: "未配置",
    mcp: "未配置",
    llm: "未配置",
    skill: "未配置",
  };
  return summarizeConfigItems(workspaceConfig[kind], emptyLabels[kind]);
}

// Credentials (apiKey) must never leave the browser through the AG-UI
// protocol. The left panel keeps them in localStorage only; the backend will
// resolve real secrets via secretRef. So this payload exposes non-secret
// fields plus a `hasApiKey` flag, never the raw key.
function activeLlmProfile(
  workspaceConfig: WorkspaceConfigStore,
  activeLlmId: string | null,
) {
  const enabled = getEnabledLlmItems(workspaceConfig);
  const item =
    enabled.find((entry) => entry.id === activeLlmId) ?? enabled[0] ?? null;
  if (!item) return null;
  const { apiKey, ...rest } = normalizeLlmSettings(item.settings);
  return {
    id: item.id,
    name: item.name,
    builtin: !!item.builtin,
    hasApiKey: apiKey.trim().length > 0,
    ...rest,
  };
}

function enabledSkillIds(workspaceConfig: WorkspaceConfigStore): string[] {
  return workspaceConfig.skill.map((item) => item.id);
}

/**
 * The single run-level config the backend should read from
 * `context.run_config` (see config-management-api.md §5). Carries only ids /
 * selections — never credentials. Backend ignores it until it wires
 * run_config consumption (#3); sending it now is forward-compatible.
 */
function buildRunConfig(
  workspaceConfig: WorkspaceConfigStore,
  activeLlmId: string | null,
) {
  return {
    enabledDatasourceIds: workspaceConfig.db.map((item) => item.id),
    enabledKnowledgeIds: workspaceConfig.kb.map((item) => item.id),
    enabledMcpServerIds: workspaceConfig.mcp.map((item) => item.id),
    enabledSkillIds: enabledSkillIds(workspaceConfig),
    activeDatasourceId: defaultDatasourceId,
    activeLlmProfileId: activeLlmId,
    activeSkillId: DEFAULT_SKILL_ID,
  };
}

const SECRET_SETTING_KEYS = [
  "apiKey",
  "api_key",
  "token",
  "secret",
  "password",
  "credentialsJson",
];

/**
 * Strips credential-like fields from every config item before the store is
 * embedded into AG-UI context. Secrets stay in localStorage only.
 */
function sanitizeWorkspaceConfig(
  workspaceConfig: WorkspaceConfigStore,
): WorkspaceConfigStore {
  const sanitizeItems = (
    items: WorkspaceConfigItem[],
    kind: WorkspaceConfigKind,
  ): WorkspaceConfigItem[] =>
    items.map((item) => {
      if (!item.settings) return item;
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.settings)) {
        if (SECRET_SETTING_KEYS.includes(key)) continue;
        if (
          kind === "skill" &&
          SKILL_PACKAGE_LOCAL_ONLY_KEYS.includes(
            key as (typeof SKILL_PACKAGE_LOCAL_ONLY_KEYS)[number],
          )
        ) {
          continue;
        }
        cleaned[key] = value;
      }
      if (kind === "skill") {
        cleaned.hasPackageContent = item.settings.packageContent?.trim()
          ? "true"
          : "false";
      }
      return { ...item, settings: cleaned };
    });
  return {
    db: sanitizeItems(workspaceConfig.db, "db"),
    kb: sanitizeItems(workspaceConfig.kb, "kb"),
    mcp: sanitizeItems(workspaceConfig.mcp, "mcp"),
    llm: sanitizeItems(workspaceConfig.llm, "llm"),
    skill: sanitizeItems(workspaceConfig.skill, "skill"),
  };
}

export default function DataTasksPage() {
  return (
    <CopilotKit
      runtimeUrl={runtimeUrl}
      agent={agentId}
      useSingleEndpoint
      properties={{ datasourceId: defaultDatasourceId }}
      showDevConsole={false}
      onError={(event) => {
        console.error("[data-tasks]", event);
        window.dispatchEvent(
          new CustomEvent("dataagent-run-error", {
            detail: {
              message:
                event instanceof Error
                  ? event.message
                  : String((event as { error?: unknown }).error ?? event),
            },
          }),
        );
      }}
    >
      <DataTaskWorkspace />
    </CopilotKit>
  );
}

function DataTaskWorkspace() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<TaskSelection>(null);
  const [artifactFocusId, setArtifactFocusId] = useState<string | null>(null);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [userSidebarCollapsed, setUserSidebarCollapsed] = useState(false);
  const [userRightPanelOpen, setUserRightPanelOpen] = useState(true);
  const [configPanel, setConfigPanel] = useState<WorkspaceConfigPanelKey | null>(
    null,
  );
  const [workspaceConfig, setWorkspaceConfig] =
    useState<WorkspaceConfigStore>(loadWorkspaceConfig);
  const [activeLlmId, setActiveLlmId] = useState<string | null>(() =>
    loadActiveLlmId(loadWorkspaceConfig()),
  );

  const {
    width: rightPanelWidth,
    isResizing: isRightPanelResizing,
    onResizeStart: onRightPanelResizeStart,
    resetWidth: resetRightPanelWidth,
  } = usePanelResize({
    enabled: !configPanel,
  });

  const {
    containerRef: gridRef,
    viewportWidth: workspaceViewportWidth,
    isViewportResizing,
  } = useWorkspaceViewportWidth(!configPanel);

  const {
    sidebarCollapsed,
    rightPanelOpen,
    isAutoLayout,
  } = useWorkspaceResponsiveLayout({
    viewportWidth: workspaceViewportWidth,
    userSidebarCollapsed,
    userRightPanelOpen,
    rightPanelWidth,
    enabled: !configPanel,
  });

  const isRightConsoleVisible = rightPanelOpen && !configPanel;

  useEffect(() => {
    const stored = loadChatSessions();
    if (stored.length > 0) {
      setSessions(stored);
      setActiveSessionId(stored[0].id);
      return;
    }
    const first = createChatSession();
    setSessions([first]);
    setActiveSessionId(first.id);
  }, []);

  useEffect(() => {
    if (sessions.length > 0) persistChatSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    persistWorkspaceConfig(workspaceConfig);
  }, [workspaceConfig]);

  useEffect(() => {
    const enabled = getEnabledLlmItems(workspaceConfig);
    if (enabled.length === 0) {
      setActiveLlmId(null);
      return;
    }
    if (!activeLlmId || !enabled.some((item) => item.id === activeLlmId)) {
      setActiveLlmId(enabled[0].id);
    }
  }, [workspaceConfig.llm, activeLlmId]);

  useEffect(() => {
    if (activeLlmId) persistActiveLlmId(activeLlmId);
  }, [activeLlmId]);

  const enabledLlmOptions = useMemo(
    () => getEnabledLlmItems(workspaceConfig),
    [workspaceConfig],
  );

  const addConfigItem = useCallback(
    (
      kind: WorkspaceConfigKind,
      payload: {
        name: string;
        description: string;
        enabled?: boolean;
        settings?: Record<string, string>;
      },
    ) => {
      const created = createWorkspaceConfigItem(
        kind,
        payload.name,
        payload.description,
      );
      if (payload.enabled !== undefined) created.enabled = payload.enabled;
      if (payload.settings) {
        created.settings = { ...created.settings, ...payload.settings };
      }
      setWorkspaceConfig((current) => ({
        ...current,
        [kind]: [...current[kind], created],
      }));
      return created.id;
    },
    [],
  );

  const updateConfigItem = useCallback(
    (
      kind: WorkspaceConfigKind,
      itemId: string,
      patch: Partial<
        Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
      >,
    ) => {
      setWorkspaceConfig((current) => ({
        ...current,
        [kind]: current[kind].map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            ...patch,
            settings: patch.settings
              ? { ...item.settings, ...patch.settings }
              : item.settings,
          };
        }),
      }));
    },
    [],
  );

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions[0] ??
    null;
  const activeThreadId = activeSession?.threadId;
  const { liveRun, sessionUsage, latestQuestion } = useDataAgentRun(
    agentId,
    activeThreadId,
  );

  const backendToolPhases = useMemo(
    () => buildBackendToolPhaseMap(liveRun.toolCalls),
    [liveRun.toolCalls],
  );
  const backendToolRuntime = useMemo(
    () => ({
      phases: backendToolPhases,
      results: buildBackendToolResultMap(liveRun.toolCalls),
    }),
    [backendToolPhases, liveRun.toolCalls],
  );

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(normalizedQuery),
    );
  }, [query, sessions]);

  const createSession = useCallback(() => {
    const next = createChatSession();
    setSessions((current) => [next, ...current]);
    setActiveSessionId(next.id);
    setSelection(null);
    setConfigPanel(null);
  }, []);

  const agentContext = useMemo<JsonSerializable>(
    () =>
      JSON.parse(
        JSON.stringify({
          activeSession: activeSession
            ? { id: activeSession.id, title: activeSession.title }
            : null,
          datasourceId: defaultDatasourceId,
          enabledSkillIds: enabledSkillIds(workspaceConfig),
          activeLlmId,
          activeLlm: activeLlmProfile(workspaceConfig, activeLlmId),
          workspaceConfig: sanitizeWorkspaceConfig(workspaceConfig),
          liveRun: {
            runStatus: liveRun.runStatus,
            plan: liveRun.plan,
            audits: liveRun.audits,
            artifacts: liveRun.artifacts,
          },
          selection,
        }),
      ) as JsonSerializable,
    [activeSession, activeLlmId, liveRun, selection, workspaceConfig],
  );

  const visibleArtifacts = liveRun.artifacts;
  const visibleTimelineEvents = liveRun.events;

  // Kept: backend currently honors `datasource_id` (protocol doc §2).
  useAgentContext({
    description: "datasource_id",
    value: defaultDatasourceId,
  });
  // Forward-compatible single run config (config-management-api.md §5). Backend
  // ignores it until it wires run_config consumption (#3); ids/selections only,
  // no credentials. Replaces the old per-kind context items.
  useAgentContext({
    description: "run_config",
    value: buildRunConfig(workspaceConfig, activeLlmId),
  });
  // General workspace state for debugging / richer context (secrets stripped).
  useAgentContext({
    description: "当前数据任务工作区状态",
    value: agentContext,
  });

  const chatInput = useMemo(
    () =>
      function BoundDataTaskChatInput(
        inputProps: ComponentProps<typeof DataTaskChatInput>,
      ) {
        return (
          <DataTaskChatInput
            {...inputProps}
            autoFocus
            bottomAnchored={false}
            showDisclaimer={false}
            activeLlmId={activeLlmId}
            llmOptions={enabledLlmOptions}
            onActiveLlmChange={setActiveLlmId}
            onOpenLlmConfig={() => setConfigPanel("llm")}
          />
        );
      },
    [activeLlmId, enabledLlmOptions],
  );

  useFrontendTool(
    {
      name: "selectDataSession",
      description: "切换 UI 中可见的数据任务会话。",
      agentId,
      parameters: z.object({
        sessionId: z.string().describe("要激活的会话 ID"),
      }),
      handler: async ({ sessionId }) => {
        const target = sessions.find((session) => session.id === sessionId);
        if (!target) return `未找到会话：${sessionId}`;
        setActiveSessionId(target.id);
        setSelection(null);
        return `已选择：${target.title}`;
      },
      followUp: false,
    },
    [sessions],
  );

  return (
    <BackendToolRuntimeProvider runtime={backendToolRuntime}>
      <DataTaskToolRenderers />
      <div
      ref={gridRef}
      className={[
        "grid h-screen min-h-[560px] overflow-hidden bg-slate-100 text-slate-950",
        isRightPanelResizing || isAutoLayout || isViewportResizing
          ? ""
          : "transition-[grid-template-columns] duration-300",
      ].join(" ")}
      style={{
        gridTemplateColumns: getWorkspaceGridTemplateColumns({
          isConfigPanelOpen: Boolean(configPanel),
          isRightPanelOpen: rightPanelOpen,
          sidebarCollapsed,
          rightPanelWidth,
        }),
      }}
    >
      <SessionPane
        activeSessionId={activeSession?.id ?? null}
        activeConfigPanel={configPanel}
        collapsed={sidebarCollapsed}
        filteredSessions={filteredSessions}
        query={query}
        sessionCount={sessions.length}
        onCreateSession={createSession}
        onOpenConfigPanel={setConfigPanel}
        onQueryChange={setQuery}
        onToggleCollapse={() =>
          setUserSidebarCollapsed((value) => !value)
        }
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setSelection(null);
          setConfigPanel(null);
        }}
        workspaceConfig={workspaceConfig}
      />

      {configPanel ? (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
          <WorkspaceConfigPanel
            panel={configPanel}
            items={workspaceConfig[configPanel]}
            onAdd={(payload) => addConfigItem(configPanel, payload)}
            onBack={() => setConfigPanel(null)}
            onUpdateItem={(itemId, patch) =>
              updateConfigItem(configPanel, itemId, patch)
            }
          />
        </div>
      ) : (
        <>
      <ChatPane
        activeThreadId={activeThreadId}
        title={activeSession?.title ?? "数据任务"}
        datasourceId={defaultDatasourceId}
        liveRunStatus={liveRun.runStatus}
        chatInput={chatInput}
        rightPanelOpen={rightPanelOpen}
        onOpenRightPanel={() => setUserRightPanelOpen(true)}
      />

      {rightPanelOpen ? (
        <div
          className="relative flex h-full min-h-0 shrink-0 overflow-hidden"
          style={{
            width: rightPanelWidth,
            minWidth: rightPanelWidth,
            maxWidth: rightPanelWidth,
          }}
        >
          <PanelResizeHandle
            width={rightPanelWidth}
            isResizing={isRightPanelResizing}
            onResizeStart={onRightPanelResizeStart}
            onReset={resetRightPanelWidth}
          />
          <TaskConsole
            artifacts={visibleArtifacts}
            liveRun={liveRun}
            sessionUsage={sessionUsage}
            selection={selection}
            visibleEvents={visibleTimelineEvents}
            currentQuestion={latestQuestion}
            artifactFocusId={artifactFocusId}
            onArtifactFocusHandled={() => setArtifactFocusId(null)}
            onClearSelection={() => setSelection(null)}
            onClose={() => setUserRightPanelOpen(false)}
            onOpenTrace={() => setIsTraceOpen(true)}
            onSelectEvent={(eventId) =>
              setSelection({ type: "action", id: eventId })
            }
          />
        </div>
      ) : null}
        </>
      )}

      <TraceOverlay
        artifacts={visibleArtifacts}
        liveRun={liveRun}
        isOpen={isTraceOpen}
        onClose={() => setIsTraceOpen(false)}
        onSelectArtifact={(artifactId) => {
          setArtifactFocusId(artifactId);
          setUserRightPanelOpen(true);
          setIsTraceOpen(false);
        }}
        onSelectEvent={(eventId) => {
          setSelection({ type: "action", id: eventId });
          setIsTraceOpen(false);
        }}
      />
    </div>
    </BackendToolRuntimeProvider>
  );
}

function DataTaskToolRenderers() {
  useRenderTool(
    {
      name: "inspect_schema",
      parameters: z.object({
        datasource_id: z.string().optional(),
        table_names: z.array(z.string()).optional(),
      }),
      agentId,
      render: ({ name, parameters, result, status, toolCallId }) => (
        <SchemaToolCard
          toolCallId={toolCallId}
          name={name}
          parameters={parameters}
          result={result}
          status={status}
        />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "run_sql_readonly",
      parameters: z.object({
        sql: z.string().optional(),
        limit: z.number().optional(),
      }),
      agentId,
      render: ({ name, parameters, result, status, toolCallId }) => (
        <SqlToolCard
          toolCallId={toolCallId}
          name={name}
          parameters={parameters}
          result={result}
          status={status}
        />
      ),
    },
    [],
  );

  useRenderTool({
    name: "*",
    agentId,
    render: ({ name, parameters, result, status, toolCallId }) => (
      <GenericToolCard
        toolCallId={toolCallId}
        name={name}
        parameters={parameters}
        result={result}
        status={status}
      />
    ),
  });

  return null;
}

function useEffectiveToolResult(
  toolCallId: string | undefined,
  copilotResult?: string,
): string | undefined {
  const backendResult = useBackendToolResult(toolCallId);
  return copilotResult ?? backendResult;
}

function useResolvedToolDisplayStatus(
  toolCallId: string | undefined,
  copilotStatus: CopilotToolStatus,
  copilotResult?: string,
): ToolDisplayStatus {
  const effectiveResult = useEffectiveToolResult(toolCallId, copilotResult);
  const backendPhase = useBackendToolPhase(toolCallId);
  return resolveToolDisplayStatus({
    copilotStatus,
    backendPhase,
    hasResult: !!effectiveResult,
    resultIsError: toolResultLooksLikeError(effectiveResult),
  });
}

type ToolStatus = CopilotToolStatus;

function ToolCallSplitLayout({ children }: { children: ReactNode }) {
  return <div className="mb-3 grid gap-2 last:mb-0">{children}</div>;
}

function ToolInvocationCard({
  name,
  displayStatus,
  children,
}: {
  name: string;
  displayStatus: ToolDisplayStatus;
  children: ReactNode;
}) {
  const statusTone = toolStatusToneClass(displayStatus, "blue");

  return (
    <div className="rounded-xl border border-violet-200/90 bg-violet-50/30 p-3 text-sm text-slate-700 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
            工具调用
          </span>
          <strong className="truncate font-mono text-slate-950">{name}</strong>
        </div>
        <span
          className={[
            "rounded-full border px-2 py-0.5 text-xs",
            statusTone,
            displayStatus === "executing" ? "animate-pulse" : "",
          ].join(" ")}
        >
          {invocationStatusLabel(displayStatus)}
        </span>
      </div>
      {children}
    </div>
  );
}

function ToolResultCard({
  name,
  tone,
  children,
}: {
  name: string;
  tone: "blue" | "emerald";
  children: ReactNode;
}) {
  const shellClass =
    tone === "emerald"
      ? "border-emerald-200/90 bg-emerald-50/35"
      : "border-blue-200/90 bg-blue-50/35";
  const badgeClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-100 text-emerald-700"
      : "border-blue-200 bg-blue-100 text-blue-700";

  return (
    <div
      className={`rounded-xl border ${shellClass} p-3 text-sm text-slate-700 shadow-sm`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
          >
            执行结果
          </span>
          <span className="truncate font-mono text-xs text-slate-500">{name}</span>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${badgeClass}`}
        >
          已返回
        </span>
      </div>
      {children}
    </div>
  );
}

function invocationStatusLabel(status: ToolDisplayStatus): string {
  if (status === "failed") return "执行失败";
  if (status === "complete") return "已提交";
  return toolDisplayStatusLabel(status);
}

function toolStatusToneClass(
  displayStatus: ToolDisplayStatus,
  tone: "blue" | "emerald",
): string {
  if (displayStatus === "complete") {
    return tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (displayStatus === "executing") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (displayStatus === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function ToolPendingHint({ displayStatus }: { displayStatus: ToolDisplayStatus }) {
  if (displayStatus === "complete") return null;
  const toneClass =
    displayStatus === "failed"
      ? "bg-red-50 text-red-700"
      : displayStatus === "executing"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-50 text-slate-500";

  return (
    <p className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${toneClass}`}>
      {toolPendingHint(displayStatus)}
    </p>
  );
}

function ToolResultMissingCard({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-dashed border-amber-300/90 bg-amber-50/50 p-3 text-xs leading-5 text-amber-900">
      <div className="font-semibold text-amber-950">执行结果未同步</div>
      <p className="mt-1">
        <span className="font-mono">{name}</span>{" "}
        的工具 observation 仍未送达前端线程。若右侧追溯里已有 SQL 审计或 step
        状态，通常是 AG-UI{" "}
        <code className="text-[11px]">TOOL_CALL_RESULT</code>{" "}
        缺失；请刷新后重试，或检查 dataAgent runtime 桥接逻辑。
      </p>
    </div>
  );
}

function ToolResultFailedCard({
  name,
  title,
  message,
  hint,
}: {
  name: string;
  title: string;
  message: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-red-200/90 bg-red-50/50 p-3 text-xs leading-5 text-red-900">
      <div className="font-semibold text-red-950">{title}</div>
      <p className="mt-1">
        <span className="font-mono">{name}</span>：{message}
      </p>
      {hint ? <p className="mt-2 text-[11px] text-red-800/90">{hint}</p> : null}
    </div>
  );
}

function renderToolFailureCard(name: string, result?: string) {
  const failure = resolveToolFailurePresentation(result);
  return (
    <ToolResultFailedCard
      name={name}
      title={failure.title}
      message={failure.message}
      hint={failure.hint}
    />
  );
}

function SqlCodeBlock({ sql }: { sql: string }) {
  return (
    <pre className="max-h-60 overflow-auto rounded-lg bg-slate-950 p-2.5 text-[11px] leading-5 text-slate-100">
      <code>{sql}</code>
    </pre>
  );
}

function ResultMetaChips({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]"
          title={`${item.label}: ${item.value}`}
        >
          <span className="font-semibold text-slate-500">{item.label}</span>
          <span className="max-w-[160px] truncate font-mono text-slate-700">
            {item.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: unknown[][];
}) {
  const previewRows = rows.slice(0, 50);
  return (
    <div className="overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-slate-100">
              {columns.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className={[
                    "whitespace-nowrap px-2 py-1.5",
                    cellIndex === 0
                      ? "font-medium text-slate-900"
                      : "text-slate-600",
                  ].join(" ")}
                >
                  {formatCell(row[cellIndex])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > previewRows.length && (
        <div className="border-t border-slate-100 bg-slate-50 px-2 py-1 text-[10px] text-slate-400">
          仅预览前 {previewRows.length} 行，共 {rows.length} 行。
        </div>
      )}
    </div>
  );
}

type SqlResult = {
  columns: string[];
  rows: unknown[][];
  row_count?: number;
  audit_log_id?: string;
  elapsed_ms?: number;
  artifact_id?: string;
};

function SqlToolCard({
  toolCallId,
  name,
  parameters,
  result,
  status,
}: {
  toolCallId?: string;
  name: string;
  parameters: { sql?: string; limit?: number } | undefined;
  result?: string;
  status: ToolStatus;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const parsed = parseJson<SqlResult>(effectiveResult);
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout>
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        {parameters?.sql && (
          <ToolSection title="SQL">
            <SqlCodeBlock sql={parameters.sql} />
          </ToolSection>
        )}
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name} tone="emerald">
          {parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows) ? (
            <>
              <ResultMetaChips
                items={[
                  {
                    label: "行数",
                    value: String(parsed.row_count ?? parsed.rows.length),
                  },
                  ...(parsed.elapsed_ms !== undefined
                    ? [{ label: "耗时", value: `${parsed.elapsed_ms}ms` }]
                    : []),
                  ...(parsed.audit_log_id
                    ? [{ label: "审计", value: parsed.audit_log_id }]
                    : []),
                  ...(parsed.artifact_id
                    ? [{ label: "产出", value: parsed.artifact_id }]
                    : []),
                ]}
              />
              <div className="mt-2">
                <DataTable columns={parsed.columns} rows={parsed.rows} />
              </div>
            </>
          ) : (
            <ToolPayloadBlock title="原始返回" value={effectiveResult} tone="light" />
          )}
        </ToolResultCard>
      ) : displayStatus === "failed" || resultIsError ? (
        renderToolFailureCard(name, effectiveResult)
      ) : displayStatus === "complete" ? (
        <ToolResultMissingCard name={name} />
      ) : null}
    </ToolCallSplitLayout>
  );
}

type SchemaColumn = { name: string; type?: string; nullable?: boolean };
type SchemaResult = {
  datasource_id?: string;
  tables?: Array<{ name: string; columns?: SchemaColumn[] }>;
};

function SchemaToolCard({
  toolCallId,
  name,
  parameters,
  result,
  status,
}: {
  toolCallId?: string;
  name: string;
  parameters: { datasource_id?: string; table_names?: string[] } | undefined;
  result?: string;
  status: ToolStatus;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const parsed = parseJson<SchemaResult>(effectiveResult);
  const requested = parameters?.table_names ?? [];
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout>
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        {requested.length > 0 && (
          <ToolSection title="检查的表">
            <div className="flex flex-wrap gap-1">
              {requested.map((table) => (
                <span
                  key={table}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                >
                  {table}
                </span>
              ))}
            </div>
          </ToolSection>
        )}
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name} tone="blue">
          {parsed && Array.isArray(parsed.tables) && parsed.tables.length > 0 ? (
            <div className="grid gap-2">
              {parsed.tables.map((table) => (
                <div key={table.name} className="rounded-lg bg-white/80 p-2.5">
                  <div className="font-mono text-xs font-semibold text-slate-900">
                    {table.name}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(table.columns ?? []).map((column) => (
                      <span
                        key={column.name}
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                        title={column.type}
                      >
                        {column.name}
                        {column.type ? (
                          <span className="text-slate-400"> · {column.type}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ToolPayloadBlock title="原始返回" value={effectiveResult} tone="light" />
          )}
        </ToolResultCard>
      ) : displayStatus === "failed" || resultIsError ? (
        renderToolFailureCard(name, effectiveResult)
      ) : displayStatus === "complete" ? (
        <ToolResultMissingCard name={name} />
      ) : null}
    </ToolCallSplitLayout>
  );
}

function GenericToolCard({
  toolCallId,
  name,
  parameters,
  result,
  status,
}: {
  toolCallId?: string;
  name: string;
  parameters: unknown;
  result?: string;
  status: ToolStatus;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout>
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        {parameters !== undefined && (
          <ToolPayloadBlock title="参数" value={parameters} tone="dark" />
        )}
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name} tone="blue">
          <ToolPayloadBlock title="原始返回" value={effectiveResult} tone="light" />
        </ToolResultCard>
      ) : displayStatus === "failed" || resultIsError ? (
        renderToolFailureCard(name, effectiveResult)
      ) : displayStatus === "complete" ? (
        <ToolResultMissingCard name={name} />
      ) : null}
    </ToolCallSplitLayout>
  );
}

function ToolPayloadBlock({
  title,
  value,
  tone,
}: {
  title: string;
  value: unknown;
  tone: "dark" | "light";
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
        {title}
      </div>
      <pre
        className={[
          "max-h-44 overflow-auto whitespace-pre-wrap p-2 text-xs leading-5",
          tone === "dark"
            ? "bg-slate-950 text-slate-100"
            : "bg-white text-slate-700",
        ].join(" ")}
      >
        {formatPayload(value)}
      </pre>
    </div>
  );
}

const toolDisplayName: Record<string, string> = {
  inspect_schema: "检查 Schema",
  run_sql_readonly: "执行只读 SQL",
};

function firstLine(text: string): string {
  const line = text.split("\n").find((segment) => segment.trim().length > 0) ?? "";
  const trimmed = line.replace(/^[#>*\-\s]+/, "").trim();
  return trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed;
}

function CopyContentButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      title="复制此消息"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/**
 * 把单个助手回合渲染成一个「步骤」条目，按 ReAct 循环阅读：
 * - 带工具调用的回合 = ReAct 步骤；卡片内分「思考」「工具调用」两个子面板；
 * - 末尾纯文本回合 = 流式时为「回答中」（天蓝），完成后为「最终回答」（绿色）；
 * - 中间纯文本回合 = 思考/观察（琥珀色）。
 * 已完成步骤默认折叠；点击标题栏展开/折叠；流式步骤带边框光晕与光标。
 * 当前进行中的 block 自动展开；流式结束且下一步开始时，上一 block 自动折叠。
 */
function StepAssistantMessage({
  message,
  messages,
  isRunning,
}: CopilotChatAssistantMessageProps) {
  const content =
    typeof message.content === "string" ? message.content.trim() : "";
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const hasToolCalls = toolCalls.length > 0;

  const allMessages = messages ?? [];
  const isLast = allMessages[allMessages.length - 1]?.id === message.id;
  const isActive = isLast && !!isRunning;
  const isFinalAnswer = isLast && content.length > 0 && !hasToolCalls;
  const isFinalAnswerComplete = isFinalAnswer && !isActive;
  const isThought = !hasToolCalls && !isFinalAnswer && content.length > 0;

  const stepNumber = hasToolCalls
    ? allMessages.filter(
        (item) =>
          item.role === "assistant" &&
          Array.isArray((item as { toolCalls?: unknown[] }).toolCalls) &&
          ((item as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) > 0,
      ).findIndex((item) => item.id === message.id) + 1
    : 0;

  const defaultCollapsed = !isActive && (hasToolCalls || isThought);
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const collapsed = manualCollapsed ?? defaultCollapsed;
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive) {
      setManualCollapsed(null);
    } else if (wasActiveRef.current) {
      // 本 block 刚结束流式/执行，下一步已接管 — 回到默认折叠（最终回答除外）
      setManualCollapsed(null);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  if (!content && !hasToolCalls) return null;

  const toolNames = toolCalls
    .map((call) => {
      const raw = call?.function?.name ?? "";
      return toolDisplayName[raw] ?? raw;
    })
    .filter(Boolean)
    .join("、");

  const kindLabel = isFinalAnswer
    ? isActive
      ? "回答中"
      : "最终回答"
    : hasToolCalls
      ? content
        ? "ReAct 回合"
        : "工具调用"
      : "思考 · 观察";

  const summary =
    content && hasToolCalls
      ? `${firstLine(content)} · 调用 ${toolNames}`
      : firstLine(content) || (toolNames ? `调用 ${toolNames}` : "步骤");
  const theme = getStepCardTheme({
    hasToolCalls,
    isActive,
    isFinalAnswer,
    isFinalAnswerComplete,
    isThought,
  });

  const toggleCollapsed = () => {
    setManualCollapsed(!collapsed);
  };

  return (
    <div
      data-copilotkit
      style={theme.glowVar}
      className={[
        "copilotKitMessage copilotKitAssistantMessage step-enter mb-4 rounded-2xl border p-3 shadow-sm transition-colors duration-200",
        theme.card,
        isActive ? "step-streaming" : "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 text-left"
      >
        <StepBadge
          stepNumber={stepNumber}
          isFinalAnswer={isFinalAnswerComplete}
          isStreamingAnswer={isFinalAnswer && isActive}
          isActive={isActive}
          isThought={isThought}
        />
        <span className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${theme.label}`}>
          {kindLabel}
        </span>
        {isActive && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${theme.statusPill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${theme.statusDot}`} />
            {isFinalAnswer ? "生成中" : "执行中"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {content && (
            <span onClick={(event) => event.stopPropagation()}>
              <CopyContentButton content={content} />
            </span>
          )}
          <StepChevron expanded={!collapsed} />
        </div>
      </button>

      {collapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="mt-1.5 block w-full truncate text-left text-xs text-slate-500 hover:text-slate-700"
          title={summary}
        >
          {summary}
        </button>
      ) : (
        <>
          {content && hasToolCalls ? (
            <>
              <StepSubPanel
                title="思考"
                tone="thought"
                streaming={isActive}
              >
                <div className="text-sm leading-6 text-slate-700 [&_code]:rounded [&_code]:bg-white/80 [&_code]:px-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
                  <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
                  {isActive && (
                    <span className="caret-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] bg-amber-600 align-middle" />
                  )}
                </div>
              </StepSubPanel>
              <StepSubPanel
                title="工具调用"
                tone="tool"
                badge={toolCalls.length}
                busy={isActive}
              >
                <div className="grid gap-1">
                  <CopilotChatToolCallsView message={message} messages={messages} />
                </div>
              </StepSubPanel>
            </>
          ) : content ? (
            <div className="mt-2 text-sm leading-6 text-slate-700 [&_code]:rounded [&_code]:bg-white/80 [&_code]:px-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
              <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
              {isActive && (
                <span
                  className={`caret-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] align-middle ${theme.caret}`}
                />
              )}
            </div>
          ) : hasToolCalls ? (
            <StepSubPanel
              title="工具调用"
              tone="tool"
              badge={toolCalls.length}
              busy={isActive}
            >
              <div className="grid gap-1">
                <CopilotChatToolCallsView message={message} messages={messages} />
              </div>
            </StepSubPanel>
          ) : null}
        </>
      )}
    </div>
  );
}

function StepSubPanel({
  title,
  tone,
  badge,
  streaming,
  busy,
  children,
}: {
  title: string;
  tone: "thought" | "tool";
  badge?: number;
  streaming?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const styles =
    tone === "thought"
      ? {
          shell: "border-amber-200/90 bg-amber-50/45",
          header: "border-amber-100/90 bg-amber-50/70",
          label: "text-amber-800",
          dot: "bg-amber-500",
        }
      : {
          shell: "border-violet-200/90 bg-violet-50/40",
          header: "border-violet-100/90 bg-violet-50/60",
          label: "text-violet-700",
          dot: "bg-violet-500",
        };

  return (
    <section className={`mt-2 overflow-hidden rounded-xl border ${styles.shell}`}>
      <div
        className={`flex items-center gap-2 border-b px-3 py-2 ${styles.header}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
        <span
          className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${styles.label}`}
        >
          {title}
        </span>
        {badge !== undefined && badge > 0 ? (
          <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
            {badge}
          </span>
        ) : null}
        {(streaming || busy) && (
          <span
            className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium ${styles.label}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${styles.dot}`} />
            {streaming ? "生成中" : "执行中"}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function getStepCardTheme({
  hasToolCalls,
  isActive,
  isFinalAnswer,
  isFinalAnswerComplete,
  isThought,
}: {
  hasToolCalls: boolean;
  isActive: boolean;
  isFinalAnswer: boolean;
  isFinalAnswerComplete: boolean;
  isThought: boolean;
}) {
  if (isFinalAnswerComplete) {
    return {
      card: "border-emerald-300/80 bg-emerald-50/55",
      label: "text-emerald-700",
      statusPill: "bg-emerald-100 text-emerald-700",
      statusDot: "bg-emerald-500",
      caret: "bg-emerald-600",
      glowVar: undefined,
    };
  }
  if (isFinalAnswer && isActive) {
    return {
      card: "border-sky-400/90 bg-sky-50/65",
      label: "text-sky-700",
      statusPill: "bg-sky-100 text-sky-700",
      statusDot: "bg-sky-500",
      caret: "bg-sky-600",
      glowVar: { ["--step-glow" as string]: "rgb(14 165 233 / 0.22)" },
    };
  }
  if (hasToolCalls && isActive) {
    return {
      card: "border-violet-400/85 bg-violet-50/60",
      label: "text-violet-700",
      statusPill: "bg-violet-100 text-violet-700",
      statusDot: "bg-violet-500",
      caret: "bg-violet-600",
      glowVar: { ["--step-glow" as string]: "rgb(139 92 246 / 0.22)" },
    };
  }
  if (hasToolCalls) {
    return {
      card: "border-violet-200/90 bg-violet-50/35",
      label: "text-violet-600",
      statusPill: "bg-violet-100 text-violet-700",
      statusDot: "bg-violet-500",
      caret: "bg-violet-600",
      glowVar: undefined,
    };
  }
  if (isThought && isActive) {
    return {
      card: "border-amber-300/85 bg-amber-50/55",
      label: "text-amber-800",
      statusPill: "bg-amber-100 text-amber-800",
      statusDot: "bg-amber-500",
      caret: "bg-amber-700",
      glowVar: { ["--step-glow" as string]: "rgb(245 158 11 / 0.2)" },
    };
  }
  if (isThought) {
    return {
      card: "border-amber-200/80 bg-amber-50/35",
      label: "text-amber-700",
      statusPill: "bg-amber-100 text-amber-800",
      statusDot: "bg-amber-500",
      caret: "bg-amber-700",
      glowVar: undefined,
    };
  }
  return {
    card: "border-slate-200 bg-slate-50/60",
    label: "text-slate-500",
    statusPill: "bg-slate-100 text-slate-600",
    statusDot: "bg-slate-400",
    caret: "bg-slate-500",
    glowVar: undefined,
  };
}

function StepChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      data-expanded={expanded}
      className="step-chevron flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400"
      aria-hidden
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function StepBadge({
  stepNumber,
  isFinalAnswer,
  isStreamingAnswer,
  isActive,
  isThought,
}: {
  stepNumber: number;
  isFinalAnswer: boolean;
  isStreamingAnswer: boolean;
  isActive: boolean;
  isThought?: boolean;
}) {
  if (isFinalAnswer) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (isStreamingAnswer) {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-sky-600">
        <span className="absolute inset-0 rounded-full bg-sky-400/60 animate-ping" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-white" />
      </span>
    );
  }
  if (stepNumber > 0) {
    return (
      <span
        className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
          isActive
            ? "bg-violet-600 text-white"
            : "bg-violet-100 text-violet-700"
        }`}
      >
        {isActive && (
          <span className="absolute inset-0 rounded-full bg-violet-400/60 animate-ping" />
        )}
        <span className="relative">{stepNumber}</span>
      </span>
    );
  }
  if (isThought) {
    return (
      <span
        className={`relative flex h-5 w-5 items-center justify-center rounded-full ${
          isActive ? "bg-amber-500" : "bg-amber-100"
        }`}
      >
        {isActive && (
          <span className="absolute inset-0 rounded-full bg-amber-300/70 animate-ping" />
        )}
        <span
          className={`relative h-1.5 w-1.5 rounded-full ${isActive ? "bg-white" : "bg-amber-600"}`}
        />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
    </span>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {direction === "left" ? (
        <path d="M12.5 5 7.5 10l5 5" />
      ) : (
        <path d="M7.5 5l5 5-5 5" />
      )}
    </svg>
  );
}

function SessionPane({
  activeSessionId,
  activeConfigPanel,
  collapsed,
  filteredSessions,
  query,
  sessionCount,
  workspaceConfig,
  onCreateSession,
  onOpenConfigPanel,
  onQueryChange,
  onToggleCollapse,
  onSelectSession,
}: {
  activeSessionId: string | null;
  activeConfigPanel: WorkspaceConfigPanelKey | null;
  collapsed: boolean;
  filteredSessions: ChatSession[];
  query: string;
  sessionCount: number;
  workspaceConfig: WorkspaceConfigStore;
  onCreateSession: () => void;
  onOpenConfigPanel: (panel: WorkspaceConfigPanelKey) => void;
  onQueryChange: (value: string) => void;
  onToggleCollapse: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 w-14 min-w-14 max-w-14 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-white py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white">
          D
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="展开侧栏"
          aria-label="展开侧栏"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronIcon direction="right" />
        </button>
        <button
          type="button"
          onClick={onCreateSession}
          title="新建数据任务"
          aria-label="新建数据任务"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800"
        >
          <span className="text-lg leading-none">+</span>
        </button>
        <span className="mt-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {sessionCount}
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-[320px] min-w-[320px] max-w-[320px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white">
          D
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">数据任务</h1>
          <p className="text-xs text-slate-500">{sessionCount} 个会话</p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="折叠侧栏"
          aria-label="折叠侧栏"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronIcon direction="left" />
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            工作区默认配置
          </span>
        </div>
        <p className="mb-1.5 text-[11px] leading-4 text-slate-400">
          默认全部可用；本次任务的启用/关闭将在对话框中控制
        </p>
        <div className="flex flex-col gap-0.5">
          <ConfigRow
            label="DB"
            value={configSummary("db", workspaceConfig)}
            tone="blue"
            active={activeConfigPanel === "db"}
            onClick={() => onOpenConfigPanel("db")}
          />
          <ConfigRow
            label="KB"
            value={configSummary("kb", workspaceConfig)}
            tone="violet"
            unsupported={workspaceConfig.kb.length === 0}
            active={activeConfigPanel === "kb"}
            onClick={() => onOpenConfigPanel("kb")}
          />
          <ConfigRow
            label="MCP"
            value={configSummary("mcp", workspaceConfig)}
            tone="rose"
            unsupported
            active={activeConfigPanel === "mcp"}
            onClick={() => onOpenConfigPanel("mcp")}
          />
          <ConfigRow
            label="LLM"
            value={configSummary("llm", workspaceConfig)}
            tone="amber"
            active={activeConfigPanel === "llm"}
            onClick={() => onOpenConfigPanel("llm")}
          />
          <ConfigRow
            label="Skill"
            value={configSummary("skill", workspaceConfig)}
            tone="emerald"
            active={activeConfigPanel === "skill"}
            onClick={() => onOpenConfigPanel("skill")}
          />
        </div>
      </div>

      <div className="border-b border-slate-200 p-3">
        <button
          type="button"
          onClick={onCreateSession}
          className="h-9 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          新建数据任务
        </button>
        <label className="mt-3 block">
          <span className="sr-only">搜索会话</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-slate-400 focus:bg-white"
            placeholder="搜索会话"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-2 pb-2 text-xs font-semibold text-slate-500">
          会话
        </div>
        <div className="flex flex-col gap-0.5">
          {filteredSessions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-400">没有匹配的会话。</p>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                title={session.title}
                className={[
                  "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition",
                  session.id === activeSessionId
                    ? "bg-slate-100 font-medium text-slate-950"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                ].join(" ")}
              >
                {session.title}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function WorkspaceConfigPanel({
  panel,
  items,
  onAdd,
  onBack,
  onUpdateItem,
}: {
  panel: WorkspaceConfigPanelKey;
  items: WorkspaceConfigItem[];
  onAdd: (payload: {
    name: string;
    description: string;
    enabled?: boolean;
    settings?: Record<string, string>;
  }) => string;
  onBack: () => void;
  onUpdateItem: (
    itemId: string,
    patch: Partial<
      Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
    >,
  ) => void;
}) {
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<WorkspaceConfigItem | null>(null);

  useEffect(() => {
    setDetailItemId(null);
    setDraftItem(null);
  }, [panel]);

  const isCreating = detailItemId === NEW_CONFIG_ITEM_ID;
  const detailItem = isCreating
    ? draftItem
    : detailItemId
      ? items.find((item) => item.id === detailItemId) ?? null
      : null;

  const titles: Record<typeof panel, string> = {
    db: "数据源",
    kb: "知识库",
    mcp: "MCP",
    skill: "Skill",
    llm: "模型",
  };

  const detailTitles: Record<typeof panel, string> = {
    db: "数据源详情",
    kb: "知识库详情",
    mcp: "MCP 详情",
    skill: "Skill 详情",
    llm: "模型详情",
  };

  const descriptions: Record<typeof panel, string> = {
    db: "管理数据源；当前后端可连 DuckDB(demo)/SQLite/CSV/Excel。注册/切换 REST API 尚未接入。",
    kb: "管理知识库；点击卡片查看并编辑具体配置。当前版本后端未支持。",
    mcp: "管理 MCP 服务器连接（Transport / Endpoint）；后端尚无 MCP 实现，先保留最小骨架。",
    skill: "上传 SKILL.md 或 .zip 技能包；自定义包暂存浏览器，后端 REST 接入后改为服务端存储。",
    llm: "管理 LLM 连接（Provider / Base URL / API Key / Model Name）；点击卡片编辑，或通过 + 新增自定义配置。",
  };

  const addLabels: Record<typeof panel, string> = {
    db: "新增数据源",
    kb: "新增知识库",
    mcp: "新增 MCP",
    skill: "导入 Skill",
    llm: "新增模型",
  };

  const openCreate = () => {
    setDraftItem({
      id: NEW_CONFIG_ITEM_ID,
      name: "",
      description: "",
      enabled: true,
      settings: defaultSettingsForKind(panel),
    });
    setDetailItemId(NEW_CONFIG_ITEM_ID);
  };

  const handleHeaderBack = () => {
    if (detailItem) {
      setDetailItemId(null);
      setDraftItem(null);
      return;
    }
    onBack();
  };

  const handleCreate = () => {
    if (!draftItem) return;
    const name = draftItem.name.trim();
    if (!name) return;
    const createdId = onAdd({
      name,
      description: draftItem.description.trim() || "自定义配置项",
      enabled: draftItem.enabled,
      settings: draftItem.settings,
    });
    setDetailItemId(createdId);
    setDraftItem(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-6">
        <button
          type="button"
          onClick={handleHeaderBack}
          aria-label={detailItem ? `返回${titles[panel]}列表` : "返回工作区"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronIcon direction="left" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-slate-950">
            {detailItem
              ? isCreating
                ? addLabels[panel]
                : detailItem.name || titles[panel]
              : titles[panel]}
          </h2>
          <p className="text-xs text-slate-500">
            {detailItem ? detailTitles[panel] : "工作区配置"}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {detailItem ? (
            <ConfigItemDetailView
              item={detailItem}
              mode={isCreating ? "create" : "edit"}
              panel={panel}
              onCreate={handleCreate}
              onUpdate={(patch) => {
                if (isCreating) {
                  setDraftItem((current) =>
                    current
                      ? {
                          ...current,
                          ...patch,
                          settings: patch.settings
                            ? { ...current.settings, ...patch.settings }
                            : current.settings,
                        }
                      : current,
                  );
                  return;
                }
                onUpdateItem(detailItem.id, patch);
              }}
            />
          ) : (
            <>
              <p className="text-sm leading-6 text-slate-500">{descriptions[panel]}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((item) => (
                  <ConfigItemCard
                    key={item.id}
                    item={item}
                    onSelect={() => setDetailItemId(item.id)}
                  />
                ))}
                <AddConfigCard
                  label={addLabels[panel]}
                  onClick={openCreate}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigItemDetailView({
  item,
  mode,
  panel,
  onCreate,
  onUpdate,
}: {
  item: WorkspaceConfigItem;
  mode: "create" | "edit";
  panel: WorkspaceConfigPanelKey;
  onCreate: () => void;
  onUpdate: (
    patch: Partial<
      Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
    >,
  ) => void;
}) {
  const settings: Record<string, string> =
    panel === "llm"
      ? normalizeLlmSettings(item.settings ?? defaultSettingsForKind(panel, item.name))
      : panel === "mcp"
        ? normalizeMcpSettings(item.settings ?? defaultSettingsForKind(panel, item.name))
        : panel === "skill"
          ? normalizeSkillSettings(
              item.settings ?? defaultSettingsForKind(panel, item.name),
            )
          : (item.settings ?? defaultSettingsForKind(panel, item.name));
  const fields = visibleConfigFields(panel, settings);
  const nameReadOnly = mode === "edit" && !!item.builtin;
  const isBuiltinSkill = panel === "skill" && !!item.builtin;
  const hasUploadedSkillPackage =
    panel === "skill" &&
    (settings.packageFormat === "builtin" || settings.packageContent.trim().length > 0);

  const configKindLabel =
    panel === "db"
      ? "数据源"
      : panel === "kb"
        ? "知识库"
        : panel === "mcp"
          ? "MCP"
          : panel === "llm"
            ? "模型"
            : "Skill";

  const notes: Record<WorkspaceConfigPanelKey, string> = {
    db:
      "选数据源类型后填写文件路径。当前后端 Data Gateway 仅支持 " +
      "DuckDB(demo) / SQLite / CSV / Excel；PostgreSQL/MySQL 等暂未实现。" +
      "run 时仅数据源 ID 经 forwardedProps 传入。内置数据源核心字段不可修改。",
    kb: "知识库索引与检索参数仅在前端保存，后端 RAG 接口尚未接入。",
    mcp:
      "MCP 连接配置经 AG-UI context（description=mcp_config）传给 runtime；" +
      "当前 dataAgent 尚未动态挂载 MCP middleware，待后端接入后启用项将生效。",
    llm:
      "字段与服务端 dataAgent 环境变量 LLM_PROVIDER / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 对齐。" +
      "自定义配置经 AG-UI context（description=llm_config）传给 runtime；" +
      "当前后端仍固定读取服务端 .env，待后续支持按 run 切换模型。",
    skill: isBuiltinSkill
      ? "内置 Skill 由服务端预置 SKILL.md 包，无需上传；run 时仅传 skill id。"
      : "自定义 Skill 须上传 SKILL.md（含 YAML frontmatter）。包正文保存在浏览器 localStorage，不经 AG-UI 外发；后端 POST /api/v1/skills 落地后改为服务端存储。",
  };

  const createDisabled = !isWorkspaceConfigItemValid(panel, item, settings);
  const createLabel = panel === "skill" ? "导入 Skill" : "创建配置项";

  return (
    <div className="space-y-4">
      {panel === "skill" && <SkillConfigProtocolHint builtin={isBuiltinSkill} />}

      {!isBuiltinSkill && panel === "skill" && (
        <SkillPackageUpload
          fileName={settings.packageFileName}
          onImport={(pkg) =>
            onUpdate({
              name: pkg.name,
              description: pkg.description,
              settings: skillSettingsFromPackage(pkg),
            })
          }
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="space-y-3">
          <EditableField
            label="名称"
            value={item.name}
            readOnly={nameReadOnly}
            placeholder={`输入${configKindLabel}名称`}
            onChange={(name) => onUpdate({ name })}
          />
          <EditableField
            label="描述"
            value={item.description}
            multiline
            placeholder="简短说明"
            onChange={(description) => onUpdate({ description })}
          />
        </div>
      </div>

      {mode === "edit" && (
        <DetailField label="配置 ID" value={item.id} />
      )}

      {(panel !== "skill" || hasUploadedSkillPackage) && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
            {panel === "skill" ? "包信息" : "具体配置"}
          </h4>
          {panel === "llm" && (
            <LlmConfigProtocolHint builtin={!!item.builtin && mode === "edit"} />
          )}
          {panel === "mcp" && <McpConfigProtocolHint />}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <EditableField
                key={field.key}
                label={field.label}
                value={settings[field.key] ?? ""}
                placeholder={field.placeholder}
                helpText={field.helpText}
                inputType={field.inputType}
                options={field.options}
                fullWidth={field.fullWidth}
                required={field.required}
                readOnly={field.readOnly?.(item) ?? false}
                onChange={(value) =>
                  onUpdate({ settings: { [field.key]: value } })
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
          说明
        </h4>
        <p className="mt-2 text-sm leading-6 text-slate-600">{notes[panel]}</p>
        {mode === "edit" && (
          <p className="mt-2 text-xs text-slate-400">
            {item.builtin ? "内置配置项" : "自定义配置项"}
            {" · 工作区默认可用"}
          </p>
        )}
      </section>

      {mode === "create" && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={createDisabled}
            onClick={onCreate}
            className="h-9 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {createLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function SkillPackageUpload({
  fileName,
  onImport,
}: {
  fileName: string;
  onImport: (pkg: ParsedSkillPackage) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    const result = await parseSkillPackageFile(file);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onImport(result);
  };

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-slate-900">上传 Skill 包</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            支持 SKILL.md（须含 YAML frontmatter）或 .zip 目录包（zip 待后端 REST 启用）。
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
          className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "解析中…" : fileName ? "重新选择文件" : "选择文件"}
        </button>
      </div>
      {fileName && (
        <p className="text-xs text-slate-600">
          已选：<span className="font-medium text-slate-900">{fileName}</span>
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".md,.zip,application/zip"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </section>
  );
}

function SkillConfigProtocolHint({ builtin }: { builtin: boolean }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs leading-5 text-violet-900">
      <p className="font-medium">Skill 包说明</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-violet-800/90">
        <li>
          标准结构：目录内含{" "}
          <code className="text-[11px]">SKILL.md</code>（YAML frontmatter + 指令正文）
        </li>
        <li>
          后端契约：<code className="text-[11px]">POST /api/v1/skills</code>{" "}
          multipart 上传；run 仅传{" "}
          <code className="text-[11px]">activeSkillId</code>，不传包正文
        </li>
        {builtin ? (
          <li>内置 Skill 由服务端预置，当前前端仅展示元数据</li>
        ) : (
          <li>过渡期包正文存 localStorage；AG-UI context 只带 hasPackageContent 标记</li>
        )}
      </ul>
    </div>
  );
}

function McpConfigProtocolHint() {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-900">
      <p className="font-medium">MCP 连接说明</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-rose-800/90">
        <li>
          远程服务常用 SSE URL，例如{" "}
          <code className="text-[11px]">https://host/mcp/sse</code>
        </li>
        <li>
          前端经{" "}
          <code className="text-[11px]">useAgentContext({"{"}description:
          &quot;mcp_config&quot;{"}"})</code>{" "}
          传递已启用的 MCP 配置（不含 API Key / Token，仅传 hasApiKey 标记）
        </li>
        <li>CopilotKit runtime 支持 @ag-ui/mcp-middleware 挂载外部 MCP 工具</li>
      </ul>
    </div>
  );
}

function LlmConfigProtocolHint({ builtin }: { builtin: boolean }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
      <p className="font-medium">AG-UI / dataAgent 对齐说明</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-blue-800/90">
        <li>
          服务端 env：<code className="text-[11px]">LLM_PROVIDER</code>、
          <code className="text-[11px]">LLM_BASE_URL</code>、
          <code className="text-[11px]">LLM_API_KEY</code>、
          <code className="text-[11px]">LLM_MODEL</code>
        </li>
        <li>
          前端经 <code className="text-[11px]">useAgentContext({"{"}description:
          &quot;llm_config&quot;{"}"})</code> 传递已启用的自定义配置（不含 API Key，仅传 hasApiKey 标记）
        </li>
        <li>
          AG-UI <code className="text-[11px]">RunAgentInput.context</code>{" "}
          已支持 datasource；LLM 按 run 切换尚未接入后端
        </li>
        {builtin && (
          <li>「服务端默认」项只读，实际模型由 dataAgent 进程环境变量决定</li>
        )}
      </ul>
    </div>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  helpText,
  readOnly,
  required,
  multiline,
  inputType = "text",
  options,
  fullWidth,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  helpText?: string;
  readOnly?: boolean;
  required?: boolean;
  multiline?: boolean;
  inputType?: "text" | "password" | "url" | "select" | "number";
  options?: Array<{ value: string; label: string }>;
  fullWidth?: boolean;
  onChange: (value: string) => void;
}) {
  const className =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition read-only:bg-slate-50 read-only:text-slate-500 focus:border-slate-400";
  const wrapperClass = fullWidth ? "sm:col-span-2" : "";

  return (
    <label className={`block ${wrapperClass}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {inputType === "select" && options ? (
        <select
          value={value}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} h-9`}
        >
          <option value="">请选择…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} resize-y min-h-[72px]`}
        />
      ) : (
        <input
          type={
            inputType === "password"
              ? "password"
              : inputType === "number"
                ? "number"
                : "text"
          }
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete={inputType === "password" ? "off" : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} h-9`}
        />
      )}
      {helpText && (
        <span className="mt-1 block text-[11px] leading-4 text-slate-400">
          {helpText}
        </span>
      )}
    </label>
  );
}

function AddConfigCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      <span className="text-2xl leading-none">+</span>
      <span className="mt-1 text-xs font-medium">{label}</span>
    </button>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 break-all text-sm text-slate-800">{value}</dd>
    </div>
  );
}

// Reserved status badge. Backend `test`/`introspect` (#2) will populate
// `item.status`; until then custom items read as 未测试 and builtins are silent.
function configItemStatusBadge(
  item: WorkspaceConfigItem,
): { label: string; className: string } | null {
  if (item.status === "connected")
    return { label: "已连接", className: "bg-emerald-50 text-emerald-700" };
  if (item.status === "failed")
    return { label: "失败", className: "bg-rose-50 text-rose-700" };
  if (item.builtin) return null;
  return { label: "未测试", className: "bg-slate-100 text-slate-400" };
}

function ConfigItemCard({
  item,
  onSelect,
}: {
  item: WorkspaceConfigItem;
  onSelect?: () => void;
}) {
  const className = [
    "rounded-xl border px-4 py-3 transition",
    "border-slate-200 bg-white hover:border-slate-300",
    onSelect ? "cursor-pointer hover:bg-slate-50" : "",
  ].join(" ");

  const status = configItemStatusBadge(item);
  const content = (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
          {item.name}
        </div>
        {status && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}
          >
            {status.label}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
        {item.description}
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={`text-left ${className}`}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function ConfigRow({
  label,
  value,
  tone,
  unsupported,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: "blue" | "violet" | "amber" | "emerald" | "rose";
  unsupported?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "blue"
      ? "text-blue-700"
      : tone === "violet"
        ? "text-violet-600"
        : tone === "emerald"
          ? "text-emerald-700"
          : tone === "rose"
            ? "text-rose-700"
            : "text-amber-700";

  const className = [
    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition",
    onClick ? "cursor-pointer hover:bg-slate-100" : "",
    active ? "bg-slate-100 font-medium" : "",
  ].join(" ");

  const content = (
    <>
      <span className={`w-7 shrink-0 font-semibold ${toneClass}`}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-left text-slate-600">{value}</span>
      {unsupported && (
        <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-400">
          未支持
        </span>
      )}
      {onClick && (
        <span className="shrink-0 text-slate-400">
          <ChevronIcon direction="right" />
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        title={`配置 ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className} title={`${label}: ${value}`}>
      {content}
    </div>
  );
}

function ChatPane({
  activeThreadId,
  title,
  datasourceId,
  liveRunStatus,
  chatInput: ChatInput,
  rightPanelOpen,
  onOpenRightPanel,
}: {
  activeThreadId?: string;
  title: string;
  datasourceId: string;
  liveRunStatus: "idle" | "running" | "completed" | "failed";
  chatInput: ComponentType<ComponentProps<typeof DataTaskChatInput>>;
  rightPanelOpen: boolean;
  onOpenRightPanel: () => void;
}) {
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-slate-50">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-950">
            {title}
          </h2>
          <p className="truncate text-xs text-slate-500">
            数据源 {datasourceId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RunStatusPill status={liveRunStatus} />
          {!rightPanelOpen ? (
            <button
              type="button"
              onClick={onOpenRightPanel}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            >
              打开控制台
            </button>
          ) : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeThreadId ? (
          <CopilotChat
            agentId={agentId}
            threadId={activeThreadId}
            key={activeThreadId}
            welcomeScreen={false}
            autoScroll="pin-to-send"
            messageView={{
              assistantMessage:
                StepAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
            }}
            input={ChatInput as typeof CopilotChatInput}
            className={chatPaneClassName}
          />
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-slate-400">
            正在初始化会话…
          </div>
        )}
      </div>
    </main>
  );
}

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson<T>(value: unknown): T | null {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function formatCell(value: unknown): string {
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

function RunStatusPill({
  status,
}: {
  status: "idle" | "running" | "completed" | "failed";
}) {
  const label =
    status === "completed"
      ? "已完成"
      : status === "running"
        ? "运行中"
        : status === "failed"
          ? "失败"
          : "就绪";
  const className =
    status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : status === "running"
        ? "bg-blue-50 text-blue-700"
        : status === "failed"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-600";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
