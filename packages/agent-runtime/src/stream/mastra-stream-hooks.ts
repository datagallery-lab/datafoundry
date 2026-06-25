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
): MastraStreamNormalizerHooks => ({
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
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
