import type { ContextBudget } from "../context-budget-allocator.js";
import { createContextItem, type ContextItem, type ToolResultAdapter } from "../tool-result-adapter.js";

export abstract class BaseToolContextAdapter implements ToolResultAdapter {
  abstract readonly resultType: string;
  abstract readonly toolName: string;
  readonly sourceType = "tool-result";

  /** Project one tool's raw result into bounded model and activity context. */
  toContextItems(raw: unknown, budget: ContextBudget): ContextItem[] {
    const projected = this.project(raw);
    const bounded = boundStructuredValue(projected, budget.maxChars ?? 12000);
    const groupId = `${this.resultType}-observation`;
    return [
      createContextItem({
        id: `${this.resultType}-model`,
        sourceType: this.resultType,
        sourceId: this.toolName,
        groupId,
        visibility: "model",
        trust: "tool",
        retention: "supporting",
        priority: 20,
        content: bounded,
        metadata: { atomic: true, groupKind: "tool-exchange", toolName: this.toolName }
      }),
      createContextItem({
        id: `${this.resultType}-activity`,
        sourceType: this.resultType,
        sourceId: this.toolName,
        groupId,
        visibility: "activity",
        trust: "tool",
        retention: "reference",
        priority: 10,
        content: bounded,
        metadata: { atomic: true, groupKind: "reference", toolName: this.toolName }
      })
    ];
  }

  protected abstract project(raw: unknown): unknown;
}

const boundStructuredValue = (value: unknown, maxChars: number): unknown => {
  const serialized = safeSerialize(value);
  if (serialized.length <= maxChars) {
    return value;
  }

  const reservedChars = 160;
  return {
    original_chars: serialized.length,
    preview: serialized.slice(0, Math.max(maxChars - reservedChars, 0)),
    truncated: true
  };
};

const safeSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : { value };

export const pickFields = (value: unknown, fields: string[]): Record<string, unknown> => {
  const record = asRecord(value);
  return Object.fromEntries(
    fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])
  );
};
