export type SqlGuardResult =
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

export const guardReadonlySql = (sql: string): SqlGuardResult => {
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

export const stripQuotedSql = (sql: string): string =>
  sql.replace(/'([^']|'')*'/gu, "''").replace(/"([^"]|"")*"/gu, '""');
