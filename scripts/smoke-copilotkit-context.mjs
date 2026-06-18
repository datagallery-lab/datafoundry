import { extractDatasourceId, extractLastUserText } from "../apps/api/dist/run-input.js";

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

console.log("CopilotKit context smoke OK: datasource and user text extraction are stable");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
