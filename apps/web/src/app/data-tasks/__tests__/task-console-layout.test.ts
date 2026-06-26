import { describe, expect, it } from "vitest";
import { CONSOLE_FILE_ASSETS_TAB, overviewSectionPlan } from "../task-console-layout";

describe("task console information architecture", () => {
  it("keeps overview focused on conclusion and progress", () => {
    expect(
      overviewSectionPlan({
        hasWorkspaceSignals: true,
        hasToolDistribution: true,
      }),
    ).toEqual([
      { id: "conclusion", collapsible: false },
      { id: "progress", collapsible: false },
      { id: "workspace-signals", collapsible: true },
      { id: "tool-distribution", collapsible: true },
    ]);
  });

  it("assigns workspace file assets to outputs instead of overview", () => {
    expect(CONSOLE_FILE_ASSETS_TAB).toBe("outputs");
  });
});
