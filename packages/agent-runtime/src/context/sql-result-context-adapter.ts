import type { SqlExecutionResult } from "@open-data-agent/data-gateway";

import { applySqlModelContextPolicy } from "./context-policy.js";
import { DEFAULT_AGENT_CONTEXT_POLICY } from "./context-policy.js";
import type { ContextBudget } from "./context-budget-allocator.js";
import { contextPackageToItems } from "./context-package-builder.js";
import type { ContextItem, ToolResultAdapter } from "./tool-result-adapter.js";

export type SqlResultInput = {
  result: SqlExecutionResult;
  sql: string;
};

export class SqlResultContextAdapter implements ToolResultAdapter {
  readonly toolName = "run_sql_readonly";
  readonly resultType = "sql";
  readonly sourceType = "tool-result";

  toContextItems(raw: unknown, budget: ContextBudget): ContextItem[] {
    const input = normalizeSqlResultInput(raw);
    if (!input) {
      return contextPackageToItems(createInvalidSqlResultProjection(raw), this.resultType, 10);
    }
    const contextPackage = applySqlModelContextPolicy(input.result, input.sql, {
      ...DEFAULT_AGENT_CONTEXT_POLICY,
      sql: {
        max_activity_chars: budget.maxChars ?? DEFAULT_AGENT_CONTEXT_POLICY.sql.max_activity_chars,
        max_activity_rows: getLimit(
          budget,
          "maxActivityRows",
          DEFAULT_AGENT_CONTEXT_POLICY.sql.max_activity_rows
        ),
        max_cell_chars: getLimit(budget, "maxCellChars", DEFAULT_AGENT_CONTEXT_POLICY.sql.max_cell_chars),
        max_model_rows: getLimit(budget, "maxModelRows", DEFAULT_AGENT_CONTEXT_POLICY.sql.max_model_rows),
        max_model_chars: budget.maxChars ?? DEFAULT_AGENT_CONTEXT_POLICY.sql.max_model_chars,
        max_sql_chars: getLimit(budget, "maxSqlChars", DEFAULT_AGENT_CONTEXT_POLICY.sql.max_sql_chars)
      }
    });
    return contextPackageToItems(contextPackage, this.resultType, 10);
  }
}

const getLimit = (budget: ContextBudget, key: string, defaultValue: number): number =>
  budget.sourceLimits?.[key] ?? defaultValue;

const normalizeSqlResultInput = (raw: unknown): SqlResultInput | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  if (isSqlExecutionResult(raw.result)) {
    return { result: raw.result, sql: typeof raw.sql === "string" ? raw.sql : "" };
  }

  if (isSqlExecutionResult(raw)) {
    return { result: raw, sql: "" };
  }

  return undefined;
};

const createInvalidSqlResultProjection = (raw: unknown) => {
  const serialized = safeSerialize(raw);
  const preview = serialized.slice(0, 4000);
  const content = {
    tool_result_invalid: true,
    tool_name: "run_sql_readonly",
    reason: "Tool observation did not contain a SQL execution result.",
    preview
  };

  return {
    model: content,
    activity: content,
    artifactRefs: [],
    auditRefs: [],
    truncation: [{
      sourceId: "sql-result-invalid",
      truncated: serialized.length > preview.length,
      reason: "Invalid SQL tool observation preview was bounded for model context.",
      originalSize: serialized.length,
      returnedSize: preview.length
    }]
  };
};

const isSqlExecutionResult = (value: unknown): value is SqlExecutionResult => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.columns) &&
    value.columns.every((column) => typeof column === "string") &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => Array.isArray(row)) &&
    typeof value.row_count === "number" &&
    (value.audit_log_id === undefined || typeof value.audit_log_id === "string") &&
    (value.elapsed_ms === undefined || typeof value.elapsed_ms === "number")
  );
};

const safeSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
