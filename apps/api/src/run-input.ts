import type { RunAgentInput } from "@ag-ui/client";
import type { ConfigResourceKind, MetadataStore } from "@open-data-agent/metadata";

export type RunConfigDefaults = {
  activeDatasourceId?: string;
  activeLlmProfileId?: string;
  activeSkillId?: string;
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
};

export type EffectiveRunConfig = {
  activeDatasourceId: string;
  activeLlmProfileId?: string;
  activeSkillId?: string;
  enabledDatasourceIds: string[];
  fileIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
  resourceRevisions?: Record<string, number>;
  goal?: {
    maxRuns?: number;
    objective: string;
  };
};

/** Parse and validate the frontend run_config into the backend's effective run policy. */
export const extractEffectiveRunConfig = (
  input: RunAgentInput,
  defaultDatasourceId: string,
  defaults?: RunConfigDefaults
): EffectiveRunConfig => {
  const runConfig = extractRunConfigRecord(input);
  const legacyDatasourceId = extractDatasourceId(input);
  const configuredDatasourceId = stringFromAliases(runConfig, ["activeDatasourceId", "active_datasource_id"]);
  const datasourceOverride = stringArrayOptionFromAliases(
    runConfig,
    ["enabledDatasourceIds", "enabled_datasource_ids"]
  );
  const activeDatasourceId = configuredDatasourceId ?? legacyDatasourceId ?? datasourceOverride?.[0]
    ?? defaults?.activeDatasourceId ?? defaultDatasourceId;
  const effectiveDatasourceIds = unique(datasourceOverride ?? defaults?.enabledDatasourceIds ?? [activeDatasourceId]);
  const activeLlmProfileId = stringFromAliases(runConfig, ["activeLlmProfileId", "active_llm_profile_id"])
    ?? defaults?.activeLlmProfileId;
  const skillOverride = stringArrayOptionFromAliases(runConfig, ["enabledSkillIds", "enabled_skill_ids"]);
  const configuredSkillId = stringFromAliases(runConfig, ["activeSkillId", "active_skill_id"]);
  const activeSkillId = configuredSkillId
    ?? (skillOverride ? skillOverride[0] : defaults?.activeSkillId);
  const enabledSkillIds = unique(
    skillOverride ?? defaults?.enabledSkillIds ?? (configuredSkillId ? [configuredSkillId] : [])
  );
  const goal = extractGoal(runConfig);

  if (!effectiveDatasourceIds.includes(activeDatasourceId)) {
    throw new Error("ACTIVE_DATASOURCE_NOT_ENABLED");
  }
  if (activeSkillId && !enabledSkillIds.includes(activeSkillId)) {
    throw new Error("ACTIVE_SKILL_NOT_ENABLED");
  }

  return {
    activeDatasourceId,
    ...(activeLlmProfileId ? { activeLlmProfileId } : {}),
    ...(activeSkillId ? { activeSkillId } : {}),
    enabledDatasourceIds: effectiveDatasourceIds,
    fileIds: unique(stringArrayOptionFromAliases(runConfig, ["fileIds", "file_ids"]) ?? []),
    enabledKnowledgeIds: unique(stringArrayOptionFromAliases(
      runConfig,
      ["enabledKnowledgeIds", "enabled_knowledge_ids"]
    ) ?? defaults?.enabledKnowledgeIds ?? []),
    enabledMcpServerIds: unique(stringArrayOptionFromAliases(
      runConfig,
      ["enabledMcpServerIds", "enabled_mcp_server_ids"]
    ) ?? defaults?.enabledMcpServerIds ?? []),
    enabledSkillIds,
    ...(goal ? { goal } : {})
  };
};

/** Resolve workspace defaults, per-run overrides, and immutable resource revisions for one run. */
export const resolveEffectiveRunConfig = (
  input: RunAgentInput,
  metadataStore: MetadataStore,
  userId: string,
  defaultDatasourceId: string,
  workspaceId = "default"
): EffectiveRunConfig => {
  const defaults = loadWorkspaceRunDefaults(metadataStore, userId, workspaceId);
  const config = extractEffectiveRunConfig(input, defaultDatasourceId, defaults);
  return {
    ...config,
    resourceRevisions: resolveResourceRevisions(config, metadataStore, userId, workspaceId)
  };
};

const loadWorkspaceRunDefaults = (
  metadataStore: MetadataStore,
  userId: string,
  workspaceId: string
): RunConfigDefaults => {
  const datasourceIds = metadataStore.dataSources.list({ user_id: userId })
    .filter((item) => {
      const config = recordFromUnknown(item.config_json) ?? {};
      return item.status === "ready" && config.defaultEnabled !== false;
    })
    .map((item) => item.id);
  const enabled = (kind: ConfigResourceKind): string[] => metadataStore.configResources.list({
    workspace_id: workspaceId,
    user_id: userId,
    kind
  }).filter((item) => item.default_enabled && item.status !== "disabled").map((item) => item.id);
  const modelProfileIds = enabled("model-profile");
  const skillIds = enabled("skill");
  return {
    ...(datasourceIds[0] ? { activeDatasourceId: datasourceIds[0] } : {}),
    ...(modelProfileIds[0] ? { activeLlmProfileId: modelProfileIds[0] } : {}),
    ...(skillIds[0] ? { activeSkillId: skillIds[0] } : {}),
    enabledDatasourceIds: datasourceIds,
    enabledKnowledgeIds: enabled("knowledge-base"),
    enabledMcpServerIds: enabled("mcp-server"),
    enabledSkillIds: skillIds
  };
};

const resolveResourceRevisions = (
  config: EffectiveRunConfig,
  metadataStore: MetadataStore,
  userId: string,
  workspaceId: string
): Record<string, number> => {
  const revisions: Record<string, number> = {};
  config.enabledDatasourceIds.forEach((id) => {
    revisions[`datasource:${id}`] = metadataStore.dataSources.get({ user_id: userId, datasource_id: id }).revision;
  });
  const addResources = (kind: ConfigResourceKind, ids: string[]): void => {
    unique(ids).forEach((id) => {
      revisions[`${kind}:${id}`] = metadataStore.configResources.get({
        id,
        workspace_id: workspaceId,
        user_id: userId,
        kind
      }).revision;
    });
  };
  addResources("knowledge-base", config.enabledKnowledgeIds);
  addResources("mcp-server", config.enabledMcpServerIds);
  addResources("skill", [...config.enabledSkillIds, ...(config.activeSkillId ? [config.activeSkillId] : [])]);
  if (config.activeLlmProfileId) {
    const visited = new Set<string>();
    let profileId: string | undefined = config.activeLlmProfileId;
    while (profileId && !visited.has(profileId)) {
      visited.add(profileId);
      const profile = metadataStore.configResources.get({
        id: profileId,
        workspace_id: workspaceId,
        user_id: userId,
        kind: "model-profile"
      });
      revisions[`model-profile:${profileId}`] = profile.revision;
      profileId = typeof profile.payload.fallbackProfileId === "string"
        ? profile.payload.fallbackProfileId
        : undefined;
    }
  }
  return revisions;
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

const stringArrayOptionFromAliases = (record: Record<string, unknown>, aliases: string[]): string[] | undefined => {
  for (const alias of aliases) {
    if (alias in record) {
      return stringArrayFromAliases(record, [alias]);
    }
  }
  return undefined;
};

const unique = (values: string[]): string[] => [...new Set(values)];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
