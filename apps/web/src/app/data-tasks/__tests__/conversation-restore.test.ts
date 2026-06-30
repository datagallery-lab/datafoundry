import { describe, expect, it } from "vitest";
import type { SessionConversationDto } from "../../../lib/config-api/types";
import {
  collaborationResponsesFromConversation,
  conversationToAgentMessages,
  hydrateLiveRunFromConversation,
  hydratePendingInteractionLiveRun,
  isIgnorableConversationRestoreError,
  agentMessagesMatchConversation,
  latestUserQuestionFromConversation,
  pendingInteractionsFromConversation,
  replayRestorableCustomEvents,
  shouldHydrateLiveRunFromConversation,
  shouldRestoreConversation,
  shouldRestoreConversationMessages,
} from "../conversation-restore";
import { ConfigApiError } from "../../../lib/config-api/types";
import {
  createInitialLiveRun,
  reconcileLiveRunArtifacts,
  reduceLiveRunEvent,
} from "../live-run-state";

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

  it("uses persisted args instead of result preview for restored tool arguments", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "I'll inspect the schema.",
          position: 1,
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
          args: { table_names: ["orders"] },
          resultPreview: '{"tables":[]}',
        },
      ],
    };

    expect(conversationToAgentMessages(dto)[0]?.toolCalls?.[0]?.function.arguments).toBe(
      JSON.stringify({ table_names: ["orders"] }),
    );
  });

  it("uses parentMessageId when linking tool calls to assistant messages", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "First step",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
        {
          id: "m2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-2",
          contentText: "Second step",
          position: 2,
          createdAt: "2026-06-25T10:00:03Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-1",
          status: "completed",
          toolName: "list_data_sources",
          parentMessageId: "msg-assistant-1",
          callEventSeq: 1,
        },
        {
          runId: "run-1",
          toolCallId: "tc-2",
          status: "completed",
          toolName: "inspect_schema",
          parentMessageId: "msg-assistant-2",
          callEventSeq: 2,
        },
      ],
    };

    const restored = conversationToAgentMessages(dto);
    expect(restored[0]?.toolCalls?.[0]?.function.name).toBe("list_data_sources");
    expect(restored[1]?.toolCalls?.[0]?.function.name).toBe("inspect_schema");
  });

  it("distributes unlinked tool calls across assistant turns in order", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          messageId: "msg-user-1",
          contentText: "analyze",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "Step 1",
          position: 2,
          createdAt: "2026-06-25T10:00:02Z",
        },
        {
          id: "m3",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-2",
          contentText: "Step 2",
          position: 3,
          createdAt: "2026-06-25T10:00:03Z",
        },
        {
          id: "m4",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-3",
          contentText: "Final answer",
          position: 4,
          createdAt: "2026-06-25T10:00:04Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-1",
          status: "completed",
          toolName: "list_data_sources",
          callEventSeq: 1,
        },
        {
          runId: "run-1",
          toolCallId: "tc-2",
          status: "completed",
          toolName: "inspect_schema",
          callEventSeq: 2,
        },
      ],
    };

    const restored = conversationToAgentMessages(dto);
    expect(restored.find((message) => message.id === "msg-assistant-1")?.toolCalls?.[0]?.function.name).toBe(
      "list_data_sources",
    );
    expect(restored.find((message) => message.id === "msg-assistant-2")?.toolCalls?.[0]?.function.name).toBe(
      "inspect_schema",
    );
    expect(restored.find((message) => message.id === "msg-assistant-3")?.toolCalls).toBeUndefined();
  });

  it("groups parallel tool calls that share an ephemeral parent message into one restored step", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m-user",
          runId: "run-1",
          role: "user",
          source: "client",
          messageId: "msg-user-1",
          contentText: "同时执行三个list_data_sources",
          position: 1,
          createdAt: "2026-06-30T10:00:01Z",
        },
        {
          id: "m-assistant-1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "已确认数据源，接下来检查 schema。",
          position: 2,
          createdAt: "2026-06-30T10:00:02Z",
        },
        {
          id: "m-assistant-2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-2",
          contentText: "schema 已检查完成。",
          position: 3,
          createdAt: "2026-06-30T10:00:03Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-list-1",
          status: "completed",
          toolName: "list_data_sources",
          parentMessageId: "msg-ephemeral-tools",
          callEventSeq: 8,
        },
        {
          runId: "run-1",
          toolCallId: "tc-list-2",
          status: "completed",
          toolName: "list_data_sources",
          parentMessageId: "msg-ephemeral-tools",
          callEventSeq: 11,
        },
        {
          runId: "run-1",
          toolCallId: "tc-list-3",
          status: "completed",
          toolName: "list_data_sources",
          parentMessageId: "msg-ephemeral-tools",
          callEventSeq: 14,
        },
        {
          runId: "run-1",
          toolCallId: "tc-schema",
          status: "completed",
          toolName: "inspect_schema",
          parentMessageId: "msg-assistant-1",
          callEventSeq: 46,
        },
      ],
    };

    const restored = conversationToAgentMessages(dto);
    const parallelStep = restored.find((message) =>
      message.toolCalls?.some((call) => call.id === "tc-list-1"),
    );
    expect(parallelStep?.toolCalls).toHaveLength(3);
    expect(parallelStep?.toolCalls?.map((call) => call.function.name)).toEqual([
      "list_data_sources",
      "list_data_sources",
      "list_data_sources",
    ]);
    expect(
      restored.find((message) => message.id === "msg-assistant-1")?.toolCalls?.[0]?.function.name,
    ).toBe("inspect_schema");
  });

  it("restores empty assistant placeholders needed for collaboration tool anchoring", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m-user",
          runId: "run-1",
          role: "user",
          source: "user",
          messageId: "msg-user-1",
          contentText: "选择数据源",
          position: 0,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m-ask",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-ask",
          contentText: "",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
        {
          id: "m-data",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-data",
          contentText: "Conversation Summary",
          position: 2,
          createdAt: "2026-06-25T10:00:03Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-ask",
          status: "completed",
          toolName: "ask_user",
          callEventSeq: 1,
          result: "orders",
        },
        {
          runId: "run-1",
          toolCallId: "tc-data",
          status: "completed",
          toolName: "list_data_sources",
          callEventSeq: 2,
        },
      ],
    };

    const restored = conversationToAgentMessages(dto);
    expect(restored.some((message) => message.id === "msg-assistant-ask")).toBe(true);
    expect(
      restored.find((message) => message.id === "msg-assistant-ask")?.toolCalls?.[0]?.function.name,
    ).toBe("ask_user");
    expect(
      restored.find((message) => message.id === "msg-assistant-data")?.toolCalls?.[0]?.function.name,
    ).toBe("list_data_sources");
  });
});

describe("collaborationResponsesFromConversation", () => {
  it("rebuilds answered ask_user records from persisted tool calls", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "请选择下一步",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-ask",
          status: "completed",
          toolName: "ask_user",
          args: {
            question: "继续哪种分析？",
            options: [{ label: "Inspect schema", value: "schema" }],
          },
          result: "schema",
        },
      ],
    };

    expect(collaborationResponsesFromConversation("thread-1", dto)).toEqual([
      {
        threadId: "thread-1",
        toolCallId: "tc-ask",
        toolName: "ask_user",
        question: "继续哪种分析？",
        displayText: "Inspect schema",
        assistantMessageId: "msg-assistant-1",
      },
    ]);
  });

  it("rebuilds ask_user records when persisted tool name is missing", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "Conversation Summary",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-ask",
          status: "completed",
          result: { content: "User answered: orders" },
        },
      ],
    };

    expect(collaborationResponsesFromConversation("thread-1", dto)).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        toolCallId: "tc-ask",
        toolName: "ask_user",
        displayText: "orders",
      }),
    ]);
  });

  it("rebuilds submit_plan approval records", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "请审批计划",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-plan",
          status: "completed",
          toolName: "submit_plan",
          args: {
            title: "执行Plan approval",
            plan: "1. 查 schema\n2. 跑 SQL",
          },
          result: { action: "approved" },
        },
      ],
    };

    expect(collaborationResponsesFromConversation("thread-1", dto)).toEqual([
      {
        threadId: "thread-1",
        toolCallId: "tc-plan",
        toolName: "submit_plan",
        question: "执行Plan approval",
        plan: "1. 查 schema\n2. 跑 SQL",
        displayText: "已批准执行计划",
        assistantMessageId: "msg-assistant-1",
      },
    ]);
  });

  it("rebuilds submit_plan when persisted tool name is mislabeled ask_user", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "请审批计划",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-plan",
          status: "completed",
          toolName: "ask_user",
          args: {
            title: "简单计划",
            plan: "步骤1：确认收到审批",
          },
          result: { action: "approved" },
        },
      ],
    };

    expect(collaborationResponsesFromConversation("thread-1", dto)).toEqual([
      expect.objectContaining({
        toolCallId: "tc-plan",
        toolName: "submit_plan",
        plan: "步骤1：确认收到审批",
        displayText: "已批准执行计划",
      }),
    ]);

    const restored = conversationToAgentMessages(dto);
    expect(
      restored.find((message) => message.id === "msg-assistant-1")?.toolCalls?.[0]?.function.name,
    ).toBe("submit_plan");

    const run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(run.toolCalls.find((call) => call.id === "tc-plan")?.name).toBe("submit_plan");
  });

  it("infers submit_plan from approval result when tool name is missing", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          messageId: "msg-assistant-1",
          contentText: "",
          position: 1,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-plan",
          status: "completed",
          resultPreview: JSON.stringify({
            action: "approved",
            content: "Plan approved",
            source: "mastra-collaboration",
          }),
          args: {
            title: "数据源计划",
            plan: "步骤1：调用list_data_sources",
          },
        },
      ],
    };

    expect(collaborationResponsesFromConversation("thread-1", dto)).toEqual([
      expect.objectContaining({
        toolCallId: "tc-plan",
        toolName: "submit_plan",
      }),
    ]);

    const run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(run.toolCalls.find((call) => call.id === "tc-plan")?.name).toBe("submit_plan");
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

describe("agentMessagesMatchConversation", () => {
  const dto: SessionConversationDto = {
    sessionId: "thread-1",
    messages: [
      {
        id: "m1",
        runId: "run-1",
        role: "user",
        source: "client",
        messageId: "msg-user-1",
        contentText: "统计不同品类销售额",
        position: 1,
        createdAt: "2026-06-25T10:00:01Z",
      },
      {
        id: "m2",
        runId: "run-1",
        role: "assistant",
        source: "agent",
        messageId: "msg-assistant-1",
        contentText: "好的，我来分析。",
        position: 2,
        createdAt: "2026-06-25T10:00:02Z",
      },
    ],
    runEventRefs: [],
    toolCalls: [],
  };

  it("returns false when agent still holds another thread's messages", () => {
    expect(
      agentMessagesMatchConversation(
        [{ id: "other-thread-msg", role: "user", content: "hello" }],
        dto,
      ),
    ).toBe(false);
  });

  it("returns true when agent messages match restored conversation", () => {
    expect(agentMessagesMatchConversation(conversationToAgentMessages(dto), dto)).toBe(
      true,
    );
  });
});

describe("shouldRestoreConversationMessages", () => {
  it("restores when agent messages are stale after thread switch", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-2",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          messageId: "msg-user-2",
          contentText: "查询 orders 表有多少行",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(
      shouldRestoreConversationMessages({
        conversationMemoryEnabled: true,
        isRunning: false,
        agentMessages: [{ id: "msg-user-1", role: "user", content: "old question" }],
        dto,
      }),
    ).toBe(true);
  });
});

describe("shouldHydrateLiveRunFromConversation", () => {
  it("hydrates when tool calls are missing but conversation has history", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "sql-1",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 1,
        },
      ],
    };

    expect(shouldHydrateLiveRunFromConversation(createInitialLiveRun(), dto)).toBe(true);
  });

  it("skips when live run already reflects the conversation", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "sql-1",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 1,
        },
      ],
    };

    let run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(shouldHydrateLiveRunFromConversation(run, dto)).toBe(false);
  });

  it("hydrates when AG-UI replay left the run running with no tool calls", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "sql-1",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 1,
        },
      ],
    };

    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    expect(run.runStatus).toBe("running");
    expect(shouldHydrateLiveRunFromConversation(run, dto)).toBe(true);
  });

  it("hydrates when replay only produced run boundaries without tools", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "schema-1",
          status: "completed",
          toolName: "inspect_schema",
          callEventSeq: 1,
          resultPreview: JSON.stringify({ tables: [] }),
        },
      ],
    };

    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-orphan", title: "旧产出", summary: "" },
    });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    expect(run.toolCalls).toHaveLength(0);
    expect((run.runHistory?.length ?? 0)).toBeGreaterThan(0);
    expect(shouldHydrateLiveRunFromConversation(run, dto)).toBe(true);

    run = hydrateLiveRunFromConversation(run, dto);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.runHistory).toEqual([]);
  });

  it("hydrates when live run is missing tool ids from conversation", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-1",
          status: "completed",
          toolName: "list_data_sources",
          callEventSeq: 1,
        },
        {
          runId: "run-1",
          toolCallId: "tc-2",
          status: "completed",
          toolName: "inspect_schema",
          callEventSeq: 2,
        },
      ],
    };

    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tc-1",
      toolCallName: "list_data_sources",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tc-1",
      toolCallName: "list_data_sources",
      result: "{}",
    });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });

    expect(shouldHydrateLiveRunFromConversation(run, dto)).toBe(true);
    run = hydrateLiveRunFromConversation(run, dto);
    expect(run.toolCalls).toHaveLength(2);
  });
});

describe("latestUserQuestionFromConversation", () => {
  it("returns the last user message text", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          contentText: "first question",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m2",
          runId: "run-1",
          role: "assistant",
          source: "agent",
          contentText: "answer",
          position: 2,
          createdAt: "2026-06-25T10:00:02Z",
        },
        {
          id: "m3",
          runId: "run-2",
          role: "user",
          source: "client",
          contentText: "follow up",
          position: 3,
          createdAt: "2026-06-25T10:00:03Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(latestUserQuestionFromConversation(dto)).toBe("follow up");
  });

  it("skips collaboration echo user messages when resolving latest question", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-1",
          role: "user",
          source: "client",
          contentText: "先查看数据库，再问我下一步要做什么",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m2",
          runId: "run-2",
          role: "user",
          source: "client",
          contentText: "调用askuser tool",
          position: 2,
          createdAt: "2026-06-25T10:00:03Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [],
    };

    expect(latestUserQuestionFromConversation(dto)).toBe(
      "先查看数据库，再问我下一步要做什么",
    );
  });
});

describe("hydrateLiveRunFromConversation run ordering", () => {
  it("orders hydrated run groups by user turn instead of interleaved tool seq", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [
        {
          id: "m1",
          runId: "run-a",
          role: "user",
          source: "client",
          contentText: "round one",
          position: 1,
          createdAt: "2026-06-25T10:00:01Z",
        },
        {
          id: "m2",
          runId: "run-b",
          role: "user",
          source: "client",
          contentText: "round two",
          position: 2,
          createdAt: "2026-06-25T10:00:02Z",
        },
      ],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-b",
          toolCallId: "tc-collab",
          status: "completed",
          resultPreview: JSON.stringify({
            content: "User answered: yes",
            source: "mastra-collaboration",
          }),
        },
        {
          runId: "run-a",
          toolCallId: "tc-a",
          status: "completed",
          toolName: "list_data_sources",
          callEventSeq: 10,
        },
        {
          runId: "run-b",
          toolCallId: "tc-b",
          status: "completed",
          toolName: "inspect_schema",
          callEventSeq: 20,
        },
      ],
    };

    const run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(run.toolCalls.map((call) => call.id)).toEqual([
      "tc-a",
      "tc-collab",
      "tc-b",
    ]);
    expect(run.toolCalls.find((call) => call.id === "tc-collab")?.name).toBe("ask_user");
    expect(run.runHistory).toHaveLength(1);
    expect(run.runHistory?.[0]?.toolCallEndIndex).toBe(1);
  });
});

describe("hydrateLiveRunFromConversation", () => {
  it("hydrates live run tool calls and links restored artifacts", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [{ runId: "run-1", eventCount: 4 }],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "sql-1",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 1,
          resultEventSeq: 2,
          resultPreview: JSON.stringify({ row_count: 3, elapsed_ms: 12 }),
        },
      ],
    };

    let run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.toolCalls[0]?.name).toBe("run_sql_readonly");
    expect(run.runStatus).toBe("completed");

    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        type: "table",
        title: "SQL result",
        preview_json: { row_count: 3, columns: ["a"], rows: [["1"]] },
      },
    });
    run = reconcileLiveRunArtifacts(run);
    expect(run.artifacts[0]?.createdByEventId).toBe("sql-1");
  });

  it("rebuilds multi-run tool history with run boundaries", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "tc-1",
          status: "completed",
          toolName: "list_data_sources",
          callEventSeq: 1,
        },
        {
          runId: "run-1",
          toolCallId: "tc-ask",
          status: "pending",
          toolName: "ask_user",
          callEventSeq: 2,
        },
        {
          runId: "run-2",
          toolCallId: "tc-2",
          status: "completed",
          toolName: "inspect_schema",
          callEventSeq: 3,
          resultPreview: JSON.stringify({ tables: [] }),
        },
        {
          runId: "run-2",
          toolCallId: "tc-3",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 4,
          resultPreview: JSON.stringify({ row_count: 2 }),
        },
      ],
    };

    const run = hydrateLiveRunFromConversation(createInitialLiveRun(), dto);
    expect(run.toolCalls).toHaveLength(4);
    expect(run.runHistory).toHaveLength(1);
    expect(run.runHistory?.[0]?.status).toBe("suspended");
    expect(run.runHistory?.[0]?.toolCallEndIndex).toBe(2);
    expect(run.runStatus).toBe("completed");
  });

  it("preserves orphaned artifacts when re-hydrating tool calls", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [
        {
          runId: "run-1",
          toolCallId: "sql-1",
          status: "completed",
          toolName: "run_sql_readonly",
          callEventSeq: 1,
          resultPreview: JSON.stringify({ row_count: 3 }),
        },
      ],
    };

    let polluted = createInitialLiveRun();
    polluted = reduceLiveRunEvent(polluted, { type: "RUN_STARTED" });
    polluted = reduceLiveRunEvent(polluted, {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-orphan", title: "旧产出", summary: "" },
    });
    polluted = reduceLiveRunEvent(polluted, { type: "RUN_FINISHED" });

    const run = hydrateLiveRunFromConversation(polluted, dto);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.artifacts.some((artifact) => artifact.id === "artifact-orphan")).toBe(true);
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

describe("hydratePendingInteractionLiveRun", () => {
  it("bootstraps suspended live run when only pendingInteractions are persisted", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [],
      pendingInteractions: [
        {
          interactionId: "int-1",
          runId: "run-1",
          toolCallId: "tc-ask",
          toolName: "ask_user",
          interruptEvent: {
            type: "mastra_suspend",
            toolCallId: "tc-ask",
            toolName: "ask_user",
          },
        },
      ],
    };

    const run = hydratePendingInteractionLiveRun(
      createInitialLiveRun(),
      "thread-1",
      dto,
      [],
    );

    expect(run.runStatus).toBe("suspended");
    expect(run.toolCalls).toEqual([
      expect.objectContaining({ id: "tc-ask", name: "ask_user", status: "running" }),
    ]);
  });
});

describe("pendingInteractionsFromConversation", () => {
  it("maps pending interactions with interrupt payloads", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [],
      pendingInteractions: [
        {
          interactionId: "int-1",
          runId: "run-1",
          toolCallId: "tc-ask",
          toolName: "ask_user",
          interruptEvent: {
            type: "mastra_suspend",
            toolCallId: "tc-ask",
            toolName: "ask_user",
            runId: "run-1",
          },
        },
      ],
    };

    expect(pendingInteractionsFromConversation("thread-1", dto)).toEqual([
      {
        threadId: "thread-1",
        runId: "run-1",
        toolCallId: "tc-ask",
        toolName: "ask_user",
        interruptEvent: {
          type: "mastra_suspend",
          toolCallId: "tc-ask",
          toolName: "ask_user",
          runId: "run-1",
        },
      },
    ]);
  });
});

describe("replayRestorableCustomEvents", () => {
  it("replays persisted custom events into live run state", () => {
    const dto: SessionConversationDto = {
      sessionId: "thread-1",
      messages: [],
      runEventRefs: [],
      toolCalls: [],
      restorableCustomEvents: [
        {
          runId: "run-1",
          seq: 2,
          name: "token_usage",
          value: { input_tokens: 10, output_tokens: 5 },
        },
        {
          runId: "run-1",
          seq: 1,
          name: "sql_audit",
          value: { audit_log_id: "audit-1", status: "succeeded" },
        },
      ],
    };

    const run = replayRestorableCustomEvents(createInitialLiveRun(), dto);
    expect(run.audits).toHaveLength(1);
    expect(run.tokenUsageEvents).toHaveLength(1);
  });
});
