import type { Message } from "@ag-ui/core";
import type {
  ConversationMessageDto,
  ConversationToolCallDto,
  SessionConversationDto,
} from "../../lib/config-api/types";
import { ConfigApiError } from "../../lib/config-api/types";

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

function attachRestoredToolCalls(
  messages: Message[],
  sortedEntries: ConversationMessageDto[],
  toolCalls: ConversationToolCallDto[],
): Message[] {
  if (toolCalls.length === 0) {
    return messages;
  }

  const entryIndexByMessageId = new Map<string, number>();
  sortedEntries.forEach((entry, index) => {
    entryIndexByMessageId.set(entry.messageId ?? entry.id, index);
  });

  const toolsByMessageIndex = new Map<number, RestoredToolCall[]>();

  for (const toolCall of toolCalls) {
    if (!toolCall.toolName) {
      continue;
    }

    const restoredCall: RestoredToolCall = {
      id: toolCall.toolCallId,
      type: "function",
      function: {
        name: toolCall.toolName,
        arguments: toolCall.resultPreview ?? "{}",
      },
    };

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
      continue;
    }

    const assistantMessageId =
      sortedEntries[targetEntryIndex]?.messageId ??
      sortedEntries[targetEntryIndex]?.id;
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
