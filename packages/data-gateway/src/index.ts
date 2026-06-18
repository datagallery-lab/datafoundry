import { LocalArtifactService } from "@open-data-agent/artifacts";
import type { ArtifactSummary, DataSourceSummary } from "@open-data-agent/contracts";
import type { DataSourceRecord, MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import readXlsxFile from "read-excel-file/node";

export type DataSourceType = "duckdb" | "sqlite" | "csv" | "xlsx" | "postgresql" | "mysql" | string;

export type ConfigurableParam = {
  name: string;
  label: string;
  type: "string" | "password" | "select" | "number" | "boolean" | "file";
  required: boolean;
  default_value?: string | number | boolean;
  options?: string[];
};

export type SupportedDataSourceType = {
  name: DataSourceType;
  enabled: boolean;
  label: string;
  description?: string;
  parameters: ConfigurableParam[];
};

export type ListDataSourcesInput = {
  user_id: string;
  enabled_only?: boolean;
};

export type RegisterDataSourceInput = {
  user_id: string;
  id: string;
  name: string;
  type: DataSourceType;
  config: Record<string, unknown>;
  description?: string;
};

export type TestConnectInput = {
  user_id: string;
  datasource_id: string;
};

export type InspectSchemaInput = {
  user_id: string;
  datasource_id: string;
  table_names?: string[];
};

export type PreviewTableInput = {
  user_id: string;
  datasource_id: string;
  table: string;
  limit?: number;
};

export type RunSqlReadonlyInput = {
  user_id: string;
  datasource_id: string;
  sql: string;
  run_id?: string;
  limit?: number;
  timeout_ms?: number;
};

export type SchemaSummary = {
  datasource_id: string;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
    }>;
  }>;
};

export type TableResult = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
};

export type SqlExecutionResult = TableResult & {
  audit_log_id: string;
  elapsed_ms: number;
  artifact_id?: string;
  artifact?: ArtifactSummary;
};

export interface DataGateway {
  listDataSources(input: ListDataSourcesInput): Promise<DataSourceSummary[]>;
  supportTypes(): Promise<SupportedDataSourceType[]>;
  registerDataSource(input: RegisterDataSourceInput): Promise<DataSourceSummary>;
  testConnect(input: TestConnectInput): Promise<{ ok: boolean; message: string }>;
  inspectSchema(input: InspectSchemaInput): Promise<SchemaSummary>;
  previewTable(input: PreviewTableInput): Promise<TableResult>;
  runSqlReadonly(input: RunSqlReadonlyInput): Promise<SqlExecutionResult>;
}

export class LocalDataGateway implements DataGateway {
  private readonly artifactService: LocalArtifactService;

  constructor(private readonly metadataStore: MetadataStore) {
    this.artifactService = new LocalArtifactService(metadataStore);
  }

  async listDataSources(input: ListDataSourcesInput): Promise<DataSourceSummary[]> {
    return this.metadataStore.dataSources.list(input).map(dataSourceRecordToSummary);
  }

  async supportTypes(): Promise<SupportedDataSourceType[]> {
    return SUPPORTED_DATA_SOURCE_TYPES;
  }

  async registerDataSource(input: RegisterDataSourceInput): Promise<DataSourceSummary> {
    const record = this.metadataStore.dataSources.create({
      user_id: input.user_id,
      id: input.id,
      name: input.name,
      type: input.type,
      config: input.config,
      ...(input.description ? { description: input.description } : {})
    });

    return dataSourceRecordToSummary(record);
  }

  async testConnect(input: TestConnectInput): Promise<{ ok: boolean; message: string }> {
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = createAdapter(dataSource);
    await adapter.inspectSchema();
    this.metadataStore.dataSources.touchTest({
      user_id: input.user_id,
      datasource_id: input.datasource_id,
      status: "ready"
    });

    return { ok: true, message: "Connection test passed." };
  }

  async inspectSchema(input: InspectSchemaInput): Promise<SchemaSummary> {
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = createAdapter(dataSource);
    const schema = await adapter.inspectSchema();
    const tableNames = new Set(input.table_names ?? []);

    return {
      datasource_id: input.datasource_id,
      tables: tableNames.size > 0 ? schema.tables.filter((table) => tableNames.has(table.name)) : schema.tables
    };
  }

  async previewTable(input: PreviewTableInput): Promise<TableResult> {
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = createAdapter(dataSource);
    return adapter.previewTable({
      table: input.table,
      limit: Math.min(input.limit ?? 20, 100)
    });
  }

  async runSqlReadonly(input: RunSqlReadonlyInput): Promise<SqlExecutionResult> {
    const startedAt = Date.now();
    const auditLogId = randomUUID();
    const dataSource = this.metadataStore.dataSources.get(input);
    const guard = guardReadonlySql(input.sql);

    if (!guard.allowed) {
      this.metadataStore.sqlAuditLogs.create({
        user_id: input.user_id,
        id: auditLogId,
        datasource_id: input.datasource_id,
        sql_text: input.sql,
        status: "blocked",
        blocked_reason: guard.reason,
        ...(input.run_id ? { run_id: input.run_id } : {}),
        elapsed_ms: Date.now() - startedAt
      });
      throw new Error(`SQL_BLOCKED: ${guard.reason}`);
    }

    const limit = Math.min(input.limit ?? 100, 1000);
    const timeoutMs = input.timeout_ms ?? 10000;

    try {
      const adapter = createAdapter(dataSource);
      const result = await withTimeout(
        adapter.runSqlReadonly({
          sql: applyLimit(guard.normalized_sql, limit),
          limit
        }),
        timeoutMs
      );
      const elapsedMs = Date.now() - startedAt;
      const audit = this.metadataStore.sqlAuditLogs.create({
        user_id: input.user_id,
        id: auditLogId,
        datasource_id: input.datasource_id,
        sql_text: guard.normalized_sql,
        status: "succeeded",
        row_count: result.row_count,
        elapsed_ms: elapsedMs,
        ...(input.run_id ? { run_id: input.run_id } : {})
      });
      const run = input.run_id ? this.metadataStore.runs.get({ user_id: input.user_id, run_id: input.run_id }) : undefined;
      const artifact = run
        ? await this.artifactService.createArtifact({
            user_id: input.user_id,
            session_id: run.session_id,
            run_id: run.id,
            type: "table",
            name: `SQL result ${audit.id}`,
            preview_json: result
          })
        : undefined;

      return {
        ...result,
        audit_log_id: audit.id,
        elapsed_ms: elapsedMs,
        ...(artifact ? { artifact_id: artifact.id, artifact } : {})
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = error instanceof Error && error.message === "SQL_TIMEOUT";
      this.metadataStore.sqlAuditLogs.create({
        user_id: input.user_id,
        id: auditLogId,
        datasource_id: input.datasource_id,
        sql_text: guard.normalized_sql,
        status: isTimeout ? "timeout" : "failed",
        blocked_reason: error instanceof Error ? error.message : "Unknown SQL execution error",
        elapsed_ms: elapsedMs,
        ...(input.run_id ? { run_id: input.run_id } : {})
      });
      throw error;
    }
  }
}

type DataSourceAdapter = {
  inspectSchema(): Promise<Omit<SchemaSummary, "datasource_id">>;
  previewTable(input: { table: string; limit: number }): Promise<TableResult>;
  runSqlReadonly(input: { sql: string; limit: number }): Promise<TableResult>;
};

const SUPPORTED_DATA_SOURCE_TYPES: SupportedDataSourceType[] = [
  {
    name: "duckdb",
    enabled: true,
    label: "DuckDB",
    description: "Local analytical datasource. Day 3 supports schema and preview for demo/local datasets.",
    parameters: [{ name: "mode", label: "Mode", type: "select", required: false, options: ["demo"] }]
  },
  {
    name: "sqlite",
    enabled: true,
    label: "SQLite",
    description: "Local SQLite database file.",
    parameters: [{ name: "path", label: "Database Path", type: "file", required: true }]
  },
  {
    name: "csv",
    enabled: true,
    label: "CSV",
    description: "Uploaded or local CSV dataset.",
    parameters: [{ name: "file_path", label: "CSV File Path", type: "file", required: true }]
  },
  {
    name: "xlsx",
    enabled: true,
    label: "XLSX",
    description: "Uploaded or local Excel workbook.",
    parameters: [{ name: "file_path", label: "XLSX File Path", type: "file", required: true }]
  },
  {
    name: "postgresql",
    enabled: false,
    label: "PostgreSQL",
    description: "Not enabled in this Day 3 build.",
    parameters: []
  },
  {
    name: "mysql",
    enabled: false,
    label: "MySQL",
    description: "Not enabled in this Day 3 build.",
    parameters: []
  }
];

const createAdapter = (dataSource: DataSourceRecord): DataSourceAdapter => {
  const config = parseConfig(dataSource);

  if (dataSource.type === "sqlite") {
    return new SQLiteAdapter(config);
  }

  if (dataSource.type === "csv") {
    return new CsvAdapter(config);
  }

  if (dataSource.type === "xlsx") {
    return new XlsxAdapter(config);
  }

  if (dataSource.type === "duckdb") {
    return new DuckDbDemoAdapter(config);
  }

  throw new Error(`Unsupported data source type: ${dataSource.type}`);
};

class SQLiteAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(): Promise<Omit<SchemaSummary, "datasource_id">> {
    const database = this.open();

    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
        .all()
        .map((row) => requiredRecordString(row, "name"));

      return {
        tables: tables.map((table) => ({
          name: table,
          columns: database
            .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
            .all()
            .map((row) => ({
              name: requiredRecordString(row, "name"),
              type: requiredRecordString(row, "type") || "TEXT",
              nullable: requiredRecordNumber(row, "notnull") === 0
            }))
        }))
      };
    } finally {
      database.close();
    }
  }

  async previewTable(input: { table: string; limit: number }): Promise<TableResult> {
    const database = this.open();

    try {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ?`).all(input.limit);
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  async runSqlReadonly(input: { sql: string }): Promise<TableResult> {
    const database = this.open();

    try {
      const rows = database.prepare(input.sql).all();
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    const path = stringConfig(this.config, "path");
    return new DatabaseSync(path);
  }
}

class DuckDbDemoAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(): Promise<Omit<SchemaSummary, "datasource_id">> {
    const tables = demoTables(this.config);

    return {
      tables: tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({ name: column, type: inferColumnType(table.rows, column) }))
      }))
    };
  }

  async previewTable(input: { table: string; limit: number }): Promise<TableResult> {
    const table = demoTables(this.config).find((candidate) => candidate.name === input.table);

    if (!table) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows.slice(0, input.limit), table.columns);
  }

  async runSqlReadonly(input: { sql: string; limit: number }): Promise<TableResult> {
    return executeSimpleSelectOnTables(demoTables(this.config), input.sql, input.limit);
  }
}

class CsvAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(): Promise<Omit<SchemaSummary, "datasource_id">> {
    const table = this.readTable(100);

    return {
      tables: [
        {
          name: table.name,
          columns: table.columns.map((column) => ({ name: column, type: inferCsvColumnType(table.rows, column) }))
        }
      ]
    };
  }

  async previewTable(input: { table: string; limit: number }): Promise<TableResult> {
    const table = this.readTable(input.limit);

    if (input.table !== table.name) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows, table.columns);
  }

  async runSqlReadonly(input: { sql: string; limit: number }): Promise<TableResult> {
    return executeSimpleSelectOnTables([this.readTable(input.limit)], input.sql, input.limit);
  }

  private readTable(limit: number): DatasetTable {
    const filePath = stringConfig(this.config, "file_path");
    const raw = readFileSync(filePath, "utf8");
    const parsedRows = parseCsv(raw, limit + 1);
    const columns = parsedRows[0] ?? [];
    const rows = parsedRows.slice(1).map((row) => columnsToObject(columns, row));

    return {
      name: stringConfig(this.config, "table_name", "dataset"),
      columns,
      rows
    };
  }
}

class XlsxAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(): Promise<Omit<SchemaSummary, "datasource_id">> {
    const table = await this.readTable(100);

    return {
      tables: [
        {
          name: table.name,
          columns: table.columns.map((column) => ({ name: column, type: inferCsvColumnType(table.rows, column) }))
        }
      ]
    };
  }

  async previewTable(input: { table: string; limit: number }): Promise<TableResult> {
    const table = await this.readTable(input.limit);

    if (input.table !== table.name) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows, table.columns);
  }

  async runSqlReadonly(input: { sql: string; limit: number }): Promise<TableResult> {
    return executeSimpleSelectOnTables([await this.readTable(input.limit)], input.sql, input.limit);
  }

  private async readTable(limit: number): Promise<DatasetTable> {
    const filePath = stringConfig(this.config, "file_path");
    const rows = (await readXlsxFile(filePath, { dateFormat: "yyyy-mm-dd" })) as unknown as unknown[][];
    const columns = (rows[0] ?? []).map((value: unknown) => String(value ?? ""));
    const objectRows = rows.slice(1, limit + 1).map((row) => columnsToObject(columns, row));

    return {
      name: stringConfig(this.config, "table_name", "dataset"),
      columns,
      rows: objectRows
    };
  }
}

type DatasetTable = {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

const dataSourceRecordToSummary = (record: DataSourceRecord): DataSourceSummary => ({
  id: record.id,
  name: record.name,
  type: record.type,
  status: record.status,
  ...(record.description ? { description: record.description } : {})
});

const parseConfig = (dataSource: DataSourceRecord): Record<string, unknown> => JSON.parse(dataSource.config_json) as Record<
  string,
  unknown
>;

const stringConfig = (config: Record<string, unknown>, key: string, defaultValue?: string): string => {
  const value = config[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing string config: ${key}`);
};

const requiredRecordString = (row: unknown, key: string): string => {
  if (!isRecord(row) || typeof row[key] !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }

  return row[key];
};

const requiredRecordNumber = (row: unknown, key: string): number => {
  if (!isRecord(row) || typeof row[key] !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }

  return row[key];
};

const rowsToTableResult = (rows: unknown[]): TableResult => {
  const objectRows = rows.filter(isRecord);
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return objectRowsToTableResult(objectRows, columns);
};

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const inferColumnType = (rows: Record<string, unknown>[], column: string): string => {
  const value = rows.find((row) => row[column] !== null && row[column] !== undefined)?.[column];

  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "DOUBLE";
  }

  if (typeof value === "boolean") {
    return "BOOLEAN";
  }

  return "TEXT";
};

const inferCsvColumnType = (rows: Record<string, unknown>[], column: string): string => {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== "");

  if (values.length > 0 && values.every((value) => Number.isFinite(Number(value)))) {
    return "DOUBLE";
  }

  return "TEXT";
};

const demoTables = (config: Record<string, unknown>): DatasetTable[] => {
  const configuredTables = config.tables;

  if (Array.isArray(configuredTables)) {
    return configuredTables.filter(isDatasetTable);
  }

  const rows = [
    { order_id: "o_001", channel: "search", category: "electronics", user_type: "new", gmv: 1280, created_at: "2026-05-18" },
    { order_id: "o_002", channel: "social", category: "beauty", user_type: "returning", gmv: 640, created_at: "2026-05-19" },
    { order_id: "o_003", channel: "direct", category: "home", user_type: "returning", gmv: 920, created_at: "2026-05-20" }
  ];

  return [
    {
      name: "orders",
      columns: ["order_id", "channel", "category", "user_type", "gmv", "created_at"],
      rows
    }
  ];
};

const parseCsv = (raw: string, maxRows: number): string[][] => {
  const rows: string[][] = [];
  let current = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const nextChar = raw[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(current);
      rows.push(currentRow);
      current = "";
      currentRow = [];

      if (rows.length >= maxRows) {
        return rows;
      }

      continue;
    }

    current += char;
  }

  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current);
    rows.push(currentRow);
  }

  return rows;
};

const columnsToObject = (columns: string[], row: readonly unknown[]): Record<string, unknown> =>
  Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isDatasetTable = (value: unknown): value is DatasetTable => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.name === "string" && Array.isArray(value.columns) && Array.isArray(value.rows);
};

type SqlGuardResult =
  | {
      allowed: true;
      normalized_sql: string;
    }
  | {
      allowed: false;
      normalized_sql: string;
      reason: string;
    };

const DANGEROUS_SQL_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "REPLACE",
  "MERGE",
  "CALL",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "COPY",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "ANALYZE",
  "SET",
  "RESET",
  "LOAD"
];

const guardReadonlySql = (sql: string): SqlGuardResult => {
  const normalizedSql = normalizeSql(sql);

  if (!normalizedSql) {
    return { allowed: false, normalized_sql: normalizedSql, reason: "SQL is empty." };
  }

  if (hasMultipleStatements(normalizedSql)) {
    return { allowed: false, normalized_sql: normalizedSql, reason: "Multiple SQL statements are not allowed." };
  }

  const upperSql = stripQuotedSql(normalizedSql).toUpperCase();

  if (!upperSql.startsWith("SELECT ") && !upperSql.startsWith("WITH ")) {
    return { allowed: false, normalized_sql: normalizedSql, reason: "Only SELECT/WITH statements are allowed." };
  }

  const dangerousKeyword = DANGEROUS_SQL_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`, "u").test(upperSql));

  if (dangerousKeyword) {
    return { allowed: false, normalized_sql: normalizedSql, reason: `Dangerous keyword blocked: ${dangerousKeyword}.` };
  }

  return { allowed: true, normalized_sql: normalizedSql };
};

const normalizeSql = (sql: string): string => sql.trim().replace(/;+\s*$/u, "").replace(/\s+/gu, " ");

const hasMultipleStatements = (sql: string): boolean => {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextChar = sql[index + 1];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        index += 1;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        index += 1;
        continue;
      }

      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote && sql.slice(index + 1).trim().length > 0) {
      return true;
    }
  }

  return false;
};

const stripQuotedSql = (sql: string): string => sql.replace(/'([^']|'')*'/gu, "''").replace(/"([^"]|"")*"/gu, '""');

const applyLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("SQL_TIMEOUT")), timeoutMs);
    })
  ]);

const executeSimpleSelectOnTables = (tables: DatasetTable[], sql: string, limit: number): TableResult => {
  const parsed = parseSimpleSelect(sql);
  const table = tables.find((candidate) => candidate.name === parsed.table);

  if (!table) {
    throw new Error(`Table not found: ${parsed.table}`);
  }

  const columns = parsed.columns.length === 1 && parsed.columns[0] === "*" ? table.columns : parsed.columns;
  const rows = table.rows.slice(0, Math.min(parsed.limit ?? limit, limit));

  return objectRowsToTableResult(rows, columns);
};

type ParsedSimpleSelect = {
  columns: string[];
  table: string;
  limit?: number;
};

const parseSimpleSelect = (sql: string): ParsedSimpleSelect => {
  const directMatch = /^SELECT\s+(.+?)\s+FROM\s+("?[\w-]+"?)\s*(?:LIMIT\s+(\d+))?$/iu.exec(sql);

  if (directMatch) {
    return {
      columns: parseSelectedColumns(directMatch[1] ?? "*"),
      table: unquoteIdentifier(directMatch[2] ?? ""),
      ...(directMatch[3] ? { limit: Number.parseInt(directMatch[3], 10) } : {})
    };
  }

  const wrappedMatch = /^SELECT\s+\*\s+FROM\s+\((SELECT\s+.+)\)\s+AS\s+readonly_query\s+LIMIT\s+(\d+)$/iu.exec(sql);

  if (wrappedMatch) {
    const inner = parseSimpleSelect(wrappedMatch[1] ?? "");

    return {
      ...inner,
      limit: Number.parseInt(wrappedMatch[2] ?? "100", 10)
    };
  }

  throw new Error("Only simple SELECT column list FROM table queries are supported for file/demo data sources.");
};

const parseSelectedColumns = (rawColumns: string): string[] =>
  rawColumns
    .split(",")
    .map((column) => unquoteIdentifier(column.trim()))
    .filter((column) => column.length > 0);

const unquoteIdentifier = (identifier: string): string => identifier.replace(/^"/u, "").replace(/"$/u, "").replaceAll('""', '"');
