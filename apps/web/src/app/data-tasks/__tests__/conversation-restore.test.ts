import { describe, expect, it } from "vitest";
import type { SessionConversationDto } from "../../../lib/config-api/types";
import {
  conversationToAgentMessages,
  isIgnorableConversationRestoreError,
  shouldRestoreConversation,
} from "../conversation-restore";
import { ConfigApiError } from "../../../lib/config-api/types";

describe("conversationToAgentMessages", () => {
  it("returns empty array when there are no messages", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [],
    };
    expect(conversationToAgentMessages(dto)).toEqual([]);
  });

  it("sorts by position and maps user/assistant roles with stable ids", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "Here is the answer.",
          position: 2,
          createdAt: "2026-06-25T10:00:02Z",
        },
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          messageId: "msg-user-1",
          contentText: "What is revenue?",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(conversationToAgentMessages(dto)).toEqual([
      {
        id: "msg-user-1",
        role: "user",
        content: "What is revenue?",
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "Here is the answer.",
      },
    ]);
  });

  it("falls back to entry id when messageId is missing", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "persisted-user-1",
          runId: "run-1",
          role: "user",
          source: "client",
          contentText: "hello",
          position: 0,
          createdAt: "2026-06-25T10:00:00Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(conversationToAgentMessages(dto)[0]?.id).toBe("persisted-user-1");
  });

  it("skips empty content and unknown roles", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m-empty",
          runId: "run-1",
          role: "user",
          source: "client",
          contentText: "   ",
          position: 0,
          createdAt: "2026-06-25T10:00:00Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(conversationToAgentMessages(dto)).toEqual([]);
  });

  it("attaches restored tool calls to the preceding assistant message", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          messageId: "msg-user-1",
          contentText: "Inspect schema",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "I'll inspect the schema.",
          position: 2,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-1",
          status: "completed",
          toolName: "inspect_schema",
          resultMessageId: "msg-tool-1",
          resultPreview: '{"tables":[]}',
        },
      ],
    };

    expect(conversationToAgentMessages(dto)).toEqual([
      {
        id: "msg-user-1",
        role: "user",
        content: "Inspect schema",
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "I'll inspect the schema.",
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: {
              name: "inspect_schema",
              arguments: '{"tables":[]}',
            },
          },
        ],
      },
    ]);
  });
});

describe("shouldRestoreConversation", () => {
  it("allows restore when conversation memory is on and chat is empty", () => {
    expect(
      shouldRestoreConversation({
        conversationMemoryEnabled: true,
        messageCount: 0,
        isRunning: false,
        alreadyRestored: false,
      }),
    ).toBe(true);
  });

  it("blocks restore when memory is off, chat has messages, run is active, or already restored", () => {
    const base = {
      conversationMemoryEnabled: true,
      messageCount: 0,
      isRunning: false,
      alreadyRestored: false,
    };

    expect(
      shouldRestoreConversation({ ...base, conversationMemoryEnabled: false }),
    ).toBe(false);
    expect(shouldRestoreConversation({ ...base, messageCount: 2 })).toBe(false);
    expect(shouldRestoreConversation({ ...base, isRunning: true })).toBe(false);
    expect(shouldRestoreConversation({ ...base, alreadyRestored: true })).toBe(
      false,
    );
  });
});

describe("isIgnorableConversationRestoreError", () => {
  it("treats new-session not-found responses as empty history", () => {
    expect(
      isIgnorableConversationRestoreError(
        new ConfigApiError("RESOURCE_NOT_FOUND", "Session not found: thread-new", 404),
      ),
    ).toBe(true);
  });

  it("does not ignore non-404 restore failures", () => {
    expect(
      isIgnorableConversationRestoreError(
        new ConfigApiError("INTERNAL_ERROR", "database unavailable", 500),
      ),
    ).toBe(false);
  });
});
