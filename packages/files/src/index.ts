import type {
  FileAssetRecord,
  FileAssetRefRecord,
  FileAssetRefSource,
  MetadataStore
} from "@open-data-agent/metadata";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, linkSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export type CreateFileAssetRefInput = {
  user_id: string;
  workspace_id: string;
  filename: string;
  content: Buffer;
  declared_mime_type?: string;
  source: FileAssetRefSource;
  session_id?: string;
  run_id?: string;
  metadata?: unknown;
};

export type CreateFileAssetRefFromPathInput = Omit<CreateFileAssetRefInput, "content"> & {
  path: string;
};

export type ResolvedFileAssetRef = {
  asset: FileAssetRecord;
  ref: FileAssetRefRecord;
};

export type FileAssetService = {
  createRef(input: CreateFileAssetRefInput): ResolvedFileAssetRef;
  createRefFromPath(input: CreateFileAssetRefFromPathInput): ResolvedFileAssetRef;
  deleteRef(input: { user_id: string; workspace_id: string; id: string }): FileAssetRefRecord;
  getRef(input: { user_id: string; workspace_id: string; id: string }): ResolvedFileAssetRef;
  listRefs(input: {
    user_id: string;
    workspace_id: string;
    limit?: number;
    source?: FileAssetRefSource;
  }): ResolvedFileAssetRef[];
  materializeRefToPath(input: {
    ref: FileAssetRefRecord;
    targetPath: string;
    linkStrategy?: "copy" | "hardlink";
  }): void;
  readRef(input: { user_id: string; workspace_id: string; id: string }): { body: Buffer; mimeType: string };
};

export type LocalFileAssetServiceOptions = {
  storageRoot?: string;
};

export class LocalFileAssetService implements FileAssetService {
  private readonly root: string;

  constructor(
    private readonly metadataStore: MetadataStore,
    options: LocalFileAssetServiceOptions = {}
  ) {
    this.root = resolve(options.storageRoot ?? process.env.FILE_ASSET_STORAGE_ROOT ?? "storage/files");
  }

  createRef(input: CreateFileAssetRefInput): ResolvedFileAssetRef {
    const sha256 = hashBuffer(input.content);
    const storagePath = this.assetStoragePath(sha256);
    const existing = this.metadataStore.fileAssets.findBySha256(sha256);
    if (!existing) {
      mkdirSync(dirname(storagePath), { recursive: true });
      const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
      writeFileSync(temporaryPath, input.content);
      renameSync(temporaryPath, storagePath);
    }
    const asset = this.metadataStore.fileAssets.create({
      id: existing?.id ?? randomUUID(),
      sha256,
      size_bytes: input.content.length,
      storage_path: storagePath,
      ...(input.declared_mime_type ? { detected_mime_type: input.declared_mime_type } : {})
    });
    const ref = this.metadataStore.fileAssetRefs.create({
      id: randomUUID(),
      file_asset_id: asset.id,
      user_id: input.user_id,
      workspace_id: input.workspace_id,
      filename: safeFilename(input.filename),
      ...(input.declared_mime_type ? { declared_mime_type: input.declared_mime_type } : {}),
      source: input.source,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.run_id ? { run_id: input.run_id } : {}),
      ...(input.metadata !== undefined ? { metadata_json: input.metadata } : {})
    });
    return { asset, ref };
  }

  createRefFromPath(input: CreateFileAssetRefFromPathInput): ResolvedFileAssetRef {
    return this.createRef({
      ...input,
      content: readFileSync(input.path)
    });
  }

  deleteRef(input: { user_id: string; workspace_id: string; id: string }): FileAssetRefRecord {
    return this.metadataStore.fileAssetRefs.softDelete(input);
  }

  getRef(input: { user_id: string; workspace_id: string; id: string }): ResolvedFileAssetRef {
    const ref = this.metadataStore.fileAssetRefs.get(input);
    const asset = this.metadataStore.fileAssets.get({ id: ref.file_asset_id });
    this.assertStoragePath(asset.storage_path);
    return { asset, ref };
  }

  listRefs(input: {
    user_id: string;
    workspace_id: string;
    limit?: number;
    source?: FileAssetRefSource;
  }): ResolvedFileAssetRef[] {
    return this.metadataStore.fileAssetRefs.list(input).map((ref) => ({
      asset: this.metadataStore.fileAssets.get({ id: ref.file_asset_id }),
      ref
    }));
  }

  materializeRefToPath(input: {
    ref: FileAssetRefRecord;
    targetPath: string;
    linkStrategy?: "copy" | "hardlink";
  }): void {
    const asset = this.metadataStore.fileAssets.get({ id: input.ref.file_asset_id });
    this.assertStoragePath(asset.storage_path);
    mkdirSync(dirname(input.targetPath), { recursive: true });
    if ((input.linkStrategy ?? "hardlink") === "hardlink") {
      try {
        linkSync(asset.storage_path, input.targetPath);
        return;
      } catch {
        // Cross-device filesystems and some sandboxed volumes do not support hard links.
      }
    }
    copyFileSync(asset.storage_path, input.targetPath);
  }

  readRef(input: { user_id: string; workspace_id: string; id: string }): { body: Buffer; mimeType: string } {
    const { asset, ref } = this.getRef(input);
    return {
      body: readFileSync(asset.storage_path),
      mimeType: ref.declared_mime_type ?? asset.detected_mime_type ?? mimeTypeForFilename(ref.filename)
    };
  }

  private assetStoragePath(sha256: string): string {
    const path = resolve(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("FILE_ASSET_STORAGE_PATH_INVALID");
    }
    return path;
  }

  private assertStoragePath(storagePath: string): void {
    const path = resolve(storagePath);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error("FILE_ASSET_STORAGE_PATH_INVALID");
    }
  }
}

export const fileAssetRefDto = (input: ResolvedFileAssetRef): Record<string, unknown> => ({
  id: input.ref.id,
  assetId: input.asset.id,
  filename: input.ref.filename,
  mimeType: input.ref.declared_mime_type ?? input.asset.detected_mime_type ?? mimeTypeForFilename(input.ref.filename),
  sizeBytes: input.asset.size_bytes,
  sha256: input.asset.sha256,
  source: input.ref.source,
  status: input.ref.status,
  ...(input.ref.session_id ? { sessionId: input.ref.session_id } : {}),
  ...(input.ref.run_id ? { runId: input.ref.run_id } : {}),
  createdAt: input.ref.created_at
});

export const safeFilename = (filename: string): string =>
  basename(filename).replace(/[^a-zA-Z0-9._ -]+/gu, "-").trim() || "file";

export const mimeTypeForFilename = (filename: string): string => {
  const extension = filename.toLowerCase().split(".").pop();
  return ({
    csv: "text/csv; charset=utf-8",
    html: "text/html; charset=utf-8",
    json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8"
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
};

const hashBuffer = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

