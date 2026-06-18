import type { ArtifactSummary, ArtifactType, Citation } from "@open-data-agent/contracts";
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

export interface ArtifactService {
  createArtifact(input: CreateArtifactInput): Promise<ArtifactSummary>;
}

export class LocalArtifactService implements ArtifactService {
  constructor(private readonly metadataStore: MetadataStore) {}

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
}
