#!/usr/bin/env node
/**
 * Build workspace packages and start API + web dev servers (WSL/Linux).
 *
 * Usage:
 *   npm run dev          # start both
 *   npm run dev -- --api # API only
 *   npm run dev -- --web # web only
 */
import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apiOnly = args.includes("--api");
const webOnly = args.includes("--web");
const startApi = !webOnly || apiOnly;
const startWeb = !apiOnly || webOnly;

execSync("node scripts/ensure-dev-environment.mjs", {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

for (const port of [8787, 3000]) {
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, {
      cwd: root,
      stdio: "ignore",
      shell: true,
    });
  } catch {
    // fuser may be unavailable; dev servers will fail loudly if ports stay busy.
  }
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

if (startApi) {
  const child = spawn("npm", ["--workspace", "@open-data-agent/api", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
}
if (startWeb) {
  const child = spawn("npm", ["--workspace", "@open-data-agent/web", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
}

if (children.length === 0) {
  console.error("Nothing to start. Use --api and/or --web.");
  process.exit(1);
}

console.log(
  "\n[dev] " +
    (startApi ? "API → http://127.0.0.1:8787  " : "") +
    (startWeb ? "Web → http://localhost:3000/data-tasks" : "") +
    "\n",
);

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exit(code);
    }
  });
}
