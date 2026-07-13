import type { AdapterTableResult, TableResult } from "./types.js";

export const applyTableResultMask = (
  result: AdapterTableResult,
  maskFields: string[]
): TableResult => {
  const publicResult = (): TableResult => ({
    columns: result.columns,
    rows: result.rows,
    row_count: result.row_count
  });
  if (maskFields.length === 0) {
    return publicResult();
  }

  const maskedNames = new Set(maskFields.map((field) => field.toLowerCase()));
  const hasOrigins = Array.isArray(result.column_origins);
  const maskedIndexes = result.columns
    .map((column, index) => ({ column, index, origin: result.column_origins?.[index] }))
    .filter(({ column, origin }) =>
      maskedNames.has(column.toLowerCase())
      || (hasOrigins && (origin === null || origin === undefined || maskedNames.has(origin.column.toLowerCase()))))
    .map(({ index }) => index);

  if (maskedIndexes.length === 0) {
    return publicResult();
  }
  const maskedIndexSet = new Set(maskedIndexes);
  return {
    columns: result.columns,
    rows: result.rows.map((row) =>
      row.map((value, index) => maskedIndexSet.has(index) && value !== null ? "[MASKED]" : value)),
    row_count: result.row_count
  };
};
