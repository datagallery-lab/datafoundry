#!/usr/bin/env node
/**
 * Validates the local dev environment before starting API/web.
 * Intended for WSL2 / Linux. Warns when npm was run from Windows against this tree.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MIN_NODE_MAJOR = 22;

function fail(message) {
  console.error(`\n[dev-env] ${message}\n`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[dev-env] warning: ${message}`);
}

function run(command) {
  execSync(command, { cwd: root, stdio: "inherit", env: process.env });
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  fail(
    `Node.js ${MIN_NODE_MAJOR}+ required (current: ${process.versions.node}). ` +
      "In WSL use: nvm use 22",
  );
}

if (process.platform === "win32") {
  fail(
    "Detected Windows Node. Run npm and dev commands inside WSL2 (~/project/dataagent), " +
      "not from PowerShell/CMD against the same directory.",
  );
}

if (!existsSync(join(root, "node_modules"))) {
  fail("node_modules missing. Run: npm install");
}

for (const bin of ["tsx", "next"]) {
  const localBin = join(root, "node_modules", ".bin", bin);
  if (!existsSync(localBin)) {
    fail(`${bin} not found in node_modules/.bin — run: npm install`);
  }
}

const linuxNativeHints = [
  "@tailwindcss/oxide-linux-x64-gnu",
  "lightningcss-linux-x64-gnu",
];
for (const pkg of linuxNativeHints) {
  const pkgPath = join(root, "node_modules", pkg);
  if (!existsSync(pkgPath)) {
    warn(
      `${pkg} missing — Tailwind/Next CSS may fail. Re-run npm install from WSL, ` +
        "not from Windows npm.",
    );
  }
}

if (existsSync(join(root, "package-lock.json.win.bak"))) {
  warn(
    "package-lock.json.win.bak detected — you may have run npm on Windows. " +
      "Use WSL-only: rm package-lock.json.win.bak && npm install",
  );
}

if (process.env.SKIP_DEV_BUILD === "1") {
  console.log("[dev-env] SKIP_DEV_BUILD=1 — skipping package build");
  process.exit(0);
}

console.log("[dev-env] building workspace packages (tsc -b)…");
run("npm run build");
