import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRunWorkspace } from "../packages/agent-runtime/dist/tools/workspace-factory.js";
import { createCompatibleWorkspaceTools } from "../packages/agent-runtime/dist/tools/workspace-tool-input-compat.js";

const createTools = async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "datafoundry-workspace-input-compat-"));
  const runWorkspace = createRunWorkspace({
    runContext: {
      user_id: "workspace-input-test-user",
      workspace_id: "workspace-input-test-workspace",
      session_id: "workspace-input-test-session",
      run_id: "workspace-input-test-run",
      user_input: "list files",
      chat_mode: "copilotkit",
      enabled_datasource_ids: [],
      model_name: "test",
    },
    workspaceRoot,
  });
  await runWorkspace.workspace.init();
  const tools = await createCompatibleWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace,
  });
  return {
    runWorkspace,
    tools,
    workspaceRoot,
  };
};

const destroyTools = async ({ runWorkspace, workspaceRoot }) => {
  await runWorkspace.destroy().catch(() => undefined);
  rmSync(workspaceRoot, { force: true, recursive: true });
};

test("list_files accepts explicit numeric and boolean strings emitted by chat models", async () => {
  const fixture = await createTools();
  try {
    const executionContext = {
      context: { requestContext: new Map() },
      name: "list_files",
      workspace: fixture.runWorkspace.workspace,
    };
    await fixture.tools.write_file.execute(
      { path: "compatibility.txt", content: "ok" },
      { ...executionContext, name: "write_file" },
    );
    const modelInput = {
      path: ".",
      maxDepth: "2",
      showHidden: "false",
      dirsOnly: "false",
      exclude: "",
      extension: "",
      pattern: "",
      respectGitignore: "true",
    };
    const validation = await fixture.tools.list_files.inputSchema["~standard"].validate(modelInput);
    const modelInputSchema = fixture.tools.list_files.inputSchema["~standard"].jsonSchema.input({
      target: "draft-07",
    });

    assert.equal("issues" in validation, false);
    assert.equal(modelInputSchema.properties?.maxDepth?.type, "number");
    assert.equal(modelInputSchema.properties?.showHidden?.type, "boolean");
    assert.deepEqual(validation.value, {
      ...modelInput,
      maxDepth: 2,
      showHidden: false,
      dirsOnly: false,
      respectGitignore: true,
    });
    const output = await fixture.tools.list_files.execute(validation.value, executionContext);
    assert.match(String(output), /compatibility\.txt/);
  } finally {
    await destroyTools(fixture);
  }
});

test("list_files preserves native values and rejects ambiguous string coercions", async () => {
  const fixture = await createTools();
  try {
    assert.deepEqual(
      await fixture.tools.list_files.inputSchema.parseAsync({
        path: ".",
        maxDepth: 3,
        showHidden: true,
        dirsOnly: false,
        respectGitignore: true,
      }),
      {
        path: ".",
        maxDepth: 3,
        showHidden: true,
        dirsOnly: false,
        respectGitignore: true,
      },
    );

    for (const input of [
      { maxDepth: "two" },
      { showHidden: "yes" },
      { dirsOnly: "0" },
      { respectGitignore: "" },
    ]) {
      const validation = await fixture.tools.list_files.inputSchema.safeParseAsync({ path: ".", ...input });
      assert.equal(validation.success, false, `Expected ${JSON.stringify(input)} to remain invalid`);
    }
  } finally {
    await destroyTools(fixture);
  }
});

test("enabled workspace tools accept explicit strings for numeric and boolean fields", async () => {
  const fixture = await createTools();
  try {
    const cases = [
      {
        toolName: "read_file",
        input: { path: "sample.txt", offset: "1", limit: "2", showLineNumbers: "false" },
        expected: { path: "sample.txt", offset: 1, limit: 2, showLineNumbers: false },
      },
      {
        toolName: "write_file",
        input: { path: "sample.txt", content: "sample", overwrite: "false" },
        expected: { path: "sample.txt", content: "sample", overwrite: false },
      },
      {
        toolName: "edit_file",
        input: { path: "sample.txt", old_string: "a", new_string: "b", replace_all: "true" },
        expected: { path: "sample.txt", old_string: "a", new_string: "b", replace_all: true },
      },
      {
        toolName: "mkdir",
        input: { path: "reports", recursive: "false" },
        expected: { path: "reports", recursive: false },
      },
      {
        toolName: "grep",
        input: {
          pattern: "sample",
          path: ".",
          contextLines: "2",
          maxCount: "5",
          caseSensitive: "false",
          includeHidden: "true",
        },
        expected: {
          pattern: "sample",
          path: ".",
          contextLines: 2,
          maxCount: 5,
          caseSensitive: false,
          includeHidden: true,
        },
      },
      {
        toolName: "execute_command",
        input: { command: "pwd", timeout: "10", tail: "0", background: "false" },
        expected: { command: "pwd", timeout: 10, tail: 0, background: false },
      },
    ];

    for (const { toolName, input, expected } of cases) {
      const validation = await fixture.tools[toolName].inputSchema["~standard"].validate(input);
      assert.equal("issues" in validation, false, `${toolName}: ${JSON.stringify(validation)}`);
      assert.deepEqual(validation.value, expected);
    }
  } finally {
    await destroyTools(fixture);
  }
});
