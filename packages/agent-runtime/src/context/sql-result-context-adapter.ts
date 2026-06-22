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
    const input = raw as SqlResultInput;
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
