import type { ArtifactSummary, ArtifactType, Citation } from "@open-data-agent/contracts";
import { type FileAssetService, fileAssetRefDto, mimeTypeForFilename } from "@open-data-agent/files";
import { artifactRecordToSummary, type MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";

export type CreateArtifactInput = {
  user_id: string;
  session_id: string;
  run_id: string;
  type: ArtifactType;
  name: string;
  preview_json?: unknown;
  citations?: Citation[];
};

export type CreateArtifactFromFileInput = CreateArtifactInput & {
  source_path: string;
  workspace_id: string;
  metadata?: unknown;
};

export interface ArtifactService {
  createArtifact(input: CreateArtifactInput): Promise<ArtifactSummary>;
  createArtifactFromFile(input: CreateArtifactFromFileInput): Promise<ArtifactSummary & {
    download_url: string;
    file_id: string;
  }>;
}

export class LocalArtifactService implements ArtifactService {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly fileAssetService?: FileAssetService
  ) {}

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactSummary> {
    const record = this.metadataStore.artifacts.create({
      user_id: input.user_id,
      session_id: input.session_id,
      run_id: input.run_id,
      id: randomUUID(),
      type: input.type,
      name: input.name,
      preview_json: input.preview_json,
      ...(input.citations ? { metadata_json: { citations: input.citations } } : {})
    });

    return artifactRecordToSummary(record);
  }

  async createArtifactFromFile(input: CreateArtifactFromFileInput): Promise<ArtifactSummary & {
    download_url: string;
    file_id: string;
  }> {
    if (!this.fileAssetService) {
      throw new Error("FILE_ASSET_SERVICE_REQUIRED");
    }
    const file = this.fileAssetService.createRefFromPath({
      user_id: input.user_id,
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      filename: input.name,
      declared_mime_type: mimeTypeForFilename(input.name),
      source: "artifact",
      path: input.source_path,
      metadata: input.metadata
    });
    const record = this.metadataStore.artifacts.create({
      user_id: input.user_id,
      session_id: input.session_id,
      run_id: input.run_id,
      id: randomUUID(),
      type: input.type,
      name: input.name,
      mime_type: mimeTypeForFilename(input.name),
      file_asset_ref_id: file.ref.id,
      preview_json: input.preview_json,
      metadata_json: {
        ...(input.citations ? { citations: input.citations } : {}),
        file: fileAssetRefDto(file)
      }
    });
    return {
      ...artifactRecordToSummary(record),
      file_id: file.ref.id,
      download_url: `/api/v1/artifacts/${record.id}/download`
    };
  }
}
