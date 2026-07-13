import type {
  AdapterExecutionInput,
  AdapterPreviewInput,
  AdapterSqlInput,
  AdapterTableResult,
  DataSourceAdapter,
  SchemaSummary,
  TableResult
} from "../types.js";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { Pool, type PoolClient, type PoolConfig, type QueryResult } from "pg";

type PostgreSqlPool = Pick<Pool, "connect" | "end">;
type PostgreSqlPoolFactory = (config: PoolConfig) => PostgreSqlPool;

export class PostgreSqlAdapter implements DataSourceAdapter {
  constructor(
    private readonly config: Record<string, unknown>,
    private readonly createPool: PostgreSqlPoolFactory = (config) => new Pool(config)
  ) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.config, "schema", "public");
    const accessRows = await this.query(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname = $1
          AND pg_catalog.has_schema_privilege(namespace.oid, 'USAGE')
      ) AS accessible
    `, [schema], input.signal);
    if (accessRows[0]?.accessible !== true) {
      throw new Error(`POSTGRES_SCHEMA_NOT_FOUND_OR_INACCESSIBLE:${schema}`);
    }
    const rows = await this.query(`
      SELECT
        relation.relname AS table_name,
        pg_catalog.obj_description(relation.oid, 'pg_class') AS table_description,
        attribute.attname AS column_name,
        pg_catalog.col_description(relation.oid, attribute.attnum) AS column_description,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
        CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = $1
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND pg_catalog.has_schema_privilege(namespace.oid, 'USAGE')
        AND pg_catalog.has_column_privilege(relation.oid, attribute.attnum, 'SELECT')
      ORDER BY relation.relname, attribute.attnum
    `, [schema], input.signal);
    return schemaRowsToSummary(
      rows,
      "table_name",
      "column_name",
      "data_type",
      "is_nullable",
      "table_description",
      "column_description"
    );
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
    const limit = Math.max(0, Math.floor(input.limit));
    return this.withClient(async (client) => {
      await client.query(`DECLARE "__datafoundry_readonly_cursor" NO SCROLL CURSOR FOR ${input.sql}`);
      const result = await client.query<unknown[]>({
        text: `FETCH FORWARD ${limit} FROM "__datafoundry_readonly_cursor"`,
        rowMode: "array"
      });
      return postgresResultToTableResult(client, result);
    }, input.signal);
  }

  private async query(
    sql: string,
    values: unknown[] = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    return this.withClient(async (client) => {
      const result = await client.query(sql, values);
      return result.rows.filter(isRecord);
    }, signal);
  }

  private async withClient<T>(
    operation: (client: PoolClient) => Promise<T>,
    signal?: AbortSignal | undefined
  ): Promise<T> {
    throwIfAborted(signal);
    const timeoutMs = numberConfig(this.config, "timeoutMs", 30000);
    const password = optionalStringConfig(this.config, "password");
    const pool = this.createPool({
      host: stringConfig(this.config, "host"),
      port: numberConfig(this.config, "port", 5432),
      database: stringConfig(this.config, "database"),
      user: stringConfig(this.config, "username"),
      ...(password !== undefined ? { password } : {}),
      ssl: booleanConfig(this.config, "ssl", false),
      max: 1,
      connectionTimeoutMillis: timeoutMs,
      statement_timeout: timeoutMs
    });
    let client: PoolClient | undefined;
    let aborted = false;
    let released = false;
    const release = (destroy: boolean): void => {
      if (!client || released) {
        return;
      }
      released = true;
      client.release(destroy);
    };
    const abort = (): void => {
      aborted = true;
      release(true);
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      client = await pool.connect();
      throwIfAborted(signal);
      await client.query("BEGIN READ ONLY");
      const schema = stringConfig(this.config, "schema", "public");
      await client.query(
        "SELECT pg_catalog.set_config('search_path', $1, true)",
        [quoteIdentifier(schema)]
      );
      const result = await operation(client);
      throwIfAborted(signal);
      await client.query("ROLLBACK");
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      try {
        release(aborted);
      } finally {
        await pool.end();
      }
    }
  }
}

/**
 * Keeps the pre-existing PostgreSQL-wire-compatible behavior for engines whose
 * catalog, cursor, and connection options are not guaranteed to match
 * PostgreSQL. PostgreSQL-specific hardening belongs in PostgreSqlAdapter only.
 */
class PostgreSqlCompatibleAdapter extends PostgreSqlAdapter {
  constructor(
    private readonly compatibleConfig: Record<string, unknown>,
    private readonly compatibleCreatePool: PostgreSqlPoolFactory = (config) => new Pool(config)
  ) {
    super(compatibleConfig, compatibleCreatePool);
  }

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.compatibleConfig, "schema", "public");
    const rows = await this.compatibleQuery(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position
    `, [schema], input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const schema = stringConfig(this.compatibleConfig, "schema", "public");
    return rowsToTableResult(await this.compatibleQuery(
      `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(input.table)} LIMIT $1`,
      [input.limit],
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.compatibleQuery(applyStandardLimit(input.sql, input.limit), [], input.signal));
  }

  private async compatibleQuery(
    sql: string,
    values: unknown[] = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    const pool = this.compatibleCreatePool({
      host: stringConfig(this.compatibleConfig, "host"),
      port: numberConfig(this.compatibleConfig, "port", 5432),
      database: stringConfig(this.compatibleConfig, "database"),
      user: stringConfig(this.compatibleConfig, "username"),
      password: stringConfig(this.compatibleConfig, "password"),
      max: 1,
      statement_timeout: numberConfig(this.compatibleConfig, "timeoutMs", 30000)
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

export class MySqlAdapter implements DataSourceAdapter {
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

  protected async query(
    sql: string,
    values: unknown[] = [],
    signal?: AbortSignal | undefined
  ): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    const connection = await createConnection({
      host: stringConfig(this.config, "host"),
      port: numberConfig(this.config, "port", 3306),
      database: stringConfig(this.config, "database"),
      user: stringConfig(this.config, "username"),
      password: stringConfig(this.config, "password"),
      connectTimeout: numberConfig(this.config, "timeoutMs", 30000)
    });
    const abort = (): void => {
      void connection.destroy();
    };
    try {
      signal?.addEventListener("abort", abort, { once: true });
      await connection.beginTransaction();
      await connection.query("SET TRANSACTION READ ONLY");
      const [rows] = await connection.query<RowDataPacket[]>(sql, values);
      await connection.rollback();
      return rows.filter(isRecord);
    } finally {
      signal?.removeEventListener("abort", abort);
      await connection.end();
    }
  }
}

export class GaussDbAdapter extends PostgreSqlCompatibleAdapter {}

export class StarRocksAdapter extends MySqlAdapter {}

export class RedshiftAdapter extends PostgreSqlCompatibleAdapter {}

export class GreenplumAdapter extends PostgreSqlCompatibleAdapter {}

export class DorisAdapter extends MySqlAdapter {}

export class MariaDbAdapter extends MySqlAdapter {}

export class TiDbAdapter extends MySqlAdapter {}

export class OceanBaseAdapter extends MySqlAdapter {}

const applyStandardLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const rowsToTableResult = (rows: unknown[]): TableResult => {
  const objectRows = rows.filter(isRecord);
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return objectRowsToTableResult(objectRows, columns);
};

const postgresResultToTableResult = async (
  client: PoolClient,
  result: QueryResult<unknown[]>
): Promise<AdapterTableResult> => {
  const tableIds = Array.from(new Set(
    result.fields.map((field) => field.tableID).filter((tableId) => tableId > 0)
  ));
  const originRows = tableIds.length > 0
    ? await client.query<{
        table_id: number;
        column_id: number;
        schema_name: string;
        table_name: string;
        column_name: string;
      }>(`
        SELECT
          attribute.attrelid AS table_id,
          attribute.attnum::integer AS column_id,
          namespace.nspname AS schema_name,
          relation.relname AS table_name,
          attribute.attname AS column_name
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE attribute.attrelid = ANY($1::oid[])
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      `, [tableIds])
    : undefined;
  const origins = new Map(
    (originRows?.rows ?? []).map((row) => [
      `${row.table_id}:${row.column_id}`,
      { schema: row.schema_name, table: row.table_name, column: row.column_name }
    ])
  );
  return {
    columns: result.fields.map((field) => field.name),
    rows: result.rows,
    row_count: result.rows.length,
    column_origins: result.fields.map((field) =>
      origins.get(`${field.tableID}:${field.columnID}`) ?? null)
  };
};

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

const schemaRowsToSummary = (
  rows: Record<string, unknown>[],
  tableKey: string,
  columnKey: string,
  typeKey: string,
  nullableKey: string,
  tableDescriptionKey?: string,
  columnDescriptionKey?: string
): Omit<SchemaSummary, "datasource_id"> => {
  const tables = new Map<string, SchemaSummary["tables"][number]>();
  rows.forEach((row) => {
    const tableName = requiredRecordStringLoose(row, tableKey);
    const tableDescription = tableDescriptionKey
      ? optionalRecordStringLoose(row, tableDescriptionKey)
      : undefined;
    const table = tables.get(tableName) ?? {
      name: tableName,
      ...(tableDescription !== undefined ? { description: tableDescription } : {}),
      columns: []
    };
    const columnDescription = columnDescriptionKey
      ? optionalRecordStringLoose(row, columnDescriptionKey)
      : undefined;
    table.columns.push({
      name: requiredRecordStringLoose(row, columnKey),
      type: requiredRecordStringLoose(row, typeKey),
      nullable: requiredRecordStringLoose(row, nullableKey).toUpperCase() === "YES",
      ...(columnDescription !== undefined ? { description: columnDescription } : {})
    });
    tables.set(tableName, table);
  });
  return { tables: [...tables.values()] };
};

const stringConfig = (config: Record<string, unknown>, key: string, defaultValue?: string): string => {
  const value = config[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing config value: ${key}`);
};

const optionalStringConfig = (config: Record<string, unknown>, key: string): string | undefined => {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const booleanConfig = (config: Record<string, unknown>, key: string, defaultValue: boolean): boolean => {
  const value = config[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return defaultValue;
};

const numberConfig = (config: Record<string, unknown>, key: string, defaultValue: number): number => {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }
  return defaultValue;
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const quoteMysqlIdentifier = (identifier: string): string => `\`${identifier.replaceAll("`", "``")}\``;

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

const optionalRecordStringLoose = (row: unknown, key: string): string | undefined => {
  if (!isRecord(row)) {
    return undefined;
  }
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  return typeof value === "string" ? value : undefined;
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
