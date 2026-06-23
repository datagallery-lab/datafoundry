"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useConfigPillOverflow } from "../../hooks/use-config-pill-overflow";
import {
  PER_RUN_MENTION_APPEARANCE,
  PER_RUN_MENTION_KINDS,
  PER_RUN_MENTION_META,
  sessionResourceCounts,
} from "../../data-task-state";
import type {
  ChatSession,
  PerRunMentionKind,
  WorkspaceConfigItem,
  WorkspaceConfigStore,
} from "../../data-task-state";

type SessionConfigBarProps = {
  workspaceConfig: WorkspaceConfigStore;
  session: ChatSession | null;
  onToggleSessionResource: (kind: PerRunMentionKind, id: string) => void;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function SessionConfigBar({
  workspaceConfig,
  session,
  onToggleSessionResource,
  leading,
  trailing,
}: SessionConfigBarProps) {
  const [openKind, setOpenKind] = useState<PerRunMentionKind | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const {
    pillsContainerRef,
    setPillRef,
    visibleKinds,
    overflowKinds,
  } = useConfigPillOverflow();

  useEffect(() => {
    if (!openKind) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenKind(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openKind]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [overflowOpen]);

  useEffect(() => {
    if (overflowKinds.length === 0) {
      setOverflowOpen(false);
    }
  }, [overflowKinds.length]);

  const renderPill = (
    kind: PerRunMentionKind,
    options?: { measureRef?: (node: HTMLDivElement | null) => void },
  ) => (
    <SessionConfigPill
      key={kind}
      kind={kind}
      items={workspaceConfig[kind]}
      counts={sessionResourceCounts(workspaceConfig, kind, session)}
      open={openKind === kind}
      session={session}
      onToggleOpen={() =>
        setOpenKind((current) => (current === kind ? null : kind))
      }
      onToggleResource={(id) => onToggleSessionResource(kind, id)}
      rootRef={options?.measureRef}
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative flex w-full items-center justify-between gap-2 px-3 pb-1.5 pt-1"
      data-testid="session-config-bar"
    >
      <div
        className="pointer-events-none absolute left-0 top-0 -z-10 flex opacity-0"
        aria-hidden
      >
        {PER_RUN_MENTION_KINDS.map((kind) =>
          renderPill(kind, { measureRef: (node) => setPillRef(kind, node) }),
        )}
      </div>

      {leading ? (
        <div className="flex shrink-0 items-center self-center">{leading}</div>
      ) : null}
      <div
        ref={pillsContainerRef}
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden"
      >
        {visibleKinds.map((kind) => renderPill(kind))}
        {overflowKinds.length > 0 ? (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="更多会话配置"
              data-testid="session-config-overflow"
              onClick={() => {
                setOpenKind(null);
                setOverflowOpen((value) => !value);
              }}
              className={[
                "inline-flex h-7 min-w-9 items-center justify-center rounded-full border px-2 text-xs font-semibold transition",
                overflowOpen
                  ? "border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-500 dark:bg-slate-600 dark:text-slate-100"
                  : "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
              ].join(" ")}
            >
              ...
            </button>
            {overflowOpen && (
              <div
                role="menu"
                aria-label="更多会话配置"
                className="absolute bottom-full left-0 z-[100] mb-2 flex min-w-[220px] flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-[#252525]"
                onMouseDown={preventFocusSteal}
              >
                {overflowKinds.map((kind) => renderPill(kind))}
              </div>
            )}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1">{trailing}</div>
      ) : null}
    </div>
  );
}

function preventFocusSteal(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('button, input, [role="switch"]')) return;
  event.preventDefault();
}

function SessionConfigPill({
  kind,
  items,
  counts,
  open,
  session,
  onToggleOpen,
  onToggleResource,
  rootRef,
}: {
  kind: PerRunMentionKind;
  items: WorkspaceConfigItem[];
  counts: { enabled: number; total: number };
  open: boolean;
  session: ChatSession | null;
  onToggleOpen: () => void;
  onToggleResource: (id: string) => void;
  rootRef?: (node: HTMLDivElement | null) => void;
}) {
  const meta = PER_RUN_MENTION_META[kind];
  const appearance = PER_RUN_MENTION_APPEARANCE[kind];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${meta.label} 会话配置`}
        onClick={onToggleOpen}
        className={[
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition",
          open ? appearance.pillOpen : appearance.pill,
        ].join(" ")}
      >
        <ChevronUpIcon open={open} />
        <span
          className={[
            "inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
            appearance.badge,
          ].join(" ")}
        >
          {meta.token}
        </span>
        <span className="opacity-70">
          {counts.enabled}/{counts.total}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`${meta.label} 会话配置`}
          className="absolute bottom-full left-0 z-[100] mb-2 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-[#252525]"
          onMouseDown={preventFocusSteal}
        >
          <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400 dark:border-slate-700">
            本会话 · {meta.label}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              暂无配置，请先在左侧面板添加
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {items.map((item) => {
                const enabled = !new Set(
                  session?.config?.disabled[kind] ?? [],
                ).has(item.id);
                return (
                  <li key={item.id}>
                    <div className="flex items-start gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {item.name}
                        </span>
                        {item.description && (
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={enabled}
                        onChange={() => onToggleResource(item.id)}
                        aria-label={`${enabled ? "禁用" : "启用"} ${item.name}`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={[
        "relative z-10 h-5 w-9 shrink-0 self-center rounded-full transition",
        checked ? "bg-slate-800 dark:bg-slate-300" : "bg-slate-200 dark:bg-slate-600",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-slate-900",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

function ChevronUpIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={[
        "h-3 w-3 shrink-0 text-slate-400 transition-transform",
        open ? "rotate-180" : "",
      ].join(" ")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5 10 7.5 15 12.5" />
    </svg>
  );
}
