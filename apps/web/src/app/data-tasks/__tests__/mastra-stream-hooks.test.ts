import { describe, expect, it } from "vitest";

import {
  createMastraStreamNormalizerHooks,
  tokenUsageEventFromChunk,
} from "../../../../../../packages/agent-runtime/src/stream/mastra-stream-hooks";

describe("tokenUsageEventFromChunk", () => {
  it("extracts usage, tool_call_id, and tool_name from step output", () => {
    const event = tokenUsageEventFromChunk({
      type: "step-finish",
      payload: {
        output: {
          usage: { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 },
          toolCalls: [
            {
              toolCallId: "tool-sql-1",
              toolName: "run_sql_readonly",
            },
          ],
        },
        model: { modelId: "qwen-plus" },
      },
    });

    expect(event).toMatchObject({
      input_tokens: 1200,
      output_tokens: 340,
      total_tokens: 1540,
      tool_call_id: "tool-sql-1",
      tool_name: "run_sql_readonly",
      model: "qwen-plus",
    });
  });

  it("returns undefined when chunk has no usage", () => {
    expect(tokenUsageEventFromChunk({ type: "text-delta", payload: { text: "hi" } })).toBeUndefined();
  });
});

describe("createMastraStreamNormalizerHooks token emission", () => {
  it("emits token_usage only on step end chunks and dedupes finish-step pairs", () => {
    const events: Array<{ name?: string; value?: Record<string, unknown> }> = [];
    const emitter = {
      emit: (event: { name?: string; value?: unknown }) => {
        events.push({
          name: event.name,
          value: event.value as Record<string, unknown>,
        });
      },
    };

    const hooks = createMastraStreamNormalizerHooks(emitter);
    const usageChunk = {
      type: "step-finish",
      payload: {
        output: {
          usage: { inputTokens: 500, outputTokens: 100 },
          toolCalls: [{ toolCallId: "tool-1", toolName: "run_sql_readonly" }],
        },
      },
    };

    hooks.onChunk?.({ type: "text-delta", payload: { text: "partial" } });
    hooks.onChunk?.({ type: "finish-step", ...usageChunk });
    hooks.onChunk?.(usageChunk);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "token_usage",
      value: {
        input_tokens: 500,
        output_tokens: 100,
        step_number: 1,
        tool_call_id: "tool-1",
        tool_name: "run_sql_readonly",
      },
    });
  });
});
