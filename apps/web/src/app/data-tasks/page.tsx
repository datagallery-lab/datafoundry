"use client";

import {
  CopilotChat,
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotChatInput,
  CopilotChatToolCallsView,
  CopilotKit,
  useAgent,
  useAgentContext,
  useAttachments,
  useCopilotChatConfiguration,
  useCopilotKit,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { useCallback, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ComponentType, MouseEvent, ReactNode } from "react";
import { z } from "zod";
import {
  buildMentionResources,
  buildRunConfig,
  createChatSession,
  createWorkspaceConfigItem,
  defaultSettingsForKind,
  applyAutoTitle,
  deleteChatSession,
  deriveSnippetTitle,
  emptyPerRunFileSelection,
  sortChatSessions,
  togglePinChatSession,
  emptyPerRunSelection,
  fileMentionFromArtifact,
  fileMentionFromWorkspaceAsset,
  filterWorkspaceAssetFiles,
  getEnabledLlmItems,
  hasCapability,
  toolDisplayTitle,
  loadActiveLlmId,
  loadChatSessions,
  mergeServerChatSessions,
  normalizeLlmSettings,
  normalizeMcpSettings,
  persistActiveLlmId,
  persistChatSessions,
  isWorkspaceConfigItemValid,
  renameChatSession,
  serverSessionDtoToChatSession,
  normalizeSkillSettings,
  parseSkillPackageFile,
  prunePerRunSelection,
  removePerRunFileMention,
  removePerRunMention,
  resolveActiveLlmProfileId,
  resolveActiveDatasourceId,
  skillSettingsFromPackage,
  SKILL_PACKAGE_LOCAL_ONLY_KEYS,
  workspaceConfigItemDraftEquals,
  summarizeConfigItems,
  summarizeLlmItems,
  summarizeMcpItems,
  togglePerRunFileMention,
  togglePerRunMention,
  toggleSessionResource,
  renderableConfigFields,
  resolveConfigFieldOptions,
  isFieldPending,
  isFieldDisabled,
  isSelectOptionPending,
  normalizeKbSettings,
  normalizeLlmSettingsExtended,
  visibleConfigFields,
  WORKSPACE_CONFIG_BADGE_CLASS,
  WORKSPACE_CONFIG_SHORT_LABEL,
} from "./data-task-state";
import { configApi } from "../../lib/config-api/client";
import {
  messageTextContent,
  resolveAssistantThoughtContent,
} from "./assistant-thought-content";
import {
  resolveCollaborationStepLabel,
  resolveStepBadgePresentation,
  resolveStepSummaryText,
  resolveToolStepActionLabel,
} from "./step-display-label";
import { JobProgressBanner } from "./components/JobProgressBanner";
import {
  formatConfigTestError,
  formatConfigTestResult,
  type ConfigTestPresentation,
} from "./config-test-result";
import { useWorkspaceConfigApi } from "./hooks/use-workspace-config-api";
import type { FileAssetRefDto, JobDto } from "../../lib/config-api";
import type {
  CopilotChatAssistantMessageProps,
  JsonSerializable,
} from "@copilotkit/react-core/v2";
import type {
  ChatSession,
  DataArtifact,
  FileMentionResource,
  PerRunFileSelection,
  ParsedSkillPackage,
  PerRunMentionKind,
  PerRunSelection,
  WorkspaceConfigItem,
  WorkspaceConfigKind,
  WorkspaceConfigStore,
} from "./data-task-state";
import { TaskConsole } from "./components/task-console/TaskConsole";
import { TaskConsoleDrawer } from "./components/task-console/TaskConsoleDrawer";
import { TraceOverlay } from "./components/task-console/TraceOverlay";
import { WorkspaceFileAssetsPanel } from "./components/task-console/WorkspaceFileAssetsPanel";
import { SchemaBrowserPanel } from "./components/SchemaBrowserPanel";
import { DataTaskChatInput } from "./components/chat/DataTaskChatInput";
import { createChatStopHandler } from "./components/chat/chat-stop-handler";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_BYTES,
  buildMessageContent,
  createChatOnUpload,
  readFileAsBase64,
} from "./components/chat/chat-attachments";
import { scheduleChatTextareaResize } from "./components/chat/use-chat-textarea-autoresize";
import {
  DataTaskChatInputBindingsProvider,
  useDataTaskChatInputBindings,
} from "./components/chat/DataTaskChatInputBindingsContext";
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
import {
  LiveRunEventSubscriber,
  LiveRunProvider,
  useLiveRun,
} from "./use-data-agent-run";
import type { LiveRun } from "./live-run-state";
import { ToolFormattedParams, ToolFormattedResult } from "./tool-result-format";
import { normalizeSqlTable } from "./table-rows";
import {
  chatPaneClassName,
  getWorkspaceGridTemplateColumns,
  resolveSidebarExpandPreferences,
} from "./workspace-layout";
import { usePanelResize } from "./hooks/use-panel-resize";
import { useChatColumnWidth } from "./hooks/use-chat-column-width";
import { useWorkspaceResponsiveLayout } from "./hooks/use-workspace-responsive-layout";
import { useWorkspaceViewportWidth } from "./hooks/use-workspace-viewport-width";
import { PanelResizeHandle } from "./components/layout/PanelResizeHandle";
import {
  ChatInitializingState,
  DataTaskWelcomeScreen,
  DatasourceChip,
} from "./components/chat/DataTaskWelcome";
import { SessionConversationRestore } from "./components/chat/SessionConversationRestore";
import { SessionArtifactsRestore } from "./components/chat/SessionArtifactsRestore";
import { CollaborationInterruptHandler } from "./components/chat/CollaborationInterruptHandler";
import {
  CollaborationResponseBridge,
  CollaborationResponsesProvider,
  useThreadCollaborationResponsesForChat,
} from "./components/chat/collaboration-responses";
import {
  AgentMessageRenderSync,
  useAgentMessageRenderGeneration,
} from "./agent-message-render-sync";
import {
  resolveAssistantToolStepNumber,
  resolveStepAssistantFlags,
} from "./step-assistant-state";
import { btnSecondaryClass, panelTitleClass, sectionLabelClass } from "./ui-tokens";
import {
  getCollapsedWorkspaceRailCopy,
  getCollapsedWorkspacePreviewClassNames,
  getSessionListItemIconSlots,
} from "./session-pane-ui";
import { getBackendCapabilities, isResourcePanelSupported } from "../../lib/config-api";

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

async function uploadChatDataFile(
  file: File,
  sessionId?: string | null,
): Promise<{ path: string; mimeType: string; size: number }> {
  return configApi.uploadChatFile(file, sessionId);
}

function StableDataTaskChatInput({
  inputProps,
}: {
  inputProps: ComponentProps<typeof DataTaskChatInput>;
}) {
  const bindings = useDataTaskChatInputBindings();
  const { agent } = useAgent({ agentId: bindings.agentId });
  const { copilotkit } = useCopilotKit();

  const capabilities = useCallback(
    () => {
      if (!bindings.capabilitiesReady) {
        return { imageInput: false, fileUpload: false };
      }
      const caps = getBackendCapabilities();
      return {
        imageInput: caps["chat.imageInput"],
        fileUpload: caps["chat.fileUpload"],
      };
    },
    [bindings.capabilitiesReady],
  );
  const onUpload = useMemo(
    () =>
      createChatOnUpload({
        capabilities,
        readBase64: (file) => readFileAsBase64(file),
        uploadDataFile: (file) => uploadChatDataFile(file, bindings.activeThreadId),
      }),
    [bindings.activeThreadId, capabilities],
  );

  const attachmentsApi = useAttachments({
    config: {
      enabled: true,
      accept: CHAT_ATTACHMENT_ACCEPT,
      maxSize: CHAT_ATTACHMENT_MAX_BYTES,
      onUpload: onUpload as never,
      onUploadFailed: ({ message }) => {
        if (typeof window !== "undefined") {
          console.warn(`[attachments] ${message}`);
        }
      },
    },
  });

  const handleSubmitMessage = (value: string) => {
    bindings.onUserMessageSubmitted(value);
    const ready = attachmentsApi.consumeAttachments();
    if (ready.length > 0 && agent) {
      const content = buildMessageContent(value, ready);
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
      void copilotkit.runAgent({ agent });
    } else {
      inputProps.onSubmitMessage?.(value);
    }
    bindings.onClearPerRunMentions();
    bindings.onClearPerRunFileMentions();
    requestAnimationFrame(scheduleChatTextareaResize);
  };
  const handleStop = useMemo(
    () =>
      createChatStopHandler({
        onCancelRun: bindings.onCancelRun,
        onStopFrontend: inputProps.onStop,
      }),
    [bindings.onCancelRun, inputProps.onStop],
  );
  return (
    <DataTaskChatInput
      {...inputProps}
      {...bindings}
      attachmentsApi={attachmentsApi}
      onSubmitMessage={handleSubmitMessage}
      onStop={handleStop}
      showDisclaimer={false}
    />
  );
}

function configSummary(
  kind: WorkspaceConfigKind,
  workspaceConfig: WorkspaceConfigStore,
): string {
  if (kind === "llm") {
    return summarizeLlmItems(workspaceConfig.llm, "未配置");
  }
  const emptyLabels: Record<WorkspaceConfigKind, string> = {
    db: "未配置",
    kb: "未配置",
    mcp: "未配置",
    llm: "未配置",
    skill: "未配置",
  };
  if (kind === "mcp") {
    return summarizeMcpItems(workspaceConfig.mcp, emptyLabels.mcp);
  }
  return summarizeConfigItems(workspaceConfig[kind], emptyLabels[kind]);
}

// Credentials must never leave the browser through the AG-UI protocol.
// REST write paths submit credentials once; reads expose hasSecret only.
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
    hasApiKey: Boolean(item.hasSecret) || apiKey.trim().length > 0,
    ...rest,
  };
}

function enabledSkillIds(workspaceConfig: WorkspaceConfigStore): string[] {
  return workspaceConfig.skill.map((item) => item.id);
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
 * embedded into AG-UI context. Secrets stay server-side via secretRef.
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
      showDevConsole={false}
      onError={(event) => {
        const message =
          event instanceof Error
            ? event.message
            : String((event as { error?: unknown }).error ?? event);
        if (message.includes("Run ended without emitting a terminal event")) {
          return;
        }
        if (
          message.includes("data-workspace-metadata") &&
          message.includes("missing payload")
        ) {
          return;
        }
        console.error("[data-tasks]", event);
        window.dispatchEvent(
          new CustomEvent("dataagent-run-error", {
            detail: { message },
          }),
        );
      }}
    >
      <CollaborationResponsesProvider>
        <LiveRunProvider>
          <DataTaskWorkspace />
        </LiveRunProvider>
      </CollaborationResponsesProvider>
    </CopilotKit>
  );
}

function DataTaskWorkspace() {
  const {
    workspaceConfig,
    runDefaults,
    loading: workspaceLoading,
    capabilitiesReady,
    error: workspaceError,
    createItem,
    updateItem,
    deleteItem,
    testItem,
    introspectDatasource,
    reindexKnowledgeBase,
    uploadKnowledgeFile,
    replaceSkillPackage,
    validateSkill,
    pollJob,
    cancelJob,
  } = useWorkspaceConfigApi();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<TaskSelection>(null);
  const [artifactFocusId, setArtifactFocusId] = useState<string | null>(null);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isConsoleDrawerOpen, setIsConsoleDrawerOpen] = useState(false);
  const [userSidebarCollapsed, setUserSidebarCollapsed] = useState(false);
  const [userRightPanelOpen, setUserRightPanelOpen] = useState(true);
  const [configPanel, setConfigPanel] = useState<WorkspaceConfigPanelKey | null>(
    null,
  );
  const [workspaceFilesPanelOpen, setWorkspaceFilesPanelOpen] = useState(false);
  const [workspaceFileAssets, setWorkspaceFileAssets] = useState<FileAssetRefDto[]>([]);
  const [promotedArtifactIds, setPromotedArtifactIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeLlmId, setActiveLlmId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobDto | null>(null);
  const [configActionError, setConfigActionError] = useState<string | null>(null);
  const [sessionSyncError, setSessionSyncError] = useState<string | null>(null);
  const [runCancelBusy, setRunCancelBusy] = useState(false);
  // Layer-2 per-run override (DESIGN.md): `@`-selected capabilities for the next
  // run only. Cleared after each send so it never mutates workspace defaults.
  const [perRunSelection, setPerRunSelection] = useState<PerRunSelection>(
    emptyPerRunSelection,
  );
  const [perRunFiles, setPerRunFiles] = useState<PerRunFileSelection>(
    emptyPerRunFileSelection,
  );
  const [chatColumnWidth, setChatColumnWidth] = useState(1280);
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  useEffect(() => {
    setLayoutHydrated(true);
  }, []);

  const togglePerRunMentionItem = useCallback(
    (kind: PerRunMentionKind, id: string) => {
      setPerRunSelection((current) => togglePerRunMention(current, kind, id));
    },
    [],
  );
  const removePerRunMentionItem = useCallback(
    (kind: PerRunMentionKind, id: string) => {
      setPerRunSelection((current) => removePerRunMention(current, kind, id));
    },
    [],
  );
  const clearPerRunMentions = useCallback(
    () => setPerRunSelection(emptyPerRunSelection()),
    [],
  );
  const togglePerRunFileMentionItem = useCallback((resource: FileMentionResource) => {
    setPerRunFiles((current) => togglePerRunFileMention(current, resource));
  }, []);
  const removePerRunFileMentionItem = useCallback((resource: FileMentionResource) => {
    setPerRunFiles((current) => removePerRunFileMention(current, resource));
  }, []);
  const clearPerRunFileMentions = useCallback(
    () => setPerRunFiles(emptyPerRunFileSelection()),
    [],
  );

  const {
    width: rightPanelWidth,
    isResizing: isRightPanelResizing,
    onResizeStart: onRightPanelResizeStart,
    resetWidth: resetRightPanelWidth,
  } = usePanelResize({
    enabled: !configPanel && !workspaceFilesPanelOpen,
  });

  const sidePanelOpen = Boolean(configPanel) || workspaceFilesPanelOpen;
  const {
    containerRef: gridRef,
    viewportWidth: workspaceViewportWidth,
    isViewportResizing,
  } = useWorkspaceViewportWidth(!sidePanelOpen);

  const {
    sidebarCollapsed,
    rightPanelOpen,
    isAutoLayout,
    canDockRightPanel,
  } = useWorkspaceResponsiveLayout({
    viewportWidth: workspaceViewportWidth,
    userSidebarCollapsed,
    userRightPanelOpen,
    rightPanelWidth,
    enabled: !sidePanelOpen && layoutHydrated,
  });

  const isRightConsoleVisible =
    !sidePanelOpen &&
    ((canDockRightPanel && rightPanelOpen) || isConsoleDrawerOpen);

  useEffect(() => {
    if (workspaceViewportWidth > 0) {
      setChatColumnWidth(workspaceViewportWidth);
    }
  }, [workspaceViewportWidth]);

  const openTaskConsole = useCallback(() => {
    if (canDockRightPanel) {
      setUserSidebarCollapsed(true);
      setUserRightPanelOpen(true);
      return;
    }
    setIsConsoleDrawerOpen(true);
  }, [canDockRightPanel]);

  const toggleSidebar = useCallback(() => {
    if (sidebarCollapsed) {
      const next = resolveSidebarExpandPreferences({
        viewportWidth: workspaceViewportWidth,
        userRightPanelOpen,
        rightPanelWidth,
      });
      setUserSidebarCollapsed(next.userSidebarCollapsed);
      setUserRightPanelOpen(next.userRightPanelOpen);
      return;
    }
    setUserSidebarCollapsed(true);
  }, [
    sidebarCollapsed,
    workspaceViewportWidth,
    userRightPanelOpen,
    rightPanelWidth,
  ]);

  const closeTaskConsole = useCallback(() => {
    if (canDockRightPanel) {
      setUserRightPanelOpen(false);
      return;
    }
    setIsConsoleDrawerOpen(false);
  }, [canDockRightPanel]);

  const openConfigPanel = useCallback((panel: WorkspaceConfigPanelKey) => {
    setWorkspaceFilesPanelOpen(false);
    setConfigPanel((current) => (current === panel ? null : panel));
  }, []);

  const openWorkspaceFilesPanel = useCallback(() => {
    setConfigPanel(null);
    setWorkspaceFilesPanelOpen((open) => !open);
  }, []);

  const closeWorkspaceFilesPanel = useCallback(() => {
    setWorkspaceFilesPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!canDockRightPanel || !isConsoleDrawerOpen) return;
    setIsConsoleDrawerOpen(false);
    setUserRightPanelOpen(true);
  }, [canDockRightPanel, isConsoleDrawerOpen]);

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
    let cancelled = false;
    void configApi.listSessions({ limit: 50 })
      .then((response) => {
        if (cancelled) return;
        if (response.sessions.length === 0) {
          setSessionSyncError(null);
          return;
        }
        setSessions((current) => {
          const merged = mergeServerChatSessions(current, response.sessions);
          setActiveSessionId((active) => {
            if (active && merged.some((session) => session.id === active)) return active;
            return merged[0]?.id ?? active;
          });
          return merged;
        });
        setSessionSyncError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setSessionSyncError(error instanceof Error ? error.message : "加载服务端会话失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessions.length > 0) persistChatSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (workspaceLoading) return;
    const enabled = getEnabledLlmItems(workspaceConfig);
    const fallback =
      runDefaults?.activeLlmProfileId ??
      loadActiveLlmId(workspaceConfig);
    const resolved = resolveActiveLlmProfileId(enabled, activeLlmId, fallback);
    if (resolved !== activeLlmId) {
      setActiveLlmId(resolved);
    }
  }, [workspaceConfig.llm, activeLlmId, runDefaults, workspaceLoading, workspaceConfig]);

  useEffect(() => {
    if (activeLlmId) persistActiveLlmId(activeLlmId);
  }, [activeLlmId]);

  const saveConfigItem = useCallback(
    async (kind: WorkspaceConfigKind, item: WorkspaceConfigItem) => {
      setConfigActionError(null);
      try {
        return await updateItem(kind, item);
      } catch (error) {
        setConfigActionError(
          error instanceof Error ? error.message : "保存配置失败",
        );
        throw error;
      }
    },
    [updateItem],
  );

  const addConfigItem = useCallback(
    async (
      kind: WorkspaceConfigKind,
      payload: {
        name: string;
        description: string;
        enabled?: boolean;
        settings?: Record<string, string>;
      },
      skillFile?: File,
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
      setConfigActionError(null);
      try {
        const createdId = await createItem(kind, created, skillFile);
        if (kind === "llm") {
          setActiveLlmId(createdId);
        }
        return createdId;
      } catch (error) {
        setConfigActionError(
          error instanceof Error ? error.message : "创建配置失败",
        );
        throw error;
      }
    },
    [createItem],
  );

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions[0] ??
    null;
  const activeThreadId = activeSession?.threadId;
  const activeDatasourceId = resolveActiveDatasourceId(
    workspaceConfig,
    activeSession,
    perRunSelection,
    runDefaults?.activeDatasourceId ?? defaultDatasourceId,
  );

  const enabledLlmOptions = useMemo(
    () => getEnabledLlmItems(workspaceConfig),
    [workspaceConfig],
  );

  const mentionResources = useMemo(
    () => buildMentionResources(workspaceConfig, activeSession),
    [workspaceConfig, activeSession],
  );
  const workspaceFileMentionResources = useMemo(
    () => filterWorkspaceAssetFiles(workspaceFileAssets).map(fileMentionFromWorkspaceAsset),
    [workspaceFileAssets],
  );

  const toggleSessionResourceItem = useCallback(
    (kind: PerRunMentionKind, id: string) => {
      if (!activeSessionId) return;
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSessionId
            ? toggleSessionResource(session, kind, id)
            : session,
        ),
      );
    },
    [activeSessionId],
  );

  // Drop @ picks for resources removed from workspace or disabled in session.
  useEffect(() => {
    setPerRunSelection((current) =>
      prunePerRunSelection(workspaceConfig, activeSession, current),
    );
  }, [workspaceConfig, activeSession]);
  const { liveRun, sessionUsage, latestQuestion } = useLiveRun();
  useEffect(() => {
    if (!capabilitiesReady || !hasCapability("conversation.title")) return;
    const sessionTitle = liveRun.sessionTitle;
    if (!sessionTitle) return;
    setSessions((current) =>
      applyAutoTitle(current, sessionTitle.sessionId, sessionTitle.title, "llm"),
    );
  }, [capabilitiesReady, liveRun.sessionTitle]);
  const refreshWorkspaceFileAssets = useCallback(async () => {
    if (!capabilitiesReady || !hasCapability("files")) {
      setWorkspaceFileAssets([]);
      return;
    }
    const response = await configApi.listWorkspaceFiles({
      scope: "workspace",
      origin: ["uploaded", "saved"],
    });
    setWorkspaceFileAssets(filterWorkspaceAssetFiles(response.files ?? []));
  }, [capabilitiesReady]);
  useEffect(() => {
    if (!capabilitiesReady || !hasCapability("files")) {
      setWorkspaceFileAssets([]);
      return;
    }
    let cancelled = false;
    void refreshWorkspaceFileAssets()
      .then(() => {
        if (!cancelled) {
          // refreshWorkspaceFileAssets already updated state.
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaceFileAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilitiesReady, refreshWorkspaceFileAssets]);
  const sessionArtifactFileMentionResources = useMemo(
    () => liveRun.artifacts.map(fileMentionFromArtifact).filter((file): file is FileMentionResource => Boolean(file)),
    [liveRun.artifacts],
  );
  const fileMentionResources = useMemo(
    () => [...sessionArtifactFileMentionResources, ...workspaceFileMentionResources],
    [sessionArtifactFileMentionResources, workspaceFileMentionResources],
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

  const cancelCurrentRun = useCallback(async () => {
    if (!liveRun.runId || (liveRun.runStatus !== "running" && liveRun.runStatus !== "suspended")) {
      return;
    }
    setRunCancelBusy(true);
    setConfigActionError(null);
    try {
      await configApi.cancelRun(liveRun.runId, "user-requested");
    } catch (error) {
      setConfigActionError(error instanceof Error ? error.message : "取消运行失败");
    } finally {
      setRunCancelBusy(false);
    }
  }, [liveRun.runId, liveRun.runStatus]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matched = normalizedQuery
      ? sessions.filter((session) =>
          session.title.toLowerCase().includes(normalizedQuery),
        )
      : sessions;
    return sortChatSessions(matched);
  }, [query, sessions]);

  const createSession = useCallback(() => {
    const next = createChatSession();
    setSessions((current) => sortChatSessions([next, ...current]));
    setActiveSessionId(next.id);
    setSelection(null);
    setConfigPanel(null);
    setWorkspaceFilesPanelOpen(false);
  }, []);

  const renameSession = useCallback((sessionId: string, title: string) => {
    setSessions((current) => renameChatSession(current, sessionId, title));
    void configApi.patchSessionTitle(sessionId, title)
      .then((updated) => {
        setSessions((current) =>
          current.map((session) => {
            if (session.id !== sessionId && session.threadId !== sessionId) return session;
            const server = serverSessionDtoToChatSession({
              id: session.id,
              threadId: session.threadId,
              title: updated.title,
              titleSource: updated.titleSource,
              updatedAt: updated.updatedAt,
            });
            return {
              ...session,
              title: server.title,
              titleSource: server.titleSource,
              updatedAt: server.updatedAt,
            };
          }),
        );
        setSessionSyncError(null);
      })
      .catch((error) => {
        setSessionSyncError(error instanceof Error ? error.message : "会话重命名同步失败");
      });
  }, []);

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((current) => {
        const next = deleteChatSession(current, sessionId);
        if (next.length === 0) {
          const fallback = createChatSession();
          setActiveSessionId(fallback.id);
          return [fallback];
        }
        if (activeSessionId === sessionId) {
          setActiveSessionId(next[0]?.id ?? null);
        }
        return next;
      });
      setSelection(null);
    },
    [activeSessionId],
  );

  const togglePinSession = useCallback((sessionId: string) => {
    setSessions((current) => {
      const next = sortChatSessions(togglePinChatSession(current, sessionId));
      const pinned = next.find((session) => session.id === sessionId)?.pinned;
      if (pinned) {
        requestAnimationFrame(() => {
          document
            .getElementById(`session-item-${sessionId}`)
            ?.scrollIntoView({ block: "nearest" });
        });
      }
      return next;
    });
  }, []);

  const applyFirstUserMessageTitle = useCallback((text: string) => {
    if (!activeSessionId) return;
    setSessions((current) => {
      const session = current.find((item) => item.id === activeSessionId);
      if (!session || session.titleSource !== "default") return current;
      return applyAutoTitle(
        current,
        activeSessionId,
        deriveSnippetTitle(text),
        "auto-snippet",
      );
    });
  }, [activeSessionId]);

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

  // Kept for CopilotKit forwardedProps compatibility; backend also consumes
  // `run_config` via effectiveRunConfig merge.
  useAgentContext({
    description: "datasource_id",
    value: resolveActiveDatasourceId(
      workspaceConfig,
      activeSession,
      perRunSelection,
      runDefaults?.activeDatasourceId ?? defaultDatasourceId,
    ),
  });
  // Forward-compatible single run config (config-management-api.md §5).
  // Backend merges this with workspace defaults into effectiveRunConfig.
  useAgentContext({
    description: "run_config",
    value: buildRunConfig(workspaceConfig, {
      activeLlmId,
      defaultDatasourceId: runDefaults?.activeDatasourceId ?? defaultDatasourceId,
      session: activeSession,
      perRunSelection,
      perRunFiles,
    }),
  });
  // General workspace state for debugging / richer context (secrets stripped).
  useAgentContext({
    description: "当前数据任务工作区状态",
    value: agentContext,
  });

  const chatInputBindings = useMemo(
    () => ({
      activeLlmId,
      llmOptions: enabledLlmOptions,
      onActiveLlmChange: setActiveLlmId,
      onOpenLlmConfig: () => openConfigPanel("llm"),
      mentionResources,
      perRunSelection,
      onTogglePerRunMention: togglePerRunMentionItem,
      onRemovePerRunMention: removePerRunMentionItem,
      onClearPerRunMentions: clearPerRunMentions,
      fileMentionResources,
      perRunFiles,
      onTogglePerRunFileMention: togglePerRunFileMentionItem,
      onRemovePerRunFileMention: removePerRunFileMentionItem,
      onClearPerRunFileMentions: clearPerRunFileMentions,
      workspaceConfig,
      activeSession,
      onToggleSessionResource: toggleSessionResourceItem,
      chatColumnWidth,
      agentId,
      activeThreadId: activeThreadId ?? null,
      capabilitiesReady,
      onUserMessageSubmitted: applyFirstUserMessageTitle,
      liveRunStatus: liveRun.runStatus,
      liveRunRunId: liveRun.runId ?? null,
      onCancelRun: cancelCurrentRun,
      cancelRunBusy: runCancelBusy,
    }),
    [
      activeLlmId,
      activeSession,
      activeThreadId,
      capabilitiesReady,
      applyFirstUserMessageTitle,
      cancelCurrentRun,
      chatColumnWidth,
      enabledLlmOptions,
      openConfigPanel,
      mentionResources,
      perRunSelection,
      perRunFiles,
      fileMentionResources,
      togglePerRunMentionItem,
      removePerRunMentionItem,
      clearPerRunMentions,
      togglePerRunFileMentionItem,
      removePerRunFileMentionItem,
      clearPerRunFileMentions,
      toggleSessionResourceItem,
      workspaceConfig,
      liveRun.runId,
      liveRun.runStatus,
      runCancelBusy,
    ],
  );

  const chatInput = useMemo(
    () =>
      function BoundDataTaskChatInput(
        inputProps: ComponentProps<typeof DataTaskChatInput>,
      ) {
        return <StableDataTaskChatInput inputProps={inputProps} />;
      },
    [],
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

  const handleSelectToolAction = useCallback(
    (toolCallId: string) => {
      setSelection({ type: "action", id: toolCallId });
      openTaskConsole();
    },
    [openTaskConsole],
  );

  const mentionArtifactFile = useCallback((artifact: DataArtifact) => {
    const fileMention = fileMentionFromArtifact(artifact);
    if (!fileMention) return;
    setPerRunFiles((current) => togglePerRunFileMention(current, fileMention));
  }, []);

  const promoteArtifactToWorkspace = useCallback(
    async (artifact: DataArtifact) => {
      await configApi.promoteArtifact(artifact.id);
      setPromotedArtifactIds((current) => {
        const next = new Set(current);
        next.add(artifact.id);
        return next;
      });
      await refreshWorkspaceFileAssets();
    },
    [refreshWorkspaceFileAssets],
  );
  const sidePanelError = workspaceError ?? configActionError ?? sessionSyncError;

  return (
    <BackendToolRuntimeProvider runtime={backendToolRuntime}>
      <DataTaskToolRenderers onSelectToolAction={handleSelectToolAction} />
      <div
      ref={gridRef}
      className={[
        "grid h-screen min-h-[560px] overflow-hidden bg-surface-subtle text-foreground",
        isRightPanelResizing || isAutoLayout || isViewportResizing
          ? ""
          : "transition-[grid-template-columns] duration-300",
      ].join(" ")}
      style={{
        gridTemplateColumns: getWorkspaceGridTemplateColumns({
          isConfigPanelOpen: sidePanelOpen,
          isRightPanelOpen: canDockRightPanel && rightPanelOpen,
          sidebarCollapsed,
          rightPanelWidth,
        }),
      }}
    >
      <SessionPane
        activeSessionId={activeSession?.id ?? null}
        activeConfigPanel={configPanel}
        activeFilesPanel={workspaceFilesPanelOpen}
        collapsed={sidebarCollapsed}
        filteredSessions={filteredSessions}
        query={query}
        sessionCount={sessions.length}
        workspaceFileCount={workspaceFileAssets.length}
        capabilitiesReady={capabilitiesReady}
        onCreateSession={createSession}
        onOpenConfigPanel={openConfigPanel}
        onOpenFilesPanel={openWorkspaceFilesPanel}
        onQueryChange={setQuery}
        onToggleCollapse={toggleSidebar}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setSelection(null);
          setConfigPanel(null);
          setWorkspaceFilesPanelOpen(false);
        }}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onTogglePinSession={togglePinSession}
        workspaceConfig={workspaceConfig}
      />

      {workspaceFilesPanelOpen ? (
        <WorkspaceFilesLibraryPanel
          onBack={closeWorkspaceFilesPanel}
          onFilesChange={setWorkspaceFileAssets}
        />
      ) : configPanel ? (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
          {sidePanelError && (
            <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
              {sidePanelError}
            </div>
          )}
          <JobProgressBanner
            job={activeJob}
            onCancel={(jobId) =>
              cancelJob(jobId).then((job) => setActiveJob(job))
            }
            onDismiss={() => setActiveJob(null)}
          />
          <WorkspaceConfigPanel
            panel={configPanel}
            items={workspaceConfig[configPanel]}
            workspaceConfig={workspaceConfig}
            loading={workspaceLoading || !capabilitiesReady}
            onAdd={(payload, skillFile) => addConfigItem(configPanel, payload, skillFile)}
            onBack={() => setConfigPanel(null)}
            onSaveItem={(item) => saveConfigItem(configPanel, item)}
            onDeleteItem={(itemId) => deleteItem(configPanel, itemId)}
            onTestItem={(itemId) => testItem(configPanel, itemId)}
            onIntrospect={
              configPanel === "db"
                ? async (itemId) => {
                    const job = await introspectDatasource(itemId);
                    setActiveJob(job);
                    const finished = await pollJob(job.id, setActiveJob);
                    setActiveJob(finished);
                  }
                : undefined
            }
            onReindex={
              configPanel === "kb"
                ? async (itemId) => {
                    const job = await reindexKnowledgeBase(itemId);
                    setActiveJob(job);
                    const finished = await pollJob(job.id, setActiveJob);
                    setActiveJob(finished);
                  }
                : undefined
            }
            onUploadKnowledgeFile={
              configPanel === "kb"
                ? (itemId, file) => uploadKnowledgeFile(itemId, file)
                : undefined
            }
            onReplaceSkill={
              configPanel === "skill"
                ? (itemId, file) => replaceSkillPackage(itemId, file)
                : undefined
            }
            onValidateSkill={
              configPanel === "skill"
                ? (itemId) => validateSkill(itemId)
                : undefined
            }
          />
        </div>
      ) : (
        <>
      <DataTaskChatInputBindingsProvider value={chatInputBindings}>
      <ToolActionSelectionContext.Provider value={handleSelectToolAction}>
      <div className="relative z-10 min-h-0 min-w-0 overflow-hidden">
      <ChatPane
        activeThreadId={activeThreadId}
        title={activeSession?.title ?? "数据任务"}
        datasourceId={activeDatasourceId}
        liveRunStatus={liveRun.runStatus}
        liveRun={liveRun}
        chatInput={chatInput}
        rightPanelOpen={isRightConsoleVisible}
        onOpenRightPanel={openTaskConsole}
        onChatColumnWidthChange={setChatColumnWidth}
        capabilitiesReady={capabilitiesReady}
      />
      </div>
      </ToolActionSelectionContext.Provider>
      </DataTaskChatInputBindingsProvider>

      {canDockRightPanel && rightPanelOpen ? (
        <div
          className="relative z-0 flex h-full min-h-0 shrink-0 isolate overflow-hidden"
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
            onClose={closeTaskConsole}
            onMentionArtifact={mentionArtifactFile}
            onOpenTrace={() => setIsTraceOpen(true)}
            onPromoteArtifact={promoteArtifactToWorkspace}
            onArtifactExportJob={setActiveJob}
            onSelectEvent={(eventId) =>
              setSelection({ type: "action", id: eventId })
            }
            promotedArtifactIds={promotedArtifactIds}
          />
        </div>
      ) : null}
        </>
      )}

      <TaskConsoleDrawer
        artifacts={visibleArtifacts}
        liveRun={liveRun}
        sessionUsage={sessionUsage}
        selection={selection}
        visibleEvents={visibleTimelineEvents}
        currentQuestion={latestQuestion}
        artifactFocusId={artifactFocusId}
        onArtifactFocusHandled={() => setArtifactFocusId(null)}
        onClearSelection={() => setSelection(null)}
        onMentionArtifact={mentionArtifactFile}
        isOpen={!sidePanelOpen && !canDockRightPanel && isConsoleDrawerOpen}
        onClose={() => setIsConsoleDrawerOpen(false)}
        onOpenTrace={() => setIsTraceOpen(true)}
        onPromoteArtifact={promoteArtifactToWorkspace}
        onArtifactExportJob={setActiveJob}
        onSelectEvent={(eventId) =>
          setSelection({ type: "action", id: eventId })
        }
        promotedArtifactIds={promotedArtifactIds}
      />

      <TraceOverlay
        artifacts={visibleArtifacts}
        liveRun={liveRun}
        isOpen={isTraceOpen}
        onClose={() => setIsTraceOpen(false)}
        onSelectArtifact={(artifactId) => {
          setArtifactFocusId(artifactId);
          openTaskConsole();
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

function DataTaskToolRenderers({
  onSelectToolAction,
}: {
  onSelectToolAction: (toolCallId: string) => void;
}) {
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
          onSelectToolAction={onSelectToolAction}
        />
      ),
    },
    [onSelectToolAction],
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
          onSelectToolAction={onSelectToolAction}
        />
      ),
    },
    [onSelectToolAction],
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
        onSelectToolAction={onSelectToolAction}
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

function ToolCallSplitLayout({
  toolCallId,
  onSelectToolAction,
  children,
}: {
  toolCallId?: string;
  onSelectToolAction?: (toolCallId: string) => void;
  children: ReactNode;
}) {
  const selectable = Boolean(toolCallId && onSelectToolAction);
  const handleActivate = () => {
    if (toolCallId && onSelectToolAction) {
      onSelectToolAction(toolCallId);
    }
  };
  const handleContainerClick = (event: MouseEvent) => {
    if (!selectable) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "button, a, input, select, textarea, label, summary, details, [data-no-tool-select]",
      )
    ) {
      return;
    }
    handleActivate();
  };

  return (
    <div
      data-testid={selectable ? "selectable-tool-card" : undefined}
      className={[
        "mb-3 grid gap-2 last:mb-0",
        selectable
          ? "cursor-pointer rounded-xl ring-offset-2 transition-colors duration-150 hover:bg-surface-subtle"
          : "",
      ].join(" ")}
      onClick={selectable ? handleContainerClick : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
      title={selectable ? "在任务控制台中查看详情" : undefined}
    >
      {children}
    </div>
  );
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
  const statusTone = toolStatusToneClass(displayStatus);

  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm text-muted shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">
            工具调用
          </span>
          <strong className="truncate font-mono text-foreground">{name}</strong>
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
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-surface p-3 text-sm text-muted shadow-[var(--shadow-card)]"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-muted"
          >
            执行结果
          </span>
          <span className="truncate font-mono text-xs text-muted-light">{name}</span>
        </div>
        <span
          className="rounded-full border border-step-success/25 bg-step-success/8 px-2 py-0.5 text-xs text-step-success"
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

function toolStatusToneClass(displayStatus: ToolDisplayStatus): string {
  if (displayStatus === "complete") {
    return "border-border bg-surface-subtle text-muted";
  }
  if (displayStatus === "executing") {
    return "border-border bg-surface-subtle text-foreground";
  }
  if (displayStatus === "failed") {
    return "border-step-error/25 bg-step-error/8 text-step-error";
  }
  return "border-border bg-surface-subtle text-muted";
}

function ToolPendingHint({ displayStatus }: { displayStatus: ToolDisplayStatus }) {
  if (displayStatus === "complete") return null;
  const toneClass =
    displayStatus === "failed"
      ? "bg-step-error/8 text-step-error"
      : displayStatus === "executing"
        ? "bg-surface-subtle text-foreground"
        : "bg-surface-subtle text-muted";

  return (
    <p className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${toneClass}`}>
      {toolPendingHint(displayStatus)}
    </p>
  );
}

function ToolResultMissingCard({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-subtle p-3 text-xs leading-5 text-muted">
      <div className="font-semibold text-foreground">执行结果未同步</div>
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
    <div className="rounded-xl border border-step-error/25 bg-step-error/8 p-3 text-xs leading-5 text-step-error">
      <div className="font-semibold text-step-error">{title}</div>
      <p className="mt-1">
        <span className="font-mono">{name}</span>：{message}
      </p>
      {hint ? <p className="mt-2 text-[11px] text-step-error/90">{hint}</p> : null}
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
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px]"
          title={`${item.label}: ${item.value}`}
        >
          <span className="font-semibold text-muted-light">{item.label}</span>
          <span className="max-w-[160px] truncate font-mono text-muted">
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
  rows: unknown[];
}) {
  const { columns: displayColumns, rows: normalizedRows } = normalizeSqlTable(columns, rows);
  const previewRows = normalizedRows.slice(0, 50);
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-surface-subtle text-muted-light">
          <tr>
            {displayColumns.map((column) => (
              <th key={column} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border">
              {displayColumns.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className={[
                    "whitespace-nowrap px-2 py-1.5",
                    cellIndex === 0
                      ? "font-medium text-foreground"
                      : "text-muted",
                  ].join(" ")}
                >
                  {formatCell(row[cellIndex])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {normalizedRows.length > previewRows.length && (
        <div className="border-t border-border bg-surface-subtle px-2 py-1 text-[10px] text-muted-light">
          仅预览前 {previewRows.length} 行，共 {normalizedRows.length} 行。
        </div>
      )}
    </div>
  );
}

type SqlResult = {
  columns: string[];
  rows: unknown[];
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
  onSelectToolAction,
}: {
  toolCallId?: string;
  name: string;
  parameters: { sql?: string; limit?: number } | undefined;
  result?: string;
  status: ToolStatus;
  onSelectToolAction?: (toolCallId: string) => void;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const parsed = parseJson<SqlResult>(effectiveResult);
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout
      toolCallId={toolCallId}
      onSelectToolAction={onSelectToolAction}
    >
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        {parameters?.sql ? (
          <ToolFormattedParams toolName={name} parameters={parameters} />
        ) : null}
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name}>
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
  onSelectToolAction,
}: {
  toolCallId?: string;
  name: string;
  parameters: { datasource_id?: string; table_names?: string[] } | undefined;
  result?: string;
  status: ToolStatus;
  onSelectToolAction?: (toolCallId: string) => void;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const parsed = parseJson<SchemaResult>(effectiveResult);
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout
      toolCallId={toolCallId}
      onSelectToolAction={onSelectToolAction}
    >
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        {parameters !== undefined ? (
          <ToolFormattedParams toolName={name} parameters={parameters} />
        ) : null}
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name}>
          {parsed && Array.isArray(parsed.tables) && parsed.tables.length > 0 ? (
            <div className="grid gap-2">
              {parsed.tables.map((table) => (
                <div key={table.name} className="rounded-lg border border-border bg-surface-subtle p-2.5">
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {table.name}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(table.columns ?? []).map((column) => (
                      <span
                        key={column.name}
                        className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
                        title={column.type}
                      >
                        {column.name}
                        {column.type ? (
                          <span className="text-muted-light"> · {column.type}</span>
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
  onSelectToolAction,
}: {
  toolCallId?: string;
  name: string;
  parameters: unknown;
  result?: string;
  status: ToolStatus;
  onSelectToolAction?: (toolCallId: string) => void;
}) {
  const displayStatus = useResolvedToolDisplayStatus(toolCallId, status, result);
  const effectiveResult = useEffectiveToolResult(toolCallId, result);
  const hasResult = !!effectiveResult;
  const resultIsError = toolResultLooksLikeError(effectiveResult);

  return (
    <ToolCallSplitLayout
      toolCallId={toolCallId}
      onSelectToolAction={onSelectToolAction}
    >
      <ToolInvocationCard name={name} displayStatus={displayStatus}>
        <ToolFormattedParams toolName={name} parameters={parameters} />
        {!hasResult && displayStatus !== "complete" && displayStatus !== "failed" && (
          <ToolPendingHint displayStatus={displayStatus} />
        )}
      </ToolInvocationCard>
      {hasResult && !resultIsError ? (
        <ToolResultCard name={name}>
          <ToolFormattedResult
            toolName={name}
            result={effectiveResult}
            variant="chat"
          />
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
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-surface-subtle px-2.5 py-1 text-[11px] font-semibold text-muted-light">
        {title}
      </div>
      <pre
        className={[
          "max-h-44 overflow-auto whitespace-pre-wrap p-2 text-xs leading-5",
          tone === "dark"
            ? "bg-code-bg text-slate-100"
            : "bg-surface text-muted",
        ].join(" ")}
      >
        {formatPayload(value)}
      </pre>
    </div>
  );
}

type ChatRunStatus = LiveRun["runStatus"];

const ChatRunStatusContext = createContext<ChatRunStatus>("idle");
const ChatLiveRunContext = createContext<LiveRun | null>(null);
const ToolActionSelectionContext = createContext<
  ((toolCallId: string) => void) | null
>(null);
const ProcessTimelineCollapseContext = createContext<{
  collapsed: boolean;
  toggle: () => void;
}>({
  collapsed: false,
  toggle: () => {},
});

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
  isRunning: propIsRunning,
}: CopilotChatAssistantMessageProps) {
  useAgentMessageRenderGeneration();
  const chatConfig = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: chatConfig?.agentId ?? agentId });
  const liveRunStatus = useContext(ChatRunStatusContext);
  const liveRun = useContext(ChatLiveRunContext);
  const processTimelineCollapse = useContext(ProcessTimelineCollapseContext);
  const selectToolAction = useContext(ToolActionSelectionContext);
  const collaborationResponses = useThreadCollaborationResponsesForChat(chatConfig?.threadId);
  const allMessages =
    agent.messages && agent.messages.length > 0 ? agent.messages : (messages ?? []);
  const isRunning = agent.isRunning ?? propIsRunning;
  const content = resolveAssistantThoughtContent(message, allMessages);
  const {
    hasToolCalls,
    isWaitingForUser,
    isCollaborationStep,
    isCollaborationComplete,
    isActive,
    isFinalAnswer,
    isFinalAnswerComplete,
    isThought,
    linkedCollaboration,
  } = resolveStepAssistantFlags({
    message,
    messages: allMessages,
    content,
    isRunning: Boolean(isRunning),
    liveRunStatus,
    liveRun,
    collaborationResponses,
  });
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const linkedLiveToolCall =
    linkedCollaboration && liveRun
      ? liveRun.toolCalls.find((call) => call.id === linkedCollaboration.toolCallId)
      : undefined;
  const effectiveToolCalls =
    toolCalls.length > 0
      ? toolCalls
      : linkedLiveToolCall
        ? [
            {
              id: linkedLiveToolCall.id,
              type: "function" as const,
              function: {
                name: linkedLiveToolCall.name,
                arguments: "{}",
              },
            },
          ]
        : [];
  const displayHasToolCalls = effectiveToolCalls.length > 0;
  const displayMessage =
    effectiveToolCalls === toolCalls
      ? message
      : ({ ...message, toolCalls: effectiveToolCalls } as typeof message);
  const currentMessageIndex = allMessages.findIndex((item) => item.id === message.id);
  const lastUserIndex =
    currentMessageIndex >= 0
      ? (allMessages
          .slice(0, currentMessageIndex + 1)
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.role === "user")
          .at(-1)?.index ?? -1)
      : -1;
  const nextUserIndex =
    currentMessageIndex >= 0
      ? allMessages.findIndex(
          (item, index) => index > currentMessageIndex && item.role === "user",
        )
      : -1;
  const currentRunMessages =
    currentMessageIndex >= 0
      ? allMessages.slice(lastUserIndex + 1, nextUserIndex > -1 ? nextUserIndex : undefined)
      : allMessages;
  const processMessagesInRun = currentRunMessages.filter(
    (item) =>
      item.role === "assistant" &&
      (((item as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) > 0 ||
        messageTextContent((item as { content?: unknown }).content).length > 0),
  );
  const isProcessStep =
    (displayHasToolCalls || (isThought && !isCollaborationComplete)) &&
    !isFinalAnswer &&
    !isCollaborationStep &&
    !isWaitingForUser;
  const isFirstProcessStep =
    isProcessStep && processMessagesInRun[0]?.id === message.id;
  const processStepCount = processMessagesInRun.length;

  const stepNumber = resolveAssistantToolStepNumber({
    message,
    messages: allMessages,
    liveRun,
    collaborationResponses,
  });

  const defaultCollapsed = !isActive && (displayHasToolCalls || isThought);
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const collapsed =
    isProcessStep && processTimelineCollapse.collapsed && !isActive
      ? true
      : manualCollapsed ?? defaultCollapsed;
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

  if (!content && !hasToolCalls) {
    if (isWaitingForUser) {
      const theme = getStepCardTheme({
        hasToolCalls: false,
        isActive: false,
        isFinalAnswer: false,
        isFinalAnswerComplete: false,
        isThought: false,
        isCollaborationStep: true,
        isWaitingForUser: true,
      });
      return (
        <div
          data-copilotkit
          className={[
            "copilotKitMessage copilotKitAssistantMessage step-enter mb-4 rounded-2xl border p-3 shadow-sm",
            theme.card,
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <StepBadge
              stepNumber={stepNumber}
              isFinalAnswer={false}
              isStreamingAnswer={false}
              isActive={false}
              isThought={false}
              isCollaboration={true}
              isWaitingForUser={true}
            />
            <span className={`text-xs font-semibold ${theme.label}`}>
              等待你的回答
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            Agent 已暂停，请在下方卡片中选择或填写你的回答。
          </p>
        </div>
      );
    }
    if (isActive) {
      return <ChatAssistantLoadingRow />;
    }
    return null;
  }

  const rawToolNames = effectiveToolCalls
    .map((call) => call?.function?.name ?? "")
    .filter(Boolean);
  const toolNames = rawToolNames
    .map((call) => toolDisplayTitle(call))
    .filter(Boolean)
    .join("、");
  const toolActionLabel = resolveToolStepActionLabel(rawToolNames);
  const collaborationStepLabel = resolveCollaborationStepLabel(
    rawToolNames,
    isActive,
    linkedCollaboration?.toolName,
  );

  const kindLabel = isWaitingForUser
    ? "等待你的回答"
    : isCollaborationStep
      ? collaborationStepLabel
      : isFinalAnswer
        ? isActive
          ? "正在回答"
          : "回答"
        : displayHasToolCalls
          ? toolActionLabel
          : "思考";

  const summary = resolveStepSummaryText({
    content,
    hasToolCalls: displayHasToolCalls,
    displayToolNames: toolNames,
    toolActionLabel,
    isThought,
  });
  const theme = getStepCardTheme({
    hasToolCalls: displayHasToolCalls,
    isActive,
    isFinalAnswer,
    isFinalAnswerComplete,
    isThought,
    isCollaborationStep,
    isWaitingForUser,
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setManualCollapsed(next);
    if (!next && displayHasToolCalls && selectToolAction) {
      const toolCallId = effectiveToolCalls
        .map((call) => call?.id)
        .find((id): id is string => typeof id === "string" && id.length > 0);
      if (toolCallId) {
        selectToolAction(toolCallId);
      }
    }
  };

  if (isFinalAnswer) {
    return (
      <div
        data-copilotkit
        className="copilotKitMessage copilotKitAssistantMessage step-enter mb-6 px-1"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-light">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-light" />
          <span>{isActive ? "正在回答" : "回答"}</span>
          {isActive ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
              生成中
            </span>
          ) : null}
          {content ? (
            <span className="ml-auto">
              <CopyContentButton content={content} />
            </span>
          ) : null}
        </div>
        {content ? (
          <div className="max-w-none text-sm leading-7 text-foreground [&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
            <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
            {isActive && (
              <span
                className={`caret-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] align-middle ${theme.caret}`}
              />
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
    {isFirstProcessStep ? (
      <div className="copilotKitMessage copilotKitAssistantMessage mb-1 mt-4 flex items-center gap-2 px-1 text-xs text-muted-light">
        <button
          type="button"
          onClick={processTimelineCollapse.toggle}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 font-medium transition-colors duration-150 hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          aria-expanded={!processTimelineCollapse.collapsed}
        >
          <span>工作过程</span>
          <span className="tabular">{processStepCount} 步</span>
          <StepChevron expanded={!processTimelineCollapse.collapsed} />
        </button>
      </div>
    ) : null}
    <div
      data-copilotkit
      style={theme.glowVar}
      className={[
        "copilotKitMessage copilotKitAssistantMessage step-enter relative mb-0 pl-7 pr-1 py-1.5 transition-colors duration-200",
        isProcessStep ? "" : `rounded-xl border p-3 shadow-[var(--shadow-card)] ${theme.card}`,
      ].join(" ")}
    >
      {isProcessStep ? (
        <>
          <span className="absolute left-[9px] top-0 bottom-0 w-px bg-border" aria-hidden />
          <span className="absolute left-0 top-2.5">
            <StepBadge
              stepNumber={stepNumber}
              isFinalAnswer={false}
              isStreamingAnswer={false}
              isActive={isActive}
              isThought={isThought}
            />
          </span>
        </>
      ) : null}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleCollapsed();
          }
        }}
        aria-expanded={!collapsed}
        className={[
          "flex w-full cursor-pointer items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          isProcessStep ? "px-2 py-1 hover:bg-surface-subtle" : "",
        ].join(" ")}
      >
        {!isProcessStep ? (
          <StepBadge
            stepNumber={stepNumber}
            isFinalAnswer={isFinalAnswerComplete}
            isStreamingAnswer={isFinalAnswer && isActive}
            isActive={isActive}
            isThought={isThought}
            isCollaboration={isCollaborationStep || isWaitingForUser}
            isWaitingForUser={isWaitingForUser}
          />
        ) : null}
        <span className={`text-xs font-semibold ${theme.label}`}>
          {kindLabel}
        </span>
        {isActive && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${theme.statusPill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${theme.statusDot}`} />
            {isFinalAnswer ? "生成中" : isWaitingForUser ? "等待输入" : isCollaborationStep ? "协作中" : "执行中"}
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
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={[
            "block w-full truncate rounded-lg text-left text-xs transition-colors duration-150 hover:text-foreground",
            isProcessStep ? "px-2 pb-1 text-muted" : "mt-1.5 text-muted-light",
          ].join(" ")}
          title={summary}
        >
          {summary}
        </button>
      ) : (
        <>
          {content && displayHasToolCalls ? (
            <>
              <StepSubPanel
                title="思考"
                tone="thought"
                streaming={isActive}
              >
                <div className="text-sm leading-6 text-muted [&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
                  <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
                  {isActive && (
                    <span className="caret-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] bg-muted align-middle" />
                  )}
                </div>
              </StepSubPanel>
              <StepSubPanel
                title="工具调用"
                tone="tool"
                badge={effectiveToolCalls.length}
                busy={isActive}
              >
                <div className="grid gap-1">
                  <CopilotChatToolCallsView message={displayMessage} messages={messages} />
                </div>
              </StepSubPanel>
            </>
          ) : content ? (
            <div className="mt-2 text-sm leading-6 text-muted [&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
              <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
              {isActive && (
                <span
                  className={`caret-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] align-middle ${theme.caret}`}
                />
              )}
            </div>
          ) : displayHasToolCalls ? (
            <StepSubPanel
              title="工具调用"
              tone="tool"
              badge={effectiveToolCalls.length}
              busy={isActive}
            >
              <div className="grid gap-1">
                <CopilotChatToolCallsView message={displayMessage} messages={messages} />
              </div>
            </StepSubPanel>
          ) : null}
        </>
      )}
    </div>
    </>
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
          shell: "border-border bg-surface",
          header: "border-border bg-surface-subtle",
          label: "text-muted",
          dot: "bg-muted-light",
        }
      : {
          shell: "border-border bg-surface",
          header: "border-border bg-surface-subtle",
          label: "text-muted",
          dot: "bg-muted-light",
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
          <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-bold text-muted-light">
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
  isCollaborationStep,
  isWaitingForUser,
}: {
  hasToolCalls: boolean;
  isActive: boolean;
  isFinalAnswer: boolean;
  isFinalAnswerComplete: boolean;
  isThought: boolean;
  isCollaborationStep?: boolean;
  isWaitingForUser?: boolean;
}) {
  if (isWaitingForUser || (isCollaborationStep && isActive)) {
    return {
      card: "border-border bg-surface",
      label: "text-foreground",
      statusPill: "border border-border bg-surface-subtle text-foreground",
      statusDot: "bg-foreground",
      caret: "bg-primary",
      glowVar: { ["--step-glow" as string]: "rgb(13 13 13 / 0.12)" },
    };
  }
  if (isCollaborationStep) {
    return {
      card: "border-border bg-surface",
      label: "text-muted",
      statusPill: "border border-border bg-surface-subtle text-muted",
      statusDot: "bg-muted",
      caret: "bg-primary",
      glowVar: undefined,
    };
  }
  if (isFinalAnswerComplete) {
    return {
      card: "border-border bg-surface",
      label: "text-foreground",
      statusPill: "border border-border bg-surface-subtle text-muted",
      statusDot: "bg-muted",
      caret: "bg-primary",
      glowVar: undefined,
    };
  }
  if (isFinalAnswer && isActive) {
    return {
      card: "border-border bg-surface",
      label: "text-foreground",
      statusPill: "border border-border bg-surface-subtle text-foreground",
      statusDot: "bg-foreground",
      caret: "bg-primary",
      glowVar: { ["--step-glow" as string]: "rgb(13 13 13 / 0.12)" },
    };
  }
  if (hasToolCalls && isActive) {
    return {
      card: "border-border bg-surface",
      label: "text-foreground",
      statusPill: "border border-border bg-surface-subtle text-foreground",
      statusDot: "bg-foreground",
      caret: "bg-primary",
      glowVar: { ["--step-glow" as string]: "rgb(13 13 13 / 0.1)" },
    };
  }
  if (hasToolCalls) {
    return {
      card: "border-border bg-surface",
      label: "text-muted",
      statusPill: "border border-border bg-surface-subtle text-muted",
      statusDot: "bg-muted-light",
      caret: "bg-primary",
      glowVar: undefined,
    };
  }
  if (isThought && isActive) {
    return {
      card: "border-border bg-surface",
      label: "text-foreground",
      statusPill: "border border-border bg-surface-subtle text-foreground",
      statusDot: "bg-foreground",
      caret: "bg-primary",
      glowVar: { ["--step-glow" as string]: "rgb(13 13 13 / 0.1)" },
    };
  }
  if (isThought) {
    return {
      card: "border-border bg-surface",
      label: "text-muted",
      statusPill: "border border-border bg-surface-subtle text-muted",
      statusDot: "bg-muted-light",
      caret: "bg-primary",
      glowVar: undefined,
    };
  }
  return {
    card: "border-border bg-surface-subtle/80",
    label: "text-muted-light",
    statusPill: "bg-surface-subtle text-muted",
    statusDot: "bg-muted-light",
    caret: "bg-muted",
    glowVar: undefined,
  };
}

function StepChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      data-expanded={expanded}
      className="step-chevron flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-light"
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

function ChatAssistantLoadingRow() {
  return (
    <div
      data-copilotkit
      className="copilotKitMessage copilotKitAssistantMessage mb-4 flex items-center gap-2.5"
      role="status"
      aria-live="polite"
      aria-label="Agent 思考中"
    >
      <StepBadge
        stepNumber={0}
        isFinalAnswer={false}
        isStreamingAnswer={false}
        isActive={true}
        isThought={true}
      />
      <span className="chat-assistant-loading-pill inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium">
        <span className="chat-assistant-loading-dot h-1.5 w-1.5 rounded-full" />
        <span className="chat-assistant-loading-dot h-1.5 w-1.5 rounded-full" />
        <span className="chat-assistant-loading-dot h-1.5 w-1.5 rounded-full" />
      </span>
    </div>
  );
}

function StepBadge({
  stepNumber,
  isFinalAnswer,
  isStreamingAnswer,
  isActive,
  isThought,
  isCollaboration,
  isWaitingForUser,
}: {
  stepNumber: number;
  isFinalAnswer: boolean;
  isStreamingAnswer: boolean;
  isActive: boolean;
  isThought?: boolean;
  isCollaboration?: boolean;
  isWaitingForUser?: boolean;
}) {
  const presentation = resolveStepBadgePresentation({
    stepNumber,
    isFinalAnswer,
    isStreamingAnswer,
    isActive,
    isThought,
    isCollaboration,
    isWaitingForUser,
  });

  if (presentation.kind === "waiting") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-foreground">
        <span className="absolute inset-0 rounded-full bg-muted-light/45 animate-ping" />
        <span className="relative text-[9px] font-bold text-white">?</span>
      </span>
    );
  }
  if (presentation.kind === "collaboration") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-subtle text-muted">
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
          <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 17v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1H4Z" />
        </svg>
      </span>
    );
  }
  if (presentation.kind === "final") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-subtle text-muted">
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
  if (presentation.kind === "streaming") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-foreground">
        <span className="absolute inset-0 rounded-full bg-muted-light/60 animate-ping" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-white" />
      </span>
    );
  }
  if (presentation.kind === "number") {
    return (
      <span
        className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
          isActive
            ? "bg-foreground text-white"
            : "border border-border bg-surface text-muted"
        }`}
      >
        {isActive && (
          <span className="absolute inset-0 rounded-full bg-muted-light/60 animate-ping" />
        )}
        <span className="relative">{presentation.value}</span>
      </span>
    );
  }
  if (presentation.kind === "thought") {
    return (
      <span
        className={`relative flex h-5 w-5 items-center justify-center rounded-full ${
          isActive ? "bg-foreground" : "border border-border bg-surface"
        }`}
      >
        {isActive && (
          <span className="absolute inset-0 rounded-full bg-muted-light/60 animate-ping" />
        )}
        <span
          className={`relative h-1.5 w-1.5 rounded-full ${isActive ? "bg-white" : "bg-muted"}`}
        />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-light" />
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

function SidebarToggleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
      <line x1="7.75" y1="3.75" x2="7.75" y2="16.25" />
    </svg>
  );
}

function WorkspaceFilesGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 2.75H5.5A1.75 1.75 0 0 0 3.75 4.5v11A1.75 1.75 0 0 0 5.5 17.25h9a1.75 1.75 0 0 0 1.75-1.75V8z" />
      <path d="M11 2.75V8h5.25" />
    </svg>
  );
}

function SessionBubbleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-muted-light"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-3.5 2.5V13H6.5A2.5 2.5 0 0 1 4 10.5v-5Z"
      />
    </svg>
  );
}

function MoreHorizontalIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="4.5" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="15.5" cy="10" r="1.2" />
    </svg>
  );
}

function PinMenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 3.5h3l.5 3 2.5 2.5-1.5 1.5-2-1V16l-2-1.5V9.5l-2 1-1.5-1.5L7 6.5l.5-3Z" />
    </svg>
  );
}

function ShareMenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5 16 8.5 12 12.5M16 8.5H8a3.5 3.5 0 1 0 0 7" />
    </svg>
  );
}

function PencilMenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12.2 4.8 3 3-7.8 7.8H4.4v-3l7.8-7.8Z"
      />
    </svg>
  );
}

function TrashMenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 6.5h10M8 6.5V5h4v1.5M7 6.5v8.5h6V6.5" />
    </svg>
  );
}

function SessionActionMenu({
  session,
  forceVisible,
  onRename,
  onDelete,
  onTogglePin,
}: {
  session: ChatSession;
  forceVisible?: boolean;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const runMenuAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  const menuItemClass =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-foreground";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`会话操作：${session.title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={[
          "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-light transition-colors duration-150 hover:bg-surface-subtle hover:text-foreground",
          open || forceVisible
            ? "bg-surface-subtle text-foreground opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        ].join(" ")}
      >
        <MoreHorizontalIcon />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[148px] rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-card-hover)]"
        >
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              runMenuAction(onTogglePin);
            }}
          >
            <PinMenuIcon />
            {session.pinned ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-muted-light opacity-50"
            title="分享功能待后端支持"
          >
            <ShareMenuIcon />
            分享
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              runMenuAction(onRename);
            }}
          >
            <PencilMenuIcon />
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-step-error transition-colors duration-150 hover:bg-step-error/8"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              runMenuAction(onDelete);
            }}
          >
            <TrashMenuIcon />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SessionListItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);

  useEffect(() => {
    if (!editing) setDraftTitle(session.title);
  }, [editing, session.title]);

  const commitRename = () => {
    onRename(draftTitle);
    setEditing(false);
  };
  const iconSlots = getSessionListItemIconSlots({ pinned: Boolean(session.pinned) });

  if (editing) {
    return (
      <div className="rounded-lg bg-surface px-2 py-1.5 shadow-[var(--shadow-card)]">
        <input
          autoFocus
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftTitle(session.title);
              setEditing(false);
            }
          }}
          className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground outline-none transition-colors duration-150 focus:border-muted-light"
        />
      </div>
    );
  }

  return (
    <div
      id={`session-item-${session.id}`}
      className={[
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150",
        active ? "bg-surface shadow-[var(--shadow-card)]" : "hover:bg-surface",
      ].join(" ")}
    >
      {iconSlots.leading === "session" ? (
        <SessionBubbleIcon />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        title={session.title}
        className={[
          "min-w-0 flex-1 truncate text-left text-sm transition",
          active ? "font-medium text-foreground" : "text-muted hover:text-foreground",
        ].join(" ")}
      >
        {session.title}
      </button>
      {iconSlots.trailing === "pin" && (
        <span
          className="shrink-0 text-muted"
          title="已置顶"
          aria-label="已置顶"
        >
          <PinMenuIcon />
        </span>
      )}
      <SessionActionMenu
        session={session}
        forceVisible={active}
        onRename={() => setEditing(true)}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

type SessionPaneProps = {
  activeSessionId: string | null;
  activeConfigPanel: WorkspaceConfigPanelKey | null;
  activeFilesPanel: boolean;
  collapsed: boolean;
  filteredSessions: ChatSession[];
  query: string;
  sessionCount: number;
  workspaceFileCount: number;
  workspaceConfig: WorkspaceConfigStore;
  capabilitiesReady: boolean;
  onCreateSession: () => void;
  onOpenConfigPanel: (panel: WorkspaceConfigPanelKey) => void;
  onOpenFilesPanel: () => void;
  onQueryChange: (value: string) => void;
  onToggleCollapse: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePinSession: (sessionId: string) => void;
};

function SessionPane({
  activeSessionId,
  activeConfigPanel,
  activeFilesPanel,
  collapsed,
  filteredSessions,
  query,
  sessionCount,
  workspaceFileCount,
  workspaceConfig,
  capabilitiesReady,
  onCreateSession,
  onOpenConfigPanel,
  onOpenFilesPanel,
  onQueryChange,
  onToggleCollapse,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onTogglePinSession,
}: SessionPaneProps) {
  const collapsedRailCopy = getCollapsedWorkspaceRailCopy();
  const previewClassNames = getCollapsedWorkspacePreviewClassNames();

  if (collapsed) {
    return (
      <aside
        aria-label={collapsedRailCopy.railLabel}
        className="relative z-30 flex h-full min-h-0 w-14 min-w-14 max-w-14 shrink-0 flex-col items-center border-r border-border bg-surface-subtle py-3"
      >
        <div className="group relative">
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsedRailCopy.expandLabel}
            aria-label={collapsedRailCopy.expandLabel}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-foreground shadow-[var(--shadow-card)] transition-colors duration-200 hover:bg-surface-subtle"
          >
            <SidebarToggleIcon />
          </button>
          <div className={previewClassNames.panel} aria-label="工作区侧栏预览">
            <SessionPaneContent
              activeSessionId={activeSessionId}
              activeConfigPanel={activeConfigPanel}
              activeFilesPanel={activeFilesPanel}
              filteredSessions={filteredSessions}
              query={query}
              sessionCount={sessionCount}
              workspaceFileCount={workspaceFileCount}
              workspaceConfig={workspaceConfig}
              capabilitiesReady={capabilitiesReady}
              onCreateSession={onCreateSession}
              onOpenConfigPanel={onOpenConfigPanel}
              onOpenFilesPanel={onOpenFilesPanel}
              onQueryChange={onQueryChange}
              onToggleCollapse={onToggleCollapse}
              onSelectSession={onSelectSession}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
              onTogglePinSession={onTogglePinSession}
              preview
            />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-[320px] min-w-[320px] max-w-[320px] shrink-0 flex-col overflow-hidden border-r border-border bg-surface-subtle">
      <SessionPaneContent
        activeSessionId={activeSessionId}
        activeConfigPanel={activeConfigPanel}
        activeFilesPanel={activeFilesPanel}
        filteredSessions={filteredSessions}
        query={query}
        sessionCount={sessionCount}
        workspaceFileCount={workspaceFileCount}
        workspaceConfig={workspaceConfig}
        capabilitiesReady={capabilitiesReady}
        onCreateSession={onCreateSession}
        onOpenConfigPanel={onOpenConfigPanel}
        onOpenFilesPanel={onOpenFilesPanel}
        onQueryChange={onQueryChange}
        onToggleCollapse={onToggleCollapse}
        onSelectSession={onSelectSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        onTogglePinSession={onTogglePinSession}
      />
    </aside>
  );
}

function SessionPaneContent({
  activeSessionId,
  activeConfigPanel,
  activeFilesPanel,
  filteredSessions,
  query,
  sessionCount,
  workspaceFileCount,
  workspaceConfig,
  capabilitiesReady,
  onCreateSession,
  onOpenConfigPanel,
  onOpenFilesPanel,
  onQueryChange,
  onToggleCollapse,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onTogglePinSession,
  preview = false,
}: Omit<SessionPaneProps, "collapsed"> & { preview?: boolean }) {
  const previewClassNames = getCollapsedWorkspacePreviewClassNames();

  return (
    <div
      className={
        preview
          ? previewClassNames.content
          : "flex h-full min-h-0 w-full flex-col overflow-hidden"
      }
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-sm font-semibold text-foreground shadow-[var(--shadow-card)]">
          D
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground">数据任务</h1>
          <p className="text-xs text-muted-light">{sessionCount} 个会话</p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={preview ? "展开为常驻侧栏" : "收起为工作区快捷栏"}
          aria-label={preview ? "展开为常驻侧栏" : "收起为工作区快捷栏"}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-light transition-colors duration-200 hover:bg-surface-subtle hover:text-foreground"
        >
          <SidebarToggleIcon />
        </button>
      </div>

      <div className="border-b border-border px-3 py-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={sectionLabelClass}>工作区默认配置</span>
        </div>
        <p className="mb-1.5 text-[11px] leading-4 text-muted-light">
          默认全部可用；本次任务的启用/关闭将在对话框中控制
        </p>
        <div className="flex flex-col gap-0.5">
          <ConfigRow
            kind="db"
            value={configSummary("db", workspaceConfig)}
            active={activeConfigPanel === "db"}
            onClick={() => onOpenConfigPanel("db")}
          />
          <ConfigRow
            kind="kb"
            value={configSummary("kb", workspaceConfig)}
            active={activeConfigPanel === "kb"}
            unsupported={capabilitiesReady && !isResourcePanelSupported("kb")}
            onClick={() => onOpenConfigPanel("kb")}
          />
          <ConfigRow
            kind="mcp"
            value={configSummary("mcp", workspaceConfig)}
            active={activeConfigPanel === "mcp"}
            unsupported={capabilitiesReady && !isResourcePanelSupported("mcp")}
            onClick={() => onOpenConfigPanel("mcp")}
          />
          <ConfigRow
            kind="skill"
            value={configSummary("skill", workspaceConfig)}
            active={activeConfigPanel === "skill"}
            unsupported={capabilitiesReady && !isResourcePanelSupported("skill")}
            onClick={() => onOpenConfigPanel("skill")}
          />
          <ConfigRow
            kind="llm"
            value={configSummary("llm", workspaceConfig)}
            active={activeConfigPanel === "llm"}
            onClick={() => onOpenConfigPanel("llm")}
          />
          <WorkspaceFilesRow
            count={workspaceFileCount}
            active={activeFilesPanel}
            unsupported={capabilitiesReady && !hasCapability("files")}
            onClick={onOpenFilesPanel}
          />
        </div>
      </div>

      <div className="border-b border-border p-3">
        <button
          type="button"
          onClick={onCreateSession}
          className="h-9 w-full cursor-pointer rounded-lg bg-primary text-sm font-semibold text-white transition-colors duration-200 hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          新建数据任务
        </button>
        <label className="mt-3 block">
          <span className="sr-only">搜索会话</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors duration-200 placeholder:text-muted-light focus:border-muted-light focus:bg-surface"
            placeholder="搜索会话"
          />
        </label>
      </div>

      <div
        className={
          preview
            ? previewClassNames.sessionList
            : "min-h-0 flex-1 overflow-y-auto p-2"
        }
      >
        <div className="px-2 pb-2 text-xs font-semibold text-muted-light">
          {preview ? "历史对话" : "会话"}
        </div>
        <div className="flex flex-col gap-0.5">
          {filteredSessions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-light">没有匹配的会话。</p>
          ) : (
            filteredSessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => onSelectSession(session.id)}
                onRename={(title) => onRenameSession(session.id, title)}
                onDelete={() => onDeleteSession(session.id)}
                onTogglePin={() => onTogglePinSession(session.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceFilesLibraryPanel({
  onBack,
  onFilesChange,
}: {
  onBack: () => void;
  onFilesChange: (files: FileAssetRefDto[]) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-light transition hover:bg-surface-subtle hover:text-foreground"
          aria-label="返回对话"
          title="返回对话"
        >
          <ChevronIcon direction="left" />
        </button>
        <div className="min-w-0">
          <h2 className={panelTitleClass}>工作区文件</h2>
          <p className="text-xs text-muted-light">
            跨会话可复用的文件资产，可在 @ 文件中注入到后续任务。
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <WorkspaceFileAssetsPanel onFilesChange={onFilesChange} />
      </div>
    </div>
  );
}

function WorkspaceConfigPanel({
  panel,
  items,
  workspaceConfig,
  loading,
  onAdd,
  onBack,
  onSaveItem,
  onDeleteItem,
  onTestItem,
  onIntrospect,
  onReindex,
  onUploadKnowledgeFile,
  onReplaceSkill,
  onValidateSkill,
}: {
  panel: WorkspaceConfigPanelKey;
  items: WorkspaceConfigItem[];
  workspaceConfig: WorkspaceConfigStore;
  loading?: boolean;
  onAdd: (
    payload: {
      name: string;
      description: string;
      enabled?: boolean;
      settings?: Record<string, string>;
    },
    skillFile?: File,
  ) => Promise<string>;
  onBack: () => void;
  onSaveItem: (item: WorkspaceConfigItem) => Promise<WorkspaceConfigItem>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onTestItem: (itemId: string) => Promise<Record<string, unknown>>;
  onIntrospect?: (itemId: string) => Promise<void>;
  onReindex?: (itemId: string) => Promise<void>;
  onUploadKnowledgeFile?: (itemId: string, file: File) => Promise<void>;
  onReplaceSkill?: (itemId: string, file: File) => Promise<void>;
  onValidateSkill?: (itemId: string) => Promise<void>;
}) {
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<WorkspaceConfigItem | null>(null);
  const [editDraftItem, setEditDraftItem] = useState<WorkspaceConfigItem | null>(null);
  const [pendingSkillFile, setPendingSkillFile] = useState<File | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [testResult, setTestResult] = useState<ConfigTestPresentation | null>(null);

  useEffect(() => {
    setDetailItemId(null);
    setDraftItem(null);
    setEditDraftItem(null);
    setPendingSkillFile(null);
    setPanelError(null);
    setTestResult(null);
  }, [panel]);

  useEffect(() => {
    if (!detailItemId || detailItemId === NEW_CONFIG_ITEM_ID) {
      setEditDraftItem(null);
      return;
    }
    const saved = items.find((entry) => entry.id === detailItemId);
    if (!saved) return;
    setEditDraftItem((current) => {
      if (!current || current.id !== detailItemId) {
        return saved;
      }
      if (workspaceConfigItemDraftEquals(current, saved)) {
        return saved;
      }
      return current;
    });
  }, [detailItemId, items]);

  const isCreating = detailItemId === NEW_CONFIG_ITEM_ID;
  const savedItem =
    !isCreating && detailItemId
      ? items.find((item) => item.id === detailItemId) ?? null
      : null;
  const detailItem = isCreating ? draftItem : editDraftItem ?? savedItem;

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
    db: "管理数据源；支持 DuckDB demo / SQLite / CSV / Excel / PostgreSQL / MySQL。配置经 REST API 持久化。",
    kb: "管理知识库；上传文档、重建索引与调试检索均经 REST API。",
    mcp: "管理 MCP 服务器连接；测试连接后会缓存 tools manifest。",
    skill: "上传 SKILL.md 或 .zip 技能包；包正文存储在服务端，run 时仅传 skill id。",
    llm: "管理 LLM model profile；run 时通过 run_config.activeLlmProfileId 切换模型。",
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
      setEditDraftItem(null);
      setTestResult(null);
      return;
    }
    onBack();
  };

  const handleSaveEdit = async () => {
    if (!editDraftItem) return;
    setActionBusy(true);
    setPanelError(null);
    try {
      const saved = await onSaveItem(editDraftItem);
      setEditDraftItem(saved);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelEdit = () => {
    if (savedItem) {
      setEditDraftItem(savedItem);
    }
    setPanelError(null);
  };

  const handleCreate = async () => {
    if (!draftItem) return;
    const name = draftItem.name.trim();
    if (!name) return;
    setActionBusy(true);
    setPanelError(null);
    try {
      const createdId = await onAdd(
        {
          name,
          description: draftItem.description.trim() || "自定义配置项",
          enabled: draftItem.enabled,
          settings: draftItem.settings,
        },
        panel === "skill" ? pendingSkillFile ?? undefined : undefined,
      );
      setDetailItemId(createdId);
      setDraftItem(null);
      setPendingSkillFile(null);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-6">
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
          {panelError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {panelError}
            </div>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-500">正在从 REST API 加载配置…</p>
          ) : null}
          {detailItem ? (
            <ConfigItemDetailView
              item={detailItem}
              savedItem={savedItem}
              mode={isCreating ? "create" : "edit"}
              panel={panel}
              workspaceConfig={workspaceConfig}
              onCreate={() => {
                void handleCreate();
              }}
              createDisabled={
                actionBusy || (panel === "skill" && isCreating && !pendingSkillFile)
              }
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
                setEditDraftItem((current) =>
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
              }}
              onSave={
                !isCreating
                  ? () => {
                      void handleSaveEdit();
                    }
                  : undefined
              }
              onCancel={!isCreating ? handleCancelEdit : undefined}
              saveBusy={actionBusy}
              onDelete={
                !isCreating && !(panel === "skill" && detailItem.builtin)
                  ? async () => {
                      setActionBusy(true);
                      try {
                        await onDeleteItem(detailItem.id);
                        setDetailItemId(null);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "删除失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onTest={
                !isCreating
                  ? async () => {
                      setActionBusy(true);
                      setPanelError(null);
                      setTestResult(null);
                      try {
                        const result = await onTestItem(detailItem.id);
                        setTestResult(formatConfigTestResult(panel, result));
                      } catch (error) {
                        setTestResult(formatConfigTestError(error));
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              testBusy={actionBusy}
              testResult={testResult}
              onIntrospect={
                !isCreating && onIntrospect
                  ? async () => {
                      setActionBusy(true);
                      try {
                        await onIntrospect(detailItem.id);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "Schema 抓取失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onReindex={
                !isCreating && onReindex
                  ? async () => {
                      setActionBusy(true);
                      try {
                        await onReindex(detailItem.id);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "重建索引失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onUploadKnowledgeFile={
                !isCreating && onUploadKnowledgeFile
                  ? async (file) => {
                      setActionBusy(true);
                      try {
                        await onUploadKnowledgeFile(detailItem.id, file);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "上传失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onReplaceSkill={
                !isCreating && onReplaceSkill
                  ? async (file) => {
                      setActionBusy(true);
                      try {
                        await onReplaceSkill(detailItem.id, file);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "替换 Skill 失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onValidateSkill={
                !isCreating && onValidateSkill
                  ? async () => {
                      setActionBusy(true);
                      try {
                        await onValidateSkill(detailItem.id);
                      } catch (error) {
                        setPanelError(
                          error instanceof Error ? error.message : "校验失败",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    }
                  : undefined
              }
              onSelectSkillFile={
                isCreating && panel === "skill"
                  ? (file) => setPendingSkillFile(file)
                  : undefined
              }
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
              {panel === "db" ? (
                <SchemaBrowserPanel datasources={items} />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigItemDetailView({
  item,
  savedItem,
  mode,
  panel,
  workspaceConfig,
  onCreate,
  createDisabled,
  onUpdate,
  onSave,
  onCancel,
  saveBusy = false,
  onDelete,
  onTest,
  onIntrospect,
  onReindex,
  onUploadKnowledgeFile,
  onReplaceSkill,
  onValidateSkill,
  onSelectSkillFile,
  testBusy = false,
  testResult,
}: {
  item: WorkspaceConfigItem;
  savedItem?: WorkspaceConfigItem | null;
  mode: "create" | "edit";
  panel: WorkspaceConfigPanelKey;
  workspaceConfig: WorkspaceConfigStore;
  onCreate: () => void;
  createDisabled?: boolean;
  onUpdate: (
    patch: Partial<
      Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
    >,
  ) => void;
  onSave?: () => void;
  onCancel?: () => void;
  saveBusy?: boolean;
  onDelete?: () => void | Promise<void>;
  onTest?: () => void | Promise<void>;
  onIntrospect?: () => void | Promise<void>;
  onReindex?: () => void | Promise<void>;
  onUploadKnowledgeFile?: (file: File) => void | Promise<void>;
  onReplaceSkill?: (file: File) => void | Promise<void>;
  onValidateSkill?: () => void | Promise<void>;
  onSelectSkillFile?: (file: File) => void;
  testBusy?: boolean;
  testResult?: ConfigTestPresentation | null;
}) {
  const [mcpTools, setMcpTools] = useState<Array<Record<string, unknown>> | null>(null);
  const [mcpToolsError, setMcpToolsError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || panel !== "mcp") {
      setMcpTools(null);
      setMcpToolsError(null);
      return;
    }
    let cancelled = false;
    void configApi
      .getMcpTools(item.id)
      .then((tools) => {
        if (!cancelled) {
          setMcpTools(tools);
          setMcpToolsError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMcpTools(null);
          setMcpToolsError(error instanceof Error ? error.message : "无法加载 tools manifest");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, panel, item.id]);

  const settings: Record<string, string> =
    panel === "llm"
      ? normalizeLlmSettingsExtended(
          item.settings ?? defaultSettingsForKind(panel, item.name),
        )
      : panel === "mcp"
        ? normalizeMcpSettings(item.settings ?? defaultSettingsForKind(panel, item.name))
        : panel === "kb"
          ? normalizeKbSettings(item.settings ?? defaultSettingsForKind(panel, item.name))
          : panel === "skill"
            ? normalizeSkillSettings(
                item.settings ?? defaultSettingsForKind(panel, item.name),
              )
            : (item.settings ?? defaultSettingsForKind(panel, item.name));
  const fields = renderableConfigFields(panel, settings);
  const fieldOptionsContext = {
    workspaceConfig,
    currentItemId: item.id,
  };
  const nameReadOnly = mode === "edit" && panel === "skill" && !!item.builtin;
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
      "数据源经 REST API 注册；凭据写入 secretRef，读接口不回传明文。" +
      "测试连接与 schema 抓取结果会更新 connectionStatus。",
    kb: "知识库文档与索引经 REST API 管理；run 时按 run_config.enabledKnowledgeIds 检索。",
    mcp:
      "MCP server 经 REST API 注册；测试连接会刷新 toolManifest 与 healthStatus。",
    llm:
      "Model profile 经 REST API 管理；run 时通过 run_config.activeLlmProfileId 切换。",
    skill: isBuiltinSkill
      ? "内置 Skill 由服务端预置，run 时仅传 skill id。"
      : "自定义 Skill 经 multipart REST 上传；包正文存储在服务端。",
  };

  const createDisabledFinal =
    Boolean(createDisabled) ||
    !isWorkspaceConfigItemValid(panel, item, settings);
  const createLabel = panel === "skill" ? "导入 Skill" : "创建配置项";
  const isDirty =
    mode === "edit" &&
    savedItem != null &&
    !workspaceConfigItemDraftEquals(item, savedItem);
  const saveDisabledFinal =
    !isDirty ||
    saveBusy ||
    !isWorkspaceConfigItemValid(panel, item, settings);

  return (
    <div className="space-y-4">
      {panel === "skill" && <SkillConfigProtocolHint builtin={isBuiltinSkill} />}

      {!isBuiltinSkill && panel === "skill" && (
        <SkillPackageUpload
          fileName={settings.packageFileName}
          onImport={(pkg) => {
            onUpdate({
              name: pkg.name,
              description: pkg.description,
              settings: skillSettingsFromPackage(pkg),
            });
          }}
          onSelectFile={onSelectSkillFile ?? onReplaceSkill}
        />
      )}

      {panel === "kb" && mode === "edit" && onUploadKnowledgeFile ? (
        <KnowledgeFileUpload onUpload={onUploadKnowledgeFile} />
      ) : null}

      {mode === "edit" && (onTest || onIntrospect || onReindex || onValidateSkill || onDelete) ? (
        <section className="flex flex-wrap gap-2 rounded-xl border border-border bg-white px-5 py-4">
          {onTest ? (
            <ActionButton
              label={testBusy ? "测试中…" : "测试连接"}
              disabled={testBusy}
              onClick={() => void onTest()}
            />
          ) : null}
          {onIntrospect ? (
            <ActionButton label="抓取 Schema" onClick={() => void onIntrospect()} />
          ) : null}
          {onReindex ? (
            <ActionButton label="重建索引" onClick={() => void onReindex()} />
          ) : null}
          {onValidateSkill ? (
            <ActionButton label="语义校验" onClick={() => void onValidateSkill()} />
          ) : null}
          {onDelete ? (
            <ActionButton label="删除" tone="danger" onClick={() => void onDelete()} />
          ) : null}
        </section>
      ) : null}

      {testResult ? <ConfigTestResultCard result={testResult} /> : null}

      <div className="rounded-xl border border-border bg-white px-5 py-4">
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
        <section className="space-y-3 rounded-xl border border-border bg-slate-50 px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
            {panel === "skill" ? "包信息" : "具体配置"}
          </h4>
          {panel === "llm" && (
            <LlmConfigProtocolHint builtin={!!item.builtin && mode === "edit"} />
          )}
          {panel === "mcp" && <McpConfigProtocolHint />}
          {panel === "mcp" && mode === "edit" ? (
            <McpToolsManifest tools={mcpTools} error={mcpToolsError} />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => {
              const isSecretField =
                field.inputType === "password" ||
                field.key === "apiKey" ||
                field.key === "embeddingApiKey";
              const secretPlaceholder =
                mode === "edit" &&
                item.hasSecret &&
                isSecretField &&
                !(settings[field.key] ?? "").trim()
                  ? "已保存（留空则不修改）"
                  : field.placeholder;
              const lockField = panel === "skill";
              const pending = lockField && isFieldPending(field, settings);
              const disabled = lockField ? isFieldDisabled(field, item, settings) : false;
              const options = resolveConfigFieldOptions(field, fieldOptionsContext);
              return (
              <EditableField
                key={field.key}
                label={field.label}
                value={settings[field.key] ?? ""}
                placeholder={secretPlaceholder}
                helpText={field.helpText}
                inputType={field.inputType}
                options={options}
                isOptionPending={
                  lockField ? (value) => isSelectOptionPending(field, value) : undefined
                }
                fullWidth={field.fullWidth}
                required={field.required && !pending}
                readOnly={lockField ? (field.readOnly?.(item) ?? false) : false}
                disabled={disabled}
                pending={pending}
                onChange={(value) =>
                  onUpdate({ settings: { [field.key]: value } })
                }
              />
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-white px-5 py-4">
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
            disabled={createDisabledFinal}
            onClick={onCreate}
            className="h-9 rounded-lg bg-code-bg px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {createLabel}
          </button>
        </div>
      )}

      {mode === "edit" && onSave && onCancel ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {isDirty ? (
            <span className="mr-auto text-xs text-amber-700">有未保存的修改</span>
          ) : null}
          <ActionButton
            label="取消"
            disabled={!isDirty || saveBusy}
            onClick={onCancel}
          />
          <button
            type="button"
            disabled={saveDisabledFinal}
            onClick={onSave}
            className="h-9 rounded-lg bg-code-bg px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveBusy ? "保存中…" : "保存"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  tone = "default",
  onClick,
  disabled = false,
}: {
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "h-8 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
          : "border border-border bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ConfigTestResultCard({ result }: { result: ConfigTestPresentation }) {
  const success = result.tone === "success";
  return (
    <section
      aria-live="polite"
      className={[
        "rounded-xl border px-4 py-3 text-sm",
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900",
      ].join(" ")}
    >
      <h4 className="font-medium">{result.title}</h4>
      <ul className="mt-1 space-y-0.5 text-xs opacity-90">
        {result.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </section>
  );
}

function KnowledgeFileUpload({
  onUpload,
}: {
  onUpload: (file: File) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-slate-900">上传文档</h4>
          <p className="mt-1 text-xs text-slate-500">
            上传到知识库并参与后续 reindex / 检索。
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-9 rounded-lg border border-border bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          选择文件
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onUpload(file);
          event.target.value = "";
        }}
      />
    </section>
  );
}

function SkillPackageUpload({
  fileName,
  onImport,
  onSelectFile,
}: {
  fileName: string;
  onImport: (pkg: ParsedSkillPackage) => void;
  onSelectFile?: (file: File) => void;
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
    onSelectFile?.(file);
    onImport(result);
  };

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-slate-900">上传 Skill 包</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            支持 SKILL.md（须含 YAML frontmatter）或 .zip 目录包；创建/替换经 REST API 上传。
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
          className="h-9 rounded-lg border border-border bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
          <li>自定义 Skill 经 REST multipart 上传；AG-UI context 只带 skill id</li>
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
          远程服务常用 SSE / Streamable HTTP URL，例如{" "}
          <code className="text-[11px]">https://host/mcp</code>
        </li>
        <li>
          配置经 <code className="text-[11px]">POST /api/v1/mcp-servers</code>{" "}
          持久化；token 写入 secretRef
        </li>
        <li>
          run 时按 <code className="text-[11px]">run_config.enabledMcpServerIds</code>{" "}
          挂载 MCP tools
        </li>
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
          Model profile 经{" "}
          <code className="text-[11px]">POST /api/v1/model-profiles</code>{" "}
          注册；API Key 写入 secretRef
        </li>
        <li>
          run 时通过{" "}
          <code className="text-[11px]">run_config.activeLlmProfileId</code>{" "}
          切换模型
        </li>
        {builtin && (
          <li>「服务端默认」项只读，对应服务端 env 中的 LLM 配置</li>
        )}
      </ul>
    </div>
  );
}

function McpToolsManifest({
  tools,
  error,
}: {
  tools: Array<Record<string, unknown>> | null;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 sm:col-span-2">
      <h5 className="text-xs font-semibold text-slate-700">Tools Manifest</h5>
      {error ? (
        <p className="mt-1 text-xs text-rose-600">{error}</p>
      ) : tools === null ? (
        <p className="mt-1 text-xs text-slate-400">正在加载…</p>
      ) : tools.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">暂无工具；请先测试连接以刷新 manifest。</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600">
          {tools.map((tool, index) => {
            const name = typeof tool.name === "string" ? tool.name : `tool-${index + 1}`;
            const description =
              typeof tool.description === "string" ? tool.description : "";
            return (
              <li key={`${name}-${index}`} className="rounded-md bg-slate-50 px-2 py-1">
                <span className="font-medium text-slate-800">{name}</span>
                {description ? (
                  <span className="ml-2 text-slate-500">{description}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  helpText,
  readOnly,
  disabled = false,
  pending = false,
  required,
  multiline,
  inputType = "text",
  options,
  isOptionPending,
  fullWidth,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  helpText?: string;
  readOnly?: boolean;
  disabled?: boolean;
  pending?: boolean;
  required?: boolean;
  multiline?: boolean;
  inputType?: "text" | "password" | "url" | "select" | "number" | "boolean" | "textarea";
  options?: Array<{ value: string; label: string }>;
  isOptionPending?: (value: string) => boolean;
  fullWidth?: boolean;
  onChange: (value: string) => void;
}) {
  const isLocked = readOnly || disabled;
  const className =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition read-only:bg-slate-50 read-only:text-slate-500 focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
  const wrapperClass = fullWidth ? "sm:col-span-2" : "";

  return (
    <label className={`block ${wrapperClass}`}>
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-600">
        <span>
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
        {pending ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            待后端
          </span>
        ) : null}
      </span>
      {inputType === "boolean" ? (
        <select
          value={value === "true" ? "true" : "false"}
          disabled={isLocked}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} h-9`}
        >
          <option value="false">否</option>
          <option value="true">是</option>
        </select>
      ) : inputType === "select" && options ? (
        <select
          value={value}
          disabled={isLocked}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} h-9`}
        >
          <option value="">请选择…</option>
          {options.map((option) => {
            const optionPending = isOptionPending?.(option.value) ?? false;
            return (
              <option
                key={option.value}
                value={option.value}
                disabled={optionPending}
              >
                {option.label}
                {optionPending ? "（待后端）" : ""}
              </option>
            );
          })}
        </select>
      ) : multiline ? (
        <textarea
          value={value}
          readOnly={isLocked}
          disabled={disabled}
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
          disabled={disabled}
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
    <div className="rounded-lg border border-border bg-slate-50 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 break-all text-sm text-slate-800">{value}</dd>
    </div>
  );
}

// Status badge from backend test/validation fields mapped into `item.status`.
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
    "border-border bg-white hover:border-slate-300",
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
  kind,
  value,
  unsupported,
  active,
  onClick,
}: {
  kind: WorkspaceConfigKind;
  value: string;
  unsupported?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const label = WORKSPACE_CONFIG_SHORT_LABEL[kind];
  const badgeClass = WORKSPACE_CONFIG_BADGE_CLASS[kind];

  const className = [
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150",
    onClick ? "cursor-pointer hover:bg-surface" : "",
    active ? "bg-surface font-medium shadow-[var(--shadow-card)]" : "",
  ].join(" ");

  const content = (
    <>
      <span
        className={[
          "inline-flex w-9 shrink-0 items-center justify-center rounded-md px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
          badgeClass,
        ].join(" ")}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-muted">{value}</span>
      {unsupported && (
        <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[10px] text-muted-light">
          未支持
        </span>
      )}
      {onClick && (
        <span className="shrink-0 text-muted-light">
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

function WorkspaceFilesRow({
  count,
  unsupported,
  active,
  onClick,
}: {
  count: number;
  unsupported?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150 hover:bg-surface",
        active ? "bg-surface font-medium shadow-[var(--shadow-card)]" : "",
      ].join(" ")}
      title="工作区文件"
    >
      <span className="inline-flex w-9 shrink-0 items-center justify-center rounded-md bg-surface-subtle px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-border">
        File
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-muted">
        {count > 0 ? `${count} 个跨会话文件` : "跨会话文件资产"}
      </span>
      {unsupported ? (
        <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[10px] text-muted-light">
          未支持
        </span>
      ) : null}
      <span className="shrink-0 text-muted-light">
        <ChevronIcon direction="right" />
      </span>
    </button>
  );
}

function ChatPane({
  activeThreadId,
  title,
  datasourceId,
  liveRunStatus,
  liveRun,
  chatInput: ChatInput,
  rightPanelOpen,
  onOpenRightPanel,
  onChatColumnWidthChange,
  capabilitiesReady,
}: {
  activeThreadId?: string;
  title: string;
  datasourceId: string;
  liveRunStatus: LiveRun["runStatus"];
  liveRun: LiveRun;
  chatInput: ComponentType<ComponentProps<typeof DataTaskChatInput>>;
  rightPanelOpen: boolean;
  onOpenRightPanel: () => void;
  onChatColumnWidthChange: (width: number) => void;
  capabilitiesReady: boolean;
}) {
  const { containerRef, chatColumnWidth } = useChatColumnWidth();
  const [processTimelineCollapsed, setProcessTimelineCollapsed] = useState(false);
  const processTimelineCollapse = useMemo(
    () => ({
      collapsed: processTimelineCollapsed,
      toggle: () => setProcessTimelineCollapsed((value) => !value),
    }),
    [processTimelineCollapsed],
  );

  useEffect(() => {
    if (chatColumnWidth > 0) {
      onChatColumnWidthChange(chatColumnWidth);
    }
  }, [chatColumnWidth, onChatColumnWidthChange]);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <ChatRunStatusContext.Provider value={liveRunStatus}>
      <ChatLiveRunContext.Provider value={liveRun}>
      <ProcessTimelineCollapseContext.Provider value={processTimelineCollapse}>
      <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            {title}
          </h2>
          <div className="mt-0.5 flex items-center gap-2">
            <DatasourceChip datasourceId={datasourceId} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RunStatusPill status={liveRunStatus} />
          {!rightPanelOpen ? (
            <button
              type="button"
              onClick={onOpenRightPanel}
              className={`h-8 ${btnSecondaryClass}`}
            >
              打开控制台
            </button>
          ) : null}
        </div>
      </header>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {activeThreadId ? (
          <CopilotChatConfigurationProvider
            agentId={agentId}
            threadId={activeThreadId}
            hasExplicitThreadId
          >
            <LiveRunEventSubscriber agentId={agentId} threadId={activeThreadId} />
            <SessionConversationRestore
              agentId={agentId}
              capabilitiesReady={capabilitiesReady}
            />
            <SessionArtifactsRestore
              capabilitiesReady={capabilitiesReady}
              threadId={activeThreadId}
            />
            <AgentMessageRenderSync agentId={agentId} runStatus={liveRunStatus} />
            <CollaborationResponseBridge />
            <CollaborationInterruptHandler
              key={activeThreadId}
              agentId={agentId}
              threadId={activeThreadId}
            />
            <CopilotChat
              agentId={agentId}
              threadId={activeThreadId}
              key={activeThreadId}
              welcomeScreen={DataTaskWelcomeScreen}
              autoScroll="pin-to-send"
              intelligenceIndicator={{ className: "chat-intelligence-indicator" }}
              messageView={{
                assistantMessage:
                  StepAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
                reasoningMessage: {
                  header: { className: "chat-reasoning-header" },
                },
                cursor: { className: "chat-stream-cursor" },
              }}
              input={ChatInput as typeof CopilotChatInput}
              className={chatPaneClassName}
            />
          </CopilotChatConfigurationProvider>
        ) : (
          <ChatInitializingState />
        )}
      </div>
      </ProcessTimelineCollapseContext.Provider>
      </ChatLiveRunContext.Provider>
      </ChatRunStatusContext.Provider>
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
  status: LiveRun["runStatus"];
}) {
  const label =
    status === "completed"
      ? "已完成"
      : status === "running"
        ? "运行中"
        : status === "suspended"
          ? "等待回复"
          : status === "failed"
            ? "失败"
            : status === "canceled"
              ? "已取消"
              : "就绪";
  const className =
    status === "completed"
      ? "border border-step-success/20 bg-step-success/8 text-step-success"
      : status === "running"
        ? "border border-border bg-surface-subtle text-foreground"
        : status === "suspended"
          ? "border border-border bg-surface-subtle text-foreground"
          : status === "failed"
            ? "border border-step-error/20 bg-step-error/8 text-step-error"
            : status === "canceled"
              ? "border border-border bg-surface-subtle text-muted"
              : "border border-border bg-surface-subtle text-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {status === "running" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" />
      ) : null}
      {label}
    </span>
  );
}
