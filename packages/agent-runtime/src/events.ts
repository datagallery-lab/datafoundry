import { EventType, type BaseEvent } from "@ag-ui/core";
import type { ArtifactSummary } from "@open-data-agent/contracts";

import type { AgentRunContext } from "./types.js";

export type JsonPatchOperation = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

export const createActivitySnapshot = (
  context: AgentRunContext,
  activityType: string,
  content: Record<string, unknown>,
  replace = true
): BaseEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: activityMessageId(context, activityType, content),
  activityType,
  content,
  replace,
  timestamp: Date.now()
});

export const createActivityDelta = (
  context: AgentRunContext,
  activityType: string,
  patch: JsonPatchOperation[],
  content: Record<string, unknown> = {}
): BaseEvent => ({
  type: EventType.ACTIVITY_DELTA,
  messageId: activityMessageId(context, activityType, content),
  activityType,
  patch,
  timestamp: Date.now()
});

export const createCustomEvent = (name: string, value: unknown): BaseEvent => ({
  type: EventType.CUSTOM,
  name,
  value,
  timestamp: Date.now()
});

export const createArtifactEvent = (artifact: ArtifactSummary & {
  download_url?: string;
  file_id?: string;
}): BaseEvent =>
  createCustomEvent("artifact", {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    title: artifact.name,
    summary: artifactEventSummary(artifact),
    preview_available: artifact.preview_json !== undefined,
    ...(artifact.download_url ? { download_url: artifact.download_url } : {}),
    ...(artifact.file_id ? { file_id: artifact.file_id } : {})
  });

const artifactEventSummary = (artifact: ArtifactSummary): string => {
  if (artifact.type === "table" && isRecord(artifact.preview_json)) {
    const rowCount = numberField(artifact.preview_json, "row_count");
    if (rowCount !== undefined) {
      return `数据集，${rowCount.toLocaleString()} 行`;
    }
  }
  return `${artifact.type} artifact`;
};

const activityMessageId = (
  context: AgentRunContext,
  activityType: string,
  content: Record<string, unknown>
): string => {
  const normalizedActivityType = activityType.toLowerCase();
  const stepId = typeof content.step_id === "string" && normalizedActivityType === "step" ? `:${content.step_id}` : "";

  return `${context.run_id}:activity:${normalizedActivityType}${stepId}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const numberField = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};
