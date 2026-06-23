"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  PER_RUN_MENTION_APPEARANCE,
  PER_RUN_MENTION_KINDS,
  PER_RUN_MENTION_META,
} from "../../data-task-state";
import type {
  MentionResource,
  PerRunMentionKind,
  PerRunSelection,
} from "../../data-task-state";
import { scheduleChatTextareaResize } from "./use-chat-textarea-autoresize";

// Matches an in-progress `@token` immediately before the caret. Allowed query
// chars: letters/digits/_/- (so a trailing space or punctuation closes it).
const MENTION_TOKEN_RE = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;

/**
 * React (18) attaches event handlers at the root, so a native listener on the
 * element in the capture phase runs first. We use this to intercept arrow/enter
 * keys for the `@` menu before CopilotChat's textarea turns Enter into a send.
 */
function setNativeTextareaValue(
  el: HTMLTextAreaElement,
  value: string,
  caret: number,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  );
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(() => {
    el.focus({ preventScroll: true });
    el.setSelectionRange(caret, caret);
    scheduleChatTextareaResize();
  });
}

type MentionMenuState = { query: string; tokenStart: number; caret: number };

export interface MentionAutocomplete {
  /** Attach to the element that wraps the CopilotChat textarea. */
  columnRef: (node: HTMLDivElement | null) => void;
  /** The floating picker; render it inside the (relative) input card. */
  menu: ReactNode;
  /** Insert an `@` at the caret and open the picker (toolbar-button entry point). */
  openAtCaret: () => void;
}

export function useMentionAutocomplete({
  resources,
  selection,
  onToggle,
  refreshToken,
}: {
  resources: MentionResource[];
  selection: PerRunSelection;
  onToggle: (kind: PerRunMentionKind, id: string) => void;
  /** Change this (e.g. the input `mode`) to re-bind after the textarea remounts. */
  refreshToken?: string;
}): MentionAutocomplete {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const columnNodeRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<MentionMenuState | null>(null);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    if (!menuState) return [];
    const query = menuState.query.trim().toLowerCase();
    if (query.length === 0) return resources;
    return resources.filter((resource) => {
      const haystack = [
        resource.name,
        resource.description,
        PER_RUN_MENTION_META[resource.kind].token,
        PER_RUN_MENTION_META[resource.kind].label,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [menuState, resources]);

  useEffect(() => {
    setHighlight(0);
  }, [menuState?.query]);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const syncFromCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setMenuState(null);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const match = before.match(MENTION_TOKEN_RE);
    if (!match) {
      setMenuState(null);
      return;
    }
    const query = match[1] ?? "";
    setMenuState({ query, tokenStart: caret - query.length - 1, caret });
  }, []);

  const selectResource = useCallback(
    (resource: MentionResource) => {
      const el = textareaRef.current;
      const state = menuState;
      if (el && state) {
        const next =
          el.value.slice(0, state.tokenStart) + el.value.slice(state.caret);
        setNativeTextareaValue(el, next, state.tokenStart);
      }
      onToggle(resource.kind, resource.id);
      setMenuState(null);
    },
    [menuState, onToggle],
  );

  // Keep refs to the latest values for the native (non-React) key handler.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const menuOpenRef = useRef(menuState !== null);
  menuOpenRef.current = menuState !== null;

  const bindTextarea = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = textareaRef.current;
      const nextTextarea = node?.querySelector("textarea") ?? null;
      if (previous === nextTextarea) return;
      if (previous) {
        previous.removeEventListener("input", syncFromCaret);
        previous.removeEventListener("keyup", syncFromCaret);
        previous.removeEventListener("click", syncFromCaret);
        previous.removeEventListener("keydown", handleKeyDownRef.current, true);
        previous.removeEventListener("blur", handleBlurRef.current);
      }
      textareaRef.current = nextTextarea;
      if (nextTextarea) {
        nextTextarea.addEventListener("input", syncFromCaret);
        nextTextarea.addEventListener("keyup", syncFromCaret);
        nextTextarea.addEventListener("click", syncFromCaret);
        nextTextarea.addEventListener("keydown", handleKeyDownRef.current, true);
        nextTextarea.addEventListener("blur", handleBlurRef.current);
      }
    },
    [syncFromCaret],
  );

  const columnRef = useCallback(
    (node: HTMLDivElement | null) => {
      columnNodeRef.current = node;
      bindTextarea(node);
    },
    [bindTextarea],
  );

  // The textarea unmounts in transcribe/processing mode; re-bind when it returns.
  useEffect(() => {
    bindTextarea(columnNodeRef.current);
  }, [bindTextarea, refreshToken]);

  // Stable handler refs so add/remove listener pairs always match.
  const handleKeyDownRef = useRef((event: KeyboardEvent) => {
    if (!menuOpenRef.current) return;
    const items = filteredRef.current;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopImmediatePropagation();
        setHighlight((index) =>
          items.length === 0 ? 0 : (index + 1) % items.length,
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopImmediatePropagation();
        setHighlight((index) =>
          items.length === 0 ? 0 : (index - 1 + items.length) % items.length,
        );
        break;
      case "Enter":
      case "Tab": {
        const choice = items[highlightRef.current];
        if (choice) {
          event.preventDefault();
          event.stopImmediatePropagation();
          selectResourceRef.current(choice);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenuState(null);
        break;
      default:
        break;
    }
  });
  const handleBlurRef = useRef(() => {
    // Delay so a click on a menu item registers before the menu unmounts.
    window.setTimeout(() => setMenuState(null), 120);
  });
  const selectResourceRef = useRef(selectResource);
  selectResourceRef.current = selectResource;

  const openAtCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const insert = before.length > 0 && !/\s$/.test(before) ? " @" : "@";
    const next = el.value.slice(0, caret) + insert + el.value.slice(caret);
    setNativeTextareaValue(el, next, caret + insert.length);
    requestAnimationFrame(() => syncFromCaret());
  }, [syncFromCaret]);

  const menu =
    menuState !== null ? (
      <MentionMenu
        items={filtered}
        highlight={highlight}
        selection={selection}
        onHover={setHighlight}
        onPick={selectResource}
        onClose={closeMenu}
      />
    ) : null;

  return { columnRef, menu, openAtCaret };
}

function MentionMenu({
  items,
  highlight,
  selection,
  onHover,
  onPick,
  onClose,
}: {
  items: MentionResource[];
  highlight: number;
  selection: PerRunSelection;
  onHover: (index: number) => void;
  onPick: (resource: MentionResource) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="选择能力（@）"
      className="absolute bottom-full left-0 z-50 mb-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-[#252525]"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-700">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
          通过 @ 指定本轮能力
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-xs text-slate-400 transition hover:text-slate-700"
        >
          Esc
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">
          没有匹配的资源，先在左侧配置中添加
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {items.map((resource, index) => {
            const active = index === highlight;
            const selected = selection[resource.kind].includes(resource.id);
            const meta = PER_RUN_MENTION_META[resource.kind];
            const appearance = PER_RUN_MENTION_APPEARANCE[resource.kind];
            return (
              <li key={`${resource.kind}:${resource.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onPick(resource)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left transition",
                    active ? "bg-slate-100 dark:bg-slate-700/60" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      appearance.badge,
                    ].join(" ")}
                  >
                    @{meta.token}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {resource.name}
                      </span>
                    </span>
                    {resource.description && (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {resource.description}
                      </span>
                    )}
                  </span>
                  {selected && (
                    <span className="shrink-0 self-center text-slate-600 dark:text-slate-300">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MentionChips({
  resources,
  selection,
  onRemove,
  onClear,
}: {
  resources: MentionResource[];
  selection: PerRunSelection;
  onRemove: (kind: PerRunMentionKind, id: string) => void;
  onClear: () => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, MentionResource>();
    for (const resource of resources) {
      map.set(`${resource.kind}:${resource.id}`, resource);
    }
    return map;
  }, [resources]);

  const chips: MentionResource[] = [];
  for (const kind of PER_RUN_MENTION_KINDS) {
    for (const id of selection[kind]) {
      const resource = byId.get(`${kind}:${id}`);
      if (resource) chips.push(resource);
    }
  }
  if (chips.length === 0) return null;

  return (
    <div
      data-mention-chips
      className="flex w-full cursor-default select-none flex-wrap items-center gap-1.5"
    >
      {chips.map((resource) => {
        const meta = PER_RUN_MENTION_META[resource.kind];
        const appearance = PER_RUN_MENTION_APPEARANCE[resource.kind];
        return (
          <span
            key={`${resource.kind}:${resource.id}`}
            className={[
              "inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-xs",
              appearance.chip,
            ].join(" ")}
            title={`${meta.label}：${resource.name}`}
          >
            <span
              className={[
                "rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
                appearance.badge,
              ].join(" ")}
            >
              @{meta.token}
            </span>
            <span className="max-w-[140px] truncate font-medium">
              {resource.name}
            </span>
            <button
              type="button"
              aria-label={`移除 ${resource.name}`}
              onClick={() => onRemove(resource.kind, resource.id)}
              className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-600"
            >
              <CloseIcon />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onClear}
        className="ml-0.5 rounded-full px-2 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
      >
        清除
      </button>
    </div>
  );
}

function CheckIcon() {
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
      <path d="m5 10 3 3 7-7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}
