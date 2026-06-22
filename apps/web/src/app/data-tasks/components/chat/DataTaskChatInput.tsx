"use client";

import {
  CopilotChatInput,
  type CopilotChatInputProps,
} from "@copilotkit/react-core/v2";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspaceConfigItem } from "../../data-task-state";
import {
  getLlmDisplayLabel,
  getLlmOptionSubtitle,
} from "../../data-task-state";

type DataTaskChatInputProps = CopilotChatInputProps & {
  llmOptions: WorkspaceConfigItem[];
  activeLlmId: string | null;
  onActiveLlmChange: (llmId: string) => void;
  onOpenLlmConfig?: () => void;
};

export function DataTaskChatInput({
  llmOptions,
  activeLlmId,
  onActiveLlmChange,
  onOpenLlmConfig,
  ...props
}: DataTaskChatInputProps) {
  return (
    <CopilotChatInput {...props}>
      {(slots) => (
        <DataTaskChatInputLayout
          {...slots}
          activeLlmId={activeLlmId}
          llmOptions={llmOptions}
          onActiveLlmChange={onActiveLlmChange}
          onOpenLlmConfig={onOpenLlmConfig}
        />
      )}
    </CopilotChatInput>
  );
}

function DataTaskChatInputLayout({
  textArea,
  sendButton,
  addMenuButton,
  startTranscribeButton,
  cancelTranscribeButton,
  finishTranscribeButton,
  audioRecorder,
  disclaimer,
  mode = "input",
  showDisclaimer,
  containerRef,
  positioning = "static",
  keyboardHeight = 0,
  bottomAnchored = false,
  llmOptions,
  activeLlmId,
  onActiveLlmChange,
  onOpenLlmConfig,
}: {
  textArea: ReactNode;
  sendButton: ReactNode;
  addMenuButton: ReactNode;
  startTranscribeButton?: ReactNode;
  cancelTranscribeButton?: ReactNode;
  finishTranscribeButton?: ReactNode;
  audioRecorder?: ReactNode;
  disclaimer: ReactNode;
  mode?: "input" | "transcribe" | "processing";
  showDisclaimer?: boolean;
  containerRef?: React.Ref<HTMLDivElement>;
  positioning?: "static" | "absolute";
  keyboardHeight?: number;
  bottomAnchored?: boolean;
  llmOptions: WorkspaceConfigItem[];
  activeLlmId: string | null;
  onActiveLlmChange: (llmId: string) => void;
  onOpenLlmConfig?: () => void;
}) {
  const focusTextArea = (textarea: HTMLTextAreaElement) => {
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  const handleTextAreaColumnMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;
    if (target.tagName === "BUTTON" || target.closest("button")) return;

    const textarea = event.currentTarget.querySelector("textarea");
    if (!textarea || mode !== "input") return;

    event.preventDefault();
    focusTextArea(textarea);
  };

  return (
    <div
      data-copilotkit
      ref={containerRef}
      className={[
        "pointer-events-none relative z-20",
        positioning === "absolute" ? "absolute bottom-0 left-0 right-0" : "",
      ].join(" ")}
      style={{
        transform:
          keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined,
        transition: "transform 0.2s ease-out",
        paddingBottom:
          "calc(1.25rem + var(--copilotkit-license-banner-offset, 0px))",
      }}
    >
      <div className="pointer-events-auto mx-auto max-w-3xl px-4 sm:px-0">
        <div
          data-testid="copilot-chat-input"
          className="flex w-full flex-col items-center justify-center overflow-visible rounded-[28px] border border-slate-200/70 bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.18),0_4px_12px_-4px_rgba(15,23,42,0.08),0_0_0_1px_rgba(15,23,42,0.04)] dark:border-slate-700/60 dark:bg-[#303030]"
        >
          <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-3 py-2">
            <div className="col-start-1 row-start-1 flex items-center">
              {addMenuButton}
            </div>
            <div
              className="relative col-start-2 row-start-1 flex min-h-[50px] min-w-0 cursor-text flex-col justify-center"
              onMouseDown={handleTextAreaColumnMouseDown}
            >
              {mode === "transcribe"
                ? audioRecorder
                : mode === "processing"
                  ? (
                    <div className="flex w-full items-center justify-center px-5 py-3">
                      <span className="h-[26px] w-[26px] animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                    </div>
                  )
                  : textArea}
            </div>
            <div className="col-start-3 row-start-1 flex items-center justify-end gap-1">
              {mode === "transcribe" ? (
                <>
                  {cancelTranscribeButton}
                  {finishTranscribeButton}
                </>
              ) : (
                <>
                  <ChatModelPicker
                    activeLlmId={activeLlmId}
                    llmOptions={llmOptions}
                    onActiveLlmChange={onActiveLlmChange}
                    onOpenLlmConfig={onOpenLlmConfig}
                  />
                  {startTranscribeButton}
                  {sendButton}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {showDisclaimer ? disclaimer : null}
    </div>
  );
}

function ChatModelPicker({
  llmOptions,
  activeLlmId,
  onActiveLlmChange,
  onOpenLlmConfig,
}: {
  llmOptions: WorkspaceConfigItem[];
  activeLlmId: string | null;
  onActiveLlmChange: (llmId: string) => void;
  onOpenLlmConfig?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeItem =
    llmOptions.find((item) => item.id === activeLlmId) ?? llmOptions[0] ?? null;
  const label = activeItem ? getLlmDisplayLabel(activeItem) : "选择模型";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative mr-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="切换模型"
        onClick={() => setOpen((value) => !value)}
        className={[
          "flex max-w-[168px] items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition",
          open
            ? "bg-slate-100 text-slate-900"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        ].join(" ")}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="模型列表"
          className="absolute bottom-full right-0 z-50 mb-2 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
            模型
          </div>
          {llmOptions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              请先在左侧配置中启用 LLM
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {llmOptions.map((item) => {
                const selected = item.id === activeItem?.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onActiveLlmChange(item.id);
                        setOpen(false);
                      }}
                      className={[
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition",
                        selected
                          ? "bg-slate-100"
                          : "hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {getLlmDisplayLabel(item)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {getLlmOptionSubtitle(item)}
                        </span>
                      </span>
                      {selected && (
                        <span className="mt-0.5 shrink-0 text-slate-600">
                          <CheckIcon />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {onOpenLlmConfig && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenLlmConfig();
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                管理模型配置…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={[
        "h-3.5 w-3.5 shrink-0 transition-transform",
        open ? "rotate-180" : "",
      ].join(" ")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
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
