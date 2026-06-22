import type { BaseEvent } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";

export type PlanTaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type PlanTaskState = [PlanTaskStatus, PlanTaskStatus, PlanTaskStatus];

export type JsonPatchOperation = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

export const createInitialPlanTaskState = (): PlanTaskState => ["pending", "pending", "pending"];

export const observePlanActivityEvent = (state: PlanTaskState, event: BaseEvent): void => {
  if (event.type !== EventType.ACTIVITY_DELTA) {
    return;
  }

  const patch = readPatch(event);

  for (const operation of patch) {
    if (operation.op !== "replace" || typeof operation.value !== "string") {
      continue;
    }

    const index = planTaskIndexFromPath(operation.path);

    if (index === undefined || !isPlanTaskStatus(operation.value)) {
      continue;
    }

    state[index] = operation.value;
  }
};

export const createRunFinishedPlanPatch = (state: PlanTaskState): JsonPatchOperation[] => {
  const patch: JsonPatchOperation[] = [];

  state.forEach((status, index) => {
    if (index === 2) {
      patch.push({ op: "replace", path: "/tasks/2/status", value: "completed" });
      return;
    }

    if (status === "pending") {
      patch.push({ op: "replace", path: `/tasks/${index}/status`, value: "skipped" });
      return;
    }

    if (status === "running") {
      patch.push({ op: "replace", path: `/tasks/${index}/status`, value: "completed" });
    }
  });

  return patch;
};

export const createRunFailedPlanPatch = (state: PlanTaskState): JsonPatchOperation[] => {
  const patch: JsonPatchOperation[] = [];

  state.forEach((status, index) => {
    if (status === "running" || index === 2) {
      patch.push({ op: "replace", path: `/tasks/${index}/status`, value: "failed" });
      return;
    }

    if (status === "pending") {
      patch.push({ op: "replace", path: `/tasks/${index}/status`, value: "skipped" });
    }
  });

  return patch;
};

const readPatch = (event: BaseEvent): JsonPatchOperation[] => {
  if (!("patch" in event) || !Array.isArray(event.patch)) {
    return [];
  }

  return event.patch.filter(isPatchOperation);
};

const planTaskIndexFromPath = (path: string): 0 | 1 | 2 | undefined => {
  if (path === "/tasks/0/status") {
    return 0;
  }

  if (path === "/tasks/1/status") {
    return 1;
  }

  if (path === "/tasks/2/status") {
    return 2;
  }

  return undefined;
};

const isPatchOperation = (value: unknown): value is JsonPatchOperation =>
  typeof value === "object" &&
  value !== null &&
  "op" in value &&
  typeof value.op === "string" &&
  "path" in value &&
  typeof value.path === "string";

const isPlanTaskStatus = (value: string): value is PlanTaskStatus =>
  value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "skipped";
