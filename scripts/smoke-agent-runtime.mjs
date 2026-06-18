import { createDataAgentRunContext, createDataAgentToolRegistry } from "../packages/agent-runtime/dist/index.js";
import { LocalDataGateway } from "../packages/data-gateway/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

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
      create: (type, payload) => {
        seq += 1;
        const event = {
          type,
          run_id,
          session_id,
          seq,
          ts: new Date().toISOString(),
          payload
        };
        events.push(event);
        return event;
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

  const schemaStart = events.find(
    (event) => event.type === "step.start" && event.payload?.tool_name === "inspect_schema"
  );
  const sqlStart = events.find(
    (event) => event.type === "step.start" && event.payload?.tool_name === "run_sql_readonly"
  );
  const sqlMeta = events.find((event) => event.type === "step.meta" && typeof event.payload?.sql === "string");
  const tableOutput = events.find(
    (event) => event.type === "step.output" && event.payload?.output_type === "table"
  );
  const final = events.find((event) => event.type === "final");
  const auditLogs = store.sqlAuditLogs.listByDataSource({ user_id, datasource_id });

  assert(Boolean(schemaStart), "inspect_schema tool was not called");
  assert(Boolean(sqlStart), "run_sql_readonly tool was not called");
  assert(Boolean(sqlMeta), "SQL metadata event was not emitted");
  assert(Boolean(tableOutput), "table output event was not emitted");
  assert(!final, "tool registry should not emit final responses");
  assert(auditLogs.some((log) => log.status === "succeeded"), "successful SQL audit log missing");

  console.log(
    `Agent tool smoke OK: events=${events.length}, sql=${sqlMeta.payload.sql}, ` +
      `rows=${tableOutput.payload.content.row_count}, audit_logs=${auditLogs.length}`
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
