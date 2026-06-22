import type { ContextItem } from "./tool-result-adapter.js";

export type ContextPackage = {
  version: 2;
  packageId: string;
  revision: number;
  runId?: string;
  sessionId?: string;
  resourceId?: string;
  items: ContextItem[];
  groups: ContextGroup[];
  sourceSnapshots: ContextSourceSnapshot[];
  model: unknown;
  activity: unknown;
  artifactRefs: ArtifactRef[];
  auditRefs: AuditRef[];
  truncation: ContextTruncation[];
};

export type ContextSourceSnapshot = {
  sourceType: string;
  itemIds: string[];
  contentHash: string;
};

export type ContextProjection = Pick<
  ContextPackage,
  "model" | "activity" | "artifactRefs" | "auditRefs" | "truncation"
>;

export type ContextGroupKind = "system" | "turn" | "tool-exchange" | "source" | "reference";

export type ContextGroup = {
  id: string;
  kind: ContextGroupKind;
  atomic: boolean;
  itemIds: string[];
};

export type ArtifactRef = {
  artifact_id: string;
  source: string;
};

export type AuditRef = {
  audit_log_id: string;
  source: string;
};

export type ContextTruncation = {
  sourceId: string;
  truncated: boolean;
  reason: string;
  originalSize: number;
  returnedSize: number;
};
