import { resolve } from "node:path";

export function datalinkEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes((env.DATALINK_ENABLED ?? "").trim().toLowerCase());
}

export function resolveDatalinkEnv(root, env = process.env) {
  return {
    ...env,
    DATALINK_CONFIG_PATH:
      env.DATALINK_CONFIG_PATH?.trim() || resolve(root, "services/datalink/datalink_config.json"),
    DATALINK_GRAPH_DB_PATH:
      env.DATALINK_GRAPH_DB_PATH?.trim() || resolve(root, "storage/datalink/datalink.db"),
    DATALINK_API_HOST: env.DATALINK_API_HOST?.trim() || "127.0.0.1",
    DATALINK_API_PORT: String(readPort(env.DATALINK_API_PORT, 8081, "DATALINK_API_PORT")),
    DATALINK_MCP_HOST: env.DATALINK_MCP_HOST?.trim() || "127.0.0.1",
    DATALINK_MCP_PORT: String(readPort(env.DATALINK_MCP_PORT, 8080, "DATALINK_MCP_PORT")),
  };
}

function readPort(value, fallback, name) {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}
