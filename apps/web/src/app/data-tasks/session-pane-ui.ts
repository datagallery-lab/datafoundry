export type SessionListIconSlot = "session" | "pin" | "none";

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
      "absolute left-full top-0 ml-3 flex w-[320px] max-h-[min(720px,calc(100vh-24px))] -translate-x-2 overflow-visible rounded-2xl border border-border bg-surface-subtle opacity-0 shadow-2xl ring-1 ring-black/5 transition-[opacity,transform] duration-200 ease-out before:absolute before:-left-3 before:top-0 before:h-full before:w-3 before:content-[''] pointer-events-none group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100",
    content:
      "flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/60 bg-surface-subtle",
    sessionList: "max-h-64 overflow-y-auto p-2",
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
