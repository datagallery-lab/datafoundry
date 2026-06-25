import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";
import type { MastraStreamChunk, MastraStreamNormalizerHooks } from "./mastra-stream-normalizer.js";

const SANDBOX_DATA_TYPES = new Set([
  "data-sandbox-stdout",
  "data-sandbox-stderr",
  "data-sandbox-exit",
  "data-sandbox-command"
]);

/** Map Mastra data-* stream chunks to AG-UI CUSTOM events for persistence and UI. */
export const createMastraStreamNormalizerHooks = (
  emitter: AgUiEventEmitter
): MastraStreamNormalizerHooks => {
  const emittedUsageKeys = new Set<string>();

  return {
    onChunk(chunk: MastraStreamChunk) {
      const usageEvent = tokenUsageEventFromChunk(chunk);
      if (!usageEvent) {
        return;
      }
      const key = JSON.stringify(usageEvent);
      if (emittedUsageKeys.has(key)) {
        return;
      }
      emittedUsageKeys.add(key);
      emitter.emit(createCustomEvent("token_usage", usageEvent));
    },
    onDataChunk(chunk: MastraStreamChunk) {
      const type = typeof chunk.type === "string" ? chunk.type : undefined;
      if (!type?.startsWith("data-")) {
        return;
      }

      if (type === "data-workspace-metadata") {
        emitter.emit(createCustomEvent("workspace.metadata", chunk.data));
        return;
      }

      if (SANDBOX_DATA_TYPES.has(type)) {
        const kind = type.slice("data-sandbox-".length);
        const data = isRecord(chunk.data) ? chunk.data : { value: chunk.data };
        emitter.emit(createCustomEvent("sandbox.output", { kind, ...data }));
      }
    }
  };
};

const tokenUsageEventFromChunk = (chunk: MastraStreamChunk): Record<string, unknown> | undefined => {
  const payload = isRecord(chunk.payload) ? chunk.payload : undefined;
  const data = isRecord(chunk.data) ? chunk.data : undefined;
  const usage = usageRecord(chunk.usage) ?? usageRecord(payload?.usage) ?? usageRecord(data?.usage);
  if (!usage) {
    return undefined;
  }
  const inputTokens = numericValue(usage.inputTokens) ?? numericValue(usage.promptTokens);
  const outputTokens = numericValue(usage.outputTokens) ?? numericValue(usage.completionTokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return {
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    prompt_tokens: inputTokens ?? 0,
    completion_tokens: outputTokens ?? 0,
    ...(numericValue(usage.totalTokens) !== undefined ? { total_tokens: numericValue(usage.totalTokens) } : {}),
    ...(numericValue(chunk.stepNumber) !== undefined ? { step_number: numericValue(chunk.stepNumber) } : {}),
    ...(numericValue(payload?.stepNumber) !== undefined ? { step_number: numericValue(payload?.stepNumber) } : {}),
    ...(typeof chunk.runId === "string" ? { run_id: chunk.runId } : {}),
    ...(typeof chunk.from === "string" ? { source: chunk.from } : {})
  };
};

const usageRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const numericValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
