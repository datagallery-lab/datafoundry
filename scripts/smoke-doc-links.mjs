import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";

const files = execFileSync("find", [
  "README.md",
  "docs",
  "-type",
  "f",
  "(",
  "-name",
  "*.md",
  "-o",
  "-name",
  "*.html",
  ")"
], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const brokenLinks = [];
const markdownLinkPattern = /\[[^\]]*]\(([^)]+)\)/g;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  let match;
  while ((match = markdownLinkPattern.exec(text)) !== null) {
    const rawTarget = match[1]?.trim() ?? "";
    if (shouldSkip(rawTarget)) {
      continue;
    }
    const targetPath = rawTarget.split("#")[0] ?? "";
    if (!targetPath) {
      continue;
    }
    const resolvedPath = normalize(join(dirname(file), targetPath));
    if (!existsSync(resolvedPath)) {
      brokenLinks.push({ file, rawTarget, resolvedPath });
    }
  }
}

if (brokenLinks.length > 0) {
  console.error("Documentation link smoke failed:");
  for (const link of brokenLinks) {
    console.error(`- ${link.file}: ${link.rawTarget} -> ${link.resolvedPath}`);
  }
  process.exit(1);
}

console.log(`Documentation link smoke OK: files=${files.length}`);

function shouldSkip(rawTarget) {
  return (
    !rawTarget ||
    rawTarget.startsWith("#") ||
    rawTarget.startsWith("http:") ||
    rawTarget.startsWith("https:") ||
    rawTarget.startsWith("mailto:") ||
    rawTarget.startsWith("app://")
  );
}
