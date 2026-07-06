import { describe, expect, it } from "vitest";
import type { Attachment } from "@copilotkit/react-core/v2";
import type { RunForwardedProps } from "../data-task-state";
import {
  createQueuedChatPrompt,
  deleteQueuedChatPrompt,
  editQueuedChatPrompt,
  markQueuedChatPromptInterrupting,
  queuedPromptToRunInput,
  resolveQueuedSubmitMode,
  shouldShowRunningStopControl,
  takeNextQueuedChatPrompt,
} from "../components/chat/queued-chat-runs";

const attachment = (id: string): Attachment =>
  ({
    id,
    name: `${id}.csv`,
    type: "text/csv",
    status: "ready",
  }) as unknown as Attachment;

const forwardedProps = (datasourceId: string): RunForwardedProps => ({
  datasourceId,
  run_config: {
    activeDatasourceId: datasourceId,
    activeLlmProfileId: "llm-1",
    enabledDatasourceIds: [datasourceId],
    enabledKnowledgeIds: [],
    enabledMcpServerIds: [],
    enabledSkillIds: [],
    mentioned: { db: [], kb: [], mcp: [], skill: [] },
    fileIds: [],
    pinnedPaths: [],
    evidenceRefs: [],
  },
});

describe("queued chat runs", () => {
  it("creates a queued prompt with the full run snapshot", () => {
    const props = forwardedProps("db-1");
    const files = [attachment("att-1")];

    const prompt = createQueuedChatPrompt({
      id: "queued-1",
      text: "Analyze revenue",
      attachments: files,
      forwardedProps: props,
      createdAt: 123,
    });

    expect(prompt).toMatchObject({
      id: "queued-1",
      text: "Analyze revenue",
      createdAt: 123,
      status: "queued",
    });
    expect(prompt.attachments).toEqual(files);
    expect(prompt.forwardedProps).toEqual(props);
  });

  it("edits only text without mutating attachments or forwarded props", () => {
    const props = forwardedProps("db-1");
    const files = [attachment("att-1")];
    const prompt = createQueuedChatPrompt({
      id: "queued-1",
      text: "old text",
      attachments: files,
      forwardedProps: props,
      createdAt: 123,
    });

    const edited = editQueuedChatPrompt([prompt], "queued-1", "new text");

    expect(edited[0]).toMatchObject({ id: "queued-1", text: "new text" });
    expect(edited[0].attachments).toEqual(files);
    expect(edited[0].forwardedProps).toEqual(props);
    expect(prompt.text).toBe("old text");
  });

  it("deletes a queued prompt by id", () => {
    const first = createQueuedChatPrompt({
      id: "queued-1",
      text: "first",
      attachments: [],
      forwardedProps: forwardedProps("db-1"),
      createdAt: 1,
    });
    const second = createQueuedChatPrompt({
      id: "queued-2",
      text: "second",
      attachments: [],
      forwardedProps: forwardedProps("db-2"),
      createdAt: 2,
    });

    expect(deleteQueuedChatPrompt([first, second], "queued-1")).toEqual([
      second,
    ]);
  });

  it("takes prompts in FIFO order", () => {
    const first = createQueuedChatPrompt({
      id: "queued-1",
      text: "first",
      attachments: [],
      forwardedProps: forwardedProps("db-1"),
      createdAt: 1,
    });
    const second = createQueuedChatPrompt({
      id: "queued-2",
      text: "second",
      attachments: [],
      forwardedProps: forwardedProps("db-2"),
      createdAt: 2,
    });

    const next = takeNextQueuedChatPrompt([first, second]);

    expect(next.prompt).toEqual(first);
    expect(next.queue).toEqual([second]);
  });

  it("moves a send-now prompt to the front and marks it interrupting", () => {
    const first = createQueuedChatPrompt({
      id: "queued-1",
      text: "first",
      attachments: [],
      forwardedProps: forwardedProps("db-1"),
      createdAt: 1,
    });
    const second = createQueuedChatPrompt({
      id: "queued-2",
      text: "second",
      attachments: [],
      forwardedProps: forwardedProps("db-2"),
      createdAt: 2,
    });

    const promoted = markQueuedChatPromptInterrupting([first, second], "queued-2");

    expect(promoted.map((item) => item.id)).toEqual(["queued-2", "queued-1"]);
    expect(promoted[0].status).toBe("interrupting");
    expect(promoted[1].status).toBe("queued");
  });

  it("queues active run submissions and dispatches idle submissions", () => {
    expect(
      resolveQueuedSubmitMode({ agentIsRunning: true, liveRunStatus: "idle" }),
    ).toBe("queue");
    expect(
      resolveQueuedSubmitMode({
        agentIsRunning: false,
        liveRunStatus: "suspended",
      }),
    ).toBe("queue");
    expect(
      resolveQueuedSubmitMode({
        agentIsRunning: false,
        liveRunStatus: "completed",
      }),
    ).toBe("dispatch");
  });

  it("shows the stop control only while a run is active and the draft is empty", () => {
    expect(
      shouldShowRunningStopControl({
        agentIsRunning: true,
        liveRunStatus: "running",
        draftText: "",
      }),
    ).toBe(true);
    expect(
      shouldShowRunningStopControl({
        agentIsRunning: true,
        liveRunStatus: "running",
        draftText: "next question",
      }),
    ).toBe(false);
    expect(
      shouldShowRunningStopControl({
        agentIsRunning: false,
        liveRunStatus: "suspended",
        draftText: "   ",
      }),
    ).toBe(true);
    expect(
      shouldShowRunningStopControl({
        agentIsRunning: false,
        liveRunStatus: "completed",
        draftText: "",
      }),
    ).toBe(false);
  });

  it("dispatches queued prompts with their saved forwarded props", () => {
    const savedProps = forwardedProps("saved-db");
    const latestProps = forwardedProps("latest-db");
    const prompt = createQueuedChatPrompt({
      id: "queued-1",
      text: "use saved context",
      attachments: [attachment("att-1")],
      forwardedProps: savedProps,
      createdAt: 1,
    });

    const runInput = queuedPromptToRunInput(prompt);

    expect(runInput.forwardedProps).toEqual(savedProps);
    expect(runInput.forwardedProps).not.toEqual(latestProps);
    expect(runInput.text).toBe("use saved context");
  });
});
