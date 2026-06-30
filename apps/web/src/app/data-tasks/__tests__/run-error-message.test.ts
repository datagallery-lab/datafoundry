import { describe, expect, it } from "vitest";

import { formatRunErrorMessage } from "../run-error-message";

describe("formatRunErrorMessage", () => {
  it("explains RUN_TIMEOUT with seconds and guidance", () => {
    expect(formatRunErrorMessage("RUN_TIMEOUT:60000")).toContain("60s");
    expect(formatRunErrorMessage("RUN_TIMEOUT:60000")).toContain("Timeout (ms)");
  });

  it("passes through unknown messages", () => {
    expect(formatRunErrorMessage("Something broke")).toBe("Something broke");
  });

  it("falls back when message is empty", () => {
    expect(formatRunErrorMessage()).toBe("Agent run failed");
  });
});
