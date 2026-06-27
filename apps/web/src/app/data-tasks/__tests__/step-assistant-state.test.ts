import { describe, expect, it } from "vitest";
import {
  findLinkedCollaborationResponse,
  hasLaterAssistantMessage,
  resolveAssistantToolStepNumber,
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

    expect(flags.isCollaborationStep).toBe(false);
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

  it("does not classify a final text answer as collaboration only because the live run has a collaboration tool", () => {
    const messages = [
      { id: "msg-final", role: "assistant", content: "收到，计划已批准，可以继续执行。" },
    ];
    const liveRun = {
      ...createInitialLiveRun(),
      toolCalls: [
        {
          id: "tc-plan",
          name: "submit_plan",
          status: "success" as const,
          startedAtMs: 1,
          finishedAtMs: 2,
        },
      ],
    };
    const flags = resolveStepAssistantFlags({
      message: messages[0],
      messages,
      content: "收到，计划已批准，可以继续执行。",
      isRunning: false,
      liveRunStatus: "completed",
      liveRun,
      collaborationResponses: [],
    });

    expect(flags.isCollaborationStep).toBe(false);
    expect(flags.isFinalAnswer).toBe(true);
  });

  it("does not let a previous collaboration tool relabel a later run's named data tool", () => {
    const messages = [
      { id: "user-1", role: "user", content: "测试 ask_user" },
      { id: "assistant-1", role: "assistant", content: "请选择工具" },
      { id: "user-2", role: "user", content: "继续调用数据源工具" },
      {
        id: "assistant-2",
        role: "assistant",
        content: "我将先列出数据源。",
        toolCalls: [{ id: "tc-list", function: { name: "list_data_sources" } }],
      },
    ];
    const liveRun = {
      ...createInitialLiveRun(),
      toolCalls: [
        {
          id: "tc-ask",
          name: "ask_user",
          status: "success" as const,
          startedAtMs: 1,
          finishedAtMs: 2,
        },
        {
          id: "tc-list",
          name: "list_data_sources",
          status: "running" as const,
          startedAtMs: 3,
        },
      ],
    };
    const flags = resolveStepAssistantFlags({
      message: messages[3],
      messages,
      content: "我将先列出数据源。",
      isRunning: true,
      liveRunStatus: "running",
      liveRun,
      collaborationResponses: [],
    });

    expect(flags.isCollaborationStep).toBe(false);
    expect(flags.hasToolCalls).toBe(true);
  });
});

describe("resolveAssistantToolStepNumber", () => {
  it("keeps regular tool-call messages in the numbered sequence", () => {
    const messages = [
      { id: "assistant-1", role: "assistant", toolCalls: [{ id: "tc-data", function: { name: "list_data_sources" } }] },
      { id: "assistant-2", role: "assistant", toolCalls: [{ id: "tc-sql", function: { name: "run_sql_readonly" } }] },
    ];

    expect(
      resolveAssistantToolStepNumber({
        message: messages[1],
        messages,
        liveRun: createInitialLiveRun(),
        collaborationResponses: [],
      }),
    ).toBe(2);
  });

  it("numbers an answered ask_user step even when the chat message has no toolCalls", () => {
    const messages = [
      { id: "assistant-1", role: "assistant", toolCalls: [{ id: "tc-data", function: { name: "list_data_sources" } }] },
      { id: "assistant-ask", role: "assistant", content: "请选择下一步" },
    ];
    const liveRun = {
      ...createInitialLiveRun(),
      toolCalls: [
        {
          id: "tc-data",
          name: "list_data_sources",
          status: "success" as const,
          startedAtMs: 1,
          finishedAtMs: 2,
        },
        {
          id: "tc-ask",
          name: "ask_user",
          status: "success" as const,
          startedAtMs: 3,
          finishedAtMs: 4,
        },
      ],
    };

    expect(
      resolveAssistantToolStepNumber({
        message: messages[1],
        messages,
        liveRun,
        collaborationResponses: [
          {
            ...baseResponse,
            toolCallId: "tc-ask",
            assistantMessageId: "assistant-ask",
          },
        ],
      }),
    ).toBe(2);
  });

  it("numbers a pending submit_plan step inferred from the live run", () => {
    const messages = [
      { id: "assistant-1", role: "assistant", toolCalls: [{ id: "tc-data", function: { name: "list_data_sources" } }] },
      { id: "assistant-plan", role: "assistant", content: "" },
    ];
    const liveRun = {
      ...createInitialLiveRun(),
      toolCalls: [
        {
          id: "tc-data",
          name: "list_data_sources",
          status: "success" as const,
          startedAtMs: 1,
          finishedAtMs: 2,
        },
        {
          id: "tc-plan",
          name: "submit_plan",
          status: "running" as const,
          startedAtMs: 3,
        },
      ],
    };

    expect(
      resolveAssistantToolStepNumber({
        message: messages[1],
        messages,
        liveRun,
        collaborationResponses: [],
      }),
    ).toBe(2);
  });
});
