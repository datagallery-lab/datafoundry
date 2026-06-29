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
import type * as BigQueryModule from "@google-cloud/bigquery";
import type * as DuckDbModule from "duckdb";
import type * as ElasticSearchModule from "@elastic/elasticsearch";
import type * as HiveDriverModule from "hive-driver";
import type * as MongoDbModule from "mongodb";
import type * as MsSqlModule from "mssql";
import type * as OdbcModule from "odbc";
import type * as OpenSearchModule from "@opensearch-project/opensearch";
import type * as OracleDbModule from "oracledb";
import type * as RedisModule from "redis";
import type * as SnowflakeModule from "snowflake-sdk";

export type DataSourceType =
  | "duckdb"
  | "sqlite"
  | "csv"
  | "xlsx"
  | "postgresql"
  | "mysql"
  | "clickhouse"
  | "snowflake"
  | "bigquery"
  | "sqlserver"
  | "oracle"
  | "mongodb"
  | "gaussdb"
  | "access"
  | "redis"
  | "starrocks"
  | "trino"
  | "presto"
  | "spark"
  | "databricks"
  | "redshift"
  | "elasticsearch"
  | "opensearch"
  | "doris"
  | "mariadb"
  | "tidb"
  | "oceanbase"
  | "greenplum"
  | string;

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
          sql: guard.normalized_sql,
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
    description: "Local analytical datasource. Supports the built-in demo mode and real DuckDB database files.",
    parameters: [
      { name: "mode", label: "Mode", type: "select", required: false, options: ["demo", "file"] },
      { name: "path", label: "Database Path", type: "file", required: false }
    ]
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
  },
  {
    name: "snowflake",
    enabled: true,
    label: "Snowflake",
    description: "Snowflake read-only datasource.",
    parameters: [
      { name: "account", label: "Account", type: "string", required: true },
      { name: "warehouse", label: "Warehouse", type: "string", required: true },
      { name: "database", label: "Database", type: "string", required: true },
      { name: "schema", label: "Schema", type: "string", required: false, default_value: "PUBLIC" },
      { name: "role", label: "Role", type: "string", required: false },
      { name: "username", label: "Username", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true }
    ]
  },
  {
    name: "bigquery",
    enabled: true,
    label: "BigQuery",
    description: "Google BigQuery read-only datasource.",
    parameters: [
      { name: "projectId", label: "Project ID", type: "string", required: true },
      { name: "dataset", label: "Dataset", type: "string", required: true },
      { name: "location", label: "Location", type: "string", required: false },
      { name: "credentialsJson", label: "Credentials JSON", type: "password", required: false },
      { name: "keyFilename", label: "Key File", type: "file", required: false }
    ]
  },
  {
    name: "sqlserver",
    enabled: true,
    label: "SQL Server",
    description: "Microsoft SQL Server read-only datasource.",
    parameters: serverDatabaseParameters(1433)
  },
  {
    name: "oracle",
    enabled: true,
    label: "Oracle",
    description: "Oracle Database read-only datasource.",
    parameters: [
      { name: "connectString", label: "Connect String", type: "string", required: true },
      { name: "schema", label: "Schema", type: "string", required: false },
      { name: "username", label: "Username", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true }
    ]
  },
  {
    name: "mongodb",
    enabled: true,
    label: "MongoDB",
    description: "MongoDB read-only datasource with simple SELECT-to-find mapping.",
    parameters: [
      { name: "uri", label: "URI", type: "password", required: true },
      { name: "database", label: "Database", type: "string", required: true },
      { name: "sampleSize", label: "Schema Sample Size", type: "number", required: false, default_value: 20 }
    ]
  },
  {
    name: "gaussdb",
    enabled: true,
    label: "GaussDB",
    description: "GaussDB PostgreSQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(5432)
  },
  {
    name: "access",
    enabled: true,
    label: "Microsoft Access",
    description: "Microsoft Access read-only datasource over ODBC.",
    parameters: [
      { name: "connectionString", label: "ODBC Connection String", type: "password", required: false },
      { name: "path", label: "Access File Path", type: "file", required: false }
    ]
  },
  {
    name: "redis",
    enabled: true,
    label: "Redis",
    description: "Redis read-only keyspace datasource exposed as the redis_keys pseudo table.",
    parameters: [
      { name: "url", label: "URL", type: "password", required: true },
      { name: "keyPattern", label: "Key Pattern", type: "string", required: false, default_value: "*" },
      { name: "database", label: "Database", type: "number", required: false, default_value: 0 }
    ]
  },
  {
    name: "starrocks",
    enabled: true,
    label: "StarRocks",
    description: "StarRocks MySQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(9030)
  },
  {
    name: "trino",
    enabled: true,
    label: "Trino",
    description: "Trino read-only datasource over the Trino REST API.",
    parameters: trinoLikeParameters(8080)
  },
  {
    name: "presto",
    enabled: true,
    label: "Presto",
    description: "Presto read-only datasource over the Presto REST API.",
    parameters: trinoLikeParameters(8080)
  },
  {
    name: "spark",
    enabled: true,
    label: "Spark SQL",
    description: "Spark Thrift Server read-only datasource over HiveServer2 protocol.",
    parameters: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "port", label: "Port", type: "number", required: true, default_value: 10000 },
      { name: "catalog", label: "Catalog", type: "string", required: false },
      { name: "schema", label: "Schema", type: "string", required: false, default_value: "default" },
      { name: "transport", label: "Transport", type: "select", required: false, options: ["tcp", "http"] },
      { name: "auth", label: "Auth", type: "select", required: false, options: ["none", "plain"] },
      { name: "username", label: "Username", type: "string", required: false },
      { name: "password", label: "Password", type: "password", required: false }
    ]
  },
  {
    name: "databricks",
    enabled: true,
    label: "Databricks SQL",
    description: "Databricks SQL Warehouse read-only datasource.",
    parameters: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "path", label: "HTTP Path", type: "string", required: true },
      { name: "warehouseId", label: "Warehouse ID", type: "string", required: false },
      { name: "token", label: "Token", type: "password", required: true },
      { name: "catalog", label: "Catalog", type: "string", required: false },
      { name: "schema", label: "Schema", type: "string", required: false }
    ]
  },
  {
    name: "redshift",
    enabled: true,
    label: "Amazon Redshift",
    description: "Amazon Redshift PostgreSQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(5439)
  },
  {
    name: "elasticsearch",
    enabled: true,
    label: "Elasticsearch",
    description: "Elasticsearch read-only datasource with index-as-table mapping.",
    parameters: searchIndexParameters()
  },
  {
    name: "opensearch",
    enabled: true,
    label: "OpenSearch",
    description: "OpenSearch read-only datasource with index-as-table mapping.",
    parameters: searchIndexParameters()
  },
  {
    name: "doris",
    enabled: true,
    label: "Apache Doris",
    description: "Apache Doris MySQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(9030)
  },
  {
    name: "mariadb",
    enabled: true,
    label: "MariaDB",
    description: "MariaDB MySQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(3306)
  },
  {
    name: "tidb",
    enabled: true,
    label: "TiDB",
    description: "TiDB MySQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(4000)
  },
  {
    name: "oceanbase",
    enabled: true,
    label: "OceanBase",
    description: "OceanBase MySQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(2881)
  },
  {
    name: "greenplum",
    enabled: true,
    label: "Greenplum",
    description: "Greenplum PostgreSQL-compatible read-only datasource.",
    parameters: serverDatabaseParameters(5432)
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
    return stringConfig(config, "mode", "file") === "demo" ? new DuckDbDemoAdapter(config) : new DuckDbAdapter(config);
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

  if (dataSource.type === "snowflake") {
    return new SnowflakeAdapter(config);
  }

  if (dataSource.type === "bigquery") {
    return new BigQueryAdapter(config);
  }

  if (dataSource.type === "sqlserver") {
    return new SqlServerAdapter(config);
  }

  if (dataSource.type === "oracle") {
    return new OracleAdapter(config);
  }

  if (dataSource.type === "mongodb") {
    return new MongoDbAdapter(config);
  }

  if (dataSource.type === "gaussdb") {
    return new GaussDbAdapter(config);
  }

  if (dataSource.type === "access") {
    return new AccessAdapter(config);
  }

  if (dataSource.type === "redis") {
    return new RedisAdapter(config);
  }

  if (dataSource.type === "starrocks") {
    return new StarRocksAdapter(config);
  }

  if (dataSource.type === "trino") {
    return new TrinoAdapter(config);
  }

  if (dataSource.type === "presto") {
    return new PrestoAdapter(config);
  }

  if (dataSource.type === "spark") {
    return new SparkSqlAdapter(config);
  }

  if (dataSource.type === "databricks") {
    return new DatabricksSqlAdapter(config);
  }

  if (dataSource.type === "redshift") {
    return new RedshiftAdapter(config);
  }

  if (dataSource.type === "elasticsearch") {
    return new ElasticsearchAdapter(config);
  }

  if (dataSource.type === "opensearch") {
    return new OpenSearchAdapter(config);
  }

  if (dataSource.type === "doris") {
    return new DorisAdapter(config);
  }

  if (dataSource.type === "mariadb") {
    return new MariaDbAdapter(config);
  }

  if (dataSource.type === "tidb") {
    return new TiDbAdapter(config);
  }

  if (dataSource.type === "oceanbase") {
    return new OceanBaseAdapter(config);
  }

  if (dataSource.type === "greenplum") {
    return new GreenplumAdapter(config);
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
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), [], input.signal));
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
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), [], input.signal));
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
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
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

class SnowflakeAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "PUBLIC");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, ordinal_position
    `, [schema.toUpperCase()], input.signal);
    return schemaRowsToSummary(rows, "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "PUBLIC");
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteSnowflakeIdentifier(schema)}.${quoteSnowflakeIdentifier(input.table)} LIMIT ?`,
      [input.limit],
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), [], input.signal));
  }

  private async query(
    sql: string,
    binds: SnowflakeModule.Binds = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    const snowflake = await loadSnowflake();
    const connection = snowflake.createConnection({
      account: stringConfig(this.config, "account"),
      username: stringConfig(this.config, "username"),
      password: stringConfig(this.config, "password"),
      warehouse: stringConfig(this.config, "warehouse"),
      database: stringConfig(this.config, "database"),
      schema: stringConfig(this.config, "schema", "PUBLIC"),
      ...optionalConfigString(this.config, "role", "role"),
      timeout: numberConfig(this.config, "timeoutMs", 30000)
    });
    try {
      await snowflakeConnect(connection, signal);
      return await snowflakeExecute(connection, sql, binds, signal);
    } finally {
      await snowflakeDestroy(connection);
    }
  }
}

class BigQueryAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const dataset = stringConfig(this.config, "dataset");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM ${quoteBigQueryIdentifier(this.projectId(), dataset, "INFORMATION_SCHEMA.COLUMNS")}
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteBigQueryIdentifier(this.projectId(), stringConfig(this.config, "dataset"), input.table)}
       LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private projectId(): string {
    return stringConfig(this.config, "projectId");
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    const bigquery = await loadBigQuery();
    const credentialsJson = optionalStringConfig(this.config, "credentialsJson");
    const keyFilename = optionalStringConfig(this.config, "keyFilename");
    const client = new bigquery.BigQuery({
      projectId: this.projectId(),
      ...(credentialsJson ? { credentials: JSON.parse(credentialsJson) as Record<string, unknown> } : {}),
      ...(keyFilename ? { keyFilename } : {})
    });
    const location = optionalStringConfig(this.config, "location");
    const queryOptions: BigQueryModule.Query = {
      query: sql,
      useLegacySql: false,
      ...(location ? { location } : {})
    };
    const [rows] = await client.query(queryOptions) as unknown as [unknown[]];
    throwIfAborted(signal);
    return rows.filter(isRecord);
  }
}

class SqlServerAdapter implements DataSourceAdapter {
  constructor(protected readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "dbo");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = @schema
      ORDER BY table_name, ordinal_position
    `, { schema }, input.signal);
    return schemaRowsToSummary(rows, "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "dbo");
    return rowsToTableResult(await this.query(
      `SELECT TOP (${input.limit}) * FROM ${quoteSqlServerIdentifier(schema)}.${quoteSqlServerIdentifier(input.table)}`,
      {},
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyTopLimit(input.sql, input.limit), {}, input.signal));
  }

  protected async query(
    sql: string,
    parameters: Record<string, string | number>,
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    const mssql = await loadMsSql();
    const pool = new mssql.ConnectionPool({
      server: stringConfig(this.config, "host"),
      port: numberConfig(this.config, "port", 1433),
      database: stringConfig(this.config, "database"),
      user: stringConfig(this.config, "username"),
      password: stringConfig(this.config, "password"),
      requestTimeout: numberConfig(this.config, "timeoutMs", 30000),
      connectionTimeout: numberConfig(this.config, "timeoutMs", 30000),
      options: {
        encrypt: booleanConfig(this.config, "encrypt", true),
        trustServerCertificate: booleanConfig(this.config, "trustServerCertificate", false),
        readOnlyIntent: true
      }
    });
    const abort = (): void => {
      void pool.close().catch(() => undefined);
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await pool.connect();
      throwIfAborted(signal);
      const request = pool.request();
      Object.entries(parameters).forEach(([key, value]) => request.input(key, value));
      const result = await request.query(sql);
      throwIfAborted(signal);
      return result.recordset.filter(isRecord);
    } finally {
      signal?.removeEventListener("abort", abort);
      await pool.close();
    }
  }
}

class OracleAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", stringConfig(this.config, "username")).toUpperCase();
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, nullable AS is_nullable
      FROM all_tab_columns
      WHERE owner = :schema
      ORDER BY table_name, column_id
    `, { schema }, input.signal);
    return schemaRowsToSummary(rows, "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", stringConfig(this.config, "username"));
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteOracleIdentifier(schema)}.${quoteOracleIdentifier(input.table)} WHERE ROWNUM <= :limit`,
      { limit: input.limit },
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyRowNumLimit(input.sql, input.limit), {}, input.signal));
  }

  private async query(
    sql: string,
    bindParams: Record<string, string | number>,
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    const oracle = await loadOracleDb();
    const connection = await oracle.getConnection({
      user: stringConfig(this.config, "username"),
      password: stringConfig(this.config, "password"),
      connectString: stringConfig(this.config, "connectString")
    });
    const abort = (): void => {
      void connection.break();
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      const result = await connection.execute(sql, bindParams, {
        outFormat: oracle.OUT_FORMAT_OBJECT,
        maxRows: numberConfig(this.config, "maxRows", 1000)
      });
      throwIfAborted(signal);
      return Array.isArray(result.rows) ? result.rows.filter(isRecord) : [];
    } finally {
      signal?.removeEventListener("abort", abort);
      await connection.close();
    }
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
      const rows = database.prepare(applyStandardLimit(input.sql, input.limit)).all();
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

class DuckDbAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    const duckdb = await loadDuckDb();
    const database = new duckdb.Database(stringConfig(this.config, "path", ":memory:"));
    const connection = database.connect();
    try {
      const rows = await duckDbAll(connection, sql, signal);
      return rows.filter(isRecord);
    } finally {
      await duckDbClose(connection);
      await duckDbCloseDatabase(database);
    }
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

class MongoDbAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    return await this.withDb(async (db) => {
      const collections = await db.listCollections().toArray();
      const sampleSize = numberConfig(this.config, "sampleSize", 20);
      const tables = [];
      for (const collectionInfo of collections.filter(isRecord)) {
        const name = requiredRecordString(collectionInfo, "name");
        const rows = await db.collection(name).find({}, { limit: sampleSize }).toArray();
        tables.push({
          name,
          columns: inferDocumentColumns(rows.filter(isRecord))
        });
      }
      return { tables };
    }, input.signal);
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return await this.withDb(async (db) => {
      const rows = await db.collection(input.table).find({}, { limit: input.limit }).toArray();
      return rowsToTableResult(rows.filter(isRecord).map(flattenDocument));
    }, input.signal);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const query = parseLimitedSimpleSelect(input.sql, input.limit);
    return await this.withDb(async (db) => {
      const rows = await db.collection(query.table).find({}, {
        limit: query.limit,
        projection: query.columns.length > 0 ? Object.fromEntries(query.columns.map((column) => [column, 1])) : {}
      }).toArray();
      return rowsToTableResult(rows.filter(isRecord).map(flattenDocument));
    }, input.signal);
  }

  private async withDb<T>(
    callback: (db: MongoDbModule.Db) => Promise<T>,
    signal?: AbortSignal | undefined
  ): Promise<T> {
    const mongodb = await loadMongoDb();
    const client = new mongodb.MongoClient(stringConfig(this.config, "uri"), {
      serverSelectionTimeoutMS: numberConfig(this.config, "timeoutMs", 30000)
    });
    const abort = (): void => {
      void client.close(true);
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await client.connect();
      throwIfAborted(signal);
      return await callback(client.db(stringConfig(this.config, "database")));
    } finally {
      signal?.removeEventListener("abort", abort);
      await client.close();
    }
  }
}

class GaussDbAdapter extends PostgreSqlAdapter {}

class AccessAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    return await this.withConnection(async (connection) => {
      const tableRows = await connection.tables(null, null, null, "TABLE");
      const tables = [];
      for (const row of tableRows.filter(isRecord)) {
        const tableName = odbcString(row, ["TABLE_NAME", "table_name"]);
        if (!tableName) {
          continue;
        }
        const columnRows = await connection.columns(null, null, tableName, null);
        tables.push({
          name: tableName,
          columns: columnRows.filter(isRecord).map((column) => ({
            name: odbcString(column, ["COLUMN_NAME", "column_name"]) ?? "",
            type: odbcString(column, ["TYPE_NAME", "type_name", "DATA_TYPE", "data_type"]) ?? "TEXT",
            nullable: odbcNullable(column)
          }))
        });
      }
      return { tables };
    }, input.signal);
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT TOP ${input.limit} * FROM ${quoteAccessIdentifier(input.table)}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyAccessLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    return await this.withConnection(async (connection) => {
      const rows = await connection.query<Record<string, unknown>>(sql);
      return rows.filter(isRecord);
    }, signal);
  }

  private async withConnection<T>(
    callback: (connection: OdbcModule.Connection) => Promise<T>,
    signal?: AbortSignal | undefined
  ): Promise<T> {
    const odbc = await loadOdbc();
    const connection = await odbc.connect({
      connectionString: accessConnectionString(this.config),
      connectionTimeout: numberConfig(this.config, "timeoutMs", 30000) / 1000,
      loginTimeout: numberConfig(this.config, "timeoutMs", 30000) / 1000
    });
    const abort = (): void => {
      void connection.close();
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await connection.setIsolationLevel(odbc.SQL_TXN_READ_COMMITTED);
      throwIfAborted(signal);
      return await callback(connection);
    } finally {
      signal?.removeEventListener("abort", abort);
      await connection.close();
    }
  }
}

class RedisAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    return {
      tables: [
        {
          name: "redis_keys",
          columns: [
            { name: "key", type: "TEXT", nullable: false },
            { name: "type", type: "TEXT", nullable: false },
            { name: "ttl", type: "INTEGER", nullable: true },
            { name: "value", type: "TEXT", nullable: true }
          ]
        }
      ]
    };
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    if (input.table !== "redis_keys") {
      throw new Error(`Table not found: ${input.table}`);
    }
    return await this.readKeys(input.limit, input.signal);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    const query = parseLimitedSimpleSelect(input.sql, input.limit);
    if (query.table !== "redis_keys") {
      throw new Error(`Table not found: ${query.table}`);
    }
    return await this.readKeys(query.limit, input.signal);
  }

  private async readKeys(limit: number, signal?: AbortSignal | undefined): Promise<TableResult> {
    const redis = await loadRedis();
    const client = redis.createClient({
      url: stringConfig(this.config, "url"),
      database: numberConfig(this.config, "database", 0)
    }) as RedisReadonlyClient;
    const abort = (): void => {
      void client.disconnect();
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await client.connect();
      const rows: Record<string, unknown>[] = [];
      const pattern = stringConfig(this.config, "keyPattern", "*");
      for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: Math.max(limit, 10) })) {
        const keys = Array.isArray(batch) ? batch : [batch];
        for (const key of keys) {
          if (rows.length >= limit) {
            return rowsToTableResult(rows);
          }
          rows.push(await this.redisKeyRow(client, key));
        }
      }
      return rowsToTableResult(rows);
    } finally {
      signal?.removeEventListener("abort", abort);
      await client.quit();
    }
  }

  private async redisKeyRow(client: RedisReadonlyClient, key: string): Promise<Record<string, unknown>> {
    const type = await client.type(key);
    const ttl = await client.ttl(key);
    return {
      key,
      type,
      ttl,
      value: await redisPreviewValue(client, key, type)
    };
  }
}

class StarRocksAdapter extends MySqlAdapter {}

class RedshiftAdapter extends PostgreSqlAdapter {}

class GreenplumAdapter extends PostgreSqlAdapter {}

class DorisAdapter extends MySqlAdapter {}

class MariaDbAdapter extends MySqlAdapter {}

class TiDbAdapter extends MySqlAdapter {}

class OceanBaseAdapter extends MySqlAdapter {}

class TrinoAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "default");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ${sqlLiteral(schema)}
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const catalog = stringConfig(this.config, "catalog");
    const schema = stringConfig(this.config, "schema", "default");
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteTrinoIdentifier(catalog)}.${quoteTrinoIdentifier(schema)}.${quoteTrinoIdentifier(input.table)}
       LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    return await queryTrinoCompatible(this.config, sql, "trino", signal);
  }
}

class PrestoAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "default");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ${sqlLiteral(schema)}
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const catalog = stringConfig(this.config, "catalog");
    const schema = stringConfig(this.config, "schema", "default");
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteTrinoIdentifier(catalog)}.${quoteTrinoIdentifier(schema)}.${quoteTrinoIdentifier(input.table)}
       LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    return await queryTrinoCompatible(this.config, sql, "presto", signal);
  }
}

class SparkSqlAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const catalog = optionalStringConfig(this.config, "catalog");
    const schema = stringConfig(this.config, "schema", "default");
    return await this.withSession(async (hive, session) => {
      const operation = await session.getColumns({
        ...(catalog ? { catalogName: catalog } : {}),
        schemaName: schema,
        tableName: "%",
        columnName: "%"
      });
      const rows = await sparkOperationRows(hive, operation, input.signal);
      return schemaRowsToSummary(rows, "TABLE_NAME", "COLUMN_NAME", "TYPE_NAME", "IS_NULLABLE");
    }, input.signal);
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const catalog = optionalStringConfig(this.config, "catalog");
    const schema = stringConfig(this.config, "schema", "default");
    const table = [catalog, schema, input.table].filter((part): part is string => Boolean(part))
      .map(quoteTrinoIdentifier).join(".");
    return rowsToTableResult(await this.query(`SELECT * FROM ${table} LIMIT ${input.limit}`, input.signal));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    return await this.withSession(async (hive, session) => {
      const operation = await session.executeStatement(sql, {
        runAsync: true,
        confOverlay: new Map([["spark.sql.thriftServer.interruptOnCancel", "true"]])
      });
      return await sparkOperationRows(hive, operation, signal);
    }, signal);
  }

  private async withSession<T>(
    callback: (hive: typeof HiveDriverModule, session: HiveSessionLike) => Promise<T>,
    signal?: AbortSignal | undefined
  ): Promise<T> {
    const hive = await loadHiveDriver();
    const client = new hive.HiveClient(hive.thrift.TCLIService, hive.thrift.TCLIService_types);
    const connection = stringConfig(this.config, "transport", "tcp") === "http"
      ? new hive.connections.HttpConnection()
      : new hive.connections.TcpConnection();
    const auth = sparkAuthProvider(hive, this.config);
    const abort = (): void => {
      client.close();
    };
    let session: HiveSessionLike | undefined;
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await client.connect(sparkConnectionOptions(this.config) as never, connection, auth as never);
      throwIfAborted(signal);
      session = await client.openSession({
        client_protocol: hive.thrift.TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10,
        ...optionalConfigString(this.config, "username")
      });
      return await callback(hive, session);
    } finally {
      signal?.removeEventListener("abort", abort);
      await session?.close().catch(() => undefined);
      client.close();
    }
  }
}

class DatabricksSqlAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "default");
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ${sqlLiteral(schema)}
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const catalog = optionalStringConfig(this.config, "catalog");
    const schema = stringConfig(this.config, "schema", "default");
    const table = [catalog, schema, input.table].filter((part): part is string => Boolean(part))
      .map(quoteTrinoIdentifier).join(".");
    return rowsToTableResult(await this.query(`SELECT * FROM ${table} LIMIT ${input.limit}`, input.signal));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    return await queryDatabricksSql(this.config, sql, signal);
  }
}

class ElasticsearchAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const elasticsearch = await loadElasticSearch();
    const client = new elasticsearch.Client(searchClientOptions(this.config));
    const mappings = await client.indices.getMapping({ index: searchIndexPattern(this.config) });
    return searchMappingsToSchema(mappings as unknown);
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return await this.search(input.table, input.limit, input.signal);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const query = parseLimitedSimpleSelect(input.sql, input.limit);
    return await this.search(query.table, query.limit, input.signal, query.columns);
  }

  private async search(
    index: string,
    limit: number,
    signal?: AbortSignal | undefined,
    columns: string[] = []
  ): Promise<TableResult> {
    const elasticsearch = await loadElasticSearch();
    const client = new elasticsearch.Client(searchClientOptions(this.config));
    const result = await client.search({
      index,
      size: limit,
      _source: columns.length > 0 ? columns : true,
      query: { match_all: {} }
    }, signal ? ({ signal } as never) : undefined);
    return searchHitsToTableResult(result as unknown);
  }
}

class OpenSearchAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const opensearch = await loadOpenSearch();
    const client = new opensearch.Client(searchClientOptions(this.config));
    const mappings = await client.indices.getMapping({ index: searchIndexPattern(this.config) });
    return searchMappingsToSchema(mappings as unknown);
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return await this.search(input.table, input.limit, input.signal);
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const query = parseLimitedSimpleSelect(input.sql, input.limit);
    return await this.search(query.table, query.limit, input.signal, query.columns);
  }

  private async search(
    index: string,
    limit: number,
    signal?: AbortSignal | undefined,
    columns: string[] = []
  ): Promise<TableResult> {
    const opensearch = await loadOpenSearch();
    const client = new opensearch.Client(searchClientOptions(this.config));
    const result = await client.search({
      index,
      size: limit,
      _source: columns.length > 0 ? columns : true,
      body: { query: { match_all: {} } }
    }, signal ? ({ signal } as never) : undefined);
    return searchHitsToTableResult(result as unknown);
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

function trinoLikeParameters(defaultPort: number): ConfigurableParam[] {
  return [
    { name: "host", label: "Host", type: "string", required: true },
    { name: "port", label: "Port", type: "number", required: true, default_value: defaultPort },
    { name: "catalog", label: "Catalog", type: "string", required: true },
    { name: "schema", label: "Schema", type: "string", required: false, default_value: "default" },
    { name: "username", label: "Username", type: "string", required: false },
    { name: "password", label: "Password", type: "password", required: false },
    { name: "secure", label: "Use HTTPS", type: "boolean", required: false, default_value: false }
  ];
}

function searchIndexParameters(): ConfigurableParam[] {
  return [
    { name: "node", label: "Node URL", type: "password", required: false },
    { name: "url", label: "Node URL", type: "password", required: false },
    { name: "indexPattern", label: "Index Pattern", type: "string", required: false, default_value: "*" },
    { name: "username", label: "Username", type: "string", required: false },
    { name: "password", label: "Password", type: "password", required: false },
    { name: "apiKey", label: "API Key", type: "password", required: false }
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

const optionalConfigString = (config: Record<string, unknown>, key: string, targetKey = key): Record<string, string> => {
  const value = optionalStringConfig(config, key);
  return value ? { [targetKey]: value } : {};
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

const requiredRecordStringLoose = (row: unknown, key: string): string => {
  if (!isRecord(row)) {
    throw new Error(`Expected string column: ${key}`);
  }
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }
  return value;
};

const odbcString = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  const value = keys.map((key) => row[key]).find((candidate) => typeof candidate === "string");
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const odbcNullable = (row: Record<string, unknown>): boolean => {
  const value = row.NULLABLE ?? row.nullable;
  return value === true || value === 1 || value === "1" || value === "YES";
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

type RedisReadonlyClient = {
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  quit(): Promise<unknown>;
  scanIterator(input: { COUNT: number; MATCH: string }): AsyncIterable<string[] | string>;
  type(key: string): Promise<string>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  hGetAll(key: string): Promise<Record<string, string>>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  sMembers(key: string): Promise<string[]>;
  zRange(key: string, start: number, stop: number): Promise<string[]>;
};

type HiveSessionLike = {
  close(): Promise<unknown>;
  executeStatement(statement: string, options?: Record<string, unknown>): Promise<HiveOperationLike>;
  getColumns(request: Record<string, string>): Promise<HiveOperationLike>;
};

type HiveOperationLike = {
  close(): Promise<unknown>;
  setMaxRows(maxRows: number): void;
};

type TrinoCompatiblePage = {
  columns?: Array<{ name: string; type?: string }>;
  data?: unknown[][];
  nextUri?: string;
};

type DatabricksStatementResponse = {
  manifest?: {
    schema?: {
      columns?: Array<{ name: string; type_name?: string; type_text?: string }>;
    };
  };
  result?: {
    data_array?: unknown[][];
    next_chunk_internal_link?: string;
  };
  statement_id?: string;
  status?: {
    error?: { message?: string };
    state?: string;
  };
};

type LimitedSimpleSelect = {
  columns: string[];
  limit: number;
  table: string;
};

const loadDuckDb = async (): Promise<typeof DuckDbModule> => {
  const loaded = await import("duckdb") as unknown as { default?: typeof DuckDbModule } & typeof DuckDbModule;
  return loaded.default ?? loaded;
};

const loadSnowflake = async (): Promise<typeof SnowflakeModule> => {
  const loaded = await import("snowflake-sdk") as unknown as { default?: typeof SnowflakeModule } & typeof SnowflakeModule;
  return loaded.default ?? loaded;
};

const loadBigQuery = async (): Promise<typeof BigQueryModule> => await import("@google-cloud/bigquery");

const loadMsSql = async (): Promise<typeof MsSqlModule> => {
  const loaded = await import("mssql") as unknown as { default?: typeof MsSqlModule } & typeof MsSqlModule;
  return loaded.default ?? loaded;
};

const loadOracleDb = async (): Promise<typeof OracleDbModule> => {
  const loaded = await import("oracledb") as unknown as { default?: typeof OracleDbModule } & typeof OracleDbModule;
  return loaded.default ?? loaded;
};

const loadMongoDb = async (): Promise<typeof MongoDbModule> => await import("mongodb");

const loadOdbc = async (): Promise<typeof OdbcModule> => {
  const loaded = await import("odbc") as unknown as { default?: typeof OdbcModule } & typeof OdbcModule;
  return loaded.default ?? loaded;
};

const loadRedis = async (): Promise<typeof RedisModule> => await import("redis");

const loadHiveDriver = async (): Promise<typeof HiveDriverModule> => {
  const loaded = await import("hive-driver") as unknown as { default?: typeof HiveDriverModule } & typeof HiveDriverModule;
  return loaded.default ?? loaded;
};

const loadElasticSearch = async (): Promise<typeof ElasticSearchModule> => await import("@elastic/elasticsearch");

const loadOpenSearch = async (): Promise<typeof OpenSearchModule> => await import("@opensearch-project/opensearch");

const duckDbAll = async (
  connection: DuckDbModule.Connection,
  sql: string,
  signal?: AbortSignal | undefined
): Promise<DuckDbModule.TableData> =>
  await new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    connection.all(sql, (error, rows) => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });

const duckDbCloseDatabase = async (database: DuckDbModule.Database): Promise<void> =>
  await new Promise((resolve, reject) => {
    database.close((error) => error ? reject(error) : resolve());
  });

const snowflakeConnect = async (
  connection: SnowflakeModule.Connection,
  signal?: AbortSignal | undefined
): Promise<void> =>
  await new Promise((resolve, reject) => {
    const abort = (): void => {
      connection.destroy(() => undefined);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    connection.connect((error) => {
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    });
  });

const snowflakeExecute = async (
  connection: SnowflakeModule.Connection,
  sql: string,
  binds: SnowflakeModule.Binds,
  signal?: AbortSignal | undefined
): Promise<Record<string, unknown>[]> =>
  await new Promise((resolve, reject) => {
    const abort = (): void => {
      connection.destroy(() => undefined);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    connection.execute({
      sqlText: sql,
      binds,
      complete: (error, _statement, rows) => {
        signal?.removeEventListener("abort", abort);
        if (error) {
          reject(error);
        } else {
          resolve((rows ?? []).filter(isRecord));
        }
      }
    });
  });

const snowflakeDestroy = async (connection: SnowflakeModule.Connection): Promise<void> =>
  await new Promise((resolve) => {
    connection.destroy(() => resolve());
  });

const queryTrinoCompatible = async (
  config: Record<string, unknown>,
  sql: string,
  protocol: "presto" | "trino",
  signal?: AbortSignal | undefined
): Promise<Record<string, unknown>[]> => {
  const headerPrefix = protocol === "trino" ? "X-Trino" : "X-Presto";
  const requestHeaders = trinoCompatibleHeaders(config, headerPrefix);
  const rows: Record<string, unknown>[] = [];
  let columns: string[] = [];
  let nextUri: string | undefined;
  let response = await fetch(trinoStatementUrl(config), {
    method: "POST",
    headers: requestHeaders,
    body: sql,
    ...(signal ? { signal } : {})
  });
  for (;;) {
    const page = await parseTrinoCompatibleResponse(response);
    if (Array.isArray(page.columns) && columns.length === 0) {
      columns = page.columns.map((column) => column.name);
    }
    if (Array.isArray(page.data)) {
      rows.push(...arrayRowsToRecords(columns, page.data));
    }
    nextUri = typeof page.nextUri === "string" ? page.nextUri : undefined;
    if (!nextUri) {
      return rows;
    }
    throwIfAborted(signal);
    response = await fetch(nextUri, { headers: requestHeaders, ...(signal ? { signal } : {}) });
  }
};

const trinoCompatibleHeaders = (config: Record<string, unknown>, prefix: "X-Presto" | "X-Trino"): HeadersInit => {
  const username = stringConfig(config, "username", "data-agent");
  const password = optionalStringConfig(config, "password");
  return {
    "Accept": "application/json",
    "Content-Type": "text/plain; charset=utf-8",
    [`${prefix}-User`]: username,
    [`${prefix}-Source`]: stringConfig(config, "source", "open-data-agent"),
    [`${prefix}-Catalog`]: stringConfig(config, "catalog"),
    [`${prefix}-Schema`]: stringConfig(config, "schema", "default"),
    ...(password ? { "Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {})
  };
};

const parseTrinoCompatibleResponse = async (response: Response): Promise<TrinoCompatiblePage> => {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`TRINO_COMPATIBLE_QUERY_FAILED:${response.status}:${body.slice(0, 500)}`);
  }
  const parsed: unknown = body ? JSON.parse(body) : {};
  if (!isRecord(parsed)) {
    throw new Error("TRINO_COMPATIBLE_JSON_RESULT_INVALID");
  }
  if (isRecord(parsed.error)) {
    const message = typeof parsed.error.message === "string" ? parsed.error.message : "unknown error";
    throw new Error(`TRINO_COMPATIBLE_QUERY_ERROR:${message}`);
  }
  return parsed as TrinoCompatiblePage;
};

const queryDatabricksSql = async (
  config: Record<string, unknown>,
  sql: string,
  signal?: AbortSignal | undefined
): Promise<Record<string, unknown>[]> => {
  const submitted = await databricksRequest(config, "/api/2.0/sql/statements", {
    statement: sql,
    warehouse_id: databricksWarehouseId(config),
    wait_timeout: "10s",
    disposition: "INLINE",
    format: "JSON_ARRAY",
    ...optionalConfigString(config, "catalog"),
    ...optionalConfigString(config, "schema")
  }, signal);
  const completed = await waitDatabricksStatement(config, submitted, signal);
  const columns = databricksColumns(completed);
  const rows = [...arrayRowsToRecords(columns, completed.result?.data_array ?? [])];
  let nextChunk = completed.result?.next_chunk_internal_link;
  while (nextChunk) {
    const chunk = await databricksRequest(config, nextChunk, undefined, signal);
    rows.push(...arrayRowsToRecords(columns, chunk.result?.data_array ?? []));
    nextChunk = chunk.result?.next_chunk_internal_link;
  }
  return rows;
};

const waitDatabricksStatement = async (
  config: Record<string, unknown>,
  response: DatabricksStatementResponse,
  signal?: AbortSignal | undefined
): Promise<DatabricksStatementResponse> => {
  let current = response;
  for (;;) {
    const state = current.status?.state;
    if (state === "SUCCEEDED") {
      return current;
    }
    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
      throw new Error(`DATABRICKS_SQL_FAILED:${current.status?.error?.message ?? state}`);
    }
    const statementId = current.statement_id;
    if (!statementId) {
      throw new Error("DATABRICKS_SQL_STATEMENT_ID_MISSING");
    }
    await delay(1000, signal);
    current = await databricksRequest(config, `/api/2.0/sql/statements/${statementId}`, undefined, signal);
  }
};

const databricksRequest = async (
  config: Record<string, unknown>,
  pathOrUrl: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal | undefined
): Promise<DatabricksStatementResponse> => {
  const response = await fetch(databricksUrl(config, pathOrUrl), {
    method: body ? "POST" : "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${stringConfig(config, "token")}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {})
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DATABRICKS_SQL_REQUEST_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!isRecord(parsed)) {
    throw new Error("DATABRICKS_SQL_JSON_RESULT_INVALID");
  }
  return parsed as DatabricksStatementResponse;
};

const databricksUrl = (config: Record<string, unknown>, pathOrUrl: string): string => {
  if (/^https?:\/\//iu.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const host = stringConfig(config, "host").replace(/^https?:\/\//iu, "");
  return `https://${host}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
};

const databricksWarehouseId = (config: Record<string, unknown>): string => {
  const configured = optionalStringConfig(config, "warehouseId");
  if (configured) {
    return configured;
  }
  const match = /\/warehouses\/([^/?#]+)/iu.exec(stringConfig(config, "path"));
  if (!match?.[1]) {
    throw new Error("DATABRICKS_WAREHOUSE_ID_REQUIRED");
  }
  return match[1];
};

const databricksColumns = (response: DatabricksStatementResponse): string[] =>
  (response.manifest?.schema?.columns ?? []).map((column) => column.name);

const delay = async (ms: number, signal?: AbortSignal | undefined): Promise<void> =>
  await new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

const sparkOperationRows = async (
  hive: typeof HiveDriverModule,
  operation: HiveOperationLike,
  signal?: AbortSignal | undefined
): Promise<Record<string, unknown>[]> => {
  operation.setMaxRows(1000);
  try {
    const utils = new hive.HiveUtils(hive.thrift.TCLIService_types);
    await utils.waitUntilReady(operation as never);
    await utils.fetchAll(operation as never);
    throwIfAborted(signal);
    const result = utils.getResult(operation as never).getValue() as unknown;
    return Array.isArray(result) ? result.filter(isRecord) : [];
  } finally {
    await operation.close().catch(() => undefined);
  }
};

const sparkConnectionOptions = (config: Record<string, unknown>): Record<string, unknown> => ({
  host: stringConfig(config, "host"),
  port: numberConfig(config, "port", 10000),
  path: stringConfig(config, "path", "cliservice"),
  options: {
    connectTimeout: numberConfig(config, "timeoutMs", 30000),
    timeout: numberConfig(config, "timeoutMs", 30000)
  }
});

const sparkAuthProvider = (hive: typeof HiveDriverModule, config: Record<string, unknown>): unknown => {
  const authMode = stringConfig(config, "auth", "none");
  if (authMode !== "plain") {
    return new hive.auth.NoSaslAuthentication();
  }
  const credentials = {
    username: stringConfig(config, "username"),
    password: stringConfig(config, "password")
  };
  return stringConfig(config, "transport", "tcp") === "http"
    ? new hive.auth.PlainHttpAuthentication(credentials)
    : new hive.auth.PlainTcpAuthentication(credentials);
};

const arrayRowsToRecords = (columns: string[], data: unknown[][]): Record<string, unknown>[] =>
  data.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])));

const searchClientOptions = (config: Record<string, unknown>): Record<string, unknown> => {
  const username = optionalStringConfig(config, "username");
  const password = optionalStringConfig(config, "password");
  const apiKey = optionalStringConfig(config, "apiKey");
  return {
    node: optionalStringConfig(config, "node") ?? optionalStringConfig(config, "url") ?? searchNodeUrl(config),
    ...(username && password ? { auth: { username, password } } : {}),
    ...(apiKey ? { auth: { apiKey } } : {})
  };
};

const searchNodeUrl = (config: Record<string, unknown>): string =>
  `${booleanConfig(config, "secure", false) ? "https" : "http"}://`
  + `${stringConfig(config, "host")}:${numberConfig(config, "port", 9200)}`;

const searchIndexPattern = (config: Record<string, unknown>): string => stringConfig(config, "indexPattern", "*");

const searchMappingsToSchema = (mappings: unknown): Omit<SchemaSummary, "datasource_id"> => {
  if (!isRecord(mappings)) {
    return { tables: [] };
  }
  return {
    tables: Object.entries(mappings).map(([index, value]) => ({
      name: index,
      columns: searchMappingColumns(value)
    }))
  };
};

const searchMappingColumns = (mapping: unknown): SchemaSummary["tables"][number]["columns"] => {
  const properties = searchMappingProperties(mapping);
  return Object.entries(flattenSearchProperties(properties)).map(([name, type]) => ({
    name,
    type: type.toUpperCase()
  }));
};

const searchMappingProperties = (mapping: unknown): Record<string, unknown> => {
  if (!isRecord(mapping)) {
    return {};
  }
  const mappings = isRecord(mapping.mappings) ? mapping.mappings : mapping;
  return isRecord(mappings.properties) ? mappings.properties : {};
};

const flattenSearchProperties = (properties: Record<string, unknown>, prefix = ""): Record<string, string> => {
  const columns: Record<string, string> = {};
  Object.entries(properties).forEach(([name, descriptor]) => {
    const column = prefix ? `${prefix}.${name}` : name;
    if (!isRecord(descriptor)) {
      columns[column] = "unknown";
      return;
    }
    if (typeof descriptor.type === "string") {
      columns[column] = descriptor.type;
    }
    if (isRecord(descriptor.properties)) {
      Object.assign(columns, flattenSearchProperties(descriptor.properties, column));
    }
  });
  return columns;
};

const searchHitsToTableResult = (result: unknown): TableResult => {
  const hitsContainer = isRecord(result) && isRecord(result.hits) ? result.hits : {};
  const rawHits = isRecord(hitsContainer) && Array.isArray(hitsContainer.hits) ? hitsContainer.hits : [];
  const rows = rawHits.filter(isRecord).map((hit) => flattenDocument({
    _id: hit._id,
    ...(isRecord(hit._source) ? hit._source : {})
  }));
  return rowsToTableResult(rows);
};

const applyStandardLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const applyTopLimit = (sql: string, limit: number): string => {
  if (/\bSELECT\s+TOP\s*\(/iu.test(sql)) {
    return sql;
  }

  return `SELECT TOP (${limit}) * FROM (${sql}) AS readonly_query`;
};

const applyRowNumLimit = (sql: string, limit: number): string => `SELECT * FROM (${sql}) WHERE ROWNUM <= ${limit}`;

const applyAccessLimit = (sql: string, limit: number): string => {
  if (/\bSELECT\s+TOP\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT TOP ${limit} * FROM (${sql}) AS readonly_query`;
};

const parseLimitedSimpleSelect = (sql: string, defaultLimit: number): LimitedSimpleSelect => {
  const match = /^SELECT\s+(.+?)\s+FROM\s+([`"\w.-]+)(?:\s+LIMIT\s+(\d+))?$/iu.exec(sql);
  if (!match) {
    throw new Error("SIMPLE_SELECT_REQUIRED");
  }
  const rawColumns = match[1] ?? "*";
  const table = unquoteIdentifier((match[2] ?? "").trim());
  const limit = Math.min(Number(match[3] ?? defaultLimit), defaultLimit);
  return {
    columns: rawColumns.trim() === "*"
      ? []
      : rawColumns.split(",").map((column) => unquoteIdentifier(column.trim())).filter(Boolean),
    limit,
    table
  };
};

const inferDocumentColumns = (rows: Record<string, unknown>[]): SchemaSummary["tables"][number]["columns"] => {
  const columns = new Map<string, string>();
  rows.map(flattenDocument).forEach((row) => {
    Object.entries(row).forEach(([key, value]) => {
      if (!columns.has(key)) {
        columns.set(key, inferColumnType([row], key) || typeof value);
      }
    });
  });
  return [...columns.entries()].map(([name, type]) => ({ name, type: type.toUpperCase() }));
};

const flattenDocument = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : value
  ]));

const redisPreviewValue = async (client: RedisReadonlyClient, key: string, type: string): Promise<string | null> => {
  if (type === "string") {
    return await client.get(key);
  }
  if (type === "hash") {
    return JSON.stringify(await client.hGetAll(key));
  }
  if (type === "list") {
    return JSON.stringify(await client.lRange(key, 0, 4));
  }
  if (type === "set") {
    return JSON.stringify((await client.sMembers(key)).slice(0, 5));
  }
  if (type === "zset") {
    return JSON.stringify(await client.zRange(key, 0, 4));
  }
  return null;
};

const accessConnectionString = (config: Record<string, unknown>): string => {
  const configured = optionalStringConfig(config, "connectionString");
  if (configured) {
    return configured;
  }
  const path = stringConfig(config, "path");
  return `Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=${path};`;
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const quoteMysqlIdentifier = (identifier: string): string => `\`${identifier.replaceAll("`", "``")}\``;

const quoteClickHouseIdentifier = (identifier: string): string => `\`${identifier.replaceAll("`", "``")}\``;

const quoteSnowflakeIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const quoteSqlServerIdentifier = (identifier: string): string => `[${identifier.replaceAll("]", "]]")}]`;

const quoteOracleIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""').toUpperCase()}"`;

const quoteAccessIdentifier = (identifier: string): string => `[${identifier.replaceAll("]", "]]")}]`;

const quoteBigQueryIdentifier = (...parts: string[]): string => `\`${parts.map((part) => part.replaceAll("`", "")).join(".")}\``;

const quoteTrinoIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const clickHouseLiteral = (value: string): string => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const trinoServerUrl = (config: Record<string, unknown>): string =>
  optionalStringConfig(config, "server")
  ?? optionalStringConfig(config, "url")
  ?? `${booleanConfig(config, "secure", false) ? "https" : "http"}://`
    + `${stringConfig(config, "host")}:${numberConfig(config, "port", 8080)}`;

const trinoStatementUrl = (config: Record<string, unknown>): string =>
  new URL("v1/statement", `${trinoServerUrl(config).replace(/\/$/u, "")}/`).toString();

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
    const tableName = requiredRecordStringLoose(row, tableKey);
    const table = tables.get(tableName) ?? { name: tableName, columns: [] };
    table.columns.push({
      name: requiredRecordStringLoose(row, columnKey),
      type: requiredRecordStringLoose(row, typeKey),
      nullable: requiredRecordStringLoose(row, nullableKey).toUpperCase() === "YES"
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
