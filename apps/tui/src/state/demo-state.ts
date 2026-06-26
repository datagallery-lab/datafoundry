import { store } from "./store.js";

export function seedDemoState(datasourceId: string): void {
  store.addUserMessage("Which regions are leading revenue this month?");
  store.addAssistantMessage(
    "Demo data is loaded. I inspected the datasource schema, ran a mock read-only SQL query, and generated a small result artifact. You can keep typing in demo mode without starting the API server.",
    false,
  );

  store.handleLiveRunEvent({
    type: "RUN_STARTED",
    threadId: "demo-thread",
    runId: "demo-run",
  });
  store.handleLiveRunEvent({
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
  store.handleLiveRunEvent({
    type: "TOOL_CALL_START",
    toolCallId: "demo-schema",
    toolCallName: "inspect_schema",
  });
  store.handleLiveRunEvent({
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
  store.handleLiveRunEvent({
    type: "TOOL_CALL_START",
    toolCallId: "demo-sql",
    toolCallName: "run_sql_readonly",
    args: {
      sql: "select region, sum(revenue) as revenue from orders group by region order by revenue desc limit 5",
    },
  });
  store.handleLiveRunEvent({
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
  store.handleLiveRunEvent({
    type: "TOOL_CALL_RESULT",
    toolCallId: "demo-sql",
    toolCallName: "run_sql_readonly",
    content: JSON.stringify({
      row_count: 5,
      elapsed_ms: 84,
    }),
  });
  store.handleLiveRunEvent({
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
  store.handleLiveRunEvent({
    type: "RUN_FINISHED",
    threadId: "demo-thread",
    runId: "demo-run",
    outcome: { type: "success" },
  });
}
