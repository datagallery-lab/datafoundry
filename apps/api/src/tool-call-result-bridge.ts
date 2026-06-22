import { EventType, type BaseEvent } from "@ag-ui/client";
import { randomUUID } from "node:crypto";

type PendingToolCall = {
  toolCallId: string;
  toolName: string;
  hasResult: boolean;
};

/**
 * @ag-ui/mastra emits TOOL_CALL_END when the model finishes streaming tool args.
 * TOOL_CALL_RESULT only follows a Mastra `tool-result` chunk — not `tool-error`.
 * Our ACTIVITY STEP snapshots already carry success/failure output from data-tools.
 * This bridge backfills missing TOOL_CALL_RESULT events so CopilotKit can attach
 * tool-role messages and the frontend can render observations/errors.
 */
export class ToolCallResultBridge {
  private readonly pending: PendingToolCall[] = [];

  observe(event: BaseEvent): BaseEvent[] {
    const extras: BaseEvent[] = [];

    if (event.type === EventType.TOOL_CALL_END && event.toolCallId) {
      this.pending.push({
        toolCallId: String(event.toolCallId),
        toolName: readString(event.toolCallName) ?? "unknown",
        hasResult: false
      });
    }

    if (event.type === EventType.TOOL_CALL_RESULT && event.toolCallId) {
      const entry = this.pending.find((item) => item.toolCallId === String(event.toolCallId));
      if (entry) entry.hasResult = true;
    }

    if (event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === "STEP") {
      const content = readRecord(event.content);
      const toolName = readString(content?.tool_name);
      const status = readString(content?.status);
      if (!toolName || !status) return extras;

      const pending = this.pending.find((item) => item.toolName === toolName && !item.hasResult);
      if (!pending) return extras;

      if (status === "failed") {
        extras.push(
          createToolCallResult(
            pending.toolCallId,
            JSON.stringify({
              error: readString(content?.error_message) ?? "Tool execution failed"
            })
          )
        );
        pending.hasResult = true;
        return extras;
      }

      if (status === "completed") {
        const payload = content?.content ?? content?.output;
        if (payload !== undefined) {
          extras.push(
            createToolCallResult(
              pending.toolCallId,
              typeof payload === "string" ? payload : JSON.stringify(payload)
            )
          );
          pending.hasResult = true;
        }
      }
    }

    return extras;
  }

  /** Must be delivered before RUN_FINISHED / RUN_ERROR — CopilotKit rejects late TOOL_CALL_RESULT. */
  flushPendingResults(): BaseEvent[] {
    const extras: BaseEvent[] = [];
    for (const pending of this.pending) {
      if (pending.hasResult) continue;
      extras.push(
        createToolCallResult(
          pending.toolCallId,
          JSON.stringify({
            error: "TOOL_RESULT_NOT_DELIVERED",
            message:
              "Tool finished without AG-UI TOOL_CALL_RESULT. The runtime could not observe tool output."
          })
        )
      );
      pending.hasResult = true;
    }
    return extras;
  }
}

const createToolCallResult = (toolCallId: string, content: string): BaseEvent => ({
  type: EventType.TOOL_CALL_RESULT,
  toolCallId,
  content,
  messageId: randomUUID(),
  role: "tool",
  timestamp: Date.now()
});

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
