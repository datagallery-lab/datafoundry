import type { AgentClient, CopilotKitEvent, RunAgentInput } from "./types.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function event(value: Record<string, unknown>): CopilotKitEvent {
  return value as CopilotKitEvent;
}

function latestUserText(input: RunAgentInput): string {
  const lastMessage = [...input.messages].reverse().find((message) => message.role === "user");
  if (!lastMessage) return "Show demo sales data";
  return typeof lastMessage.content === "string" ? lastMessage.content : "Show demo sales data";
}

export class DemoCopilotKitClient implements AgentClient {
  async *runAgent(input: RunAgentInput): AsyncGenerator<CopilotKitEvent> {
    const question = latestUserText(input);
    const datasourceId =
      typeof input.forwardedProps?.datasourceId === "string"
        ? input.forwardedProps.datasourceId
        : "api-duckdb-demo";
    const messageId = `demo-message-${Date.now()}`;

    yield event({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
      input,
    });

    yield event({
      type: "ACTIVITY_SNAPSHOT",
      activityType: "PLAN",
      messageId: "demo-plan",
      content: {
        tasks: [
          { id: "inspect", title: "Inspect datasource schema", status: "completed" },
          { id: "query", title: "Run read-only SQL", status: "running" },
          { id: "final", title: "Summarize results", status: "pending" },
        ],
      },
    });

    yield event({
      type: "REASONING_MESSAGE_START",
      messageId: `${messageId}-reasoning-1`,
    });
    yield event({
      type: "REASONING_MESSAGE_CONTENT",
      messageId: `${messageId}-reasoning-1`,
      delta: "I should inspect the datasource schema first, then run a narrow aggregate query.",
    });
    yield event({
      type: "REASONING_MESSAGE_END",
      messageId: `${messageId}-reasoning-1`,
    });

    yield event({
      type: "TOOL_CALL_START",
      toolCallId: "demo-schema",
      toolCallName: "inspect_schema",
      args: {
        datasource_id: datasourceId,
        table_names: ["orders"],
      },
    });
    await delay(180);
    yield event({
      type: "TOOL_CALL_RESULT",
      toolCallId: "demo-schema",
      toolCallName: "inspect_schema",
      content: JSON.stringify({
        tables: [
          {
            name: "orders",
            columns: [
              { name: "order_date", type: "DATE" },
              { name: "region", type: "TEXT" },
              { name: "revenue", type: "DOUBLE" },
            ],
          },
        ],
      }),
    });

    yield event({
      type: "TOOL_CALL_START",
      toolCallId: "demo-sql",
      toolCallName: "run_sql_readonly",
      args: {
        sql: "select region, sum(revenue) as revenue from orders group by region order by revenue desc limit 5",
      },
    });
    await delay(220);
    yield event({
      type: "CUSTOM",
      name: "sql_audit",
      value: {
        audit_log_id: "demo-audit-1",
        datasource_id: datasourceId,
        status: "success",
        row_count: 5,
        elapsed_ms: 84,
      },
    });
    yield event({
      type: "TOOL_CALL_RESULT",
      toolCallId: "demo-sql",
      toolCallName: "run_sql_readonly",
      content: JSON.stringify({
        row_count: 5,
        elapsed_ms: 84,
      }),
    });

    yield event({
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "demo-top-regions",
        type: "table",
        title: "Top regions by revenue",
        summary: "Demo table generated from a mock read-only SQL query.",
        preview_json: {
          columns: ["region", "revenue"],
          rows: [
            ["East", "1,284,000"],
            ["South", "973,500"],
            ["North", "812,300"],
          ],
        },
      },
    });

    const chunks = [
      `Demo response for: "${question}". `,
      "I inspected the schema, ran a read-only aggregate query, ",
      "and found East leading revenue in the sample data. ",
      "The artifact section now shows a small preview table.",
    ];
    for (const delta of chunks) {
      await delay(180);
      yield event({
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta,
      });
    }

    yield event({
      type: "TEXT_MESSAGE_END",
      messageId,
    });
    yield event({
      type: "ACTIVITY_SNAPSHOT",
      activityType: "PLAN",
      messageId: "demo-plan",
      content: {
        tasks: [
          { id: "inspect", title: "Inspect datasource schema", status: "completed" },
          { id: "query", title: "Run read-only SQL", status: "completed" },
          { id: "final", title: "Summarize results", status: "completed" },
        ],
      },
    });
    yield event({
      type: "RUN_FINISHED",
      threadId: input.threadId,
      runId: input.runId,
      outcome: { type: "success" },
    });
  }
}
