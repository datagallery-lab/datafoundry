import { describe, expect, it } from "vitest";
import {
  findLinkedCollaborationResponse,
  hasLaterAssistantMessage,
  resolveStepAssistantFlags,
} from "../step-assistant-state";
import type { CollaborationResponseRecord } from "../components/chat/collaboration-responses";
import { createInitialLiveRun } from "../live-run-state";

const baseResponse: CollaborationResponseRecord = {
  id: "t:tc-ask",
  threadId: "t",
  toolCallId: "tc-ask",
  toolName: "ask_user",
  displayText: "继续测试",
  createdAt: 1,
  assistantMessageId: "msg-preamble",
};

describe("hasLaterAssistantMessage", () => {
  it("returns true when a later assistant message exists", () => {
    const messages = [
      { id: "msg-a", role: "assistant", content: "preamble" },
      { id: "msg-b", role: "assistant", toolCalls: [{ id: "tc-1" }] },
    ];
    expect(hasLaterAssistantMessage("msg-a", messages)).toBe(true);
    expect(hasLaterAssistantMessage("msg-b", messages)).toBe(false);
  });
});

describe("findLinkedCollaborationResponse", () => {
  it("links by assistantMessageId on orphan text messages", () => {
    const messages = [
      { id: "msg-preamble", role: "assistant", content: "Let's ask the user" },
    ];
    expect(findLinkedCollaborationResponse(messages[0], messages, [baseResponse])).toEqual(
      baseResponse,
    );
  });
});

describe("resolveStepAssistantFlags", () => {
  it("classifies orphan preambles as thought steps instead of streaming answers", () => {
    const messages = [
      { id: "msg-a", role: "assistant", content: "Let's update the task" },
      { id: "msg-b", role: "assistant", toolCalls: [{ id: "tc-1", function: { name: "task_update" } }] },
    ];
    const flags = resolveStepAssistantFlags({
      message: messages[0],
      messages,
      content: "Let's update the task",
      isRunning: true,
      liveRunStatus: "running",
      liveRun: createInitialLiveRun(),
      collaborationResponses: [],
    });

    expect(flags.isThought).toBe(true);
    expect(flags.isFinalAnswer).toBe(false);
    expect(flags.isActive).toBe(false);
  });

  it("marks ask_user preambles complete after the user responds", () => {
    const messages = [
      { id: "msg-preamble", role: "assistant", content: "Let's test ask_user" },
    ];
    const flags = resolveStepAssistantFlags({
      message: messages[0],
      messages,
      content: "Let's test ask_user",
      isRunning: true,
      liveRunStatus: "running",
      liveRun: createInitialLiveRun(),
      collaborationResponses: [baseResponse],
    });

    expect(flags.isCollaborationStep).toBe(true);
    expect(flags.isCollaborationComplete).toBe(true);
    expect(flags.isFinalAnswer).toBe(false);
    expect(flags.isActive).toBe(false);
    expect(flags.linkedCollaboration).toEqual(baseResponse);
  });

  it("keeps the last message in streaming answer mode when it is a true final answer", () => {
    const messages = [{ id: "msg-final", role: "assistant", content: "Done." }];
    const flags = resolveStepAssistantFlags({
      message: messages[0],
      messages,
      content: "Done.",
      isRunning: true,
      liveRunStatus: "running",
      liveRun: createInitialLiveRun(),
      collaborationResponses: [],
    });

    expect(flags.isFinalAnswer).toBe(true);
    expect(flags.isActive).toBe(true);
  });
});
