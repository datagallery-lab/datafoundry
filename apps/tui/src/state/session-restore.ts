import type {
  ConversationToolCall,
  SessionConversation,
} from "../config/index.js";
import type { LiveToolCallRecord } from "./live-run-state.js";
import type { DisplayMessage, MessageElement } from "./tui-state.js";

export type RestoredSessionConversation = {
  threadId: string;
  title?: string | undefined;
  messages: DisplayMessage[];
  toolCalls: LiveToolCallRecord[];
};

export function restoreSessionConversation(
  dto: SessionConversation,
): RestoredSessionConversation {
  return {
    threadId: dto.sessionId,
    ...(dto.title ? { title: dto.title } : {}),
    messages: conversationToDisplayMessages(dto),
    toolCalls: conversationToToolCalls(dto.toolCalls),
  };
}

export function conversationToDisplayMessages(
  dto: SessionConversation,
): DisplayMessage[] {
  const sortedMessages = [...dto.messages].sort(
    (left, right) => left.position - right.position,
  );
  const toolCallsByRun = groupToolCallsByRun(dto.toolCalls);
  const attachedRunIds = new Set<string>();
  const messages: DisplayMessage[] = [];

  for (const entry of sortedMessages) {
    const content = entry.contentText.trim();
    if (!content) continue;

    const timestamp = timestampFromIso(entry.createdAt, Date.now());
    const elements: MessageElement[] = [];

    if (entry.role === "assistant" && !attachedRunIds.has(entry.runId)) {
      const runToolCalls = toolCallsByRun.get(entry.runId) ?? [];
      for (const toolCall of runToolCalls) {
        elements.push({
          type: "tool_call",
          toolCallId: toolCall.toolCallId,
          timestamp,
        });
      }
      attachedRunIds.add(entry.runId);
    }

    elements.push({
      type: "text",
      content,
      timestamp,
    });

    messages.push({
      id: entry.messageId ?? entry.id,
      role: entry.role,
      timestamp,
      elements,
    });
  }

  return messages;
}

export function conversationToToolCalls(
  toolCalls: ConversationToolCall[],
): LiveToolCallRecord[] {
  return [...toolCalls]
    .sort((left, right) => toolCallSortKey(left) - toolCallSortKey(right))
    .map((toolCall) => {
      const now = Date.now();
      const status = toolCall.status === "completed"
        ? "success"
        : toolCall.status === "failed"
          ? "failed"
          : "running";
      const result = serializeToolCallResult(toolCall);
      const record: LiveToolCallRecord = {
        id: toolCall.toolCallId,
        name: toolCall.toolName ?? toolCall.name ?? "tool",
        status,
        startedAtMs: now,
      };
      if (status !== "running") {
        record.finishedAtMs = now;
      }
      if (result !== undefined) {
        record.result = result;
      }
      return record;
    });
}

function groupToolCallsByRun(
  toolCalls: ConversationToolCall[],
): Map<string, ConversationToolCall[]> {
  const groups = new Map<string, ConversationToolCall[]>();
  for (const toolCall of toolCalls) {
    const bucket = groups.get(toolCall.runId) ?? [];
    bucket.push(toolCall);
    groups.set(toolCall.runId, bucket);
  }
  for (const [runId, calls] of groups) {
    groups.set(runId, [...calls].sort((left, right) => toolCallSortKey(left) - toolCallSortKey(right)));
  }
  return groups;
}

function toolCallSortKey(toolCall: ConversationToolCall): number {
  return (
    toolCall.callEventSeq ??
    toolCall.resultEventSeq ??
    toolCall.endEventSeq ??
    0
  );
}

function serializeToolCallResult(toolCall: ConversationToolCall): string | undefined {
  if (typeof toolCall.result === "string") return toolCall.result;
  if (toolCall.resultPreview) return toolCall.resultPreview;
  if (toolCall.result !== undefined) {
    try {
      return JSON.stringify(toolCall.result);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function timestampFromIso(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
