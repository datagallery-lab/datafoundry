import { describe, expect, it } from "vitest";
import {
  accumulateSessionUsage,
  createInitialLiveRun,
  createInitialSessionUsage,
  deriveLiveSessionView,
  deriveRunUsage,
  reduceLiveRunEvent,
} from "../live-run-state";

describe("live run state reducer", () => {
  it("tracks plan activity snapshots and deltas", () => {
    const initial = createInitialLiveRun();
    const withPlan = reduceLiveRunEvent(initial, {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "PLAN",
      messageId: "run-1:activity:plan",
      replace: true,
      content: {
        tasks: [
          { id: "schema", title: "检查数据源 schema", status: "pending" },
          { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
        ],
      },
    });

    const updated = reduceLiveRunEvent(withPlan, {
      type: "ACTIVITY_DELTA",
      activityType: "PLAN",
      messageId: "run-1:activity:plan",
      patch: [{ op: "replace", path: "/tasks/1/status", value: "running" }],
    });

    expect(updated.plan).toEqual([
      { id: "schema", title: "检查数据源 schema", status: "pending" },
      { id: "sql", title: "生成并执行只读 SQL", status: "running" },
    ]);
  });

  it("captures sql audit and artifact custom events", () => {
    const initial = createInitialLiveRun();
    const withAudit = reduceLiveRunEvent(initial, {
      type: "CUSTOM",
      name: "sql_audit",
      value: {
        audit_log_id: "audit-1",
        datasource_id: "api-duckdb-demo",
        status: "success",
        row_count: 12,
        elapsed_ms: 34,
      },
    });

    const updated = reduceLiveRunEvent(withAudit, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        title: "查询结果",
        summary: "12 行结果",
      },
    });

    expect(updated.audits[0]).toMatchObject({
      id: "audit-1",
      datasourceId: "api-duckdb-demo",
      rowCount: 12,
      elapsedMs: 34,
      status: "success",
    });
    expect(updated.artifacts[0]).toMatchObject({
      id: "artifact-1",
      title: "查询结果",
      summary: "12 行结果",
    });
  });

  it("parses table preview_json and links artifact to sql tool call", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_END",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        type: "table",
        name: "SQL result audit-1",
        preview_json: {
          columns: ["id", "name"],
          rows: [
            ["1", "Alice"],
            ["2", "Bob"],
          ],
          row_count: 2,
        },
      },
    });

    expect(run.artifacts[0]).toMatchObject({
      id: "artifact-1",
      title: "SQL result audit-1",
      type: "dataset",
      createdByEventId: "tool-sql-1",
      detail: {
        type: "dataset",
        columns: ["id", "name"],
        rows: [
          ["1", "Alice"],
          ["2", "Bob"],
        ],
      },
    });
    expect(run.events.find((event) => event.id === "tool-sql-1")?.artifactIds).toEqual([
      "artifact-1",
    ]);
    expect(run.toolCalls[0]?.startedAtMs).toBeTypeOf("number");
    expect(run.toolCalls[0]?.finishedAtMs).toBeUndefined();
  });

  it("links multiple sql artifacts to distinct tool calls", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    for (const [toolCallId, artifactId, value] of [
      ["tool-sql-1", "artifact-1", "A"],
      ["tool-sql-2", "artifact-2", "B"],
    ] as const) {
      run = reduceLiveRunEvent(run, {
        type: "TOOL_CALL_START",
        toolCallId,
        toolCallName: "run_sql_readonly",
      });
      run = reduceLiveRunEvent(run, {
        type: "TOOL_CALL_END",
        toolCallId,
        toolCallName: "run_sql_readonly",
      });
      run = reduceLiveRunEvent(run, {
        type: "CUSTOM",
        name: "artifact",
        value: {
          id: artifactId,
          type: "table",
          name: `Result ${value}`,
          preview_json: {
            columns: ["value"],
            rows: [[value]],
            row_count: 1,
          },
        },
      });
    }

    expect(run.events.find((event) => event.id === "tool-sql-1")?.artifactIds).toEqual([
      "artifact-1",
    ]);
    expect(run.events.find((event) => event.id === "tool-sql-2")?.artifactIds).toEqual([
      "artifact-2",
    ]);
    expect(run.artifacts.find((artifact) => artifact.id === "artifact-2")?.detail).toEqual({
      type: "dataset",
      columns: ["value"],
      rows: [["B"]],
    });
  });

  it("captures an artifact custom event without fabricating extra state", () => {
    const initial = createInitialLiveRun();
    const withArtifact = reduceLiveRunEvent(initial, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        title: "查询结果",
        summary: "12 行结果",
      },
    });

    expect(withArtifact.artifacts).toHaveLength(1);
  });

  it("resets to an idle empty run on RUN_STARTED", () => {
    const seeded = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-1", title: "旧产出", summary: "" },
    });

    const restarted = reduceLiveRunEvent(seeded, { type: "RUN_STARTED" });

    expect(restarted.artifacts).toEqual([]);
    expect(restarted.events).toEqual([]);
    expect(restarted.runStatus).toBe("running");
  });

  it("keeps tool call execution details in timeline events", () => {
    const initial = createInitialLiveRun();
    const withArgs = reduceLiveRunEvent(initial, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-1",
      toolCallName: "run_sql_readonly",
      args: {
        sql: "SELECT count(*) AS total FROM orders",
      },
    });

    const updated = reduceLiveRunEvent(withArgs, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-1",
      toolCallName: "run_sql_readonly",
      result: "total: 42",
    });

    expect(updated.events[0]).toMatchObject({
      id: "tool-1",
      kind: "query",
      toolName: "run_sql_readonly",
      title: "生成并执行 SQL",
      summary: "total: 42",
      payload: {
        sql: "SELECT count(*) AS total FROM orders",
      },
    });
    expect(updated.toolCalls[0]).toMatchObject({
      id: "tool-1",
      name: "run_sql_readonly",
      status: "success",
      result: "total: 42",
      startedAtMs: expect.any(Number),
      finishedAtMs: expect.any(Number),
    });
  });

  it("derives run usage and accumulates session stats", () => {
    let run = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "RUN_STARTED",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "sql_audit",
      value: {
        audit_log_id: "audit-1",
        status: "success",
        row_count: 100,
        elapsed_ms: 50,
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-1", title: "结果", summary: "" },
    });
    run = reduceLiveRunEvent(run, {
      type: "RUN_FINISHED",
    });

    const runUsage = deriveRunUsage(run);
    expect(runUsage.toolCalls.total).toBe(1);
    expect(runUsage.sql.total).toBe(1);
    expect(runUsage.sql.rowsScanned).toBe(100);
    expect(runUsage.artifactCount).toBe(1);

    const session = accumulateSessionUsage(
      createInitialSessionUsage(),
      runUsage,
      "completed",
    );
    expect(session.runCount).toBe(1);
    expect(session.completedRuns).toBe(1);
    expect(session.toolCalls.total).toBe(1);
    expect(session.sql.rowsScanned).toBe(100);
    expect(session.artifactCount).toBe(1);
  });

  it("deriveLiveSessionView merges in-progress run without double-counting completed", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_END",
      toolCallId: "tool-1",
    });

    const session = createInitialSessionUsage();
    const view = deriveLiveSessionView(session, run);
    expect(view.includesInProgressRun).toBe(true);
    expect(view.runCount).toBe(1);
    expect(view.toolCalls.total).toBe(1);

    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });
    const runUsage = deriveRunUsage(run);
    const accumulated = accumulateSessionUsage(session, runUsage, "completed");
    const settled = deriveLiveSessionView(accumulated, run);
    expect(settled.includesInProgressRun).toBe(false);
    expect(settled.runCount).toBe(1);
    expect(settled.toolCalls.total).toBe(1);
  });

  it("accumulates token_usage custom events into run and session stats", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "token_usage",
      value: { input_tokens: 1200, output_tokens: 340 },
    });

    const runUsage = deriveRunUsage(run);
    expect(runUsage.tokenUsageReported).toBe(true);
    expect(runUsage.tokens.inputTokens).toBe(1200);
    expect(runUsage.tokens.outputTokens).toBe(340);

    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });
    const finishedUsage = deriveRunUsage(run);
    const session = accumulateSessionUsage(
      createInitialSessionUsage(),
      finishedUsage,
      "completed",
    );
    expect(session.tokenUsageReported).toBe(true);
    expect(session.tokens.inputTokens).toBe(1200);
    expect(session.tokens.outputTokens).toBe(340);
  });

  it("correlates ACTIVITY STEP with toolCallId and keeps failed status consistent", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
      args: { sql: "SELECT 1" },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_END",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
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
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });

    expect(run.events).toHaveLength(1);
    expect(run.events[0]).toMatchObject({
      id: "tool-sql-1",
      stepId: "sql-1",
      activityStatus: "failed",
      summary: "执行失败。",
      payload: {
        sql: "SELECT 1",
        errorMessage: "permission denied",
      },
    });
    expect(run.toolCalls[0]).toMatchObject({
      id: "tool-sql-1",
      stepId: "sql-1",
      status: "failed",
    });
  });
});
