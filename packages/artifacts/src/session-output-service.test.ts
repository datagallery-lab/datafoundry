import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SessionOutputService } from "./session-output-service.js";

const roots: string[] = [];

const createTestServices = () => {
  const root = mkdtempSync(join(tmpdir(), "session-output-service-"));
  roots.push(root);
  const metadataStore = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    dev_user: {
      id: "user-1",
      email: "user@example.com",
      display_name: "Test User",
      dev_token: "dev-token"
    }
  });
  metadataStore.workspaces.createPersonal({
    id: "workspace-1",
    owner_user_id: "user-1",
    name: "Workspace"
  });
  metadataStore.sessions.create({
    user_id: "user-1",
    id: "session-1"
  });
  metadataStore.runs.create({
    user_id: "user-1",
    session_id: "session-1",
    id: "run-1",
    user_input: "test"
  });
  const fileAssetService = new LocalFileAssetService(metadataStore, {
    storageRoot: join(root, "files")
  });
  const sessionOutputService = new SessionOutputService(metadataStore, fileAssetService);
  return { fileAssetService, metadataStore, root, sessionOutputService };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("SessionOutputService", () => {
  it("returns null for paths excluded from session outputs", async () => {
    const { root, sessionOutputService } = createTestServices();
    const sourcePath = join(root, "analysis.py");
    writeFileSync(sourcePath, "print('draft')\n");

    await expect(sessionOutputService.upsertFromSessionFile({
      user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      run_id: "run-1",
      path: "analysis.py",
      source_path: sourcePath
    })).resolves.toBeNull();
  });

  it("upserts one output per session file path and appends versions", async () => {
    const { metadataStore, root, sessionOutputService } = createTestServices();
    const sourcePath = join(root, "summary.md");
    writeFileSync(sourcePath, "# First\n");

    const first = await sessionOutputService.upsertFromSessionFile({
      user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      run_id: "run-1",
      path: "reports/summary.md",
      source_path: sourcePath,
      tool_call_id: "tool-1"
    });

    writeFileSync(sourcePath, "# Second\n");
    const second = await sessionOutputService.upsertFromSessionFile({
      user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      run_id: "run-1",
      path: "reports/summary.md",
      source_path: sourcePath,
      tool_call_id: "tool-2"
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.artifact.id).toBe(first?.artifact.id);
    expect(second?.artifact.file_asset_ref_id).not.toBe(first?.artifact.file_asset_ref_id);
    expect(metadataStore.artifacts.listBySession({
      user_id: "user-1",
      session_id: "session-1"
    })).toHaveLength(1);
    expect(metadataStore.artifacts.findBySessionLogicalKey({
      user_id: "user-1",
      session_id: "session-1",
      logical_key: "session_file:reports/summary.md"
    })?.id).toBe(first?.artifact.id);

    const versions = metadataStore.artifactVersions.listByArtifact({
      user_id: "user-1",
      artifact_id: first?.artifact.id ?? ""
    });
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions[0]?.file_asset_ref_id).toBe(first?.version.file_asset_ref_id);
    expect(versions[1]?.file_asset_ref_id).toBe(second?.version.file_asset_ref_id);
  });
});
