import { LocalDataGateway } from "../packages/data-gateway/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import writeXlsxFile from "write-excel-file/node";

const stamp = Date.now();
const root = `storage/data-gateway-smoke/${stamp}`;
const metadataPath = `${root}/metadata.sqlite`;
const sqlitePath = `${root}/orders.sqlite`;
const csvPath = `${root}/orders.csv`;
const xlsxPath = `${root}/orders.xlsx`;

mkdirSync(root, { recursive: true });
createSqliteFixture(sqlitePath);
writeFileSync(
  csvPath,
  "order_id,channel,gmv\nc_001,search,1280\nc_002,social,640\nc_003,direct,920\n",
  "utf8"
);
await createXlsxFixture(xlsxPath);

const store = createMetadataStore({ database_path: metadataPath });
const gateway = new LocalDataGateway(store);
const user_id = "dev-user";

try {
  await gateway.registerDataSource({
    user_id,
    id: "duckdb-demo",
    name: "DuckDB Demo",
    type: "duckdb",
    config: { mode: "demo" }
  });
  await gateway.registerDataSource({
    user_id,
    id: "sqlite-orders",
    name: "SQLite Orders",
    type: "sqlite",
    config: { path: sqlitePath }
  });
  await gateway.registerDataSource({
    user_id,
    id: "csv-orders",
    name: "CSV Orders",
    type: "csv",
    config: { file_path: csvPath, table_name: "orders_csv" }
  });
  await gateway.registerDataSource({
    user_id,
    id: "xlsx-orders",
    name: "XLSX Orders",
    type: "xlsx",
    config: { file_path: xlsxPath, table_name: "orders_xlsx" }
  });

  const supportTypes = await gateway.supportTypes();
  assert(supportTypes.some((type) => type.name === "duckdb" && type.enabled), "duckdb support type missing");
  assert(supportTypes.some((type) => type.name === "sqlite" && type.enabled), "sqlite support type missing");

  const list = await gateway.listDataSources({ user_id });
  assert(list.length === 4, `expected 4 data sources, got ${list.length}`);
  assert(!JSON.stringify(list).includes("file_path"), "data source list leaked config file_path");

  for (const datasource_id of ["duckdb-demo", "sqlite-orders", "csv-orders", "xlsx-orders"]) {
    const test = await gateway.testConnect({ user_id, datasource_id });
    assert(test.ok, `${datasource_id} test-connect failed`);
  }

  const duckdbSchema = await gateway.inspectSchema({ user_id, datasource_id: "duckdb-demo" });
  const sqliteSchema = await gateway.inspectSchema({ user_id, datasource_id: "sqlite-orders" });
  const csvPreview = await gateway.previewTable({ user_id, datasource_id: "csv-orders", table: "orders_csv", limit: 20 });
  const xlsxPreview = await gateway.previewTable({
    user_id,
    datasource_id: "xlsx-orders",
    table: "orders_xlsx",
    limit: 20
  });

  assert(duckdbSchema.tables.some((table) => table.name === "orders"), "duckdb orders schema missing");
  assert(sqliteSchema.tables.some((table) => table.name === "orders"), "sqlite orders schema missing");
  assert(csvPreview.row_count === 3, `expected 3 CSV rows, got ${csvPreview.row_count}`);
  assert(xlsxPreview.row_count === 3, `expected 3 XLSX rows, got ${xlsxPreview.row_count}`);

  console.log(
    `Data Gateway smoke OK: sources=${list.length}, duckdb_tables=${duckdbSchema.tables.length}, ` +
      `sqlite_tables=${sqliteSchema.tables.length}, csv_rows=${csvPreview.row_count}, xlsx_rows=${xlsxPreview.row_count}`
  );
} finally {
  store.close();
}

function createSqliteFixture(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  try {
    db.exec(`
      CREATE TABLE orders (
        order_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        gmv REAL NOT NULL
      );
      INSERT INTO orders (order_id, channel, gmv) VALUES
        ('s_001', 'search', 1280),
        ('s_002', 'social', 640),
        ('s_003', 'direct', 920);
    `);
  } finally {
    db.close();
  }
}

async function createXlsxFixture(path) {
  const file = await writeXlsxFile(
    [
      [
        { value: "order_id" },
        { value: "channel" },
        { value: "gmv" }
      ],
      [
        { value: "x_001" },
        { value: "search" },
        { value: 1280 }
      ],
      [
        { value: "x_002" },
        { value: "social" },
        { value: 640 }
      ],
      [
        { value: "x_003" },
        { value: "direct" },
        { value: 920 }
      ]
    ]
  );
  await file.toFile(path);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
