import { describe, expect, it } from "vitest";
import {
  collaborationResponseLayout,
  formatCollaborationResponseDisplay,
} from "../components/chat/collaboration-response-display";

describe("formatCollaborationResponseDisplay", () => {
  it("maps ask_user option values to labels", () => {
    expect(
      formatCollaborationResponseDisplay("ask_user", "list_data_sources", [
        { label: "list_data_sources", value: "list_data_sources", description: "x" },
      ]),
    ).toBe("list_data_sources");
  });

  it("formats submit_plan approval", () => {
    expect(
      formatCollaborationResponseDisplay("submit_plan", { action: "approved" }),
    ).toBe("已批准执行计划");
  });

  it("formats submit_plan rejection with feedback", () => {
    expect(
      formatCollaborationResponseDisplay("submit_plan", {
        action: "rejected",
        feedback: "需要调整计划",
      }),
    ).toBe("已拒绝计划：需要调整计划");
  });

  it("preserves free-text ask_user answers", () => {
    expect(formatCollaborationResponseDisplay("ask_user", "  继续分析  ")).toBe("继续分析");
  });

  it("renders collaboration prompts as assistant-side recap and choices as user-side replies", () => {
    expect(collaborationResponseLayout("ask_user")).toEqual({
      recapSide: "assistant",
      choiceSide: "user",
      planRenderer: undefined,
    });
  });

  it("renders submitted plans as assistant-side markdown recap", () => {
    expect(collaborationResponseLayout("submit_plan")).toEqual({
      recapSide: "assistant",
      choiceSide: "user",
      planRenderer: "markdown",
    });
  });
});
