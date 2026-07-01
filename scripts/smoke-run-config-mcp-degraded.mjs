import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LLM_PROVIDER = "openai-compatible";
process.env.LLM_MODEL = "mcp-smoke-model";
process.env.LLM_API_KEY = "mcp-smoke-key";

import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { resolveRunConfig } from "../apps/api/dist/run-config-resolver.js";

const root = mkdtempSync(join(tmpdir(), "mcp-degraded-"));
const store = createMetadataStore({ database_path: join(root, "m.sqlite") });
store.users.upsertDevUser({ id: "dev-user", email: "dev@local", display_name: "dev", dev_token: "dev-token" });

const userId = "dev-user";
const workspaceId = "default";

try {
  store.configResources.upsert({
    id: "mcp-valid",
    workspace_id: workspaceId,
    user_id: userId,
    kind: "mcp-server",
    name: "valid MCP",
    payload: {
      transport: "streamable-http",
      serverUrl: "http://127.0.0.1:9999",
      toolManifest: [{ name: "ping" }]
    },
    default_enabled: true,
    status: "ready"
  });
  store.configResources.upsert({
    id: "mcp-broken",
    workspace_id: workspaceId,
    user_id: userId,
    kind: "mcp-server",
    name: "broken MCP",
    payload: {
      transport: "streamable-http",
      serverUrl: "http://127.0.0.1:9998"
    },
    default_enabled: true,
    status: "ready"
  });
  store.dataSources.create({
    id: "ds-1",
    user_id: userId,
    name: "ds",
    type: "sqlite",
    config: "{}",
    status: "ready",
    revision: 1
  });

  const resolved = resolveRunConfig({
    defaultDatasourceId: "ds-1",
    metadataStore: store,
    userId,
    userInput: "test",
    workspaceId,
    runInput: {
      threadId: "t1",
      runId: "r1",
      messages: [],
      context: [],
      state: {},
      forwardedProps: {
        run_config: {
          activeDatasourceId: "ds-1",
          enabledDatasourceIds: ["ds-1"],
          enabledMcpServerIds: ["mcp-valid", "mcp-broken"]
        }
      }
    }
  });

  const cfg = resolved.effectiveRunConfig;
  assert.deepEqual(cfg.enabledMcpServerIds, ["mcp-valid"], "broken MCP should be dropped from enabled set");
  assert.equal(resolved.mcpRuntime.servers.length, 1);
  assert.equal(resolved.mcpRuntime.servers[0]?.serverId, "mcp-valid");
  assert.ok(cfg.unavailableResources, "unavailableResources diagnostic should be populated");
  assert.equal(cfg.unavailableResources.length, 1);
  assert.equal(cfg.unavailableResources[0].id, "mcp-broken");
  assert.match(cfg.unavailableResources[0].reason, /MCP_TOOL_MANIFEST_REQUIRED:mcp-broken/);

  console.log("MCP degraded smoke OK: invalid MCP dropped, run continues with valid server");
} finally {
  store.close();
  rmSync(root, { force: true, recursive: true });
}
