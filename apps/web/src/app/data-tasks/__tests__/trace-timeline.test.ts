import { describe, expect, it } from "vitest";
import { buildTraceTimeline } from "../trace-timeline";
import {
  createInitialLiveRun,
  reduceLiveRunEvent,
} from "../live-run-state";

describe("buildTraceTimeline", () => {
  it("returns empty timeline for idle run with no activity", () => {
    expect(buildTraceTimeline(createInitialLiveRun())).toEqual([]);
  });

  it("merges tool calls, events, audits, and run boundaries", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-schema",
      toolCallName: "inspect_schema",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-schema",
      toolCallName: "inspect_schema",
      content: JSON.stringify({
        tables: [{ name: "orders", columns: [{ name: "id", type: "INT" }] }],
      }),
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql",
      toolCallName: "run_sql_readonly",
      args: { sql: "SELECT 1" },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "sql_audit",
      value: {
        audit_log_id: "audit-1",
        datasource_id: "api-duckdb-demo",
        status: "success",
        row_count: 42,
        elapsed_ms: 18,
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-sql",
      toolCallName: "run_sql_readonly",
      content: JSON.stringify({ row_count: 42, elapsed_ms: 18 }),
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-1", title: "查询结果", summary: "数据集" },
    });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });

    const entries = buildTraceTimeline(run);
    expect(entries[0]?.kind).toBe("run_started");
    expect(entries.at(-1)?.kind).toBe("run_finished");

    const schemaEntry = entries.find((entry) => entry.toolCallId === "tool-schema");
    expect(schemaEntry?.schemaTables?.[0]?.name).toBe("orders");

    const sqlEntry = entries.find((entry) => entry.toolCallId === "tool-sql");
    expect(sqlEntry?.sql).toBe("SELECT 1");
    expect(sqlEntry?.scannedRows).toBe(42);
    expect(sqlEntry?.auditStatus).toBe("success");
    expect(sqlEntry?.datasourceId).toBe("api-duckdb-demo");
    expect(sqlEntry?.artifactIds).toContain("artifact-1");
    expect(sqlEntry?.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    expect(entries.find((entry) => entry.kind === "artifact")).toBeUndefined();
  });

  it("shows standalone artifact entries with dataset preview detail", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-2",
        type: "table",
        name: "第二次查询结果",
        preview_json: {
          columns: ["metric"],
          rows: [["100"]],
          row_count: 1,
        },
      },
    });

    const entries = buildTraceTimeline(run);
    const artifactEntry = entries.find((entry) => entry.kind === "artifact");
    expect(artifactEntry?.title).toBe("第二次查询结果");
    expect(artifactEntry?.artifactDetail).toEqual({
      type: "dataset",
      columns: ["metric"],
      rows: [["100"]],
    });
    expect(artifactEntry?.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("includes run failure entry with error message", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "RUN_ERROR",
      message: "连接超时",
    });

    const entries = buildTraceTimeline(run);
    expect(entries.at(-1)).toMatchObject({
      kind: "run_failed",
      errorMessage: "连接超时",
    });
  });

  it("shows failed badge when ACTIVITY STEP failed without tool call", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "STEP",
      messageId: "run-1:activity:step:sql-1",
      content: {
        step_id: "sql-1",
        title: "执行只读 SQL",
        tool_name: "run_sql_readonly",
        status: "failed",
        sql: "SELECT 1",
        error_message: "permission denied",
      },
    });

    const entry = buildTraceTimeline(run).find((item) => item.eventId === "sql-1");
    expect(entry).toMatchObject({
      summary: "执行失败。",
      toolStatus: "failed",
    });
  });
});
