import { describe, expect, it } from "vitest";
import type { SessionConversationDto } from "../../../lib/config-api/types";
import { resolveUserMessageBranchState } from "../conversation-branches";

const conversation: SessionConversationDto = {
  sessionId: "thread-branch",
  messages: [
    {
      id: "m1",
      runId: "run-1",
      role: "user",
      source: "client",
      messageId: "user-message-1",
      contentText: "Original question",
      position: 1,
      createdAt: "now",
    },
    {
      id: "m2",
      runId: "run-1",
      role: "assistant",
      source: "agent",
      contentText: "Original answer",
      position: 2,
      createdAt: "now",
    },
  ],
  runEventRefs: [],
  checkpoints: [
    {
      runId: "run-1",
      status: "completed",
      messageStartPosition: 1,
      messageEndPosition: 2,
      startedAt: "now",
      finishedAt: "later",
    },
  ],
  branches: [
    {
      sessionId: "thread-original",
      parentSessionId: "thread-original",
      rootSessionId: "thread-original",
      forkRunId: "run-1",
      forkMessageEndPosition: 0,
      isOriginal: true,
      createdAt: "now",
    },
    {
      sessionId: "thread-branch",
      parentSessionId: "thread-original",
      rootSessionId: "thread-original",
      forkRunId: "run-1",
      forkMessageEndPosition: 0,
      createdAt: "later",
    },
  ],
  toolCalls: [],
};

describe("conversation branches", () => {
  it("resolves branch controls for a completed user message", () => {
    const state = resolveUserMessageBranchState({
      activeSessionId: "thread-branch",
      conversation,
      messageId: "user-message-1",
    });

    expect(state).toMatchObject({
      branchable: true,
      currentIndex: 1,
      runId: "run-1",
      status: "completed",
      total: 2,
    });
    expect(state?.previousSessionId).toBe("thread-original");
    expect(state?.nextSessionId).toBe("thread-original");
  });

  it("resolves branch controls on a child branch session with a new run id", () => {
    const state = resolveUserMessageBranchState({
      activeSessionId: "thread-branch",
      conversation: {
        ...conversation,
        sessionId: "thread-branch",
        messages: [
          {
            id: "m-branch-user",
            runId: "run-branch-rewrite",
            role: "user",
            source: "client",
            messageId: "user-message-branch",
            contentText: "Rewritten question",
            position: 1,
            createdAt: "later",
          },
        ],
        checkpoints: [
          {
            runId: "run-branch-rewrite",
            status: "completed",
            messageStartPosition: 1,
            messageEndPosition: 1,
            startedAt: "later",
            finishedAt: "later",
          },
        ],
      },
      messageId: "user-message-branch",
    });

    expect(state).toMatchObject({
      branchable: true,
      currentIndex: 1,
      runId: "run-branch-rewrite",
      total: 2,
    });
    expect(state?.previousSessionId).toBe("thread-original");
  });

  it("marks unfinished runs as refresh-only rewrites", () => {
    const state = resolveUserMessageBranchState({
      activeSessionId: "thread-live",
      conversation: {
        ...conversation,
        sessionId: "thread-live",
        checkpoints: [
          {
            runId: "run-1",
            status: "running",
            messageStartPosition: 1,
            messageEndPosition: 1,
            startedAt: "now",
          },
        ],
        branches: [],
      },
      messageId: "user-message-1",
    });

    expect(state).toMatchObject({
      branchable: false,
      refreshOnly: true,
      total: 1,
    });
  });
});
