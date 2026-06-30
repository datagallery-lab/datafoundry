import type { WorkspaceConfigKind } from "./data-task-state";

export type ConfigTestPresentation = {
  tone: "success" | "error";
  title: string;
  details: string[];
};

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function formatConfigTestResult(
  kind: WorkspaceConfigKind,
  result: Record<string, unknown>,
): ConfigTestPresentation {
  const details: string[] = [];
  const model = stringValue(result.model);
  const latencyMs = stringValue(result.latencyMs);
  const response = stringValue(result.response);
  const status = stringValue(result.status);

  if (kind === "llm" && model) details.push(`Model: ${model}`);
  if (latencyMs) details.push(`Duration: ${latencyMs} ms`);
  if (kind === "llm" && response) details.push(`Response: ${response}`);
  if (details.length === 0 && status) details.push(`Status: ${status}`);
  if (details.length === 0) details.push("Connection test completed.");

  return { tone: "success", title: "Test succeeded", details };
}

export function formatConfigTestError(error: unknown): ConfigTestPresentation {
  const message = error instanceof Error ? error.message : "Test failed";
  return { tone: "error", title: "Test failed", details: [message] };
}
