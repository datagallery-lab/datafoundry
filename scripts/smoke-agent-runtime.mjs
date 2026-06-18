import { createDataAgentRunContext, createDataAgentToolRegistry } from "../packages/agent-runtime/dist/index.js";
import { LocalDataGateway } from "../packages/data-gateway/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { EventType } from "@ag-ui/core";

const stamp = Date.now();
const metadataPath = `storage/agent-smoke/${stamp}/metadata.sqlite`;
const store = createMetadataStore({ database_path: metadataPath });
const gateway = new LocalDataGateway(store);

const user_id = "dev-user";
const session_id = "agent-smoke-session";
const run_id = "agent-smoke-run";
const datasource_id = "agent-duckdb-demo";

try {
  await gateway.registerDataSource({
    user_id,
    id: datasource_id,
    name: "Agent DuckDB Demo",
    type: "duckdb",
    config: { mode: "demo" }
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
  const registry = createDataAgentToolRegistry({
    dataGateway: gateway,
    runContext,
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
        sql: "SELECT order_id, channel FROM orders",
        limit: 20
      }),
    "SCHEMA_REQUIRED_BEFORE_SQL"
  );

  const schema = await registry.inspectSchema();
  const table = schema.tables[0];
  const selectedColumns = table?.columns.slice(0, 3).map((column) => column.name) ?? ["*"];
  const sql = `SELECT ${selectedColumns.join(", ")} FROM ${table?.name ?? "orders"} LIMIT 20`;
  await registry.runSqlReadonly({ sql, limit: 20 });

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
  const planDeltas = events.filter((record) => record.event.type === EventType.ACTIVITY_DELTA);
  const legacyEvent = events.find((record) => String(record.event.type).includes("."));
  const auditLogs = store.sqlAuditLogs.listByDataSource({ user_id, datasource_id });

  assert(Boolean(schemaActivity), "inspect_schema activity was not emitted");
  assert(Boolean(sqlActivity), "run_sql_readonly activity was not emitted");
  assert(Boolean(sqlMeta), "SQL activity metadata was not emitted");
  assert(Boolean(tableOutput), "table activity output was not emitted");
  assert(Boolean(sqlAudit), "SQL audit custom event was not emitted");
  assert(schemaActivity.event.replace === true, "schema activity should replace previous snapshots");
  assert(sqlActivity.event.replace === true, "SQL activity should replace previous snapshots");
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

  console.log(
    `Agent tool smoke OK: events=${events.length}, sql=${sqlMeta.event.content.sql}, ` +
      `rows=${tableOutput.event.content.content.row_count}, audit_logs=${auditLogs.length}`
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
