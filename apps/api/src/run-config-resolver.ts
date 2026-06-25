import type { RunAgentInput } from "@ag-ui/client";
import {
  createModelProviderFromEnv,
  createModelProviderFromProfile
} from "@open-data-agent/agent-runtime";
import type { MetadataStore } from "@open-data-agent/metadata";
import {
  selectSkillsForRun,
  type SkillRecord,
  type SkillSelectionResult
} from "@open-data-agent/skills";
import type { MCPClientConfig } from "@ag-ui/mcp-middleware";

import { resolveEffectiveRunConfig, type EffectiveRunConfig } from "./run-input.js";

export type ResolvedRunConfig = {
  effectiveRunConfig: EffectiveRunConfig;
  mcpRuntime: McpRuntime;
  modelProvider: Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }>;
  modelSettings?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  skillSelection: SkillSelectionResult;
  selectedSkills: SkillRecord[];
};

export type McpRuntime = {
  servers: MCPClientConfig[];
  toolNames: string[];
};

type ResolveRunConfigInput = {
  defaultDatasourceId: string;
  metadataStore: MetadataStore;
  runInput: RunAgentInput;
  userId: string;
  userInput: string;
};

/** Resolve one run's config, model, skill policy, MCP runtime, and enabled resources. */
export const resolveRunConfig = (input: ResolveRunConfigInput): ResolvedRunConfig => {
  const effectiveRunConfig = resolveEffectiveRunConfig(
    input.runInput,
    input.metadataStore,
    input.userId,
    input.defaultDatasourceId
  );
  validateEffectiveResources(effectiveRunConfig, input.metadataStore, input.userId);
  const modelProvider = resolveRunModelProvider(
    effectiveRunConfig.activeLlmProfileId,
    input.metadataStore,
    input.userId
  );
  const skillSelection = selectSkillsForRun({
    metadataStore: input.metadataStore,
    runConfig: effectiveRunConfig,
    userId: input.userId,
    userInput: input.userInput,
    workspaceId: "default"
  });
  effectiveRunConfig.resourceRevisions = {
    ...(effectiveRunConfig.resourceRevisions ?? {}),
    ...Object.fromEntries(skillSelection.selectedSkills.map((skill) => [`skill:${skill.id}`, skill.revision]))
  };
  const modelSettings = resolveModelSettings(effectiveRunConfig.activeLlmProfileId, input.metadataStore, input.userId);
  const mcpRuntime = resolveMcpRuntime(effectiveRunConfig.enabledMcpServerIds, input.metadataStore, input.userId);
  enforceSkillMcpPolicy(skillSelection.effectiveToolPolicy.allowedTools, mcpRuntime.toolNames);

  return {
    effectiveRunConfig,
    mcpRuntime,
    modelProvider,
    ...(modelSettings ? { modelSettings } : {}),
    selectedSkills: skillSelection.selectedSkills,
    skillSelection
  };
};

const resolveRunModelProvider = (
  profileId: string | undefined,
  metadataStore: MetadataStore,
  userId: string
): Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }> => {
  if (!profileId || profileId === "server-default") {
    const provider = createModelProviderFromEnv(process.env);
    if (provider.kind === "mock") {
      throw new Error("PROVIDER_CONFIG_MISSING:LLM_API_KEY is required for server-default.");
    }
    return provider;
  }
  const providers: Array<Exclude<ReturnType<typeof createModelProviderFromEnv>, { kind: "mock" }>> = [];
  const profileIds: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = profileId;
  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`MODEL_FALLBACK_CYCLE:${currentId}`);
    }
    visited.add(currentId);
    const profile = metadataStore.configResources.get({
      id: currentId,
      workspace_id: "default",
      user_id: userId,
      kind: "model-profile"
    });
    const credentials = profile.secret_ref
      ? metadataStore.secrets.get({ ref: profile.secret_ref, workspace_id: "default", user_id: userId })
      : {};
    const apiKey = stringRecordValue(credentials, "apiKey") ?? stringRecordValue(credentials, "api_key");
    const provider = createModelProviderFromProfile({
      provider: stringRecordValue(profile.payload, "provider") ?? "openai-compatible",
      model: stringRecordValue(profile.payload, "modelName") ?? stringRecordValue(profile.payload, "model") ?? "",
      base_url: stringRecordValue(profile.payload, "baseUrl") ?? stringRecordValue(profile.payload, "base_url") ?? "",
      ...(apiKey ? { api_key: apiKey } : {})
    });
    if (provider.kind === "mock") {
      throw new Error(`PROVIDER_CONFIG_MISSING:${currentId}`);
    }
    providers.push(provider);
    profileIds.push(currentId);
    currentId = stringRecordValue(profile.payload, "fallbackProfileId");
  }
  const primary = providers[0];
  if (!primary) {
    throw new Error(`PROVIDER_CONFIG_MISSING:${profileId}`);
  }
  if (providers.length === 1) {
    return primary;
  }
  return {
    kind: primary.kind,
    model_name: profileIds.join(" -> "),
    model: providers.map((provider, index) => ({
      id: profileIds[index] as string,
      model: provider.model,
      maxRetries: 1,
      enabled: true
    }))
  };
};

const validateEffectiveResources = (
  config: EffectiveRunConfig,
  metadataStore: MetadataStore,
  userId: string
): void => {
  config.enabledDatasourceIds.forEach((id) => {
    const datasource = metadataStore.dataSources.get({ user_id: userId, datasource_id: id });
    if (datasource.status !== "ready") {
      throw new Error(`DATASOURCE_NOT_ENABLED:${id}`);
    }
  });
  validateConfigIds(metadataStore, userId, "knowledge-base", config.enabledKnowledgeIds);
  validateConfigIds(metadataStore, userId, "mcp-server", config.enabledMcpServerIds);
  validateConfigIds(metadataStore, userId, "skill", [...config.enabledSkillIds, ...config.skillIds]);
  if (config.activeSkillId) {
    validateConfigIds(metadataStore, userId, "skill", [config.activeSkillId]);
  }
  if (config.activeLlmProfileId && config.activeLlmProfileId !== "server-default") {
    validateConfigIds(metadataStore, userId, "model-profile", [config.activeLlmProfileId]);
  }
};

const resolveModelSettings = (
  profileId: string | undefined,
  metadataStore: MetadataStore,
  userId: string
): { maxOutputTokens?: number; temperature?: number } | undefined => {
  if (!profileId || profileId === "server-default") {
    return undefined;
  }
  const profile = metadataStore.configResources.get({
    id: profileId,
    workspace_id: "default",
    user_id: userId,
    kind: "model-profile"
  });
  const temperature = numericRecordValue(profile.payload, "temperature");
  const maxOutputTokens = numericRecordValue(profile.payload, "maxTokens")
    ?? numericRecordValue(profile.payload, "maxOutputTokens");
  return {
    ...(temperature !== undefined ? { temperature: Math.max(0, Math.min(2, temperature)) } : {}),
    ...(maxOutputTokens !== undefined
      ? { maxOutputTokens: Math.max(1, Math.min(100000, Math.floor(maxOutputTokens))) }
      : {})
  };
};

const resolveMcpRuntime = (
  serverIds: string[],
  metadataStore: MetadataStore,
  userId: string
): McpRuntime => {
  const usedNames = new Set<string>();
  const toolNames: string[] = [];
  const servers = serverIds.map((id): MCPClientConfig => {
    const resource = metadataStore.configResources.get({
      id,
      workspace_id: "default",
      user_id: userId,
      kind: "mcp-server"
    });
    const transport = stringRecordValue(resource.payload, "transport") ?? "streamable-http";
    if (transport !== "streamable-http" && transport !== "sse") {
      throw new Error(`MCP_TRANSPORT_UNSUPPORTED:${id}:${transport}`);
    }
    const url = stringRecordValue(resource.payload, "serverUrl") ?? stringRecordValue(resource.payload, "url");
    if (!url) {
      throw new Error(`MCP_SERVER_URL_REQUIRED:${id}`);
    }
    const manifest = resource.payload.toolManifest;
    if (!Array.isArray(manifest)) {
      throw new Error(`MCP_TOOL_MANIFEST_REQUIRED:${id}`);
    }
    manifest.forEach((tool) => {
      if (!isRecord(tool) || typeof tool.name !== "string") {
        throw new Error(`MCP_TOOL_MANIFEST_INVALID:${id}`);
      }
      const baseName = `mcp__${sanitizeMcpName(id)}__${sanitizeMcpName(tool.name)}`;
      let resolved = baseName.slice(0, 64);
      let suffix = 1;
      while (usedNames.has(resolved)) {
        const marker = `_${suffix}`;
        resolved = `${baseName.slice(0, 64 - marker.length)}${marker}`;
        suffix += 1;
      }
      usedNames.add(resolved);
      toolNames.push(resolved);
    });
    const secret = resource.secret_ref
      ? metadataStore.secrets.get({ ref: resource.secret_ref, workspace_id: "default", user_id: userId })
      : {};
    const headers = resolveMcpHeaders(resource.payload, secret);
    return {
      type: transport === "streamable-http" ? "http" : "sse",
      url,
      serverId: id,
      ...(Object.keys(headers).length > 0 ? { headers } : {})
    };
  });
  return { servers, toolNames };
};

const resolveMcpHeaders = (
  payload: Record<string, unknown>,
  secret: Record<string, unknown>
): Record<string, string> => {
  const configured = isRecord(secret.headers)
    ? Object.fromEntries(Object.entries(secret.headers).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"))
    : {};
  const token = stringRecordValue(secret, "token") ?? stringRecordValue(secret, "apiKey");
  const authType = stringRecordValue(payload, "authType") ?? "none";
  if (authType === "bearer" && token) {
    return { ...configured, Authorization: `Bearer ${token}` };
  }
  return configured;
};

const enforceSkillMcpPolicy = (
  allowedTools: string[] | undefined,
  mcpToolNames: string[]
): void => {
  if (!allowedTools || mcpToolNames.length === 0) {
    return;
  }
  const disallowed = mcpToolNames.filter((name) => !allowedTools.includes(name));
  if (disallowed.length > 0) {
    throw new Error(`SKILL_MCP_TOOL_POLICY_UNSUPPORTED:${disallowed.join(",")}`);
  }
};

const sanitizeMcpName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_");

const validateConfigIds = (
  metadataStore: MetadataStore,
  userId: string,
  kind: "knowledge-base" | "mcp-server" | "model-profile" | "skill",
  ids: string[]
): void => {
  ids.forEach((id) => {
    const resource = metadataStore.configResources.get({
      id,
      workspace_id: "default",
      user_id: userId,
      kind
    });
    if (kind === "skill" && (resource.status === "disabled" || resource.status === "archived")) {
      throw new Error(`CONFIG_RESOURCE_NOT_ENABLED:${kind}:${id}`);
    }
    if (kind !== "skill" && !resource.default_enabled) {
      throw new Error(`CONFIG_RESOURCE_NOT_ENABLED:${kind}:${id}`);
    }
  });
};

const stringRecordValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const numericRecordValue = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
