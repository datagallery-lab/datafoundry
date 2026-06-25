import { describe, expect, it } from "vitest";
import {
  formatConfigTestError,
  formatConfigTestResult,
} from "../config-test-result";

describe("config test result presentation", () => {
  it("formats LLM connection details for inline display", () => {
    expect(
      formatConfigTestResult("llm", {
        model: "qwen-plus",
        latencyMs: 1200,
        response: "OK",
        status: "connected",
      }),
    ).toEqual({
      tone: "success",
      title: "测试成功",
      details: ["模型：qwen-plus", "耗时：1200 ms", "响应：OK"],
    });
  });

  it("formats connection test failures for inline display", () => {
    expect(
      formatConfigTestError(new Error("PROVIDER_TEST_FAILED: timeout")),
    ).toEqual({
      tone: "error",
      title: "测试失败",
      details: ["PROVIDER_TEST_FAILED: timeout"],
    });
  });
});
