import {
  createDataAgentRunContext,
  createDataAgentToolRegistry,
  ContextBudgetAllocator,
  ContextOrchestrator,
  ContextPolicy,
  ContextSourceRegistry,
  SchemaContextAdapter,
  SqlResultContextAdapter
} from "../packages/agent-runtime/dist/index.js";
import { LocalDataGateway } from "../packages/data-gateway/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { EventType } from "@ag-ui/core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const stamp = Date.now();
const metadataPath = `storage/agent-smoke/${stamp}/metadata.sqlite`;
const sqlitePath = `storage/agent-smoke/${stamp}/large.sqlite`;
const store = createMetadataStore({ database_path: metadataPath });
const gateway = new LocalDataGateway(store);

const user_id = "dev-user";
const session_id = "agent-smoke-session";
const run_id = "agent-smoke-run";
const datasource_id = "agent-sqlite-large";

try {
  createLargeSqliteFixture(sqlitePath);
  await gateway.registerDataSource({
    user_id,
    id: datasource_id,
    name: "Agent SQLite Large",
    type: "sqlite",
    config: { path: sqlitePath }
  });
  store.sessions.create({
    user_id,
    id: session_id,
    title: "Agent smoke",
    selected_datasource_id: datasource_id
  });
  store.runs.create({
    user_id,
    id: run_id,
    session_id,
    user_input: "分析 orders 表的 GMV",
    status: "running",
    datasource_id
  });

  let seq = 0;
  const events = [];
  const runContext = createDataAgentRunContext({
    user_id,
    session_id,
    run_id,
    user_input: "分析 orders 表的 GMV",
    chat_mode: "chat_data",
    selected_datasource_id: datasource_id
  });

  // Create context orchestrator
  const budgetAllocator = new ContextBudgetAllocator();
  const sourceRegistry = new ContextSourceRegistry();
  const policy = new ContextPolicy();
  const orchestrator = new ContextOrchestrator(budgetAllocator, sourceRegistry, policy);
  sourceRegistry.registerToolAdapter(new SchemaContextAdapter());
  sourceRegistry.registerToolAdapter(new SqlResultContextAdapter());

  const registry = createDataAgentToolRegistry({
    dataGateway: gateway,
    runContext,
    orchestrator,
    emitter: {
      emit: (event) => {
        seq += 1;
        events.push({
          event,
          run_id,
          session_id,
          seq,
          ts: new Date().toISOString()
        });
      }
    }
  });

  await assertRejects(
    () =>
      registry.runSqlReadonly({
        sql: "SELECT id, note FROM big_orders",
        limit: 20
      }),
    "SCHEMA_REQUIRED_BEFORE_SQL"
  );

  const schemaPkg = await registry.inspectSchema();
  const schema = schemaPkg.model;
  const table = schema.tables[0];
  const selectedColumns = table?.columns.slice(0, 3).map((column) => column.name) ?? ["*"];
  const sql = `SELECT ${selectedColumns.join(", ")} FROM ${table?.name ?? "big_orders"} ORDER BY id`;
  const sqlPkg = await registry.runSqlReadonly({ sql, limit: 100 });
  const sqlResult = sqlPkg.model;

  const schemaActivity = events.find(
    (record) => record.event.type === EventType.ACTIVITY_SNAPSHOT && record.event.content?.tool_name === "inspect_schema"
  );
  const sqlActivity = events.find(
    (record) => record.event.type === EventType.ACTIVITY_SNAPSHOT && record.event.content?.tool_name === "run_sql_readonly"
  );
  const sqlMeta = events.find(
    (record) => record.event.type === EventType.ACTIVITY_SNAPSHOT && typeof record.event.content?.sql === "string"
  );
  const tableOutput = events.find(
    (record) => record.event.type === EventType.ACTIVITY_SNAPSHOT && record.event.content?.output_type === "table"
  );
  const sqlAudit = events.find(
    (record) => record.event.type === EventType.CUSTOM && record.event.name === "sql_audit"
  );
  const artifactEvent = events.find(
    (record) => record.event.type === EventType.CUSTOM && record.event.name === "artifact"
  );
  const planDeltas = events.filter((record) => record.event.type === EventType.ACTIVITY_DELTA);
  const legacyEvent = events.find((record) => String(record.event.type).includes("."));
  const auditLogs = store.sqlAuditLogs.listByDataSource({ user_id, datasource_id });

  assert(Boolean(schemaActivity), "inspect_schema activity was not emitted");
  assert(Boolean(sqlActivity), "run_sql_readonly activity was not emitted");
  assert(Boolean(sqlMeta), "SQL activity metadata was not emitted");
  assert(Boolean(tableOutput), "table activity output was not emitted");
  assert(Boolean(sqlAudit), "SQL audit custom event was not emitted");
  assert(Boolean(artifactEvent), "artifact custom event was not emitted");
  assert("preview_json" in artifactEvent.event.value, "artifact event should expose preview data until workspace integration");
  assert(
    artifactEvent.event.value.preview_json.row_count === 100,
    "artifact event preview should preserve the stored SQL row count"
  );
  assert(sqlResult.rows.length === 20, `model-visible SQL rows should be 20, got ${sqlResult.rows.length}`);
  assert(sqlResult.row_count === 100, `SQL row_count should preserve original count, got ${sqlResult.row_count}`);
  assert(sqlResult.context?.truncation.truncated === true, "model-visible SQL result should include truncation metadata");
  assert(Boolean(sqlResult.artifact_id), "SQL result should keep artifact reference after truncation");
  assert(!("artifact" in sqlResult), "model-visible SQL result must not contain artifact preview data");
  assert(sqlPkg.artifactRefs.length === 1, "SQL context package should expose one artifact reference");
  assert(sqlPkg.auditRefs.length === 1, "SQL context package should expose one audit reference");
  assert(
    sqlPkg.truncation.some((entry) => entry.reason.includes("Truncated") && entry.reason.includes("cell")),
    "SQL context package should report cell truncation"
  );
  assert(schemaActivity.event.replace === true, "schema activity should replace previous snapshots");
  assert(sqlActivity.event.replace === true, "SQL activity should replace previous snapshots");
  assert(tableOutput.event.content.content.rows.length === 20, "activity table preview should be truncated to 20 rows");
  assert(tableOutput.event.content.content.context?.truncation.truncated === true, "activity output truncation metadata missing");
  assert(
    String(tableOutput.event.content.content.rows[0][2]).length <= 600,
    "activity output should truncate long string cells"
  );
  assert(schemaActivity.event.messageId !== sqlActivity.event.messageId, "STEP activity messageId should include step_id");
  assert(
    planDeltas.some((record) => record.event.patch?.some((patch) => patch.path === "/tasks/0/status" && patch.value === "running")),
    "schema running PLAN delta missing"
  );
  assert(
    planDeltas.some((record) => record.event.patch?.some((patch) => patch.path === "/tasks/1/status" && patch.value === "completed")),
    "SQL completed PLAN delta missing"
  );
  assert(
    planDeltas.some((record) => record.event.patch?.some((patch) => patch.path === "/tasks/2/status" && patch.value === "running")),
    "final running PLAN delta missing"
  );
  assert(!legacyEvent, "tool registry should not emit legacy custom event types");
  assert(auditLogs.some((log) => log.status === "succeeded"), "successful SQL audit log missing");

  assertThrows(
    () => orchestrator.packageToolResult({ toolName: "unregistered_tool", rawResult: { secret: "value" }, runContext }),
    "CONTEXT_ADAPTER_REQUIRED:unregistered_tool"
  );
  assertThrows(
    () => sourceRegistry.registerToolAdapter(new SchemaContextAdapter()),
    "CONTEXT_ADAPTER_ALREADY_REGISTERED:inspect_schema"
  );

  sourceRegistry.registerToolAdapter({
    toolName: "oversized_tool",
    resultType: "oversized",
    sourceType: "tool-result",
    toContextItems: () => [{
      id: "oversized-model",
      sourceType: "tool-result",
      visibility: "model",
      priority: 1,
      content: "x".repeat(70000),
      metadata: {}
    }]
  });
  assertThrows(
    () => orchestrator.packageToolResult({ toolName: "oversized_tool", rawResult: {}, runContext }),
    "CONTEXT_CHAR_BUDGET_EXCEEDED:model"
  );

  const wideSqlPackage = orchestrator.packageToolResult({
    toolName: "run_sql_readonly",
    rawResult: {
      result: {
        columns: Array.from({ length: 80 }, (_, index) => `column_${index}`),
        rows: Array.from({ length: 20 }, () => Array.from({ length: 80 }, () => "z".repeat(500))),
        row_count: 20,
        audit_log_id: "wide-audit",
        elapsed_ms: 1
      },
      sql: "SELECT * FROM wide_table"
    },
    runContext
  });
  assert(JSON.stringify(wideSqlPackage.model).length <= 32000, "wide SQL model result should fit the hard budget");
  assert(wideSqlPackage.model.rows.length < 20, "wide SQL model result should reduce rows to fit the hard budget");

  const wideSchemaPackage = orchestrator.packageToolResult({
    toolName: "inspect_schema",
    rawResult: {
      datasource_id,
      tables: Array.from({ length: 20 }, (_, tableIndex) => ({
        name: `table_${tableIndex}_${"t".repeat(1000)}`,
        columns: Array.from({ length: 50 }, (_, columnIndex) => ({
          name: `column_${columnIndex}_${"c".repeat(1000)}`,
          type: "TEXT"
        }))
      }))
    },
    runContext
  });
  assert(JSON.stringify(wideSchemaPackage.model).length <= 32000, "wide schema should fit the hard budget");
  assert(wideSchemaPackage.truncation.length > 0, "wide schema should report truncation");

  console.log(
    `Agent tool smoke OK: events=${events.length}, sql=${sqlMeta.event.content.sql}, ` +
      `model_rows=${sqlResult.rows.length}, row_count=${tableOutput.event.content.content.row_count}, audit_logs=${auditLogs.length}`
  );
} finally {
  store.close();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(fn, expectedMessage) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected rejection: ${expectedMessage}`);
}

function assertThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected exception: ${expectedMessage}`);
}

function createLargeSqliteFixture(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  try {
    db.exec(`
      CREATE TABLE big_orders (
        id INTEGER PRIMARY KEY,
        channel TEXT NOT NULL,
        note TEXT NOT NULL
      );
    `);
    const insert = db.prepare("INSERT INTO big_orders (id, channel, note) VALUES (?, ?, ?)");

    for (let index = 1; index <= 100; index += 1) {
      insert.run(index, index % 2 === 0 ? "search" : "direct", `note-${index}-` + "x".repeat(700));
    }
  } finally {
    db.close();
  }
}
