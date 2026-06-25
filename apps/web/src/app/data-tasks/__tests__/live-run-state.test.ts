import { describe, expect, it } from "vitest";
import {
  accumulateSessionUsage,
  createInitialLiveRun,
  createInitialSessionUsage,
  deriveLiveSessionView,
  deriveRunUsage,
  resolveTokenUsageForEvent,
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

  it("parses slim artifact references without inline preview data", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-slim-1",
        type: "table",
        name: "SQL result audit-1",
        title: "SQL result audit-1",
        summary: "数据集，100 行",
        preview_available: true,
      },
    });

    expect(run.artifacts[0]).toMatchObject({
      id: "artifact-slim-1",
      title: "SQL result audit-1",
      type: "dataset",
      summary: "数据集，100 行",
    });
    expect(run.artifacts[0]?.detail).toBeUndefined();
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

  it("links batched sql artifacts to earliest unlinked sql tool after multiple tools", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-inspect-1",
      toolCallName: "inspect_schema",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-inspect-1",
      toolCallName: "inspect_schema",
      result: JSON.stringify({ tables: [{ name: "orders", columns: [] }] }),
    });

    for (const [toolCallId, rowCount] of [
      ["tool-sql-1", 2],
      ["tool-sql-2", 1],
    ] as const) {
      run = reduceLiveRunEvent(run, {
        type: "TOOL_CALL_START",
        toolCallId,
        toolCallName: "run_sql_readonly",
      });
      run = reduceLiveRunEvent(run, {
        type: "TOOL_CALL_RESULT",
        toolCallId,
        toolCallName: "run_sql_readonly",
        result: JSON.stringify({ row_count: rowCount, elapsed_ms: 5 }),
      });
    }

    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        type: "table",
        name: "Result A",
        preview_json: {
          columns: ["value"],
          rows: [["A1"], ["A2"]],
          row_count: 2,
        },
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-2",
        type: "table",
        name: "Result B",
        preview_json: {
          columns: ["value"],
          rows: [["B"]],
          row_count: 1,
        },
      },
    });

    expect(run.events.find((event) => event.id === "tool-sql-1")?.artifactIds).toEqual([
      "artifact-1",
    ]);
    expect(run.events.find((event) => event.id === "tool-sql-2")?.artifactIds).toEqual([
      "artifact-2",
    ]);
    expect(run.artifacts.find((artifact) => artifact.id === "artifact-1")?.detail).toEqual({
      type: "dataset",
      columns: ["value"],
      rows: [["A1"], ["A2"]],
    });
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

  it("parses file artifacts and links them to write_file tool calls", () => {
    let run = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "TOOL_CALL_START",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
      args: { path: "hello.txt", content: "hi" },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-write-1",
      result: JSON.stringify({ observation: "Wrote 2 bytes to hello.txt" }),
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-file-1",
        type: "file",
        name: "hello.txt",
        preview_json: {
          path: "hello.txt",
          size: 2,
          mtime: "2026-06-23T09:00:00.000Z",
          tool: "write_file",
        },
      },
    });

    expect(run.artifacts[0]).toMatchObject({
      id: "artifact-file-1",
      type: "file",
      kind: "file",
      detail: {
        type: "file",
        path: "hello.txt",
        size: 2,
        tool: "write_file",
      },
    });
    expect(run.events.find((event) => event.id === "tool-write-1")?.artifactIds).toEqual([
      "artifact-file-1",
    ]);
  });

  it("links write_file and edit_file artifacts to distinct tool calls", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
      result: JSON.stringify({ observation: "Wrote 47 bytes to test_dir/test.txt" }),
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-write",
        type: "file",
        name: "test_dir/test.txt",
        preview_json: {
          path: "test_dir/test.txt",
          size: 47,
          tool: "write_file",
        },
      },
    });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-edit-1",
      toolCallName: "edit_file",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-edit-1",
      toolCallName: "edit_file",
      result: JSON.stringify({
        observation: "Replaced 1 occurrence in test_dir/test.txt",
      }),
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-edit",
        type: "file",
        name: "test_dir/test.txt",
        preview_json: {
          path: "test_dir/test.txt",
          size: 46,
          tool: "edit_file",
        },
      },
    });

    expect(run.artifacts.find((artifact) => artifact.id === "artifact-write")?.createdByEventId).toBe(
      "tool-write-1",
    );
    expect(run.artifacts.find((artifact) => artifact.id === "artifact-edit")?.createdByEventId).toBe(
      "tool-edit-1",
    );
    expect(run.events.find((event) => event.id === "tool-write-1")?.artifactIds).toEqual([
      "artifact-write",
    ]);
    expect(run.events.find((event) => event.id === "tool-edit-1")?.artifactIds).toEqual([
      "artifact-edit",
    ]);
  });

  it("links file artifact when CUSTOM arrives before TOOL_CALL_RESULT", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-write",
        type: "file",
        name: "test_dir/test.txt",
        preview_json: {
          path: "test_dir/test.txt",
          size: 47,
          tool: "write_file",
        },
      },
    });
    expect(run.artifacts[0]?.createdByEventId).toBeUndefined();

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
      result: JSON.stringify({ observation: "Wrote 47 bytes to test_dir/test.txt" }),
    });

    expect(run.artifacts.find((artifact) => artifact.id === "artifact-write")?.createdByEventId).toBe(
      "tool-write-1",
    );
  });

  it("does not link edit_file artifact to write_file when write_file is still unlinked", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-write-1",
      toolCallName: "write_file",
      result: JSON.stringify({ observation: "Wrote 47 bytes to test_dir/test.txt" }),
    });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-edit-1",
      toolCallName: "edit_file",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-edit-1",
      toolCallName: "edit_file",
      result: JSON.stringify({
        observation: "Replaced 1 occurrence in test_dir/test.txt",
      }),
    });

    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-write",
        type: "file",
        name: "test_dir/test.txt",
        preview_json: { path: "test_dir/test.txt", size: 47, tool: "write_file" },
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-edit",
        type: "file",
        name: "test_dir/test.txt",
        preview_json: { path: "test_dir/test.txt", size: 46, tool: "edit_file" },
      },
    });

    expect(run.artifacts.find((artifact) => artifact.id === "artifact-write")?.createdByEventId).toBe(
      "tool-write-1",
    );
    expect(run.artifacts.find((artifact) => artifact.id === "artifact-edit")?.createdByEventId).toBe(
      "tool-edit-1",
    );
  });

  it("preserves run progress when RUN_STARTED resumes after suspension", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-inspect-1",
      toolCallName: "inspect_schema",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-inspect-1",
      toolCallName: "inspect_schema",
      result: JSON.stringify({ tables: [{ name: "orders", columns: [] }] }),
    });
    run = reduceLiveRunEvent(run, {
      type: "STATE_DELTA",
      delta: [{ op: "replace", path: "/runStatus", value: "suspended" }],
    });

    const resumed = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    expect(resumed.runStatus).toBe("running");
    expect(resumed.toolCalls).toHaveLength(1);
    expect(resumed.events).toHaveLength(1);
    expect(resumed.toolCalls[0]?.name).toBe("inspect_schema");
  });

  it("preserves orphan session artifacts when a new run starts", () => {
    const seeded = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "artifact",
      value: { id: "artifact-1", title: "旧产出", summary: "" },
    });

    const restarted = reduceLiveRunEvent(seeded, { type: "RUN_STARTED" });

    expect(restarted.artifacts).toHaveLength(1);
    expect(restarted.events).toEqual([]);
    expect(restarted.runStatus).toBe("running");
  });

  it("accumulates session tool calls when a new run starts in the same thread", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-1",
      toolCallName: "inspect_schema",
    });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });

    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    expect(run.toolCalls).toHaveLength(1);
    expect(run.runHistory).toHaveLength(1);
    expect(run.runHistory?.[0]?.toolCallEndIndex).toBe(1);
    expect(run.runStatus).toBe("running");
    expect(run.runFinishedAt).toBeUndefined();

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-2",
      toolCallName: "run_sql_readonly",
    });

    expect(run.toolCalls).toHaveLength(2);
  });

  it("resets to an idle empty run on first RUN_STARTED with no session activity", () => {
    const restarted = reduceLiveRunEvent(createInitialLiveRun(), { type: "RUN_STARTED" });

    expect(restarted.artifacts).toEqual([]);
    expect(restarted.events).toEqual([]);
    expect(restarted.toolCalls).toEqual([]);
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

  it("tracks token_usage model, cost, and step-level usage", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "token_usage",
      value: {
        step_number: 1,
        model: "qwen-plus",
        input_tokens: 1000,
        output_tokens: 250,
        cost_usd: 0.0123,
      },
    });

    const runUsage = deriveRunUsage(run);
    expect(runUsage.tokens).toMatchObject({
      inputTokens: 1000,
      outputTokens: 250,
      costUsd: 0.0123,
    });
    expect(runUsage.models).toEqual(["qwen-plus"]);

    const stepUsage = resolveTokenUsageForEvent(run, run.events[0] ?? null);
    expect(stepUsage).toMatchObject({
      reported: true,
      inputTokens: 1000,
      outputTokens: 250,
      costUsd: 0.0123,
      models: ["qwen-plus"],
      approximate: true,
    });
  });

  it("prefers tool_call_id over step_number when both are present", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-2",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "token_usage",
      value: {
        tool_call_id: "tool-sql-2",
        input_tokens: 50,
        output_tokens: 10,
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "token_usage",
      value: {
        step_number: 1,
        input_tokens: 900,
        output_tokens: 100,
      },
    });

    const firstStepUsage = resolveTokenUsageForEvent(run, run.events[0] ?? null);
    const secondStepUsage = resolveTokenUsageForEvent(run, run.events[1] ?? null);

    expect(firstStepUsage).toMatchObject({
      inputTokens: 900,
      outputTokens: 100,
      approximate: true,
    });
    expect(secondStepUsage).toMatchObject({
      inputTokens: 50,
      outputTokens: 10,
      approximate: undefined,
    });
  });

  it("preserves sql tool identity when bridged TOOL_CALL_RESULT omits toolCallName", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
      args: { sql: "SELECT * FROM orders LIMIT 10" },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_END",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
    });
    run = reduceLiveRunEvent(run, {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "STEP",
      content: {
        step_id: "sql-1",
        title: "执行只读 SQL",
        tool_name: "run_sql_readonly",
        status: "completed",
        output_type: "table",
        content: {
          columns: ["order_id"],
          rows: [["1"]],
          row_count: 1,
        },
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-1",
        type: "table",
        name: "SQL result audit-1",
        preview_json: {
          columns: ["order_id"],
          rows: [["1"]],
          row_count: 1,
        },
      },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-sql-1",
      content: JSON.stringify({
        columns: ["order_id"],
        rows: [["1"]],
        row_count: 1,
        elapsed_ms: 6,
      }),
    });

    expect(run.toolCalls[0]).toMatchObject({
      id: "tool-sql-1",
      name: "run_sql_readonly",
      stepId: "sql-1",
      status: "success",
    });
    expect(run.events.find((event) => event.id === "tool-sql-1")).toMatchObject({
      kind: "query",
      toolName: "run_sql_readonly",
      artifactIds: ["artifact-1"],
      stepId: "sql-1",
    });
    expect(run.artifacts[0]?.createdByEventId).toBe("tool-sql-1");
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

  it("does not link sql artifact to a failed tool call when artifact arrives after failure", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, { type: "RUN_STARTED" });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
      args: { sql: "SELECT * FROM orders" },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-sql-1",
      toolCallName: "run_sql_readonly",
      result: JSON.stringify({
        audit_log_id: "audit-success",
        row_count: 3,
        elapsed_ms: 6,
      }),
    });

    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_START",
      toolCallId: "tool-sql-2",
      toolCallName: "run_sql_readonly",
      args: { sql: "SELECT channel, COUNT(*) AS count FROM orders GROUP BY channel" },
    });
    run = reduceLiveRunEvent(run, {
      type: "TOOL_CALL_RESULT",
      toolCallId: "tool-sql-2",
      toolCallName: "run_sql_readonly",
      result: JSON.stringify({
        status: "error",
        error: "Only simple SELECT column list FROM table queries are supported for file/demo data sources.",
      }),
    });

    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "artifact",
      value: {
        id: "artifact-orders",
        type: "table",
        name: "SQL result audit-success",
        preview_json: {
          audit_log_id: "audit-success",
          columns: ["order_id", "channel"],
          rows: [["o_001", "search"]],
          row_count: 3,
        },
      },
    });

    expect(run.artifacts[0]?.createdByEventId).toBe("tool-sql-1");
    expect(run.events.find((event) => event.id === "tool-sql-1")?.artifactIds).toEqual([
      "artifact-orders",
    ]);
    expect(run.events.find((event) => event.id === "tool-sql-2")?.artifactIds).toBeUndefined();
    expect(run.events.find((event) => event.id === "tool-sql-2")?.payload).toMatchObject({
      sql: "SELECT channel, COUNT(*) AS count FROM orders GROUP BY channel",
      scannedRows: 0,
    });
  });

  it("stores workspace.metadata and sandbox.output CUSTOM events", () => {
    let run = createInitialLiveRun();
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "workspace.metadata",
      value: { toolCallId: "tc-1", toolName: "write_file", status: "ready" },
    });
    run = reduceLiveRunEvent(run, {
      type: "CUSTOM",
      name: "sandbox.output",
      value: { kind: "stdout", text: "verify-ok\n" },
    });

    expect(run.workspaceMetadata).toHaveLength(1);
    expect(run.workspaceMetadata[0]).toMatchObject({
      toolCallId: "tc-1",
      toolName: "write_file",
    });
    expect(run.sandboxOutputs).toHaveLength(1);
    expect(run.sandboxOutputs[0]).toMatchObject({ kind: "stdout" });
  });

  it("keeps suspended status when RUN_FINISHED follows ask_user suspension", () => {
    let run = reduceLiveRunEvent(createInitialLiveRun(), { type: "RUN_STARTED" });
    run = reduceLiveRunEvent(run, {
      type: "STATE_DELTA",
      delta: [{ op: "replace", path: "/runStatus", value: "suspended" }],
    });
    run = reduceLiveRunEvent(run, { type: "RUN_FINISHED" });

    expect(run.runStatus).toBe("suspended");
    expect(run.runFinishedAt).toBeTypeOf("number");
  });
});
