import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "docs", "assets");
const publicAssetsDir = join(root, "docs", "public", "assets");

if (!existsSync(assetsDir)) {
  console.error(`Missing docs assets directory: ${assetsDir}`);
  process.exit(1);
}

mkdirSync(join(root, "docs", "public"), { recursive: true });
rmSync(publicAssetsDir, { recursive: true, force: true });
cpSync(assetsDir, publicAssetsDir, { recursive: true });
console.log(`Prepared docs public assets at ${publicAssetsDir}`);
