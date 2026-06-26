#!/usr/bin/env node
/**
 * After npm install, compile workspace packages so dev:api can import dist/ exports.
 * Skip in CI when explicitly disabled.
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SKIP_POSTINSTALL_BUILD === "1") {
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.warn(
    `[postinstall] Node 22+ recommended (current ${process.versions.node}); skipping build.`,
  );
  process.exit(0);
}

try {
  execSync("npm run build", { cwd: root, stdio: "inherit", env: process.env });
} catch {
  console.warn(
    "[postinstall] build failed — run `npm run build` manually before `npm run dev:api`.",
  );
  process.exit(0);
}
