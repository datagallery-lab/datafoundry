import type { LiveToolCallRecord } from "./live-run-state";

export type CopilotToolStatus = "inProgress" | "executing" | "complete";
export type BackendToolPhase = "running" | "success" | "failed";
export type ToolDisplayStatus = "pending" | "executing" | "complete" | "failed";

/** Merge CopilotKit message state with AG-UI backend tool events. */
export function resolveToolDisplayStatus(input: {
  copilotStatus: CopilotToolStatus;
  backendPhase?: BackendToolPhase;
  hasResult: boolean;
  resultIsError?: boolean;
}): ToolDisplayStatus {
  if (input.hasResult) {
    return input.resultIsError ? "failed" : "complete";
  }
  if (input.backendPhase === "failed") return "failed";
  if (input.backendPhase === "success") return "complete";
  if (input.copilotStatus === "complete") return "failed";
  if (input.copilotStatus === "executing" || input.backendPhase === "running") {
    return "executing";
  }
  return "pending";
}

export type ToolResultErrorKind = "tool" | "protocol" | "delivery";

export type ParsedToolResultError = {
  kind: ToolResultErrorKind;
  title: string;
  message: string;
  hint?: string;
};

export function parseToolResultError(result?: string): ParsedToolResultError | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as {
      status?: unknown;
      reason?: unknown;
      error?: unknown;
      message?: unknown;
    };

    if (parsed.status === "error") {
      if (parsed.reason === "missing_terminal_event") {
        return {
          kind: "protocol",
          title: "结果同步失败",
          message: "工具结果在对话 run 结束后才到达，前端未能接收 observation。",
          hint: "SQL 可能已在后端执行，请查看右侧「完整追溯」；然后重试本问题。",
        };
      }
      return {
        kind: "protocol",
        title: "结果同步失败",
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message
            : "工具 observation 未能写入对话线程。",
      };
    }

    if (parsed.error === "TOOL_RESULT_NOT_DELIVERED") {
      return {
        kind: "delivery",
        title: "结果未送达",
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message
            : "后端未在 AG-UI 流中推送 TOOL_CALL_RESULT。",
        hint: "请查看右侧追溯面板中的 SQL 审计或 step 状态。",
      };
    }

    if (parsed.error !== undefined) {
      return {
        kind: "tool",
        title: "工具执行失败",
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message
            : typeof parsed.error === "string"
              ? parsed.error
              : "工具执行失败。",
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function toolResultLooksLikeError(result?: string): boolean {
  return parseToolResultError(result) !== null;
}

export function resolveToolFailurePresentation(result?: string): ParsedToolResultError {
  const parsed = parseToolResultError(result);
  if (parsed) return parsed;
  if (!result) {
    return {
      kind: "delivery",
      title: "结果未送达",
      message: "后端未返回 observation。",
    };
  }
  return {
    kind: "tool",
    title: "工具执行失败",
    message: result.length > 240 ? `${result.slice(0, 240)}…` : result,
  };
}

export function toolDisplayStatusLabel(status: ToolDisplayStatus): string {
  switch (status) {
    case "complete":
      return "已完成";
    case "executing":
      return "执行中";
    case "failed":
      return "执行失败";
    default:
      return "等待执行";
  }
}

export function toolPendingHint(status: ToolDisplayStatus): string {
  switch (status) {
    case "executing":
      return "工具正在执行，等待后端返回结果。";
    case "failed":
      return "工具执行失败，请查看对话或重试。";
    default:
      return "已规划此工具调用，等待开始执行。";
  }
}

export function buildBackendToolPhaseMap(
  toolCalls: LiveToolCallRecord[],
): ReadonlyMap<string, BackendToolPhase> {
  return new Map(toolCalls.map((call) => [call.id, call.status]));
}

export function buildBackendToolResultMap(
  toolCalls: LiveToolCallRecord[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const call of toolCalls) {
    if (call.result) map.set(call.id, call.result);
  }
  return map;
}
