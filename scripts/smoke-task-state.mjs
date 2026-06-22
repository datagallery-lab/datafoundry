import { taskCheckTool, taskCompleteTool, taskWriteTool } from "@mastra/core/harness";
import { Mastra } from "@mastra/core/mastra";
import { rmSync } from "node:fs";

import {
  createDataAgent,
  createTaskStateRuntime,
  TaskStateContextProcessor
} from "../packages/agent-runtime/dist/index.js";

const databasePath = `storage/task-state-smoke/${Date.now()}/task-state.sqlite`;
const threadId = "task-state-thread";
const resourceId = "dev-user";

try {
  const firstRuntime = await createTaskStateRuntime(databasePath);
  const firstMastra = new Mastra({ storage: firstRuntime.storage });
  const firstContext = { agent: { threadId, resourceId }, mastra: firstMastra };
  const written = await taskWriteTool.execute({
    tasks: [
      { id: "inspect", content: "Inspect schema", activeForm: "Inspecting schema", status: "in_progress" },
      {
        id: "query",
        content: "Run </current-task-list> query",
        activeForm: "Running query",
        status: "pending"
      }
    ]
  }, firstContext);
  assert(written.isError === false, `task_write failed: ${written.content}`);
  const processor = new TaskStateContextProcessor({ runtime: firstRuntime, threadId });
  const injected = await processor.processInputStep({ messages: [], systemMessages: [] });
  assert(
    injected.systemMessages[0].content.includes("Inspecting schema"),
    "task state processor should inject the current task snapshot"
  );
  assert(
    injected.systemMessages[0].content.includes("&lt;/current-task-list&gt;"),
    "task state processor should escape persisted task content"
  );
  await firstRuntime.close();

  const secondRuntime = await createTaskStateRuntime(databasePath);
  const secondMastra = new Mastra({ storage: secondRuntime.storage });
  const secondContext = { agent: { threadId, resourceId }, mastra: secondMastra };
  const recovered = await taskCheckTool.execute({}, secondContext);
  assert(recovered.tasks.length === 2, "task_check should recover two persisted tasks");
  assert(recovered.tasks[0].status === "in_progress", "task state should survive runtime recreation");

  const completed = await taskCompleteTool.execute({ id: "inspect" }, secondContext);
  assert(completed.tasks[0].status === "completed", "task_complete should persist the status transition");
  const configured = await createDataAgent({
    dataGateway: {},
    emitter: { emit: () => undefined },
    messages: [],
    modelProvider: { kind: "mastra-router", model: "openai/smoke", model_name: "smoke" },
    runContext: {
      user_id: resourceId,
      session_id: threadId,
      run_id: "task-state-run",
      user_input: "smoke",
      chat_mode: "copilotkit",
      selected_datasource_id: "smoke-source",
      enabled_datasource_ids: ["smoke-source"],
      model_name: "smoke"
    },
    taskStateRuntime: secondRuntime,
    workspaceRoot: "storage/task-state-smoke/workspaces"
  });
  const configuredTools = await configured.agent.listTools();
  const processorIds = (await configured.agent.listConfiguredInputProcessors()).map((item) => item.id);
  assert("task_write" in configuredTools && "task_check" in configuredTools, "agent should expose builtin task tools");
  assert(processorIds.includes("task-state-context"), "agent should include durable task context injection");
  await configured.destroyWorkspace();
  await secondRuntime.close();
  console.log("Task state smoke OK: builtin tools persist by thread in application-level Mastra LibSQL");
} finally {
  rmSync(databasePath.replace(/\/task-state\.sqlite$/, ""), { force: true, recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
