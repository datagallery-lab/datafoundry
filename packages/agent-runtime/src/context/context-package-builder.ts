import { randomUUID } from "node:crypto";

import type {
  ArtifactRef,
  AuditRef,
  ContextGroup,
  ContextGroupKind,
  ContextPackage,
  ContextProjection,
  ContextTruncation
} from "./context-package.js";
import {
  createContextItem,
  hashContextContent,
  type ContextItem,
  type ContextItemVisibility
} from "./tool-result-adapter.js";

export type BuildContextPackageOptions = {
  packageId?: string;
  revision?: number;
  runId?: string;
  sessionId?: string;
  resourceId?: string;
};

export class ContextPackageBuilder {
  build(items: ContextItem[], options: BuildContextPackageOptions = {}): ContextPackage {
    return {
      version: 2,
      packageId: options.packageId ?? randomUUID(),
      revision: options.revision ?? 0,
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      items: [...items],
      groups: createGroups(items),
      sourceSnapshots: createSourceSnapshots(items),
      model: collapse(items, "model"),
      activity: collapse(items, "activity"),
      artifactRefs: items
        .filter((item) => item.visibility === "artifact-ref")
        .map((item) => requireArtifactRef(item.content)),
      auditRefs: items
        .filter((item) => item.visibility === "audit-ref")
        .map((item) => requireAuditRef(item.content)),
      truncation: items
        .filter((item) => item.visibility === "truncation")
        .map((item) => requireTruncation(item.content))
    };
  }
}

export const contextPackageToItems = (
  contextPackage: ContextProjection,
  sourceType: string,
  priority: number
): ContextItem[] => {
  const groupId = `${sourceType}-observation`;
  const items: ContextItem[] = [
    createProjectedItem(`${sourceType}-model`, sourceType, groupId, "model", priority, contextPackage.model),
    createProjectedItem(`${sourceType}-activity`, sourceType, groupId, "activity", priority, contextPackage.activity)
  ];

  contextPackage.artifactRefs.forEach((ref, index) => {
    items.push(
      createProjectedItem(`${sourceType}-artifact-${index}`, sourceType, groupId, "artifact-ref", priority, ref)
    );
  });
  contextPackage.auditRefs.forEach((ref, index) => {
    items.push(createProjectedItem(`${sourceType}-audit-${index}`, sourceType, groupId, "audit-ref", priority, ref));
  });
  contextPackage.truncation.forEach((entry, index) => {
    items.push(
      createProjectedItem(`${sourceType}-truncation-${index}`, sourceType, groupId, "truncation", priority, entry)
    );
  });

  return items;
};

const createProjectedItem = (
  id: string,
  sourceType: string,
  groupId: string,
  visibility: ContextItemVisibility,
  priority: number,
  content: unknown
): ContextItem => createContextItem({
  id,
  sourceType,
  sourceId: sourceType,
  groupId,
  visibility,
  trust: "tool",
  retention: visibility === "model" ? "supporting" : "reference",
  priority,
  content,
  metadata: { groupKind: visibility === "model" ? "tool-exchange" : "reference" }
});

const createGroups = (items: ContextItem[]): ContextGroup[] => {
  const grouped = new Map<string, ContextItem[]>();

  for (const item of items) {
    grouped.set(item.groupId, [...(grouped.get(item.groupId) ?? []), item]);
  }

  return [...grouped.entries()].map(([id, groupItems]) => ({
    id,
    kind: resolveGroupKind(groupItems),
    atomic: groupItems.every((item) => item.metadata.atomic !== false),
    itemIds: groupItems.map((item) => item.id)
  }));
};

const createSourceSnapshots = (items: ContextItem[]) => {
  const grouped = new Map<string, ContextItem[]>();

  for (const item of items) {
    grouped.set(item.sourceType, [...(grouped.get(item.sourceType) ?? []), item]);
  }

  return [...grouped.entries()].map(([sourceType, sourceItems]) => ({
    sourceType,
    itemIds: sourceItems.map((item) => item.id),
    contentHash: hashContextContent(sourceItems.map((item) => item.contentHash))
  }));
};

const resolveGroupKind = (items: ContextItem[]): ContextGroupKind => {
  const value = items.find((item) => typeof item.metadata.groupKind === "string")?.metadata.groupKind;
  return isContextGroupKind(value) ? value : "source";
};

const isContextGroupKind = (value: unknown): value is ContextGroupKind =>
  value === "system" || value === "turn" || value === "tool-exchange" || value === "source" || value === "reference";

const collapse = (items: ContextItem[], visibility: ContextItemVisibility): unknown => {
  const contents = items.filter((item) => item.visibility === visibility).map((item) => item.content);

  if (contents.length === 0) {
    return null;
  }

  return contents.length === 1 ? contents[0] : contents;
};

const requireArtifactRef = (value: unknown): ArtifactRef => {
  if (!isRecord(value) || typeof value.artifact_id !== "string" || typeof value.source !== "string") {
    throw new Error("INVALID_CONTEXT_ARTIFACT_REF");
  }
  return { artifact_id: value.artifact_id, source: value.source };
};

const requireAuditRef = (value: unknown): AuditRef => {
  if (!isRecord(value) || typeof value.audit_log_id !== "string" || typeof value.source !== "string") {
    throw new Error("INVALID_CONTEXT_AUDIT_REF");
  }
  return { audit_log_id: value.audit_log_id, source: value.source };
};

const requireTruncation = (value: unknown): ContextTruncation => {
  if (
    !isRecord(value) ||
    typeof value.sourceId !== "string" ||
    typeof value.truncated !== "boolean" ||
    typeof value.reason !== "string" ||
    typeof value.originalSize !== "number" ||
    typeof value.returnedSize !== "number"
  ) {
    throw new Error("INVALID_CONTEXT_TRUNCATION");
  }
  return {
    sourceId: value.sourceId,
    truncated: value.truncated,
    reason: value.reason,
    originalSize: value.originalSize,
    returnedSize: value.returnedSize
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
