import type { MetadataStore } from "@datafoundry/metadata";

export const BUILTIN_DATALINK_SERVER_ID = "builtin-datalink";

const DATALINK_TOOL_MANIFEST = [{ name: "datalink_explore" }] as const;

export const isBuiltinDatalinkEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  ["1", "true", "yes", "on"].includes((env.DATALINK_ENABLED ?? "").trim().toLowerCase());

export const ensureBuiltinDatalinkServer = (input: {
  env?: NodeJS.ProcessEnv;
  metadataStore: MetadataStore;
  userId: string;
  workspaceId: string;
}): "created" | "removed" | "skipped" | "updated" => {
  const env = input.env ?? process.env;
  const key = {
    id: BUILTIN_DATALINK_SERVER_ID,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    kind: "mcp-server" as const,
  };
  const current = input.metadataStore.configResources.find(key);
  if (!isBuiltinDatalinkEnabled(env)) {
    if (current?.builtin) {
      input.metadataStore.configResources.delete(key);
      return "removed";
    }
    return "skipped";
  }

  // Never overwrite a user-owned resource that happens to use the reserved id.
  if (current && !current.builtin) return "skipped";

  const payload = builtinDatalinkPayload(env);
  if (
    current
    && current.name === "DataLink"
    && current.description === "First-party DataFoundry semantic graph service."
    && JSON.stringify(current.payload) === JSON.stringify(payload)
  ) {
    return "skipped";
  }

  input.metadataStore.configResources.upsert({
    ...key,
    name: "DataLink",
    description: "First-party DataFoundry semantic graph service.",
    payload,
    default_enabled: current?.default_enabled ?? true,
    builtin: true,
    status: "untested",
    ...(current ? { expected_revision: current.revision } : {}),
  });
  return current ? "updated" : "created";
};

const builtinDatalinkPayload = (env: NodeJS.ProcessEnv): Record<string, unknown> => {
  const apiHost = connectHost(env.DATALINK_API_HOST);
  const mcpHost = connectHost(env.DATALINK_MCP_HOST);
  const apiPort = port(env.DATALINK_API_PORT, 8081);
  const mcpPort = port(env.DATALINK_MCP_PORT, 8080);
  return {
    apiUrl: `http://${apiHost}:${apiPort}`,
    managed: true,
    serverUrl: `http://${mcpHost}:${mcpPort}/mcp`,
    toolManifest: DATALINK_TOOL_MANIFEST,
    transport: "streamable-http",
  };
};

const connectHost = (value: string | undefined): string => {
  const host = value?.trim() || "127.0.0.1";
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
};

const port = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
};
