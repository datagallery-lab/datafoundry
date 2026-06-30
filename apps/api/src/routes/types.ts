import type { ApiResult } from "@open-data-agent/contracts";
import type { LocalDataGateway } from "@open-data-agent/data-gateway";
import type { FileAssetService } from "@open-data-agent/files";
import type { LocalKnowledgeService } from "@open-data-agent/knowledge";
import type { MetadataStore } from "@open-data-agent/metadata";
import type { RunCancelRegistry } from "../run-cancel-registry.js";

export type ConfigApiContext = {
  dataGateway: LocalDataGateway;
  fileAssetService: FileAssetService;
  knowledgeService: LocalKnowledgeService;
  metadataStore: MetadataStore;
  runCancelRegistry: RunCancelRegistry;
  userId: string;
  workspaceId?: string;
};

export type ConfigApiResponse = {
  body: ApiResult<unknown> | Buffer | Record<string, unknown>;
  headers?: Record<string, string>;
  status: number;
};
