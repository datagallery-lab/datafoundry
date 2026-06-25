import { describe, expect, it } from "vitest";

import {
  ensureDashScopeCompatiblePrompt,
  shouldApplyDashScopePromptCompat,
} from "../../../../../../packages/agent-runtime/src/context/dashscope-prompt-compat";

describe("dashscope prompt compat", () => {
  it("enables compat for openai-compatible providers", () => {
    expect(shouldApplyDashScopePromptCompat("openai-compatible")).toBe(true);
    expect(shouldApplyDashScopePromptCompat("mastra-router")).toBe(false);
  });

  it("adds placeholder text to assistant messages that only contain tool calls", () => {
    const prompt = ensureDashScopeCompatiblePrompt([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_file",
            input: { path: "test.txt" },
          },
        ],
      },
    ]);

    expect(prompt[0]?.content[0]).toEqual({ type: "text", text: "." });
  });

  it("adds placeholder text to assistant messages that only contain reasoning", () => {
    const prompt = ensureDashScopeCompatiblePrompt([
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking..." }],
      },
    ]);

    expect(prompt[0]?.content[0]).toEqual({ type: "text", text: "." });
  });

  it("fills empty tool result outputs", () => {
    const prompt = ensureDashScopeCompatiblePrompt([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "list_files",
            output: { type: "text", value: "" },
          },
        ],
      },
    ]);

    expect(prompt[0]?.content[0]).toMatchObject({
      output: { type: "text", value: "(empty tool result)" },
    });
  });
});
