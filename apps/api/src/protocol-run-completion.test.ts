import { EventType, type BaseEvent } from "@ag-ui/client";
import type { ProtocolRunState } from "@datafoundry/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import { assistantMessageIdFromEvent, completeProtocolRun } from "./protocol-run-completion.js";

const terminalEvent = { type: EventType.RUN_FINISHED, timestamp: 1 } as BaseEvent;

describe("completeProtocolRun", () => {
  it("recognizes a tool-only assistant turn through its parent message id", () => {
    expect(assistantMessageIdFromEvent({
      type: EventType.TOOL_CALL_START,
      toolCallId: "tool-1",
      toolCallName: "write_file",
      parentMessageId: "tool-parent-message"
    } as BaseEvent)).toBe("tool-parent-message");
  });

  it("uses the latest persisted assistant message when the current segment has no text event", async () => {
    const harness = createHarness({});

    await completeProtocolRun({
      ...harness.input,
      persistedAssistantMessageId: "persisted-message",
      terminalEvent
    });

    expect(harness.execute).toHaveBeenCalledWith(expect.objectContaining({
      actionName: "general.answer.commit",
      input: { messageId: "persisted-message" }
    }));
    expect(harness.complete).toHaveBeenCalledOnce();
  });

  it("does not submit a second answer after the protocol has entered the answer phase", async () => {
    const harness = createHarness({ answerMessageId: "committed-message", phase: "answer" });

    await completeProtocolRun({
      ...harness.input,
      lastAssistantMessageId: "committed-message",
      terminalEvent
    });

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.complete).toHaveBeenCalledOnce();
  });

  it("emits a clean run error when terminal protocol finalization fails", async () => {
    const harness = createHarness({});
    harness.execute.mockRejectedValueOnce(new Error("ACTION_NOT_ALLOWED_IN_PHASE:answer:general.answer.commit"));

    await expect(completeProtocolRun({
      ...harness.input,
      lastAssistantMessageId: "message-1",
      terminalEvent
    })).resolves.toBeUndefined();

    expect(harness.fail).toHaveBeenCalledWith({
      errorMessage: "ACTION_NOT_ALLOWED_IN_PHASE:answer:general.answer.commit",
      terminalEvent: expect.objectContaining({
        type: EventType.RUN_ERROR,
        message: "ACTION_NOT_ALLOWED_IN_PHASE:answer:general.answer.commit"
      })
    });
  });
});

const createHarness = (input: { answerMessageId?: string; phase?: string }) => {
  const execute = vi.fn(async () => undefined);
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn();
  let state: ProtocolRunState = {
    protocolId: "general-task",
    protocolVersion: "1",
    runId: "run-1",
    segmentId: "segment-1",
    phase: input.phase ?? "gather",
    revision: 1,
    status: "active",
    contextPackageRef: { packageId: "context-1", revision: 1 },
    actions: [],
    completionRejections: 0,
    domain: input.answerMessageId ? { answerMessageId: input.answerMessageId } : {},
  };
  const protocolRuntime = {
    getState: vi.fn(() => state),
    proposeCompletion: vi.fn(() => {
      state = {
        ...state,
        revision: state.revision + 1,
        terminalDecision: {
          status: "completed",
          evaluatedContextPackageRef: { packageId: "context-1", revision: 1 },
          evidenceRefs: []
        }
      };
      return state;
    })
  };
  execute.mockImplementation(async () => {
    state = { ...state, phase: "answer", domain: { answerMessageId: "persisted-message" } };
    return undefined;
  });
  return {
    complete,
    execute,
    fail,
    input: {
      finalizer: { complete, fail },
      protocol: { actionRouter: { execute }, protocolRuntime, segmentId: "segment-1" },
      runId: "run-1"
    }
  };
};
