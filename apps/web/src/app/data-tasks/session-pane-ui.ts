import type { WorkspaceConfigStore } from "./data-task-state";
import type { LiveRunStatus } from "./live-run-state";
import { LEFT_PANEL_MAX_WIDTH } from "./workspace-layout";

export type SessionListIconSlot = "session" | "running" | "pin" | "none";

export function isSessionRunActive(status: LiveRunStatus): boolean {
  return status === "running" || status === "suspended";
}

export type WorkspaceResourceNavAction =
  | { type: "config"; panel: "db" | "kb" | "mcp" | "skill" | "llm" }
  | { type: "assets" };

export type WorkspaceResourceNavGroup = {
  id: "data-sources" | "assets" | "knowledge" | "agent-tools" | "models";
  title: string;
  summary: string;
  icon: "database" | "assets" | "book" | "tools" | "models";
  action: WorkspaceResourceNavAction;
  active: boolean;
  statusLabel?: string;
};

export function getWorkspaceResourceNavGroups({
  workspaceConfig,
  workspaceFileCount,
  activeConfigPanel,
  activeFilesPanel,
  capabilitiesReady,
  supportsFiles,
  supportsKnowledge,
  supportsMcp,
  supportsSkills,
}: {
  workspaceConfig: WorkspaceConfigStore;
  workspaceFileCount: number;
  activeConfigPanel: "db" | "kb" | "mcp" | "skill" | "llm" | null;
  activeFilesPanel: boolean;
  capabilitiesReady: boolean;
  supportsFiles: boolean;
  supportsKnowledge: boolean;
  supportsMcp: boolean;
  supportsSkills: boolean;
}): WorkspaceResourceNavGroup[] {
  const assetsUnsupported = capabilitiesReady && !supportsFiles;
  const knowledgeUnsupported = capabilitiesReady && !supportsKnowledge;
  const mcpUnsupported = capabilitiesReady && !supportsMcp;
  const skillsUnsupported = capabilitiesReady && !supportsSkills;
  const agentToolsStatus = mcpUnsupported
    ? skillsUnsupported
      ? "Backend unsupported"
      : "MCP unsupported"
    : skillsUnsupported
      ? "Skills unsupported"
      : undefined;

  return [
    {
      id: "data-sources",
      title: "Data Sources",
      summary: String(workspaceConfig.db.length),
      icon: "database",
      action: { type: "config", panel: "db" },
      active: activeConfigPanel === "db",
    },
    {
      id: "knowledge",
      title: "Knowledge",
      summary: String(workspaceConfig.kb.length),
      icon: "book",
      action: { type: "config", panel: "kb" },
      active: activeConfigPanel === "kb",
      statusLabel: knowledgeUnsupported ? "Backend unsupported" : undefined,
    },
    {
      id: "agent-tools",
      title: "Agent Tools",
      summary: `${workspaceConfig.mcp.length} · ${workspaceConfig.skill.length}`,
      icon: "tools",
      action: { type: "config", panel: "mcp" },
      active: activeConfigPanel === "mcp" || activeConfigPanel === "skill",
      statusLabel: agentToolsStatus,
    },
    {
      id: "models",
      title: "Models",
      summary: String(workspaceConfig.llm.length),
      icon: "models",
      action: { type: "config", panel: "llm" },
      active: activeConfigPanel === "llm",
    },
    {
      id: "assets",
      title: "Assets",
      summary: String(workspaceFileCount),
      icon: "assets",
      action: { type: "assets" },
      active: activeFilesPanel,
      statusLabel: assetsUnsupported ? "Backend unsupported" : undefined,
    },
  ];
}

export function getCollapsedWorkspaceRailCopy() {
  return {
    expandLabel: "展开工作区快捷栏",
    railLabel: "工作区快捷栏",
    sessionCountLabel: "会话数量",
  } as const;
}

export function getCollapsedWorkspacePreviewClassNames() {
  return {
    panel:
      `absolute left-full top-0 ml-3 flex w-[${LEFT_PANEL_MAX_WIDTH}px] max-h-[min(720px,calc(100vh-24px))] -translate-x-2 overflow-visible rounded-2xl border border-border bg-surface-subtle opacity-0 shadow-2xl ring-1 ring-black/5 transition-[opacity,transform] duration-200 ease-out before:absolute before:-left-3 before:top-0 before:h-full before:w-3 before:content-[''] pointer-events-none group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100`,
    content:
      "flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/60 bg-surface-subtle",
    sessionList: "max-h-64 overflow-y-auto p-2",
  } as const;
}

export function getSessionListItemIconSlots({
  pinned,
  running = false,
}: {
  pinned: boolean;
  running?: boolean;
}): {
  leading: SessionListIconSlot;
  trailing: SessionListIconSlot;
} {
  return {
    leading: running ? "running" : "session",
    trailing: pinned ? "pin" : "none",
  };
}
