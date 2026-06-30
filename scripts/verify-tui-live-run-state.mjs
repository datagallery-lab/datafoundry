#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  createInitialLiveRun,
  reduceLiveRunEvent,
} = await import("../apps/tui/dist/state/live-run-state.js");

function startSqlRun() {
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
  return run;
}

{
  let run = startSqlRun();
  run = reduceLiveRunEvent(run, {
    type: "TOOL_CALL_RESULT",
    toolCallId: "tool-sql-1",
    content: JSON.stringify({ row_count: 1, elapsed_ms: 6 }),
  });

  assert.equal(run.toolCalls.length, 1);
  assert.equal(run.toolCalls[0].id, "tool-sql-1");
  assert.equal(run.toolCalls[0].name, "run_sql_readonly");
  assert.equal(run.toolCalls[0].status, "success");
  assert.equal(run.events[0].kind, "query");
  assert.equal(run.events[0].toolName, "run_sql_readonly");
}

{
  let run = startSqlRun();
  run = reduceLiveRunEvent(run, {
    type: "TOOL_CALL_RESULT",
    content: JSON.stringify({ error: "SQL execution failed" }),
  });

  assert.equal(run.toolCalls.length, 1);
  assert.equal(run.toolCalls[0].id, "tool-sql-1");
  assert.equal(run.toolCalls[0].name, "run_sql_readonly");
  assert.equal(run.toolCalls[0].status, "failed");
}

console.log("TUI live-run-state regression checks passed.");
