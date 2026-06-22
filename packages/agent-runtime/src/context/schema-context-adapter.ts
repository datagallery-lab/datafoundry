import type { SchemaSummary } from "@open-data-agent/data-gateway";

import { applySchemaContextPolicy } from "./context-policy.js";
import { DEFAULT_AGENT_CONTEXT_POLICY } from "./context-policy.js";
import type { ContextBudget } from "./context-budget-allocator.js";
import { contextPackageToItems } from "./context-package-builder.js";
import type { ContextItem, ToolResultAdapter } from "./tool-result-adapter.js";

export class SchemaContextAdapter implements ToolResultAdapter {
  readonly toolName = "inspect_schema";
  readonly resultType = "schema";
  readonly sourceType = "tool-result";

  toContextItems(raw: unknown, budget: ContextBudget): ContextItem[] {
    const schema = raw as SchemaSummary;
    const contextPackage = applySchemaContextPolicy(schema, {
      ...DEFAULT_AGENT_CONTEXT_POLICY,
      schema: {
        max_chars: budget.maxChars ?? DEFAULT_AGENT_CONTEXT_POLICY.schema.max_chars,
        max_columns_per_table: getLimit(
          budget,
          "maxColumnsPerTable",
          DEFAULT_AGENT_CONTEXT_POLICY.schema.max_columns_per_table
        ),
        max_tables: getLimit(budget, "maxTables", DEFAULT_AGENT_CONTEXT_POLICY.schema.max_tables)
      }
    });
    return contextPackageToItems(contextPackage, this.resultType, 10);
  }
}

const getLimit = (budget: ContextBudget, key: string, defaultValue: number): number =>
  budget.sourceLimits?.[key] ?? defaultValue;
