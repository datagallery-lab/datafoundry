export type ConsoleTabId = "overview" | "trace" | "outputs" | "detail";

export type OverviewSectionId =
  | "conclusion"
  | "progress"
  | "workspace-signals"
  | "tool-distribution";

export type OverviewSectionPlanItem = {
  id: OverviewSectionId;
  collapsible: boolean;
};

export const CONSOLE_FILE_ASSETS_TAB: ConsoleTabId = "outputs";

export function overviewSectionPlan({
  hasWorkspaceSignals,
  hasToolDistribution,
}: {
  hasWorkspaceSignals: boolean;
  hasToolDistribution: boolean;
}): OverviewSectionPlanItem[] {
  return [
    { id: "conclusion", collapsible: false },
    { id: "progress", collapsible: false },
    ...(hasWorkspaceSignals ? [{ id: "workspace-signals", collapsible: true } as const] : []),
    ...(hasToolDistribution ? [{ id: "tool-distribution", collapsible: true } as const] : []),
  ];
}
