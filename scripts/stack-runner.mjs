import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { datalinkEnabled, resolveDatalinkEnv } from "./datalink-stack-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function runStack({ mode, args = [] }) {
  loadRootEnv();
  const apiOnly = args.includes("--api");
  const webOnly = args.includes("--web");
  const startApi = !webOnly || apiOnly;
  const startWeb = !apiOnly || webOnly;
  const startDatalink = startApi && datalinkEnabled();
  const datalinkEnv = resolveDatalinkEnv(root);

  if (mode === "development") {
    execSync("node scripts/ensure-dev-environment.mjs", {
      cwd: root,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    const ports = [
      ...(startApi ? [8787] : []),
      ...(startWeb ? [3000] : []),
      ...(startDatalink
        ? [Number(datalinkEnv.DATALINK_MCP_PORT), Number(datalinkEnv.DATALINK_API_PORT)]
        : []),
    ];
    for (const port of ports) freePort(port);
  }

  if (startDatalink) ensureUvAvailable();

  const children = [];
  if (startDatalink) {
    children.push(spawnProcess("DataLink MCP", "uv", [
      "run", "--project", "services/datalink", "datalink", "serve",
      "--host", datalinkEnv.DATALINK_MCP_HOST,
      "--port", datalinkEnv.DATALINK_MCP_PORT,
      "--transport", "streamable-http",
      "--db", datalinkEnv.DATALINK_GRAPH_DB_PATH,
    ], datalinkEnv));
    children.push(spawnProcess("DataLink REST", "uv", [
      "run", "--project", "services/datalink", "datalink", "api",
      "--host", datalinkEnv.DATALINK_API_HOST,
      "--port", datalinkEnv.DATALINK_API_PORT,
    ], datalinkEnv));
  }
  if (startApi) {
    const command = mode === "development"
      ? ["--workspace", "@datafoundry/api", "run", "dev"]
      : ["--prefix", "apps/api", "run", "start"];
    children.push(spawnProcess("DataFoundry API", "npm", command, datalinkEnv));
  }
  if (startWeb) {
    const command = mode === "development"
      ? ["--workspace", "@datafoundry/web", "run", "dev"]
      : ["--prefix", "apps/web", "run", "start"];
    children.push(spawnProcess("DataFoundry Web", "npm", command, datalinkEnv));
  }

  if (children.length === 0) {
    throw new Error("Nothing to start. Use --api and/or --web.");
  }

  console.log(formatEndpoints({ datalinkEnv, startApi, startDatalink, startWeb }));
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { child } of children) {
      if (!child.killed) child.kill(signal);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  for (const { child, label } of children) {
    child.on("exit", (code, signal) => {
      if (shuttingDown || signal) return;
      console.error(`[stack] ${label} exited with code ${code ?? "unknown"}.`);
      shutdown("SIGTERM");
      process.exitCode = code && code !== 0 ? code : 1;
    });
  }
}

function loadRootEnv() {
  const envPath = join(root, ".env");
  if (existsSync(envPath)) loadEnvFile(envPath);
}

function ensureUvAvailable() {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "DATALINK_ENABLED=true requires uv and Python 3.10+. Install uv, then run `npm run install:datalink`.",
    );
  }
}

function spawnProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  child.on("error", (error) => console.error(`[stack] Unable to start ${label}: ${error.message}`));
  return { child, label };
}

function formatEndpoints({ datalinkEnv, startApi, startDatalink, startWeb }) {
  const endpoints = [];
  if (startApi) endpoints.push("API http://127.0.0.1:8787");
  if (startWeb) endpoints.push("Web http://localhost:3000/data-tasks");
  if (startDatalink) {
    endpoints.push(`DataLink MCP http://127.0.0.1:${datalinkEnv.DATALINK_MCP_PORT}/mcp`);
    endpoints.push(`DataLink REST http://127.0.0.1:${datalinkEnv.DATALINK_API_PORT}`);
  }
  return `\n[stack] ${endpoints.join(" | ")}\n`;
}

function freePort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        shell: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids = new Set();
      for (const line of output.split(/\r?\n/u)) {
        if (!/\bLISTENING\b/u.test(line)) continue;
        const pid = line.trim().split(/\s+/u).at(-1);
        if (pid && /^\d+$/u.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", shell: true });
      return;
    }
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { cwd: root, stdio: "ignore", shell: true });
  } catch {
    // The port was already free.
  }
}
