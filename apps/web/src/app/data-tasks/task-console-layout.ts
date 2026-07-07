export type ConsoleTabId = "overview" | "trace" | "outputs" | "detail";

export type OverviewSectionId = "conclusion" | "progress" | "tool-distribution";

export type OverviewSectionPlanItem = {
  id: OverviewSectionId;
  collapsible: boolean;
};

export const CONSOLE_FILE_ASSETS_TAB: ConsoleTabId = "outputs";

export function overviewSectionPlan({
  hasToolDistribution,
}: {
  hasToolDistribution: boolean;
}): OverviewSectionPlanItem[] {
  return [
    { id: "conclusion", collapsible: false },
    { id: "progress", collapsible: false },
    ...(hasToolDistribution ? [{ id: "tool-distribution", collapsible: true } as const] : []),
  ];
}
