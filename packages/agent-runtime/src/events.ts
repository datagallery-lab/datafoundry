import { EventType, type BaseEvent } from "@ag-ui/core";

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

const activityMessageId = (
  context: AgentRunContext,
  activityType: string,
  content: Record<string, unknown>
): string => {
  const normalizedActivityType = activityType.toLowerCase();
  const stepId = typeof content.step_id === "string" && normalizedActivityType === "step" ? `:${content.step_id}` : "";

  return `${context.run_id}:activity:${normalizedActivityType}${stepId}`;
};
