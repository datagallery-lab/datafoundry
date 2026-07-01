#!/usr/bin/env node
/**
 * Wipe all dev-user session / conversation history from local storage roots.
 * Keeps workspace config (datasources, models, skills, etc.).
 *
 * Usage: node scripts/clear-session-history.mjs
 */
import { rmSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = resolve(import.meta.dirname, "..");
const storageRoot = process.env.STORAGE_ROOT_DIR
  ? resolve(repoRoot, process.env.STORAGE_ROOT_DIR)
  : resolve(repoRoot, "apps/api/storage");

const userId = process.env.DEV_USER_ID ?? "dev-user";
const metaDb = process.env.METADATA_DB_PATH
  ? resolve(repoRoot, process.env.METADATA_DB_PATH)
  : join(storageRoot, "metadata", "workbench.sqlite");
const mastraDb = process.env.MASTRA_STORAGE_PATH
  ? resolve(repoRoot, process.env.MASTRA_STORAGE_PATH)
  : join(storageRoot, "mastra", "agent-state.sqlite");
const sessionsDir = join(storageRoot, "workspaces", userId, "default", "sessions");

function clearMetadata(dbPath) {
  if (!statSync(dbPath, { throwIfNoEntry: false })?.isFile()) {
    console.log(`[skip] metadata db not found: ${dbPath}`);
    return;
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const steps = [
    "DELETE FROM conversation_messages WHERE user_id = ?",
    "DELETE FROM conversation_summaries WHERE user_id = ?",
    "DELETE FROM run_events WHERE user_id = ?",
    "DELETE FROM interactions WHERE user_id = ?",
    "DELETE FROM artifacts WHERE user_id = ?",
    "DELETE FROM query_history WHERE user_id = ?",
    "DELETE FROM long_term_memories WHERE user_id = ?",
    "DELETE FROM sql_audit_logs WHERE user_id = ? AND run_id IS NOT NULL",
    "UPDATE runs SET parent_run_id = NULL WHERE user_id = ?",
    "DELETE FROM runs WHERE user_id = ?",
    "DELETE FROM file_asset_refs WHERE user_id = ? AND session_id IS NOT NULL",
    "DELETE FROM sessions WHERE user_id = ?",
  ];
  for (const sql of steps) {
    db.prepare(sql).run(userId);
  }
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId).n;
  db.close();
  console.log(`[metadata] sessions remaining for ${userId}: ${remaining}`);
}

function clearMastra(dbPath) {
  if (!statSync(dbPath, { throwIfNoEntry: false })?.isFile()) {
    console.log(`[skip] mastra db not found: ${dbPath}`);
    return;
  }
  const db = new DatabaseSync(dbPath);
  for (const table of [
    "mastra_messages",
    "mastra_thread_state",
    "mastra_workflow_snapshot",
    "mastra_threads",
  ]) {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    db.prepare(`DELETE FROM "${table}"`).run();
    console.log(`[mastra] ${table}: ${before} -> 0`);
  }
  db.close();
}

function clearWorkspaceSessionDirs(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.log(`[skip] sessions dir not found: ${dir}`);
    return;
  }
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    }
  }
  console.log(`[workspace] removed ${removed} session directories under ${dir}`);
}

console.log("Clearing session history…");
console.log(`  metadata: ${metaDb}`);
console.log(`  mastra:   ${mastraDb}`);
console.log(`  dirs:     ${sessionsDir}`);
clearMetadata(metaDb);
clearMastra(mastraDb);
clearWorkspaceSessionDirs(sessionsDir);
console.log("Done. Refresh the browser and run in DevTools console:");
console.log("  localStorage.removeItem('data-tasks:sessions:v2'); location.reload();");
