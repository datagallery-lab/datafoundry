"use client";

import { useCopilotChatConfiguration, useCopilotKit } from "@copilotkit/react-core/v2";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Message } from "@ag-ui/core";

export type CollaborationToolName = "ask_user" | "submit_plan";

export type CollaborationResponseRecord = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: CollaborationToolName;
  question?: string;
  displayText: string;
  createdAt: number;
  /** Assistant message that streamed before the collaboration tool suspended. */
  assistantMessageId?: string;
};

type ChoiceOption = { label: string; value: string; description?: string };

type StoreState = Record<string, CollaborationResponseRecord[]>;

const EMPTY_RESPONSES: CollaborationResponseRecord[] = [];

let storeState: StoreState = {};
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return storeState;
}

function responsesForThread(threadId: string): CollaborationResponseRecord[] {
  return storeState[threadId] ?? EMPTY_RESPONSES;
}

function recordResponse(entry: CollaborationResponseRecord) {
  const current = storeState[entry.threadId] ?? EMPTY_RESPONSES;
  if (current.some((item) => item.toolCallId === entry.toolCallId)) {
    return;
  }
  storeState = {
    ...storeState,
    [entry.threadId]: [...current, entry],
  };
  emitChange();
}

export function clearCollaborationResponses(threadId: string) {
  if (!storeState[threadId]) return;
  const next = { ...storeState };
  delete next[threadId];
  storeState = next;
  emitChange();
}

export function formatCollaborationResponseDisplay(
  toolName: CollaborationToolName,
  response: unknown,
  options: ChoiceOption[] = [],
): string {
  if (toolName === "submit_plan") {
    if (response && typeof response === "object") {
      const record = response as { action?: string; feedback?: string };
      if (record.action === "approved") return "已批准执行计划";
      if (record.action === "rejected") {
        return record.feedback?.trim()
          ? `已拒绝计划：${record.feedback.trim()}`
          : "已拒绝执行计划";
      }
    }
    return "已提交计划审批结果";
  }

  if (typeof response === "string") {
    const trimmed = response.trim();
    const matched = options.find((option) => option.value === trimmed);
    return matched?.label ?? trimmed;
  }

  if (typeof response === "number" || typeof response === "boolean") {
    return String(response);
  }

  if (response && typeof response === "object") {
    try {
      return JSON.stringify(response);
    } catch {
      return "已提交回答";
    }
  }

  return "已提交回答";
}

function messageHasToolCall(message: Message, toolCallId: string): boolean {
  const toolCalls = (message as { toolCalls?: Array<{ id?: string }> }).toolCalls;
  if (!Array.isArray(toolCalls)) return false;
  return toolCalls.some((call) => call?.id === toolCallId);
}

type CollaborationResponsesContextValue = {
  recordResponse: (entry: Omit<CollaborationResponseRecord, "id" | "createdAt">) => void;
  getResponsesForThread: (threadId: string) => CollaborationResponseRecord[];
};

const CollaborationResponsesContext =
  createContext<CollaborationResponsesContextValue | null>(null);

export function CollaborationResponsesProvider({ children }: { children: ReactNode }) {
  const record = useCallback(
    (entry: Omit<CollaborationResponseRecord, "id" | "createdAt">) => {
      recordResponse({
        ...entry,
        id: `${entry.threadId}:${entry.toolCallId}`,
        createdAt: Date.now(),
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      recordResponse: record,
      getResponsesForThread: responsesForThread,
    }),
    [record],
  );

  return (
    <CollaborationResponsesContext.Provider value={value}>
      {children}
    </CollaborationResponsesContext.Provider>
  );
}

export function useCollaborationResponses() {
  const context = useContext(CollaborationResponsesContext);
  if (!context) {
    throw new Error("useCollaborationResponses must be used within CollaborationResponsesProvider");
  }
  return context;
}

function useThreadCollaborationResponses(threadId: string | undefined) {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!threadId) return EMPTY_RESPONSES;
  return store[threadId] ?? EMPTY_RESPONSES;
}

export function useThreadCollaborationResponsesForChat(threadId: string | undefined) {
  return useThreadCollaborationResponses(threadId);
}

function looksLikeToolName(label: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/u.test(label.trim());
}

export function CollaborationChoiceBubble({
  response,
  inline = false,
}: {
  response: CollaborationResponseRecord;
  inline?: boolean;
}) {
  const mono = looksLikeToolName(response.displayText);

  if (inline) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/8 px-3 py-2.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
          我的选择
        </div>
        <div className={`text-sm leading-6 text-foreground ${mono ? "font-mono tracking-tight" : ""}`}>
          {response.displayText}
        </div>
      </div>
    );
  }

  return (
    <div
      data-copilotkit
      className="copilotKitMessage copilotKitUserMessage mb-4 flex flex-col items-end pt-2"
    >
      <div className="max-w-[85%] rounded-2xl border border-primary/20 bg-primary/10 px-3.5 py-2.5 text-sm leading-6 text-foreground shadow-sm">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
          我的选择
        </div>
        <div className={mono ? "font-mono tracking-tight" : ""}>{response.displayText}</div>
      </div>
    </div>
  );
}

export function CollaborationResponseAfterMessage({
  message,
  position,
}: {
  message: Message;
  position: "before" | "after";
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}) {
  const chatConfig = useCopilotChatConfiguration();
  const threadId = chatConfig?.threadId;
  const responses = useThreadCollaborationResponses(threadId);

  if (position !== "after" || message.role !== "assistant") {
    return null;
  }

  const matching = responses.filter((response) => {
    if (response.assistantMessageId) return false;
    return messageHasToolCall(message, response.toolCallId);
  });
  if (matching.length === 0) {
    return null;
  }

  return (
    <>
      {matching.map((response) => (
        <CollaborationChoiceBubble key={response.id} response={response} />
      ))}
    </>
  );
}

export function CollaborationResponseBridge() {
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const existing = copilotkit.renderCustomMessages;
    const alreadyRegistered = existing.some(
      (renderer) => renderer.render === CollaborationResponseAfterMessage,
    );
    if (alreadyRegistered) return;

    copilotkit.setRenderCustomMessages([
      ...existing,
      {
        agentId: "dataAgent",
        render: CollaborationResponseAfterMessage,
      },
    ]);

    return () => {
      copilotkit.setRenderCustomMessages(existing);
    };
  }, [copilotkit]);

  return null;
}
