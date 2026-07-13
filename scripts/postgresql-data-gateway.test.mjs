import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalDataGateway } from "../packages/data-gateway/dist/index.js";
import {
  GaussDbAdapter,
  GreenplumAdapter,
  PostgreSqlAdapter,
  RedshiftAdapter,
} from "../packages/data-gateway/dist/adapters/sql-family-adapters.js";
import { SUPPORTED_DATA_SOURCE_TYPES } from "../packages/data-gateway/dist/supported-types.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

test("PostgreSQL schema inspection returns table and column descriptions", async () => {
  const queries = [];
  const adapter = new PostgreSqlAdapter(postgresConfig(), fakePoolFactory(queries, ({ text }) => {
    if (text.includes("AS accessible")) {
      return rowsResult([{ accessible: true }]);
    }
    if (text.includes("pg_catalog.pg_attribute")) {
      return rowsResult([{
        table_name: "orders",
        table_description: "Customer orders",
        column_name: "order_id",
        column_description: "Stable order identifier",
        data_type: "uuid",
        is_nullable: "NO",
      }]);
    }
    return rowsResult([]);
  }));

  const schema = await adapter.inspectSchema();

  assert.deepEqual(schema, {
    tables: [{
      name: "orders",
      description: "Customer orders",
      columns: [{
        name: "order_id",
        description: "Stable order identifier",
        type: "uuid",
        nullable: false,
      }],
    }],
  });
  assert(
    queries.some(({ values }) => values?.includes("analytics")),
    "configured schema should be used during PostgreSQL introspection",
  );
});

test("PostgreSQL schema inspection rejects a missing or inaccessible schema", async () => {
  const adapter = new PostgreSqlAdapter(
    postgresConfig({ schema: "missing_schema" }),
    fakePoolFactory([], ({ text }) => text.includes("AS accessible")
      ? rowsResult([{ accessible: false }])
      : rowsResult([])),
  );

  await assert.rejects(
    () => adapter.inspectSchema(),
    /POSTGRES_SCHEMA_NOT_FOUND_OR_INACCESSIBLE:missing_schema/,
  );
});

test("PostgreSQL read-only SQL uses the configured schema and enforces the fetch limit", async () => {
  const queries = [];
  const adapter = new PostgreSqlAdapter(
    postgresConfig({ schema: "tenant_data" }),
    fakePoolFactory(queries, ({ text }) => {
      if (text.startsWith("FETCH FORWARD 1")) {
        return rowsResult([[42]], [{ name: "id", tableID: 1200, columnID: 1 }]);
      }
      if (text.includes("attribute.attrelid = ANY")) {
        return rowsResult([{
          table_id: 1200,
          column_id: 1,
          schema_name: "tenant_data",
          table_name: "orders",
          column_name: "id",
        }]);
      }
      return rowsResult([]);
    }),
  );

  const result = await adapter.runSqlReadonly({
    sql: "SELECT id FROM orders LIMIT 1000",
    limit: 1,
  });

  assert.deepEqual(result.columns, ["id"]);
  assert.deepEqual(result.rows, [[42]]);
  assert.equal(result.row_count, 1);
  assert.deepEqual(result.column_origins, [{
    schema: "tenant_data",
    table: "orders",
    column: "id",
  }]);
  assert(
    queries.some(({ text, values }) =>
      text.includes("set_config('search_path'") && values?.includes('"tenant_data"')),
    "configured schema should become the transaction-local PostgreSQL search_path",
  );
  assert(
    queries.some(({ text }) =>
      text.includes("DECLARE") && text.includes("SELECT id FROM orders LIMIT 1000")),
    "the guarded SELECT should be declared as a server-side cursor",
  );
  assert(
    queries.some(({ text }) => text.startsWith("FETCH FORWARD 1")),
    "the effective limit should be enforced by FETCH even when SQL contains a larger LIMIT",
  );
});

test("PostgreSQL connection config supports SSL, bounded connect time, and passwordless auth", async () => {
  const queries = [];
  const adapter = new PostgreSqlAdapter(
    postgresConfig({ password: undefined, ssl: true, timeoutMs: 2500 }),
    fakePoolFactory(queries, ({ text }) => text.includes("AS accessible")
      ? rowsResult([{ accessible: true }])
      : rowsResult([])),
  );

  await adapter.inspectSchema();

  assert(queries.length > 0);
  for (const { config } of queries) {
    assert.equal(config.connectionTimeoutMillis, 2500);
    assert.equal(config.statement_timeout, 2500);
    assert.equal(config.ssl, true);
    assert.equal(config.password, undefined);
  }

  const postgresType = SUPPORTED_DATA_SOURCE_TYPES.find(({ name }) => name === "postgresql");
  assert(postgresType, "PostgreSQL type metadata should exist");
  assert.equal(postgresType.parameters.find(({ name }) => name === "password")?.required, false);
  assert.equal(postgresType.parameters.find(({ name }) => name === "ssl")?.type, "boolean");
});

test("PostgreSQL cancellation releases the client once and preserves the cancellation reason", async () => {
  const controller = new AbortController();
  let rejectPending;
  let releaseCount = 0;
  let poolEnded = false;
  const client = {
    query: async (query) => {
      const text = typeof query === "string" ? query : query.text;
      if (text.startsWith("DECLARE")) {
        return new Promise((_, reject) => {
          rejectPending = reject;
        });
      }
      return rowsResult([]);
    },
    release: (destroy) => {
      releaseCount += 1;
      if (releaseCount > 1) {
        throw new Error("Release called on client which has already been released to the pool.");
      }
      if (destroy) {
        rejectPending?.(new Error("connection destroyed"));
      }
    },
  };
  const adapter = new PostgreSqlAdapter(postgresConfig(), () => ({
    connect: async () => client,
    end: async () => {
      poolEnded = true;
    },
  }));

  const pending = adapter.runSqlReadonly({
    sql: "SELECT pg_sleep(30)",
    limit: 1,
    signal: controller.signal,
  });
  while (!rejectPending) {
    await Promise.resolve();
  }
  controller.abort(new Error("RUN_CANCELLED:test"));

  await assert.rejects(() => pending, /RUN_CANCELLED:test/);
  assert.equal(releaseCount, 1);
  assert.equal(poolEnded, true);
});

test("PostgreSQL allowlists use the fail-closed relation parser and configured schema", async () => {
  await withGatewayFixture(async ({ store }) => {
    store.dataSources.create({
      user_id: "dev-user",
      id: "policy-postgresql",
      name: "Policy PostgreSQL",
      type: "postgresql",
      config: {
        ...postgresConfig({ schema: "analytics" }),
        introspection: { tableAllowlist: ["orders"] },
      },
    });
    const gateway = new LocalDataGateway(store);
    const common = {
      user_id: "dev-user",
      datasource_id: "policy-postgresql",
      limit: 1,
    };

    await assert.rejects(
      () => gateway.runSqlReadonly({
        ...common,
        sql: "SELECT * FROM orders, private_data",
      }),
      /TABLE_NOT_ALLOWED:private_data/,
    );
    await assert.rejects(
      () => gateway.runSqlReadonly({
        ...common,
        sql: "SELECT * FROM other_schema.orders",
      }),
      /TABLE_NOT_ALLOWED:other_schema\.orders/,
    );
    await assert.rejects(
      () => gateway.runSqlReadonly({
        ...common,
        sql: "SELECT * FROM analytics.public.orders",
      }),
      /TABLE_NOT_ALLOWED:analytics\.public\.orders/,
    );
    await assert.rejects(
      () => gateway.runSqlReadonly({
        ...common,
        sql: "SELECT NULL::integer UNION ALL TABLE other_schema.orders",
      }),
      /TABLE_NOT_ALLOWED:other_schema\.orders/,
    );
    await assert.rejects(
      () => gateway.runSqlReadonly({
        ...common,
        sql: "SELECT * FROM generate_series(1, 5)",
      }),
      /TABLE_POLICY_UNVERIFIABLE:Table functions in FROM are not supported/,
    );

    const auditLogs = store.sqlAuditLogs.listByDataSource({
      user_id: "dev-user",
      datasource_id: "policy-postgresql",
    });
    assert.equal(auditLogs.length, 5);
    assert(auditLogs.every(({ status }) => status === "blocked"));
    assert(auditLogs.some(({ blocked_reason: reason }) => reason === "TABLE_NOT_ALLOWED:private_data"));
    assert(auditLogs.some(({ blocked_reason: reason }) => reason === "TABLE_NOT_ALLOWED:other_schema.orders"));
    assert(auditLogs.some(({ blocked_reason: reason }) =>
      reason?.startsWith("TABLE_POLICY_UNVERIFIABLE:Table functions in FROM are not supported")));
  });
});

test("schema filtering keeps a disjoint allowlist empty and preview uses its workspace credentials", async () => {
  await withGatewayFixture(async ({ root, store }) => {
    const csvPath = join(root, "orders.csv");
    writeFileSync(csvPath, "id,amount\n1,42\n", "utf8");
    const credentialRef = store.secrets.put({
      workspace_id: "analytics-workspace",
      user_id: "dev-user",
      owner_kind: "datasource",
      owner_id: "workspace-csv",
      value: { file_path: csvPath },
    });
    store.dataSources.create({
      user_id: "dev-user",
      id: "workspace-csv",
      name: "Workspace CSV",
      type: "csv",
      config: {
        table_name: "orders",
        introspection: { tableAllowlist: ["orders"] },
      },
      credential_ref: credentialRef,
    });
    const gateway = new LocalDataGateway(store);
    const schema = await gateway.inspectSchema({
      user_id: "dev-user",
      workspace_id: "analytics-workspace",
      datasource_id: "workspace-csv",
      table_names: ["customers"],
    });
    assert.deepEqual(schema.tables, []);

    const preview = await gateway.previewTable({
      user_id: "dev-user",
      workspace_id: "analytics-workspace",
      datasource_id: "workspace-csv",
      table: "orders",
      limit: 1,
    });
    assert.deepEqual(preview, {
      columns: ["id", "amount"],
      rows: [["1", "42"]],
      row_count: 1,
    });
  });
});

test("PostgreSQL hardening does not change PostgreSQL-compatible adapters", async () => {
  for (const Adapter of [GaussDbAdapter, RedshiftAdapter, GreenplumAdapter]) {
    assert.equal(Adapter.prototype instanceof PostgreSqlAdapter, true);
    const queries = [];
    const adapter = new Adapter(postgresConfig(), fakePoolFactory(queries, ({ text }) => {
      if (text.includes("information_schema.columns")) {
        return rowsResult([{
          table_name: "orders",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        }]);
      }
      if (text.startsWith("SELECT")) {
        return rowsResult([{ id: 1 }]);
      }
      return rowsResult([]);
    }));

    await adapter.inspectSchema();
    await adapter.runSqlReadonly({
      sql: "SELECT id FROM orders LIMIT 1000",
      limit: 1,
    });

    assert.equal(queries.some(({ text }) => text.includes("set_config('search_path'")), false);
    assert.equal(queries.some(({ text }) => text.startsWith("DECLARE") || text.startsWith("FETCH")), false);
    assert(queries.some(({ text }) => text === "SELECT id FROM orders LIMIT 1000"));
    for (const { config } of queries) {
      assert.equal(config.ssl, undefined);
      assert.equal(config.connectionTimeoutMillis, undefined);
      assert.equal(config.password, "secret");
    }
  }

  for (const name of ["gaussdb", "redshift", "greenplum"]) {
    const supportedType = SUPPORTED_DATA_SOURCE_TYPES.find((type) => type.name === name);
    assert(supportedType, `${name} type metadata should exist`);
    assert.equal(supportedType.parameters.find(({ name: parameter }) => parameter === "password")?.required, true);
    assert.equal(supportedType.parameters.some(({ name: parameter }) => parameter === "ssl"), false);
  }
});

function postgresConfig(overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 1,
    database: "analytics",
    schema: "analytics",
    username: "readonly",
    password: "secret",
    timeoutMs: 25,
    ...overrides,
  };
}

function fakePoolFactory(queries, handler) {
  return (config) => ({
    connect: async () => ({
      query: async (query, values) => {
        const text = typeof query === "string" ? query : query.text;
        const call = { config, query, text, values };
        queries.push(call);
        return handler(call);
      },
      release: () => {},
    }),
    end: async () => {},
  });
}

function rowsResult(rows, fields = []) {
  return { rows, fields, rowCount: rows.length };
}

async function withGatewayFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "datafoundry-postgresql-gateway-"));
  const store = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "postgresql-gateway-test-key",
  });
  try {
    await callback({ root, store });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
