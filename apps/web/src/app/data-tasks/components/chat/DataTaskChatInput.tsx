"use client";

import {
  CopilotChatInput,
  type CopilotChatInputProps,
  type UseAttachmentsReturn,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  MentionResource,
  PerRunMentionKind,
  PerRunSelection,
  WorkspaceConfigItem,
} from "../../data-task-state";
import {
  getLlmDisplayLabel,
  getLlmOptionSubtitle,
} from "../../data-task-state";
import { MentionChips, useMentionAutocomplete } from "./chat-mentions";
import { AttachmentChips } from "./AttachmentChips";
import { CHAT_ATTACHMENT_ACCEPT } from "./chat-attachments";
import { SessionConfigBar } from "./SessionConfigBar";
import { useChatTextareaAutoresize, scheduleChatTextareaResize } from "./use-chat-textarea-autoresize";
import { resolveChatInputWidth } from "../../chat-input-layout";
import { useDataTaskChatInputBindings } from "./DataTaskChatInputBindingsContext";
import type { ChatSession, WorkspaceConfigStore } from "../../data-task-state";

type DataTaskChatInputProps = CopilotChatInputProps & {
  llmOptions: WorkspaceConfigItem[];
  activeLlmId: string | null;
  onActiveLlmChange: (llmId: string) => void;
  onOpenLlmConfig?: () => void;
  mentionResources: MentionResource[];
  perRunSelection: PerRunSelection;
  onTogglePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onRemovePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onClearPerRunMentions: () => void;
  workspaceConfig: WorkspaceConfigStore;
  activeSession: ChatSession | null;
  onToggleSessionResource: (kind: PerRunMentionKind, id: string) => void;
  attachmentsApi: UseAttachmentsReturn;
};

export function DataTaskChatInput({
  llmOptions,
  activeLlmId,
  onActiveLlmChange,
  onOpenLlmConfig,
  mentionResources,
  perRunSelection,
  onTogglePerRunMention,
  onRemovePerRunMention,
  onClearPerRunMentions,
  workspaceConfig,
  activeSession,
  onToggleSessionResource,
  attachmentsApi,
  textArea,
  onChange,
  ...props
}: DataTaskChatInputProps) {
  const textAreaSlot =
    textArea && typeof textArea === "object" && !Array.isArray(textArea)
      ? {
          ...textArea,
          style: {
            overflow: "hidden",
            resize: "none" as const,
            ...(textArea as { style?: CSSProperties }).style,
          },
        }
      : {
          style: {
            overflow: "hidden",
            resize: "none" as const,
          },
        };

  return (
    <CopilotChatInput
      {...props}
      onChange={(value) => {
        onChange?.(value);
        requestAnimationFrame(scheduleChatTextareaResize);
      }}
      textArea={textAreaSlot}
    >
      {(slots) => (
        <DataTaskChatInputLayout
          {...slots}
          activeLlmId={activeLlmId}
          llmOptions={llmOptions}
          onActiveLlmChange={onActiveLlmChange}
          onOpenLlmConfig={onOpenLlmConfig}
          mentionResources={mentionResources}
          perRunSelection={perRunSelection}
          onTogglePerRunMention={onTogglePerRunMention}
          onRemovePerRunMention={onRemovePerRunMention}
          onClearPerRunMentions={onClearPerRunMentions}
          workspaceConfig={workspaceConfig}
          activeSession={activeSession}
          onToggleSessionResource={onToggleSessionResource}
          attachmentsApi={attachmentsApi}
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
  mentionResources,
  perRunSelection,
  onTogglePerRunMention,
  onRemovePerRunMention,
  onClearPerRunMentions,
  workspaceConfig,
  activeSession,
  onToggleSessionResource,
  attachmentsApi,
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
  mentionResources: MentionResource[];
  perRunSelection: PerRunSelection;
  onTogglePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onRemovePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onClearPerRunMentions: () => void;
  workspaceConfig: WorkspaceConfigStore;
  activeSession: ChatSession | null;
  onToggleSessionResource: (kind: PerRunMentionKind, id: string) => void;
  attachmentsApi: UseAttachmentsReturn;
}) {
  const { chatColumnWidth } = useDataTaskChatInputBindings();
  const chatInputWidth = resolveChatInputWidth(chatColumnWidth);
  const mention = useMentionAutocomplete({
    resources: mentionResources,
    selection: perRunSelection,
    onToggle: onTogglePerRunMention,
    refreshToken: mode,
  });
  const autoresizeRef = useChatTextareaAutoresize(mode);
  const columnRef = useCallback(
    (node: HTMLDivElement | null) => {
      mention.columnRef(node);
      autoresizeRef(node);
      attachmentsApi.containerRef.current = node;
    },
    [mention.columnRef, autoresizeRef, attachmentsApi.containerRef],
  );

  const focusTextArea = (textarea: HTMLTextAreaElement) => {
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  const handleTextAreaMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;

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
          "calc(0.75rem + var(--copilotkit-license-banner-offset, 0px))",
      }}
    >
      <div
        className="pointer-events-auto mx-auto w-full"
        style={{ width: chatInputWidth, maxWidth: "100%" }}
      >
        <div
          data-testid="copilot-chat-input"
          onDragOver={attachmentsApi.handleDragOver}
          onDragLeave={attachmentsApi.handleDragLeave}
          onDrop={attachmentsApi.handleDrop}
          className="relative flex w-full flex-col overflow-visible rounded-2xl border border-border bg-surface shadow-[0_8px_28px_-6px_rgba(15,23,42,0.12),0_2px_8px_-2px_rgba(15,23,42,0.05)]"
        >
          {attachmentsApi.dragOver && (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary-light/10 text-sm font-medium text-primary">
              拖拽文件到此处上传
            </div>
          )}
          <div className="w-full px-3 py-1.5">
            <div
              ref={columnRef}
              className="relative flex w-full min-w-0 flex-col gap-1"
            >
              {mode === "input" ? mention.menu : null}
              {mode === "transcribe" ? (
                audioRecorder
              ) : mode === "processing" ? (
                <div className="flex w-full items-center justify-center px-5 py-3">
                  <span className="h-[26px] w-[26px] animate-spin rounded-full border-2 border-border border-t-primary" />
                </div>
              ) : (
                <>
                  <AttachmentChips
                    attachments={attachmentsApi.attachments}
                    onRemove={attachmentsApi.removeAttachment}
                  />
                  <MentionChips
                    resources={mentionResources}
                    selection={perRunSelection}
                    onRemove={onRemovePerRunMention}
                    onClear={onClearPerRunMentions}
                  />
                  <div
                    className={[
                      "w-full cursor-text",
                      "[&_[data-testid=copilot-chat-textarea]]:block",
                      "[&_[data-testid=copilot-chat-textarea]]:w-full",
                      "[&_[data-testid=copilot-chat-textarea]]:resize-none",
                      "[&_[data-testid=copilot-chat-textarea]]:bg-transparent",
                      "[&_[data-testid=copilot-chat-textarea]]:!px-0.5",
                      "[&_[data-testid=copilot-chat-textarea]]:!py-1.5",
                      "[&_[data-testid=copilot-chat-textarea]]:text-[15px]",
                      "[&_[data-testid=copilot-chat-textarea]]:leading-6",
                      "[&_[data-testid=copilot-chat-textarea]]:outline-none",
                      "[&_[data-testid=copilot-chat-textarea]]:overflow-y-hidden",
                      "[&_[data-testid=copilot-chat-textarea]:not(:focus)]:caret-transparent",
                    ].join(" ")}
                    onMouseDown={handleTextAreaMouseDown}
                  >
                    {textArea}
                  </div>
                </>
              )}
            </div>
            {mode === "transcribe" && (
              <div className="mt-2 flex items-center justify-end gap-1">
                {cancelTranscribeButton}
                {finishTranscribeButton}
              </div>
            )}
          </div>
          {mode !== "transcribe" && (
            <SessionConfigBar
              workspaceConfig={workspaceConfig}
              session={activeSession}
              onToggleSessionResource={onToggleSessionResource}
              leading={
                <div className="flex items-center gap-1">
                  <input
                    ref={attachmentsApi.fileInputRef}
                    type="file"
                    multiple
                    accept={CHAT_ATTACHMENT_ACCEPT}
                    className="hidden"
                    onChange={attachmentsApi.handleFileUpload}
                  />
                  <button
                    type="button"
                    aria-label="上传文件"
                    title="上传文件"
                    onClick={() => attachmentsApi.fileInputRef.current?.click()}
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-subtle hover:text-foreground"
                  >
                    <PaperclipIcon />
                  </button>
                  <div className="grid h-7 w-7 place-items-center [&_button]:flex [&_button]:h-7 [&_button]:w-7 [&_button]:items-center [&_button]:justify-center">
                    {addMenuButton}
                  </div>
                </div>
              }
              trailing={
                <>
                  <ChatModelPicker
                    activeLlmId={activeLlmId}
                    llmOptions={llmOptions}
                    onActiveLlmChange={onActiveLlmChange}
                    onOpenLlmConfig={onOpenLlmConfig}
                  />
                  {sendButton}
                </>
              }
            />
          )}
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="切换模型"
        onClick={() => setOpen((value) => !value)}
        className={[
          "flex max-w-[168px] cursor-pointer items-center gap-0.5 px-1 py-1 text-xs font-medium transition-colors duration-200",
          open
            ? "text-foreground"
            : "text-muted hover:text-foreground",
        ].join(" ")}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="模型列表"
          className="absolute bottom-full right-0 z-50 mb-2 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-light">
            模型
          </div>
          {llmOptions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-light">
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
                        "flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors duration-200",
                        selected
                          ? "bg-primary-light/8"
                          : "hover:bg-surface-subtle",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {getLlmDisplayLabel(item)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-light">
                          {getLlmOptionSubtitle(item)}
                        </span>
                      </span>
                      {selected && (
                        <span className="mt-0.5 shrink-0 text-primary">
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
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenLlmConfig();
                }}
                className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-xs font-medium text-muted transition-colors duration-200 hover:bg-surface-subtle hover:text-foreground"
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
        "h-3.5 w-3.5 shrink-0 text-muted-light transition-transform",
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

function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 9.5 9 15a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-6 6a1 1 0 0 1-1.4-1.4l5.3-5.3" />
    </svg>
  );
}
