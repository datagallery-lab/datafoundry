import { EventType } from "@ag-ui/core";
import { extractDatasourceId, extractEffectiveRunConfig, extractLastUserText } from "../apps/api/dist/run-input.js";
import { TaskPlanProjector } from "../apps/api/dist/task-plan-projector.js";

const baseInput = {
  threadId: "thread-smoke",
  runId: "run-smoke",
  messages: [],
  context: [],
  forwardedProps: {},
  state: {}
};

assert(
  extractDatasourceId({
    ...baseInput,
    forwardedProps: { datasourceId: "from-forwarded-camel" },
    state: { datasourceId: "from-state" },
    context: [{ description: "datasource_id", value: "from-context" }]
  }) === "from-forwarded-camel",
  "forwardedProps.datasourceId should win"
);
assert(
  extractDatasourceId({
    ...baseInput,
    forwardedProps: { datasource_id: "from-forwarded-snake" }
  }) === "from-forwarded-snake",
  "forwardedProps.datasource_id should be supported"
);
assert(
  extractDatasourceId({
    ...baseInput,
    state: { datasource_id: "from-state-snake" },
    context: [{ description: "datasource_id", value: "from-context" }]
  }) === "from-state-snake",
  "state.datasource_id should win over context"
);
assert(
  extractDatasourceId({
    ...baseInput,
    context: [{ description: "datasource_id", value: "from-context" }]
  }) === "from-context",
  "context datasource_id should be supported"
);
assert(
  extractLastUserText({
    ...baseInput,
    messages: [
      { role: "user", content: "older" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "latest" }
    ]
  }) === "latest",
  "latest user string message should be selected"
);
assert(
  extractLastUserText({
    ...baseInput,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "分析" },
          { type: "text", text: "orders 表" }
        ]
      }
    ]
  }) === "分析\norders 表",
  "multi-part user text should be joined"
);

const effectiveConfig = extractEffectiveRunConfig({
  ...baseInput,
  forwardedProps: {
    run_config: {
      activeDatasourceId: "orders-db",
      enabledDatasourceIds: ["orders-db", "warehouse"],
      activeSkillId: "data-analysis",
      goal: { objective: "Produce a verified orders analysis", maxRuns: 4 }
    }
  }
}, "default-db");
assert(effectiveConfig.activeDatasourceId === "orders-db", "run_config active datasource should be resolved");
assert(effectiveConfig.enabledDatasourceIds.length === 2, "run_config enabled datasources should be preserved");
assert(effectiveConfig.goal?.maxRuns === 4, "trusted goal config should be parsed and bounded");

const projector = new TaskPlanProjector({
  user_id: "dev-user",
  session_id: "thread-smoke",
  run_id: "run-smoke",
  user_input: "analyze orders",
  chat_mode: "copilotkit",
  selected_datasource_id: "orders-db",
  enabled_datasource_ids: ["orders-db"],
  model_name: "smoke-model"
});
assert(projector.observe({
  type: EventType.TOOL_CALL_START,
  toolCallId: "task-call-1",
  toolCallName: "task_write"
}).length === 0, "task tool start should not emit a plan");
const projected = projector.observe({
  type: EventType.TOOL_CALL_RESULT,
  messageId: "tool-message-1",
  toolCallId: "task-call-1",
  content: JSON.stringify({
    tasks: [{ id: "inspect", content: "Inspect schema", activeForm: "Inspecting schema", status: "in_progress" }]
  })
});
assert(projected.length === 1, "task result should emit one PLAN snapshot");
assert(projected[0].activityType === "PLAN", "projected activity should use PLAN type");
assert(projected[0].content.tasks[0].status === "running", "in_progress should map to AG-UI running");

console.log("CopilotKit context smoke OK: run config, user text, and task PLAN projection are stable");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
