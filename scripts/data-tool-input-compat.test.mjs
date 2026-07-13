import assert from "node:assert/strict";
import test from "node:test";

import { createDataFoundryToolRegistry } from "../packages/agent-runtime/dist/testing.js";

const createListDataSourcesTool = () => {
  const gatewayInputs = [];
  const registry = createDataFoundryToolRegistry({
    dataGateway: {
      listDataSources: async (input) => {
        gatewayInputs.push(input);
        return [{ id: "enabled-source", name: "Enabled", status: "ready" }];
      },
    },
    emitter: { emit: () => undefined },
    runContext: {
      user_id: "tool-input-test-user",
      session_id: "tool-input-test-session",
      run_id: "tool-input-test-run",
      user_input: "list data sources",
      chat_mode: "chat_data",
      enabled_datasource_ids: ["enabled-source"],
    },
  });
  return { gatewayInputs, tool: registry.mastraTools.list_data_sources };
};

const createPreviewTableTool = () => {
  const gatewayInputs = [];
  const schemaId = "schema_4c67585c-8dd7-4838-a9f4-e3d388802d1b";
  const registry = createDataFoundryToolRegistry({
    dataGateway: {
      previewTable: async (input) => {
        gatewayInputs.push(input);
        return {
          columns: ["value"],
          rows: [[1]],
          row_count: 1,
        };
      },
    },
    emitter: { emit: () => undefined },
    runContext: {
      user_id: "tool-input-test-user",
      session_id: "tool-input-test-session",
      run_id: "tool-input-test-run",
      user_input: "preview table",
      chat_mode: "chat_data",
      enabled_datasource_ids: ["enabled-source"],
    },
  });
  registry.state.schema_capabilities.set(schemaId, {
    datasource_id: "enabled-source",
    schema_id: schemaId,
  });
  return { gatewayInputs, schemaId, tool: registry.mastraTools.preview_table };
};

const createRunSqlTool = () => {
  const gatewayInputs = [];
  const schemaId = "schema_c6943207-11c1-4e46-a3ec-f597023f21a1";
  const registry = createDataFoundryToolRegistry({
    dataGateway: {
      runSqlReadonly: async (input) => {
        gatewayInputs.push(input);
        return {
          columns: ["value"],
          rows: [[1]],
          row_count: 1,
          audit_log_id: "tool-input-test-audit",
          elapsed_ms: 1,
        };
      },
    },
    emitter: { emit: () => undefined },
    runContext: {
      user_id: "tool-input-test-user",
      session_id: "tool-input-test-session",
      run_id: "tool-input-test-run",
      user_input: "run SQL",
      chat_mode: "chat_data",
      enabled_datasource_ids: ["enabled-source"],
    },
  });
  registry.state.schema_capabilities.set(schemaId, {
    datasource_id: "enabled-source",
    schema_id: schemaId,
  });
  return { gatewayInputs, schemaId, tool: registry.mastraTools.run_sql_readonly };
};

test("list_data_sources accepts explicit string booleans emitted by chat models", async () => {
  const { gatewayInputs, tool } = createListDataSourcesTool();

  const falseValidation = await tool.inputSchema["~standard"].validate({ enabled_only: "False" });
  const trueValidation = await tool.inputSchema["~standard"].validate({ enabled_only: " TRUE " });
  assert.equal("issues" in falseValidation, false);
  assert.equal("issues" in trueValidation, false);
  const falseInput = falseValidation.value;
  const trueInput = trueValidation.value;
  await tool.execute(falseInput, {});
  await tool.execute(trueInput, {});

  assert.deepEqual(falseInput, { enabled_only: false });
  assert.deepEqual(trueInput, { enabled_only: true });
  assert.equal(gatewayInputs[0]?.enabled_only, false);
  assert.equal(gatewayInputs[1]?.enabled_only, true);
});

test("list_data_sources preserves native booleans and rejects ambiguous coercions", async () => {
  const { tool } = createListDataSourcesTool();

  assert.deepEqual(await tool.inputSchema.parseAsync({ enabled_only: false }), { enabled_only: false });
  assert.deepEqual(await tool.inputSchema.parseAsync({}), {});

  for (const enabledOnly of ["yes", "0", "", 0, 1]) {
    const parsed = await tool.inputSchema.safeParseAsync({ enabled_only: enabledOnly });
    assert.equal(parsed.success, false, `Expected ${JSON.stringify(enabledOnly)} to remain invalid`);
  }
});

test("preview_table accepts positive integer strings emitted by chat models", async () => {
  const { gatewayInputs, schemaId, tool } = createPreviewTableTool();
  const modelInputSchema = tool.inputSchema["~standard"].jsonSchema.input({ target: "draft-07" });
  const validation = await tool.inputSchema["~standard"].validate({
    limit: "10",
    schema_id: schemaId,
    table: "dws_grid_data_menu_sb_bdz_v",
  });

  assert.equal(modelInputSchema.properties?.limit?.type, "integer");
  assert.equal("issues" in validation, false);
  assert.deepEqual(validation.value, {
    limit: 10,
    schema_id: schemaId,
    table: "dws_grid_data_menu_sb_bdz_v",
  });
  await tool.execute(validation.value, {});
  assert.equal(gatewayInputs[0]?.limit, 10);
});

test("preview_table preserves native integers and rejects ambiguous numeric coercions", async () => {
  const { schemaId, tool } = createPreviewTableTool();

  assert.deepEqual(
    await tool.inputSchema.parseAsync({
      schema_id: schemaId,
      table: "orders",
      limit: 10,
    }),
    { schema_id: schemaId, table: "orders", limit: 10 },
  );

  for (const value of ["", "0", "-1", "+1", "1.5", "1e3", "NaN", true, null]) {
    const parsed = await tool.inputSchema.safeParseAsync({
      schema_id: schemaId,
      table: "orders",
      limit: value,
    });
    assert.equal(parsed.success, false, `Expected ${JSON.stringify(value)} to remain invalid`);
  }
});

test("run_sql_readonly accepts and safely bounds integer strings emitted by chat models", async () => {
  const { gatewayInputs, schemaId, tool } = createRunSqlTool();
  const validation = await tool.inputSchema["~standard"].validate({
    limit: "2147483647",
    schema_id: schemaId,
    sql: "SELECT * FROM dws_grid_data_menu_sb_bdz_v LIMIT 1",
    timeout_ms: "2147483647",
  });

  assert.equal("issues" in validation, false);
  assert.deepEqual(validation.value, {
    limit: 1000,
    schema_id: schemaId,
    sql: "SELECT * FROM dws_grid_data_menu_sb_bdz_v LIMIT 1",
    timeout_ms: 30000,
  });
  await tool.execute(validation.value, {});
  assert.equal(gatewayInputs[0]?.limit, 1000);
  assert.equal(gatewayInputs[0]?.timeout_ms, 30000);
});

test("run_sql_readonly rejects ambiguous numeric coercions", async () => {
  const { schemaId, tool } = createRunSqlTool();

  for (const value of ["", "0", "-1", "+1", "1.5", "1e3", "NaN", true, null]) {
    const parsed = await tool.inputSchema.safeParseAsync({
      schema_id: schemaId,
      sql: "SELECT 1",
      limit: value,
    });
    assert.equal(parsed.success, false, `Expected ${JSON.stringify(value)} to remain invalid`);
  }
});
