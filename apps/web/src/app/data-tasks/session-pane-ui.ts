export type SessionListIconSlot = "session" | "pin" | "none";

export function getCollapsedWorkspaceRailCopy() {
  return {
    expandLabel: "展开工作区快捷栏",
    railLabel: "工作区快捷栏",
    sessionCountLabel: "会话数量",
  } as const;
}

export function getSessionListItemIconSlots({
  pinned,
}: {
  pinned: boolean;
}): {
  leading: SessionListIconSlot;
  trailing: SessionListIconSlot;
} {
  return {
    leading: "session",
    trailing: pinned ? "pin" : "none",
  };
}
