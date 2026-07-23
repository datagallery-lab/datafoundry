#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDatalinkEnv } from "./datalink-stack-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) loadEnvFile(envPath);
const env = resolveDatalinkEnv(root);
const service = process.argv[2];
const args = service === "api"
  ? [
      "run", "--project", "services/datalink", "datalink", "api",
      "--host", env.DATALINK_API_HOST,
      "--port", env.DATALINK_API_PORT,
    ]
  : service === "mcp"
    ? [
        "run", "--project", "services/datalink", "datalink", "serve",
        "--host", env.DATALINK_MCP_HOST,
        "--port", env.DATALINK_MCP_PORT,
        "--transport", "streamable-http",
        "--db", env.DATALINK_GRAPH_DB_PATH,
      ]
    : undefined;

if (!args) throw new Error("Usage: node scripts/start-datalink.mjs <api|mcp>");

const child = spawn("uv", args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("error", (error) => {
  console.error(`[datalink] Unable to start: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
