import assert from "node:assert/strict";
import { test } from "node:test";

import { datalinkEnabled, resolveDatalinkEnv } from "./datalink-stack-config.mjs";

test("DataLink is opt-in", () => {
  assert.equal(datalinkEnabled({}), false);
  assert.equal(datalinkEnabled({ DATALINK_ENABLED: "true" }), true);
  assert.equal(datalinkEnabled({ DATALINK_ENABLED: "1" }), true);
  assert.equal(datalinkEnabled({ DATALINK_ENABLED: "false" }), false);
});

test("DataLink paths and ports have repository-owned defaults", () => {
  const env = resolveDatalinkEnv("/repo", {});
  assert.equal(env.DATALINK_CONFIG_PATH, "/repo/services/datalink/datalink_config.json");
  assert.equal(env.DATALINK_GRAPH_DB_PATH, "/repo/storage/datalink/datalink.db");
  assert.equal(env.DATALINK_API_PORT, "8081");
  assert.equal(env.DATALINK_MCP_PORT, "8080");
});

test("invalid DataLink ports fail before processes start", () => {
  assert.throws(
    () => resolveDatalinkEnv("/repo", { DATALINK_API_PORT: "70000" }),
    /DATALINK_API_PORT/,
  );
});
