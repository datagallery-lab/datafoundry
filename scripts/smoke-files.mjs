import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalArtifactService } from "../packages/artifacts/dist/index.js";
import { LocalFileAssetService } from "../packages/files/dist/index.js";
import { LocalKnowledgeService } from "../packages/knowledge/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

const root = mkdtempSync(join(tmpdir(), "open-data-agent-files-smoke-"));
const store = createMetadataStore({
  database_path: join(root, "metadata.sqlite")
});
const files = new LocalFileAssetService(store, { storageRoot: join(root, "files") });
const artifacts = new LocalArtifactService(store, files);
const knowledge = new LocalKnowledgeService(store);

const userId = "dev-user";
const workspaceId = "default";
const sessionId = "files-smoke-session";
const runId = "files-smoke-run";

try {
  store.sessions.create({ user_id: userId, id: sessionId, title: "files smoke" });
  store.runs.create({
    user_id: userId,
    id: runId,
    session_id: sessionId,
    user_input: "files smoke",
    status: "running"
  });

  const first = files.createRef({
    user_id: userId,
    workspace_id: workspaceId,
    filename: "orders.csv",
    declared_mime_type: "text/csv; charset=utf-8",
    source: "upload",
    content: Buffer.from("id,total\n1,42\n", "utf8")
  });
  const duplicate = files.createRef({
    user_id: userId,
    workspace_id: workspaceId,
    filename: "orders-copy.csv",
    declared_mime_type: "text/csv; charset=utf-8",
    source: "upload",
    content: Buffer.from("id,total\n1,42\n", "utf8")
  });
  assert.equal(first.asset.id, duplicate.asset.id, "duplicate content should reuse the same FileAsset");
  assert.notEqual(first.ref.id, duplicate.ref.id, "duplicate uploads should still create distinct refs");

  const downloaded = files.readRef({ user_id: userId, workspace_id: workspaceId, id: first.ref.id });
  assert.equal(downloaded.body.toString("utf8"), "id,total\n1,42\n");

  const materializedPath = join(root, "workspace", "input", "orders.csv");
  files.materializeRefToPath({ ref: first.ref, targetPath: materializedPath });
  assert.equal(readFileSync(materializedPath, "utf8"), "id,total\n1,42\n");

  const artifactSource = join(root, "workspace", "output", "report.md");
  files.createRefFromPath({
    user_id: userId,
    workspace_id: workspaceId,
    session_id: sessionId,
    run_id: runId,
    filename: "source-report.md",
    declared_mime_type: "text/markdown; charset=utf-8",
    source: "workspace",
    path: materializedPath
  });
  const reportContent = Buffer.from("# Report\n\nRevenue is 42.\n", "utf8");
  const reportSeed = files.createRef({
    user_id: userId,
    workspace_id: workspaceId,
    session_id: sessionId,
    run_id: runId,
    filename: "report-seed.md",
    declared_mime_type: "text/markdown; charset=utf-8",
    source: "workspace",
    content: reportContent
  });
  files.materializeRefToPath({ ref: reportSeed.ref, targetPath: artifactSource, linkStrategy: "copy" });
  const artifact = await artifacts.createArtifactFromFile({
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    workspace_id: workspaceId,
    type: "markdown",
    name: "report.md",
    source_path: artifactSource,
    preview_json: { title: "Report" }
  });
  assert.equal(typeof artifact.file_id, "string");
  assert.equal(artifact.download_url, `/api/v1/artifacts/${artifact.id}/download`);

  const document = await knowledge.ingestText({
    user_id: userId,
    collection_id: "files-smoke-kb",
    filename: first.ref.filename,
    content: downloaded.body.toString("utf8"),
    file_asset_ref_id: first.ref.id,
    mime_type: downloaded.mimeType
  });
  assert.equal(document.file_asset_ref_id, first.ref.id);
  assert.equal(document.status, "ready");
  assert.equal(existsSync(first.asset.storage_path), true);

  console.log(
    `Files smoke OK: asset=${first.asset.id}, refs=2, artifact=${artifact.id}, document=${document.id}`
  );
} finally {
  store.close();
  rmSync(root, { force: true, recursive: true });
}
