import { createWorkspaceTools } from "@mastra/core/workspace";
import { rmSync } from "node:fs";
import path from "node:path";

import { createRunWorkspace } from "../packages/agent-runtime/dist/tools/workspace-factory.js";

const runContext = {
  user_id: "workspace-smoke-user",
  session_id: "workspace-smoke-session",
  run_id: "workspace-smoke-run-001",
  selected_datasource_id: "smoke-source",
  enabled_datasource_ids: ["smoke-source"],
  user_input: "smoke",
  chat_mode: "copilotkit",
  model_name: "smoke"
};

const workspaceRoot = "storage/workspace-smoke";
let runDir;

try {
  const runWorkspace = createRunWorkspace({ runContext, workspaceRoot });
  runDir = runWorkspace.runDir;

  assert(runDir.startsWith(path.resolve(workspaceRoot)), "runDir should live under the configured workspace root");
  assert(["bwrap", "seatbelt", "none"].includes(runWorkspace.isolation), "isolation backend should be detected");

  const expectedTools = [
    "read_file",
    "write_file",
    "edit_file",
    "list_files",
    "file_stat",
    "mkdir",
    "grep",
    "execute_command"
  ];

  await runWorkspace.workspace.init();
  assert(runWorkspace.workspace.status === "ready", "workspace should reach ready status after init");

  const tools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  for (const name of expectedTools) {
    assert(name in tools, `workspace should inject the ${name} tool`);
  }

  const execCtx = {
    context: { requestContext: new Map() },
    mastra: undefined,
    agentName: "workspace-smoke",
    name: "execute_command"
  };

  await tools.write_file.execute({ path: "greeting.txt", content: "hello-from-sandbox" }, execCtx);
  const readBack = await tools.read_file.execute({ path: "greeting.txt" }, execCtx);
  assert(
    String(readBack).includes("hello-from-sandbox"),
    "read_file should return what write_file wrote"
  );

  const listed = await tools.list_files.execute({ path: "." }, execCtx);
  assert(
    String(listed).includes("greeting.txt"),
    "list_files should enumerate the written file"
  );

  if (runWorkspace.commandExecutionEnabled) {
    const echo = await tools.execute_command.execute({ command: "echo exec-ok" }, execCtx);
    assert(String(echo).includes("exec-ok"), "execute_command should run commands inside the sandbox");

    const networkResult = await tools.execute_command.execute(
      { command: "curl -s --max-time 2 https://example.invalid || echo NET_BLOCKED" },
      execCtx
    );
    assert(
      String(networkResult).includes("NET_BLOCKED"),
      "execute_command should deny outbound network access"
    );
  } else {
    console.log("execute_command disabled by environment; skipping sandbox execution assertions");
  }

  let escaped = false;
  try {
    await createRunWorkspace({
      runContext: {
        ...runContext,
        user_id: "../escape-attempt"
      },
      workspaceRoot
    });
    escaped = true;
  } catch (error) {
    assert(
      /INVALID_WORKSPACE_USER_ID|WORKSPACE_PATH_ESCAPE/.test(error instanceof Error ? error.message : String(error)),
      "workspace factory should reject path-traversal run identities"
    );
  }
  assert(!escaped, "workspace factory must not accept path-traversing run identifiers");

  await runWorkspace.workspace.destroy();
  assert(runWorkspace.workspace.status === "destroyed", "workspace should reach destroyed status after destroy");

  console.log(
    `Workspace tools smoke OK: tools=${expectedTools.length}, isolation=${runWorkspace.isolation}, `
      + `commandExecutionEnabled=${runWorkspace.commandExecutionEnabled}, runDir=${runDir}`
  );
} finally {
  rmSync(path.resolve(workspaceRoot), { force: true, recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
