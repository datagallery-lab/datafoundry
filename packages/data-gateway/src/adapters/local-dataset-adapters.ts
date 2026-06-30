import type {
  AdapterExecutionInput,
  AdapterPreviewInput,
  AdapterSqlInput,
  DataSourceAdapter,
  SchemaSummary,
  TableResult
} from "../types.js";
import { readFileSync } from "node:fs";
import readXlsxFile from "read-excel-file/node";

export class DuckDbDemoAdapter implements DataSourceAdapter {
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

export class CsvAdapter implements DataSourceAdapter {
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

export class XlsxAdapter implements DataSourceAdapter {
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

type DatasetTable = {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
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

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

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

const unquoteIdentifier = (identifier: string): string =>
  identifier.replace(/^"/u, "").replace(/"$/u, "").replaceAll('""', '"');

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isDatasetTable = (value: unknown): value is DatasetTable => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.name === "string" && Array.isArray(value.columns) && Array.isArray(value.rows);
};
