export type StepToolStatus = "running" | "success" | "failed";

export type StepToolSummaryInput = {
  id: string;
  label: string;
  status: StepToolStatus;
  durationLabel: string;
};

export type ToolChipSummary = StepToolSummaryInput & {
  overflow?: boolean;
};

export type StepElapsedInput = {
  status: StepToolStatus;
  startedAtMs?: number;
  finishedAtMs?: number;
};

export function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function stepElapsedLabel(step: StepElapsedInput): string {
  if (step.status === "running") return "Running";
  if (step.startedAtMs === undefined || step.finishedAtMs === undefined) {
    return "—";
  }
  return formatStepDuration(Math.max(0, step.finishedAtMs - step.startedAtMs));
}

export function truncateThinkingPreview(text: string, maxChars = 96): string | undefined {
  const parts = text
    .split(/\s*\n+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const compact = parts
    .slice(0, 2)
    .join(" ")
    .trim();
  if (!compact) return undefined;
  if (compact.length > maxChars) return `${compact.slice(0, maxChars).trimEnd()}…`;
  return parts.length > 2 ? `${compact}…` : compact;
}

export function buildToolChipSummaries(
  tools: StepToolSummaryInput[],
  maxVisible = 3,
): ToolChipSummary[] {
  if (tools.length <= maxVisible) return tools;
  const visibleCount = Math.max(1, maxVisible - 1);
  return [
    ...tools.slice(0, visibleCount),
    {
      id: "__overflow__",
      label: `+${tools.length - visibleCount}`,
      status: "success",
      durationLabel: "",
      overflow: true,
    },
  ];
}

function formatToolSummary(
  tools: StepToolSummaryInput[],
  options: { includeConcurrencyPrefix?: boolean } = {},
): string {
  if (tools.length === 0) return "No tool calls";
  const prefix =
    options.includeConcurrencyPrefix && tools.length > 1
      ? `${tools.length} 个工具并发 · `
      : "";
  return `${prefix}${tools
    .map((tool) => [tool.label, tool.durationLabel].filter(Boolean).join(" "))
    .join(" · ")}`;
}

export function buildCollapsedStepSummary(input: {
  thinking?: string;
  tools: StepToolSummaryInput[];
}): {
  thinkingPreview?: string;
  toolSummary: string;
} {
  const thinkingPreview = truncateThinkingPreview(input.thinking ?? "");
  return {
    thinkingPreview,
    toolSummary: formatToolSummary(input.tools, {
      includeConcurrencyPrefix: !thinkingPreview,
    }),
  };
}
