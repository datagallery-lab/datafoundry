import type { SchemaSummary } from "@open-data-agent/data-gateway";

import { applySchemaContextPolicy } from "./context-policy.js";
import { DEFAULT_AGENT_CONTEXT_POLICY } from "./context-policy.js";
import type { ContextBudget } from "./context-budget-allocator.js";
import { contextPackageToItems } from "./context-package-builder.js";
import type { ContextItem, ToolResultAdapter } from "./tool-result-adapter.js";

type SchemaResultInput = SchemaSummary & {
  schema_id?: string;
};

export class SchemaContextAdapter implements ToolResultAdapter {
  readonly toolName = "inspect_schema";
  readonly resultType = "schema";
  readonly sourceType = "tool-result";

  toContextItems(raw: unknown, budget: ContextBudget): ContextItem[] {
    const schema = normalizeSchemaResultInput(raw);
    if (!schema) {
      return contextPackageToItems(createInvalidSchemaProjection(raw), this.resultType, 10);
    }
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
    if (schema.schema_id) {
      contextPackage.model = { ...(contextPackage.model as SchemaSummary), schema_id: schema.schema_id };
      contextPackage.activity = { ...(contextPackage.activity as SchemaSummary), schema_id: schema.schema_id };
    }
    return contextPackageToItems(contextPackage, this.resultType, 10);
  }
}

const getLimit = (budget: ContextBudget, key: string, defaultValue: number): number =>
  budget.sourceLimits?.[key] ?? defaultValue;

const normalizeSchemaResultInput = (raw: unknown): SchemaResultInput | undefined => {
  if (!isRecord(raw) || !Array.isArray(raw.tables)) {
    return undefined;
  }
  const schema: SchemaResultInput = {
    datasource_id: typeof raw.datasource_id === "string" ? raw.datasource_id : "unknown",
    tables: raw.tables.filter(isSchemaTable)
  };
  if (typeof raw.schema_id === "string") {
    schema.schema_id = raw.schema_id;
  }
  return schema;
};

const createInvalidSchemaProjection = (raw: unknown) => {
  const serialized = safeSerialize(raw);
  const preview = serialized.slice(0, 4000);
  const content = {
    tool_result_invalid: true,
    tool_name: "inspect_schema",
    reason: "Tool observation did not contain a schema summary.",
    preview
  };

  return {
    model: content,
    activity: content,
    artifactRefs: [],
    auditRefs: [],
    truncation: [{
      sourceId: "schema-result-invalid",
      truncated: serialized.length > preview.length,
      reason: "Invalid schema tool observation preview was bounded for model context.",
      originalSize: serialized.length,
      returnedSize: preview.length
    }]
  };
};

const isSchemaTable = (value: unknown): value is SchemaSummary["tables"][number] => {
  if (!isRecord(value) || typeof value.name !== "string" || !Array.isArray(value.columns)) {
    return false;
  }
  return value.columns.every((column) =>
    isRecord(column) &&
    typeof column.name === "string" &&
    typeof column.type === "string" &&
    (column.nullable === undefined || typeof column.nullable === "boolean")
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
