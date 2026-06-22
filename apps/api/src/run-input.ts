import type { RunAgentInput } from "@ag-ui/client";

export type EffectiveRunConfig = {
  activeDatasourceId: string;
  activeLlmProfileId?: string;
  activeSkillId?: string;
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  goal?: {
    maxRuns?: number;
    objective: string;
  };
};

/** Parse and validate the frontend run_config into the backend's effective run policy. */
export const extractEffectiveRunConfig = (input: RunAgentInput, defaultDatasourceId: string): EffectiveRunConfig => {
  const runConfig = extractRunConfigRecord(input);
  const legacyDatasourceId = extractDatasourceId(input);
  const configuredDatasourceId = stringFromAliases(runConfig, ["activeDatasourceId", "active_datasource_id"]);
  const activeDatasourceId = configuredDatasourceId ?? legacyDatasourceId ?? defaultDatasourceId;
  const enabledDatasourceIds = stringArrayFromAliases(runConfig, ["enabledDatasourceIds", "enabled_datasource_ids"]);
  const effectiveDatasourceIds = enabledDatasourceIds.length > 0 ? unique(enabledDatasourceIds) : [activeDatasourceId];
  const activeLlmProfileId = stringFromAliases(runConfig, ["activeLlmProfileId", "active_llm_profile_id"]);
  const activeSkillId = stringFromAliases(runConfig, ["activeSkillId", "active_skill_id"]);
  const goal = extractGoal(runConfig);

  if (!effectiveDatasourceIds.includes(activeDatasourceId)) {
    throw new Error("ACTIVE_DATASOURCE_NOT_ENABLED");
  }

  return {
    activeDatasourceId,
    ...(activeLlmProfileId ? { activeLlmProfileId } : {}),
    ...(activeSkillId ? { activeSkillId } : {}),
    enabledDatasourceIds: effectiveDatasourceIds,
    enabledKnowledgeIds: stringArrayFromAliases(runConfig, ["enabledKnowledgeIds", "enabled_knowledge_ids"]),
    enabledMcpServerIds: stringArrayFromAliases(runConfig, ["enabledMcpServerIds", "enabled_mcp_server_ids"]),
    ...(goal ? { goal } : {})
  };
};

const extractGoal = (runConfig: Record<string, unknown>): EffectiveRunConfig["goal"] => {
  const goal = recordFromUnknown(runConfig.goal);
  if (!goal) {
    return undefined;
  }
  const objective = stringFromAliases(goal, ["objective"]);
  if (!objective) {
    throw new Error("GOAL_OBJECTIVE_REQUIRED");
  }
  const rawMaxRuns = goal.maxRuns ?? goal.max_runs;
  const maxRunsInvalid = rawMaxRuns !== undefined
    && (!Number.isInteger(rawMaxRuns) || Number(rawMaxRuns) < 1 || Number(rawMaxRuns) > 20);
  if (maxRunsInvalid) {
    throw new Error("GOAL_MAX_RUNS_INVALID");
  }
  return {
    objective,
    ...(rawMaxRuns !== undefined ? { maxRuns: Number(rawMaxRuns) } : {})
  };
};

export const extractDatasourceId = (input: RunAgentInput): string | undefined => {
  const forwardedProps = isRecord(input.forwardedProps) ? input.forwardedProps : {};
  const state = isRecord(input.state) ? input.state : {};
  const contextDatasourceId = input.context.find((item) => item.description === "datasource_id")?.value;
  const forwardedDatasourceId =
    stringFromRecord(forwardedProps, "datasourceId") ?? stringFromRecord(forwardedProps, "datasource_id");
  const stateDatasourceId = stringFromRecord(state, "datasourceId") ?? stringFromRecord(state, "datasource_id");

  return forwardedDatasourceId ?? stateDatasourceId ?? contextDatasourceId;
};

export const extractLastUserText = (input: RunAgentInput): string | undefined => {
  const userMessage = [...input.messages].reverse().find((message) => message.role === "user");
  const content = userMessage?.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const stringFromRecord = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const extractRunConfigRecord = (input: RunAgentInput): Record<string, unknown> => {
  const forwardedProps = isRecord(input.forwardedProps) ? input.forwardedProps : {};
  const state = isRecord(input.state) ? input.state : {};
  const contextValue = input.context.find((item) => item.description === "run_config")?.value;
  return recordFromUnknown(forwardedProps.run_config ?? forwardedProps.runConfig) ??
    recordFromUnknown(state.run_config ?? state.runConfig) ?? recordFromUnknown(contextValue) ?? {};
};

const recordFromUnknown = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    throw new Error("INVALID_RUN_CONFIG_JSON");
  }
};

const stringFromAliases = (record: Record<string, unknown>, aliases: string[]): string | undefined => {
  for (const alias of aliases) {
    const value = stringFromRecord(record, alias);
    if (value) {
      return value;
    }
  }
  return undefined;
};

const stringArrayFromAliases = (record: Record<string, unknown>, aliases: string[]): string[] => {
  for (const alias of aliases) {
    const value = record[alias];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }
  return [];
};

const unique = (values: string[]): string[] => [...new Set(values)];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
