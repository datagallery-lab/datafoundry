import type { Message } from "@ag-ui/core";
import type {
  ConversationMessageDto,
  ConversationToolCallDto,
  SessionConversationDto,
} from "../../lib/config-api/types";
import { ConfigApiError } from "../../lib/config-api/types";
import {
  formatCollaborationResponseDisplay,
  type CollaborationToolName,
} from "./components/chat/collaboration-response-display";
import type { CollaborationResponseRecord } from "./components/chat/collaboration-responses";
import {
  createInitialLiveRun,
  reconcileLiveRunArtifacts,
  reduceLiveRunEvent,
  type LiveRun,
} from "./live-run-state";

/** Whether the client should fetch server conversation history for this thread. */
export function shouldRestoreConversation(input: {
  conversationMemoryEnabled: boolean;
  messageCount: number;
  isRunning: boolean;
  alreadyRestored: boolean;
}): boolean {
  return (
    input.conversationMemoryEnabled &&
    input.messageCount === 0 &&
    !input.isRunning &&
    !input.alreadyRestored
  );
}

export function isIgnorableConversationRestoreError(error: unknown): boolean {
  if (error instanceof ConfigApiError) {
    return error.status === 404 || error.code === "RESOURCE_NOT_FOUND";
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { status?: unknown; code?: unknown };
  return record.status === 404 || record.code === "RESOURCE_NOT_FOUND";
}

type RestoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const COLLABORATION_TOOL_NAMES = new Set<CollaborationToolName>([
  "ask_user",
  "submit_plan",
]);

type ChoiceOption = { label: string; value: string; description?: string };

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function serializeToolCallArguments(toolCall: ConversationToolCallDto): string {
  if (toolCall.args !== undefined) {
    if (typeof toolCall.args === "string") return toolCall.args;
    try {
      return JSON.stringify(toolCall.args);
    } catch {
      return "{}";
    }
  }
  return toolCall.resultPreview ?? "{}";
}

function normalizeChoiceOptions(raw: unknown): ChoiceOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChoiceOption | null => {
      if (typeof item === "string" && item.trim()) {
        const label = item.trim();
        return { label, value: label };
      }
      const record = parseRecord(item);
      if (!record) return null;
      const label =
        typeof record.label === "string"
          ? record.label
          : typeof record.value === "string"
            ? record.value
            : null;
      if (!label) return null;
      return {
        label,
        value: typeof record.value === "string" ? record.value : label,
        ...(typeof record.description === "string"
          ? { description: record.description }
          : {}),
      };
    })
    .filter((item): item is ChoiceOption => Boolean(item));
}

function readCollaborationArgs(toolCall: ConversationToolCallDto): {
  question?: string;
  plan?: string;
  options: ChoiceOption[];
} {
  const record = parseRecord(toolCall.args) ?? {};
  const suspendPayload = parseRecord(record.suspendPayload) ?? {};
  const options = normalizeChoiceOptions(record.options ?? suspendPayload.options);
  const question =
    typeof record.question === "string"
      ? record.question
      : typeof suspendPayload.question === "string"
        ? suspendPayload.question
        : typeof record.title === "string"
          ? record.title
          : undefined;
  const plan =
    typeof record.plan === "string"
      ? record.plan
      : typeof suspendPayload.plan === "string"
        ? suspendPayload.plan
        : undefined;
  return { question, plan, options };
}

function parseCollaborationResumeValue(
  toolName: CollaborationToolName,
  result: unknown,
): unknown {
  if (result === undefined) return undefined;
  if (toolName === "submit_plan") {
    const record = parseRecord(result);
    if (record && typeof record.action === "string") {
      return {
        action: record.action,
        ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
      };
    }
  }
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return undefined;
    const record = parseRecord(trimmed);
    if (record) {
      if (record.response !== undefined) return record.response;
      if (toolName === "submit_plan" && typeof record.action === "string") {
        return {
          action: record.action,
          ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
        };
      }
      if (typeof record.content === "string" && record.content.trim()) {
        return record.content.trim();
      }
    }
    return trimmed;
  }
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    if (record.response !== undefined) return record.response;
    if (toolName === "submit_plan" && typeof record.action === "string") {
      return {
        action: record.action,
        ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
      };
    }
    if (typeof record.content === "string" && record.content.trim()) {
      return record.content.trim();
    }
  }
  return undefined;
}

function findAssistantMessageIdForToolCall(
  sortedEntries: ConversationMessageDto[],
  toolCall: ConversationToolCallDto,
): string | undefined {
  const entryIndexByMessageId = new Map<string, number>();
  sortedEntries.forEach((entry, index) => {
    entryIndexByMessageId.set(entry.messageId ?? entry.id, index);
  });

  let targetEntryIndex: number | undefined;
  if (toolCall.resultMessageId) {
    const resultIndex = entryIndexByMessageId.get(toolCall.resultMessageId);
    if (resultIndex !== undefined) {
      for (let index = resultIndex - 1; index >= 0; index -= 1) {
        const entry = sortedEntries[index];
        if (entry?.role === "assistant" && entry.runId === toolCall.runId) {
          targetEntryIndex = index;
          break;
        }
      }
    }
  }

  if (targetEntryIndex === undefined) {
    for (let index = sortedEntries.length - 1; index >= 0; index -= 1) {
      const entry = sortedEntries[index];
      if (entry?.role === "assistant" && entry.runId === toolCall.runId) {
        targetEntryIndex = index;
        break;
      }
    }
  }

  if (targetEntryIndex === undefined) {
    return undefined;
  }

  return (
    sortedEntries[targetEntryIndex]?.messageId ?? sortedEntries[targetEntryIndex]?.id
  );
}

function attachRestoredToolCalls(
  messages: Message[],
  sortedEntries: ConversationMessageDto[],
  toolCalls: ConversationToolCallDto[],
): Message[] {
  if (toolCalls.length === 0) {
    return messages;
  }

  const toolsByMessageIndex = new Map<number, RestoredToolCall[]>();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.toolName ?? toolCall.name;
    if (!toolName) {
      continue;
    }

    const restoredCall: RestoredToolCall = {
      id: toolCall.toolCallId,
      type: "function",
      function: {
        name: toolName,
        arguments: serializeToolCallArguments(toolCall),
      },
    };

    const assistantMessageId = findAssistantMessageIdForToolCall(sortedEntries, toolCall);
    if (!assistantMessageId) {
      continue;
    }

    const messageIndex = messages.findIndex((message) => message.id === assistantMessageId);
    if (messageIndex < 0) {
      continue;
    }

    const existing = toolsByMessageIndex.get(messageIndex) ?? [];
    existing.push(restoredCall);
    toolsByMessageIndex.set(messageIndex, existing);
  }

  return messages.map((message, index) => {
    const toolCallEntries = toolsByMessageIndex.get(index);
    if (!toolCallEntries?.length) {
      return message;
    }
    return {
      ...message,
      toolCalls: toolCallEntries,
    };
  });
}

/**
 * Maps server-authoritative conversation messages to AG-UI chat messages.
 * Tool calls from `dto.toolCalls` are attached to the nearest preceding
 * assistant message in the same run so step UI can render historical tools.
 */
export function conversationToAgentMessages(
  dto: SessionConversationDto,
): Message[] {
  const sorted = [...dto.messages].sort((a, b) => a.position - b.position);
  const messages: Message[] = [];

  for (const entry of sorted) {
    if (entry.role !== "user" && entry.role !== "assistant") {
      continue;
    }
    const content = entry.contentText.trim();
    if (!content) {
      continue;
    }
    const id = entry.messageId ?? entry.id;
    if (entry.role === "user") {
      messages.push({
        id,
        role: "user",
        content,
      });
      continue;
    }
    messages.push({
      id,
      role: "assistant",
      content,
    });
  }

  return attachRestoredToolCalls(messages, sorted, dto.toolCalls);
}

/**
 * Rebuilds client-side collaboration response records from persisted tool-call
 * metadata so ask_user / submit_plan steps stay answered after session switch.
 */
export function collaborationResponsesFromConversation(
  threadId: string,
  dto: SessionConversationDto,
): Array<Omit<CollaborationResponseRecord, "id" | "createdAt">> {
  if (dto.toolCalls.length === 0) {
    return [];
  }

  const sortedEntries = [...dto.messages].sort((left, right) => left.position - right.position);
  const records: Array<Omit<CollaborationResponseRecord, "id" | "createdAt">> = [];

  for (const toolCall of dto.toolCalls) {
    const toolName = (toolCall.toolName ?? toolCall.name) as CollaborationToolName | undefined;
    if (!toolName || !COLLABORATION_TOOL_NAMES.has(toolName)) {
      continue;
    }
    if (toolCall.status !== "completed") {
      continue;
    }

    const resumeValue = parseCollaborationResumeValue(
      toolName,
      toolCall.result ?? toolCall.resultPreview,
    );
    if (resumeValue === undefined) {
      continue;
    }

    const { question, plan, options } = readCollaborationArgs(toolCall);
    records.push({
      threadId,
      toolCallId: toolCall.toolCallId,
      toolName,
      ...(question ? { question } : {}),
      ...(plan ? { plan } : {}),
      displayText: formatCollaborationResponseDisplay(toolName, resumeValue, options),
      assistantMessageId: findAssistantMessageIdForToolCall(sortedEntries, toolCall),
    });
  }

  return records;
}

function toolCallSortKey(toolCall: ConversationToolCallDto): number {
  return (
    toolCall.callEventSeq ??
    toolCall.resultEventSeq ??
    toolCall.endEventSeq ??
    0
  );
}

function serializeToolCallResult(toolCall: ConversationToolCallDto): string | undefined {
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

/**
 * Rebuilds console/trace tool-call state from persisted conversation metadata.
 * Used when chat messages are restored via REST instead of AG-UI event replay.
 */
export function hydrateLiveRunFromConversation(
  state: LiveRun,
  dto: SessionConversationDto,
): LiveRun {
  if (dto.toolCalls.length === 0 || state.toolCalls.length > 0) {
    return state;
  }

  const sorted = [...dto.toolCalls].sort(
    (left, right) => toolCallSortKey(left) - toolCallSortKey(right),
  );

  let next = createInitialLiveRun();
  const runId = sorted[0]?.runId;
  if (runId) {
    next = reduceLiveRunEvent(next, { type: "RUN_STARTED", runId });
  }

  for (const toolCall of sorted) {
    const toolName = toolCall.toolName ?? toolCall.name ?? "tool";
    const toolCallId = toolCall.toolCallId;
    next = reduceLiveRunEvent(next, {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: toolName,
      ...(toolCall.args && typeof toolCall.args === "object"
        ? { args: toolCall.args as Record<string, unknown> }
        : {}),
    });

    const result = serializeToolCallResult(toolCall);
    if (result !== undefined) {
      next = reduceLiveRunEvent(next, {
        type: "TOOL_CALL_RESULT",
        toolCallId,
        toolCallName: toolName,
        result,
      });
    } else if (toolCall.status === "failed") {
      next = reduceLiveRunEvent(next, {
        type: "TOOL_CALL_RESULT",
        toolCallId,
        toolCallName: toolName,
        result: JSON.stringify({ error: "Tool execution failed" }),
      });
    }
  }

  if (sorted.length > 0) {
    next = reduceLiveRunEvent(next, { type: "RUN_FINISHED" });
  }

  next = {
    ...next,
    artifacts: state.artifacts,
  };

  return reconcileLiveRunArtifacts(next);
}
