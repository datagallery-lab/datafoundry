import { describe, expect, it } from "vitest";
import {
  dedupeRepeatedText,
  messageTextContent,
  resolveAssistantThoughtContent,
} from "../assistant-thought-content";

describe("assistant-thought-content", () => {
  it("extracts text from string and text parts", () => {
    expect(messageTextContent(" hello ")).toBe("hello");
    expect(
      messageTextContent([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  it("extracts explicit reasoning parts from model reasoning messages", () => {
    expect(
      messageTextContent([
        { type: "reasoning", text: "inspect schema" },
        { type: "text", text: " then query" },
      ]),
    ).toBe("inspect schema then query");
  });

  it("dedupes exact repeated assistant text", () => {
    const thought =
      "我需要分析不同品类的销售额数据。首先，让我查看可用的数据源，然后检查数据库模式以了解表结构。";
    expect(dedupeRepeatedText(`${thought}${thought}`)).toBe(thought);
  });

  it("prefers preceding reasoning messages over duplicated assistant text", () => {
    const thought = "Let me inspect the schema first.";
    const content = resolveAssistantThoughtContent(
      {
        id: "assistant-1",
        role: "assistant",
        content: `${thought}${thought}`,
      },
      [
        { id: "user-1", role: "user", content: "question" },
        { id: "reasoning-1", role: "reasoning", content: thought },
        {
          id: "assistant-1",
          role: "assistant",
          content: `${thought}${thought}`,
        },
      ],
    );

    expect(content).toBe(thought);
  });
});
