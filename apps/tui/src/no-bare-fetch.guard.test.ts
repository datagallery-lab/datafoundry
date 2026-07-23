import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("no bare fetch on protected TUI API paths", () => {
  it("keeps production modules on injected fetch / AuthenticatedTransport", () => {
    const allowed = new Set([
      "auth/authenticated-transport.ts",
      "auth/auth-client.ts",
    ]);
    const offenders: string[] = [];

    for (const file of walk(srcRoot)) {
      const rel = relative(srcRoot, file).replace(/\\/g, "/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) {
        continue;
      }
      if (allowed.has(rel)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (/\bawait\s+fetch\s*\(/.test(source) || /\bfetch\s*\(\s*[`'"][^`'"]*\/api\//.test(source)) {
        offenders.push(rel);
      }
      if (/\bglobalThis\.fetch\s*\(/.test(source) && !rel.includes("auth/")) {
        // Defaults in constructors are OK; bare invocation is not.
        if (/globalThis\.fetch\s*\([^)]*\/api\//.test(source)) {
          offenders.push(rel);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it("forbids offline demo symbols in production sources", () => {
    const banned = /DemoCopilotKitClient|seedDemoState|--demo/;
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = relative(srcRoot, file).replace(/\\/g, "/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (banned.test(source)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
