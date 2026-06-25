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

  if (kind === "llm" && model) details.push(`模型：${model}`);
  if (latencyMs) details.push(`耗时：${latencyMs} ms`);
  if (kind === "llm" && response) details.push(`响应：${response}`);
  if (details.length === 0 && status) details.push(`状态：${status}`);
  if (details.length === 0) details.push("测试连接已完成。");

  return { tone: "success", title: "测试成功", details };
}

export function formatConfigTestError(error: unknown): ConfigTestPresentation {
  const message = error instanceof Error ? error.message : "测试失败";
  return { tone: "error", title: "测试失败", details: [message] };
}
