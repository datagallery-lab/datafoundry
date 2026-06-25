/** Resolve a cell value from a row object, including SQL `expr AS alias` column labels. */
export function resolveColumnValue(
  row: Record<string, unknown>,
  column: string,
): unknown {
  if (column in row) return row[column];

  const aliasMatch = /\bas\s+("?)([\w]+)\1\s*$/iu.exec(column.trim());
  if (aliasMatch?.[2] && aliasMatch[2] in row) {
    return row[aliasMatch[2]];
  }

  const bare = column.trim().replace(/^["'`]|["'`]$/gu, "");
  if (bare in row) return row[bare];

  return undefined;
}

/** Normalize API rows (array-of-arrays or array-of-objects) for table rendering. */
export function normalizeTableRows(
  columns: string[],
  rows: unknown[],
): unknown[][] {
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return columns.map((_, index) => row[index] ?? null);
    }
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      return columns.map((column) => resolveColumnValue(record, column) ?? null);
    }
    return columns.map(() => null);
  });
}

export function tableRowsLookEmpty(rows: unknown[][]): boolean {
  return rows.every((row) =>
    row.every((cell) => cell === null || cell === undefined || cell === ""),
  );
}

/** When SQL column labels don't match row keys, derive columns from the first object row. */
export function inferObjectRowColumns(rows: unknown[]): string[] {
  const firstObject = rows.find(
    (row) => row && typeof row === "object" && !Array.isArray(row),
  ) as Record<string, unknown> | undefined;
  return firstObject ? Object.keys(firstObject) : [];
}

export function normalizeSqlTable(
  columns: string[],
  rows: unknown[],
): { columns: string[]; rows: unknown[][] } {
  let normalized = normalizeTableRows(columns, rows);
  if (!tableRowsLookEmpty(normalized) || rows.length === 0) {
    return { columns, rows: normalized };
  }

  const inferredColumns = inferObjectRowColumns(rows);
  if (inferredColumns.length === 0) {
    return { columns, rows: normalized };
  }

  normalized = normalizeTableRows(inferredColumns, rows);
  return { columns: inferredColumns, rows: normalized };
}
