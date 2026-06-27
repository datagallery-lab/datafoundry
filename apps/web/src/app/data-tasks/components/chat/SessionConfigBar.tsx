"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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

const SESSION_CONFIG_PORTAL_ATTR = "data-session-config-portal";

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
  const overflowAnchorRef = useRef<HTMLDivElement>(null);

  const {
    pillsContainerRef,
    setPillRef,
    visibleKinds,
    overflowKinds,
  } = useConfigPillOverflow();

  const isInsideSessionConfigUi = useCallback((target: Node) => {
    if (rootRef.current?.contains(target)) return true;
    return (target as HTMLElement).closest?.(`[${SESSION_CONFIG_PORTAL_ATTR}]`) != null;
  }, []);

  useEffect(() => {
    if (!openKind) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!isInsideSessionConfigUi(event.target as Node)) {
        setOpenKind(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isInsideSessionConfigUi, openKind]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!isInsideSessionConfigUi(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isInsideSessionConfigUi, overflowOpen]);

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
        className="pointer-events-none absolute -left-[9999px] top-0 flex"
        aria-hidden
      >
        {PER_RUN_MENTION_KINDS.map((kind) => (
          <ConfigPillMeasure
            key={kind}
            kind={kind}
            counts={sessionResourceCounts(workspaceConfig, kind, session)}
            rootRef={(node) => setPillRef(kind, node)}
          />
        ))}
      </div>

      {leading ? (
        <div className="flex shrink-0 items-center self-center">{leading}</div>
      ) : null}
      <div
        ref={pillsContainerRef}
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-visible"
      >
        {visibleKinds.map((kind) => renderPill(kind))}
        {overflowKinds.length > 0 ? (
          <div ref={overflowAnchorRef} className="relative shrink-0">
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
                  ? "border-border bg-surface-subtle text-foreground"
                  : "border-border bg-surface-subtle text-muted hover:border-primary-light/40 hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              ...
            </button>
            <AnchoredPortal
              anchorRef={overflowAnchorRef}
              open={overflowOpen}
              minWidth={220}
            >
              <div
                role="menu"
                aria-label="更多会话配置"
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-lg"
                onMouseDown={preventFocusSteal}
              >
                {overflowKinds.map((kind) => renderPill(kind))}
              </div>
            </AnchoredPortal>
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

function AnchoredPortal({
  anchorRef,
  open,
  children,
  minWidth = 220,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  minWidth?: number;
}) {
  const [coords, setCoords] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setCoords(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(minWidth, rect.width), window.innerWidth - 32);
      const left = Math.min(
        Math.max(16, rect.left),
        window.innerWidth - width - 16,
      );
      setCoords({
        left,
        bottom: window.innerHeight - rect.top + 8,
        width,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchorRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, minWidth, open]);

  if (!open || !coords || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...{ [SESSION_CONFIG_PORTAL_ATTR]: "" }}
      className="pointer-events-auto"
      style={{
        position: "fixed",
        left: coords.left,
        bottom: coords.bottom,
        width: coords.width,
        zIndex: 200,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function ConfigPillMeasure({
  kind,
  counts,
  rootRef,
}: {
  kind: PerRunMentionKind;
  counts: { enabled: number; total: number };
  rootRef?: (node: HTMLDivElement | null) => void;
}) {
  const meta = PER_RUN_MENTION_META[kind];
  const appearance = PER_RUN_MENTION_APPEARANCE[kind];

  return (
    <div
      ref={rootRef}
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
        appearance.pill,
      ].join(" ")}
    >
      <span className="inline-flex h-3 w-3 shrink-0" aria-hidden />
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
    </div>
  );
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const meta = PER_RUN_MENTION_META[kind];
  const appearance = PER_RUN_MENTION_APPEARANCE[kind];

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      anchorRef.current = node;
      rootRef?.(node);
    },
    [rootRef],
  );

  return (
    <div ref={setRefs} className="relative shrink-0">
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

      <AnchoredPortal anchorRef={anchorRef} open={open}>
        <SessionConfigPillPanel
          kind={kind}
          items={items}
          session={session}
          onToggleResource={onToggleResource}
        />
      </AnchoredPortal>
    </div>
  );
}

function SessionConfigPillPanel({
  kind,
  items,
  session,
  onToggleResource,
}: {
  kind: PerRunMentionKind;
  items: WorkspaceConfigItem[];
  session: ChatSession | null;
  onToggleResource: (id: string) => void;
}) {
  const meta = PER_RUN_MENTION_META[kind];

  return (
    <div
      role="listbox"
      aria-label={`${meta.label} 会话配置`}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      onMouseDown={preventFocusSteal}
    >
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-light">
        本会话 · {meta.label}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-light">
          暂无配置，请先在左侧面板添加
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto py-1">
          {items.map((item) => {
            const enabled = !new Set(session?.config?.disabled[kind] ?? []).has(
              item.id,
            );
            return (
              <li key={item.id}>
                <div className="flex items-start gap-3 px-3 py-2 transition hover:bg-surface-subtle">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    {item.description && (
                      <span className="mt-0.5 block truncate text-xs text-muted-light">
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
        checked ? "bg-primary" : "bg-border",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform",
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
        "h-3 w-3 shrink-0 text-muted-light transition-transform",
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
