import { LocalArtifactService, type CreateArtifactInput } from "@open-data-agent/artifacts";
import type { ArtifactSummary, DataSourceSummary } from "@open-data-agent/contracts";
import type { DataSourceRecord, MetadataStore } from "@open-data-agent/metadata";
import type { FileAssetService } from "@open-data-agent/files";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { Pool, type PoolClient } from "pg";
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
  signal?: AbortSignal | undefined;
  user_id: string;
  workspace_id?: string;
  datasource_id: string;
};

export type InspectSchemaInput = {
  signal?: AbortSignal | undefined;
  user_id: string;
  workspace_id?: string;
  datasource_id: string;
  table_names?: string[];
};

export type PreviewTableInput = {
  signal?: AbortSignal | undefined;
  user_id: string;
  workspace_id?: string;
  datasource_id: string;
  table: string;
  limit?: number;
};

export type RunSqlReadonlyInput = {
  signal?: AbortSignal | undefined;
  user_id: string;
  workspace_id?: string;
  datasource_id: string;
  sql: string;
  run_id?: string;
  limit?: number;
  timeout_ms?: number;
  /**
   * Optional correlation handles (R-018). When provided, the produced table artifact
   * records them in `metadata_json` so the frontend Detail view can link the SQL result
   * back to the originating tool_call / step.
   */
  correlation?: {
    tool_call_id?: string;
    step_id?: string;
  };
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
  createArtifact(input: CreateArtifactInput): Promise<ArtifactSummary>;
}

export type DataGatewayPolicy = {
  defaultLimit: number;
  maxLimit: number;
  timeoutMs: number;
  workspaceId?: string;
};

type DataSourceRuntimePolicy = {
  allowSample?: boolean;
  maskFields: string[];
  maxRows?: number;
  maxSampleRows?: number;
  tableAllowlist: string[];
  timeoutMs?: number;
};

const DEFAULT_DATA_GATEWAY_POLICY: DataGatewayPolicy = {
  defaultLimit: 100,
  maxLimit: 1000,
  timeoutMs: 10000
};

export class LocalDataGateway implements DataGateway {
  private readonly artifactService: LocalArtifactService;

  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly policy: DataGatewayPolicy = DEFAULT_DATA_GATEWAY_POLICY,
    fileAssetService?: FileAssetService
  ) {
    this.artifactService = new LocalArtifactService(metadataStore, fileAssetService);
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
    throwIfAborted(input.signal);
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = this.createAdapter(dataSource, input.workspace_id);
    await adapter.inspectSchema({ signal: input.signal });
    this.metadataStore.dataSources.touchTest({
      user_id: input.user_id,
      datasource_id: input.datasource_id,
      status: "ready"
    });

    return { ok: true, message: "Connection test passed." };
  }

  async inspectSchema(input: InspectSchemaInput): Promise<SchemaSummary> {
    throwIfAborted(input.signal);
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = this.createAdapter(dataSource, input.workspace_id);
    const resourcePolicy = dataSourcePolicy(dataSource);
    const schema = await adapter.inspectSchema({ signal: input.signal });
    const tableNames = allowedTableSet(input.table_names, resourcePolicy.tableAllowlist);

    return {
      datasource_id: input.datasource_id,
      tables: tableNames.size > 0 ? schema.tables.filter((table) => tableNames.has(table.name)) : schema.tables
    };
  }

  async previewTable(input: PreviewTableInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const dataSource = this.metadataStore.dataSources.get(input);
    const adapter = this.createAdapter(dataSource);
    const resourcePolicy = dataSourcePolicy(dataSource);
    assertTableAllowed(input.table, resourcePolicy);
    if (resourcePolicy.allowSample === false) {
      throw new Error(`SAMPLE_BLOCKED:${input.datasource_id}:${input.table}`);
    }
    const result = await adapter.previewTable({
      table: input.table,
      limit: Math.min(
        input.limit ?? Math.min(20, this.policy.defaultLimit),
        this.policy.maxLimit,
        resourcePolicy.maxRows ?? this.policy.maxLimit,
        resourcePolicy.maxSampleRows ?? this.policy.maxLimit
      ),
      signal: input.signal
    });
    return maskTableResult(result, resourcePolicy.maskFields);
  }

  async runSqlReadonly(input: RunSqlReadonlyInput): Promise<SqlExecutionResult> {
    throwIfAborted(input.signal);
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

    const resourcePolicy = dataSourcePolicy(dataSource);
    assertSqlTablesAllowed(guard.normalized_sql, resourcePolicy);
    const limit = Math.min(
      input.limit ?? this.policy.defaultLimit,
      this.policy.maxLimit,
      resourcePolicy.maxRows ?? this.policy.maxLimit
    );
    const timeoutMs = Math.min(
      input.timeout_ms ?? this.policy.timeoutMs,
      this.policy.timeoutMs,
      resourcePolicy.timeoutMs ?? this.policy.timeoutMs
    );

    try {
      const workspaceId = input.workspace_id ?? this.policy.workspaceId ?? "default";
      const adapter = this.createAdapter(dataSource, workspaceId);
      const result = await withTimeout(
        adapter.runSqlReadonly({
          sql: applyLimit(guard.normalized_sql, limit),
          limit,
          signal: input.signal
        }),
        timeoutMs,
        input.signal
      );
      const maskedResult = maskTableResult(result, resourcePolicy.maskFields);
      const elapsedMs = Date.now() - startedAt;
      const audit = this.metadataStore.sqlAuditLogs.create({
        user_id: input.user_id,
        id: auditLogId,
        datasource_id: input.datasource_id,
        sql_text: guard.normalized_sql,
        status: "succeeded",
        row_count: maskedResult.row_count,
        elapsed_ms: elapsedMs,
        ...(input.run_id ? { run_id: input.run_id } : {})
      });
      const run = input.run_id
        ? this.metadataStore.runs.get({ user_id: input.user_id, run_id: input.run_id })
        : undefined;
      const artifact = run ? await this.createSqlResultArtifact({
        auditId: audit.id,
        correlation: input.correlation,
        datasourceId: input.datasource_id,
        result: maskedResult,
        run,
        userId: input.user_id,
        workspaceId
      }) : undefined;
      if (run) {
        this.metadataStore.queryHistory.create({
          user_id: input.user_id,
          workspace_id: workspaceId,
          session_id: run.session_id,
          run_id: run.id,
          datasource_id: input.datasource_id,
          sql_text: guard.normalized_sql,
          row_count: maskedResult.row_count,
          elapsed_ms: elapsedMs
        });
      }

      return {
        ...maskedResult,
        audit_log_id: audit.id,
        elapsed_ms: elapsedMs,
        ...(artifact ? { artifact_id: artifact.id, artifact } : {})
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = error instanceof Error && error.message === "SQL_TIMEOUT";
      const isCancelled = error instanceof Error && isAbortError(error);
      this.metadataStore.sqlAuditLogs.create({
        user_id: input.user_id,
        id: auditLogId,
        datasource_id: input.datasource_id,
        sql_text: guard.normalized_sql,
        status: isCancelled ? "canceled" : isTimeout ? "timeout" : "failed",
        blocked_reason: error instanceof Error ? error.message : "Unknown SQL execution error",
        elapsed_ms: elapsedMs,
        ...(input.run_id ? { run_id: input.run_id } : {})
      });
      throw error;
    }
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactSummary> {
    return this.artifactService.createArtifact(input);
  }

  private async createSqlResultArtifact(input: {
    auditId: string;
    correlation?: RunSqlReadonlyInput["correlation"];
    datasourceId: string;
    result: TableResult;
    run: { id: string; session_id: string };
    userId: string;
    workspaceId?: string;
  }): Promise<ArtifactSummary> {
    const metadata = {
      audit_log_id: input.auditId,
      datasource_id: input.datasourceId,
      full_result: true,
      row_count: input.result.row_count,
      ...(input.correlation?.tool_call_id ? { tool_call_id: input.correlation.tool_call_id } : {}),
      ...(input.correlation?.step_id ? { step_id: input.correlation.step_id } : {})
    };
    const name = `SQL result ${input.auditId}.csv`;
    try {
      const path = writeSqlResultCsv(input.auditId, input.result);
      return await this.artifactService.createArtifactFromFile({
        user_id: input.userId,
        workspace_id: input.workspaceId ?? this.policy.workspaceId ?? "default",
        session_id: input.run.session_id,
        run_id: input.run.id,
        type: "table",
        name,
        source_path: path,
        preview_json: input.result,
        metadata
      });
    } catch {
      return this.artifactService.createArtifact({
        user_id: input.userId,
        session_id: input.run.session_id,
        run_id: input.run.id,
        type: "table",
        name,
        preview_json: input.result,
        metadata_json: { ...metadata, full_result: false }
      });
    }
  }

  private createAdapter(dataSource: DataSourceRecord, workspaceId = this.policy.workspaceId ?? "default"): DataSourceAdapter {
    const credentials = dataSource.credential_ref
      ? this.metadataStore.secrets.get({
          ref: dataSource.credential_ref,
          workspace_id: workspaceId,
          user_id: dataSource.user_id
        })
      : {};
    const resourcePolicy = dataSourcePolicy(dataSource);
    return createAdapter(dataSource, credentials, {
      timeoutMs: Math.min(this.policy.timeoutMs, resourcePolicy.timeoutMs ?? this.policy.timeoutMs)
    });
  }
}

type DataSourceAdapter = {
  inspectSchema(input?: AdapterExecutionInput): Promise<Omit<SchemaSummary, "datasource_id">>;
  previewTable(input: AdapterPreviewInput): Promise<TableResult>;
  runSqlReadonly(input: AdapterSqlInput): Promise<TableResult>;
};

type AdapterExecutionInput = {
  signal?: AbortSignal | undefined;
};

type AdapterPreviewInput = AdapterExecutionInput & {
  limit: number;
  table: string;
};

type AdapterSqlInput = AdapterExecutionInput & {
  limit: number;
  sql: string;
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
    enabled: true,
    label: "PostgreSQL",
    description: "PostgreSQL read-only datasource.",
    parameters: serverDatabaseParameters(5432)
  },
  {
    name: "mysql",
    enabled: true,
    label: "MySQL",
    description: "MySQL read-only datasource.",
    parameters: serverDatabaseParameters(3306)
  },
  {
    name: "clickhouse",
    enabled: true,
    label: "ClickHouse",
    description: "ClickHouse read-only datasource over the HTTP JSON interface.",
    parameters: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "port", label: "Port", type: "number", required: true, default_value: 8123 },
      { name: "database", label: "Database", type: "string", required: true },
      { name: "username", label: "Username", type: "string", required: false, default_value: "default" },
      { name: "password", label: "Password", type: "password", required: false },
      { name: "secure", label: "Use HTTPS", type: "boolean", required: false, default_value: false }
    ]
  }
];

const createAdapter = (
  dataSource: DataSourceRecord,
  credentials: Record<string, unknown> = {},
  effectivePolicy: { timeoutMs?: number } = {}
): DataSourceAdapter => {
  const config = { ...parseConfig(dataSource), ...credentials, ...effectivePolicy };

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

  if (dataSource.type === "postgresql") {
    return new PostgreSqlAdapter(config);
  }

  if (dataSource.type === "mysql") {
    return new MySqlAdapter(config);
  }

  if (dataSource.type === "clickhouse") {
    return new ClickHouseAdapter(config);
  }

  throw new Error(`Unsupported data source type: ${dataSource.type}`);
};

class PostgreSqlAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "public");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position
    `, [schema], input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "public");
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(input.table)} LIMIT $1`,
      [input.limit],
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(input.sql, [], input.signal));
  }

  private async query(
    sql: string,
    values: unknown[] = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    const pool = new Pool({
      host: stringConfig(this.config, "host"),
      port: numberConfig(this.config, "port", 5432),
      database: stringConfig(this.config, "database"),
      user: stringConfig(this.config, "username"),
      password: stringConfig(this.config, "password"),
      max: 1,
      statement_timeout: numberConfig(this.config, "timeoutMs", 30000)
    });
    let client: PoolClient | undefined;
    let aborted = false;
    const abort = (): void => {
      aborted = true;
      client?.release(true);
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      client = await pool.connect();
      throwIfAborted(signal);
      await client.query("BEGIN READ ONLY");
      const result = await client.query(sql, values);
      throwIfAborted(signal);
      await client.query("ROLLBACK");
      return result.rows.filter(isRecord);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (client) {
        client.release(aborted);
      }
      await pool.end();
    }
  }
}

class MySqlAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const database = stringConfig(this.config, "database");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, ordinal_position
    `, [database], input.signal);
    return schemaRowsToSummary(rows, "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteMysqlIdentifier(input.table)} LIMIT ?`,
      [input.limit],
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(input.sql, [], input.signal));
  }

  private async query(
    sql: string,
    values: unknown[] = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    let connection: Connection | undefined;
    const abort = (): void => {
      connection?.destroy();
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      connection = await createConnection({
        host: stringConfig(this.config, "host"),
        port: numberConfig(this.config, "port", 3306),
        database: stringConfig(this.config, "database"),
        user: stringConfig(this.config, "username"),
        password: stringConfig(this.config, "password"),
        connectTimeout: numberConfig(this.config, "timeoutMs", 30000)
      });
      throwIfAborted(signal);
      await connection.query("SET TRANSACTION READ ONLY");
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>({
        sql,
        timeout: numberConfig(this.config, "timeoutMs", 30000)
      }, values);
      throwIfAborted(signal);
      await connection.rollback();
      return rows.filter(isRecord);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        connection?.destroy();
      } else {
        await connection?.end();
      }
    }
  }
}

class ClickHouseAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const database = stringConfig(this.config, "database");
    const rows = await this.query(`
      SELECT
        table AS table_name,
        name AS column_name,
        type AS data_type,
        if(startsWith(type, 'Nullable('), 'YES', 'NO') AS is_nullable
      FROM system.columns
      WHERE database = ${clickHouseLiteral(database)}
      ORDER BY table, position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const database = stringConfig(this.config, "database");
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteClickHouseIdentifier(database)}.${quoteClickHouseIdentifier(input.table)} LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(input.sql, input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    const requestSignal = combineAbortSignals(signal, AbortSignal.timeout(numberConfig(this.config, "timeoutMs", 30000)));
    const response = await fetch(this.endpointUrl(), {
      method: "POST",
      headers: this.headers(),
      body: `${withClickHouseJsonFormat(sql)}\n`,
      ...(requestSignal ? { signal: requestSignal } : {})
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`CLICKHOUSE_QUERY_FAILED:${response.status}:${body.slice(0, 500)}`);
    }
    const parsed: unknown = body ? JSON.parse(body) : {};
    if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
      throw new Error("CLICKHOUSE_JSON_RESULT_INVALID");
    }
    return parsed.data.filter(isRecord);
  }

  private endpointUrl(): string {
    const configuredUrl = optionalStringConfig(this.config, "url");
    const url = configuredUrl
      ? new URL(configuredUrl)
      : new URL(
          `${booleanConfig(this.config, "secure", false) ? "https" : "http"}://`
          + `${stringConfig(this.config, "host")}:${numberConfig(this.config, "port", 8123)}`
        );
    url.searchParams.set("database", stringConfig(this.config, "database"));
    url.searchParams.set("default_format", "JSON");
    url.searchParams.set("readonly", "1");
    url.searchParams.set("max_execution_time", String(Math.ceil(numberConfig(this.config, "timeoutMs", 30000) / 1000)));
    return url.toString();
  }

  private headers(): Record<string, string> {
    const username = optionalStringConfig(this.config, "username") ?? "default";
    const password = optionalStringConfig(this.config, "password");
    return {
      "Content-Type": "text/plain; charset=utf-8",
      "X-ClickHouse-User": username,
      ...(password ? { "X-ClickHouse-Key": password } : {})
    };
  }
}

class SQLiteAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
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

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ?`).all(input.limit);
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    // node:sqlite DatabaseSync is synchronous; cancellation is cooperative before
    // statement execution. Hard cancel would require worker-thread isolation.
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

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const tables = demoTables(this.config);

    return {
      tables: tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({ name: column, type: inferColumnType(table.rows, column) }))
      }))
    };
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const table = demoTables(this.config).find((candidate) => candidate.name === input.table);

    if (!table) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows.slice(0, input.limit), table.columns);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return executeSimpleSelectOnTables(demoTables(this.config), input.sql, input.limit);
  }
}

class CsvAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const table = this.readTable(100, input.signal);

    return {
      tables: [
        {
          name: table.name,
          columns: table.columns.map((column) => ({ name: column, type: inferCsvColumnType(table.rows, column) }))
        }
      ]
    };
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const table = this.readTable(input.limit, input.signal);

    if (input.table !== table.name) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows, table.columns);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return executeSimpleSelectOnTables([this.readTable(input.limit, input.signal)], input.sql, input.limit);
  }

  private readTable(limit: number, signal?: AbortSignal | undefined): DatasetTable {
    throwIfAborted(signal);
    const filePath = stringConfig(this.config, "file_path");
    const raw = readFileSync(filePath, "utf8");
    throwIfAborted(signal);
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

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const table = await this.readTable(100, input.signal);

    return {
      tables: [
        {
          name: table.name,
          columns: table.columns.map((column) => ({ name: column, type: inferCsvColumnType(table.rows, column) }))
        }
      ]
    };
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const table = await this.readTable(input.limit, input.signal);

    if (input.table !== table.name) {
      throw new Error(`Table not found: ${input.table}`);
    }

    return objectRowsToTableResult(table.rows, table.columns);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return executeSimpleSelectOnTables([await this.readTable(input.limit, input.signal)], input.sql, input.limit);
  }

  private async readTable(limit: number, signal?: AbortSignal | undefined): Promise<DatasetTable> {
    throwIfAborted(signal);
    const filePath = stringConfig(this.config, "file_path");
    const rows = normalizeXlsxRows(await readXlsxFile(filePath, { dateFormat: "yyyy-mm-dd" }));
    throwIfAborted(signal);
    const columns = (rows[0] ?? []).map((value: unknown) => String(value ?? ""));
    const objectRows = rows.slice(1, limit + 1).map((row) => columnsToObject(columns, row));

    return {
      name: stringConfig(this.config, "table_name", "dataset"),
      columns,
      rows: objectRows
    };
  }
}

const normalizeXlsxRows = (value: unknown): unknown[][] => {
  if (Array.isArray(value) && value.every(Array.isArray)) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0 && isRecord(value[0]) && Array.isArray(value[0].data)) {
    const firstSheetRows = value[0].data;

    if (firstSheetRows.every(Array.isArray)) {
      return firstSheetRows;
    }
  }

  throw new Error("Unsupported XLSX row format");
};

type DatasetTable = {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

const dataSourceRecordToSummary = (record: DataSourceRecord): DataSourceSummary => ({
  id: record.id,
  name: record.name,
  type: record.type,
  status: record.status === "deleted" ? "disabled" : record.status,
  ...(record.description ? { description: record.description } : {})
});

const parseConfig = (dataSource: DataSourceRecord): Record<string, unknown> =>
  JSON.parse(dataSource.config_json) as Record<string, unknown>;

const dataSourcePolicy = (dataSource: DataSourceRecord): DataSourceRuntimePolicy => {
  const config = parseConfig(dataSource);
  const queryPolicy = isRecord(config.queryPolicy) ? config.queryPolicy : {};
  const introspectionPolicy = isRecord(config.introspection) ? config.introspection : {};
  const samplePolicy = isRecord(config.samplePolicy) ? config.samplePolicy : {};
  const maxRows = positiveNumber(queryPolicy.maxRows);
  const timeoutMs = positiveNumber(queryPolicy.timeoutMs);
  const maxSampleRows = positiveNumber(samplePolicy.maxSampleRows);
  return {
    ...(typeof samplePolicy.allowSample === "boolean" ? { allowSample: samplePolicy.allowSample } : {}),
    ...(maxRows !== undefined ? { maxRows } : {}),
    ...(maxSampleRows !== undefined ? { maxSampleRows } : {}),
    maskFields: stringArray(config.maskFields),
    tableAllowlist: stringArray(introspectionPolicy.tableAllowlist),
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  };
};

const allowedTableSet = (requestedTables: string[] | undefined, policyTables: string[]): Set<string> => {
  const requested = requestedTables ?? [];
  if (requested.length > 0 && policyTables.length > 0) {
    return new Set(requested.filter((table) => policyTables.includes(table)));
  }
  return new Set(requested.length > 0 ? requested : policyTables);
};

const assertTableAllowed = (table: string, policy: DataSourceRuntimePolicy): void => {
  if (policy.tableAllowlist.length > 0 && !policy.tableAllowlist.includes(table)) {
    throw new Error(`TABLE_NOT_ALLOWED:${table}`);
  }
};

const assertSqlTablesAllowed = (sql: string, policy: DataSourceRuntimePolicy): void => {
  if (policy.tableAllowlist.length === 0) {
    return;
  }
  const tableNames = extractSqlTableNames(sql);
  const blocked = tableNames.filter((table) => !policy.tableAllowlist.includes(table));
  if (blocked.length > 0) {
    throw new Error(`TABLE_NOT_ALLOWED:${blocked.join(",")}`);
  }
};

const extractSqlTableNames = (sql: string): string[] => {
  const stripped = stripQuotedSql(sql);
  const names = new Set<string>();
  const pattern = /\b(?:FROM|JOIN)\s+((?:"[^"]+"|`[^`]+`|[\w-]+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|[\w-]+))?)/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripped)) !== null) {
    const rawName = match[1];
    if (rawName) {
      names.add(unqualifiedTableName(rawName));
    }
  }
  return [...names];
};

const unqualifiedTableName = (value: string): string => {
  const segment = value.split(".").at(-1) ?? value;
  return unquoteIdentifier(segment.trim().replace(/^`|`$/gu, ""));
};

const maskTableResult = (result: TableResult, maskFields: string[]): TableResult => {
  if (maskFields.length === 0) {
    return result;
  }
  const maskedColumnNames = new Set(maskFields.map((field) => field.toLowerCase()));
  const maskedIndexes = result.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => maskedColumnNames.has(column.toLowerCase()))
    .map(({ index }) => index);
  if (maskedIndexes.length === 0) {
    return result;
  }
  return {
    ...result,
    rows: result.rows.map((row) =>
      row.map((value, index) => maskedIndexes.includes(index) && value !== null ? "[MASKED]" : value))
  };
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
    : [];

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

function serverDatabaseParameters(defaultPort: number): ConfigurableParam[] {
  return [
    { name: "host", label: "Host", type: "string", required: true },
    { name: "port", label: "Port", type: "number", required: true, default_value: defaultPort },
    { name: "database", label: "Database", type: "string", required: true },
    { name: "schema", label: "Schema", type: "string", required: false },
    { name: "username", label: "Username", type: "string", required: true },
    { name: "password", label: "Password", type: "password", required: true }
  ];
}

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

const optionalStringConfig = (config: Record<string, unknown>, key: string): string | undefined => {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const numberConfig = (config: Record<string, unknown>, key: string, defaultValue: number): number => {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return defaultValue;
};

const booleanConfig = (config: Record<string, unknown>, key: string, defaultValue: boolean): boolean => {
  const value = config[key];
  return typeof value === "boolean" ? value : defaultValue;
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

const writeSqlResultCsv = (auditId: string, result: TableResult): string => {
  const root = process.env.SQL_RESULT_EXPORT_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "sql-results");
  mkdirSync(root, { recursive: true });
  const path = join(root, `${auditId}.csv`);
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  const lines = [
    result.columns.map(escape).join(","),
    ...result.rows.map((row) => row.map(escape).join(","))
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const quoteMysqlIdentifier = (identifier: string): string => `\`${identifier.replaceAll("`", "``")}\``;

const quoteClickHouseIdentifier = (identifier: string): string => `\`${identifier.replaceAll("`", "``")}\``;

const clickHouseLiteral = (value: string): string => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const withClickHouseJsonFormat = (sql: string): string =>
  /\bFORMAT\s+\w+\s*$/iu.test(sql)
    ? sql.replace(/\bFORMAT\s+\w+\s*$/iu, "FORMAT JSON")
    : `${sql} FORMAT JSON`;

const schemaRowsToSummary = (
  rows: Record<string, unknown>[],
  tableKey: string,
  columnKey: string,
  typeKey: string,
  nullableKey: string
): Omit<SchemaSummary, "datasource_id"> => {
  const tables = new Map<string, SchemaSummary["tables"][number]>();
  rows.forEach((row) => {
    const tableName = requiredRecordString(row, tableKey);
    const table = tables.get(tableName) ?? { name: tableName, columns: [] };
    table.columns.push({
      name: requiredRecordString(row, columnKey),
      type: requiredRecordString(row, typeKey),
      nullable: requiredRecordString(row, nullableKey).toUpperCase() === "YES"
    });
    tables.set(tableName, table);
  });
  return { tables: [...tables.values()] };
};

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
  const values = rows
    .map((row) => row[column])
    .filter((value) => value !== null && value !== undefined && value !== "");

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
    {
      order_id: "o_001", channel: "search", category: "electronics", user_type: "new",
      gmv: 1280, created_at: "2026-05-18"
    },
    {
      order_id: "o_002", channel: "social", category: "beauty", user_type: "returning",
      gmv: 640, created_at: "2026-05-19"
    },
    {
      order_id: "o_003", channel: "direct", category: "home", user_type: "returning",
      gmv: 920, created_at: "2026-05-20"
    }
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

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal | undefined
): Promise<T> => {
  throwIfAborted(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("SQL_TIMEOUT")), timeoutMs);
    });
    const aborted = signal
      ? new Promise<T>((_, reject) => {
          abortListener = () => reject(signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
          signal.addEventListener("abort", abortListener, { once: true });
        })
      : undefined;
    return await Promise.race(aborted ? [promise, timeout, aborted] : [promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
  }
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isAbortError = (error: Error): boolean =>
  error.name === "AbortError"
  || error.message === "RUN_CANCELLED"
  || error.message.startsWith("RUN_CANCELLED")
  || error.message.startsWith("RUN_TIMEOUT:")
  || error.message === "RUN_SUBSCRIBER_CLOSED";

const combineAbortSignals = (
  first?: AbortSignal | undefined,
  second?: AbortSignal | undefined
): AbortSignal | undefined => {
  const signals = [first, second].filter((signal): signal is AbortSignal => Boolean(signal));
  if (signals.length === 0) {
    return undefined;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  if (signals.some((signal) => signal.aborted)) {
    const controller = new AbortController();
    const aborted = signals.find((signal) => signal.aborted);
    controller.abort(aborted?.reason ?? new Error("RUN_CANCELLED"));
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = (event: Event): void => {
    const signal = event.target instanceof AbortSignal ? event.target : undefined;
    controller.abort(signal?.reason ?? new Error("RUN_CANCELLED"));
  };
  signals.forEach((signal) => signal.addEventListener("abort", abort, { once: true }));
  return controller.signal;
};

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

const unquoteIdentifier = (identifier: string): string =>
  identifier.replace(/^"/u, "").replace(/"$/u, "").replaceAll('""', '"');
