import { describe, expect, it } from "vitest";

import {
  createProtocolClassificationPrompt,
  parseProtocolClassificationText
} from "./model-protocol-classifier.js";

describe("createProtocolClassificationPrompt", () => {
  it("constrains classification to the router-provided candidates", () => {
    const prompt = createProtocolClassificationPrompt({
      candidates: [
        { protocolId: "general-task", protocolVersion: "1" },
        { protocolId: "data-analysis", protocolVersion: "1" }
      ],
      value: { userText: "比较订单趋势" }
    });

    expect(prompt).toContain("general-task@1");
    expect(prompt).toContain("data-analysis@1");
    expect(prompt).toContain("比较订单趋势");
    expect(prompt).toContain("只能选择候选集合中的协议");
    expect(prompt).toContain('"reasonCodes":["ANALYTIC_INTENT"]');
  });

  it("strictly parses fenced JSON returned by compatible models", () => {
    expect(parseProtocolClassificationText(`\`\`\`json
{"protocolId":"general-task","protocolVersion":"1","confidence":0.9,"reasonCodes":["GENERAL_EXPLANATION"]}
\`\`\``)).toEqual({
      protocolId: "general-task",
      protocolVersion: "1",
      confidence: 0.9,
      reasonCodes: ["GENERAL_EXPLANATION"]
    });
  });
});
