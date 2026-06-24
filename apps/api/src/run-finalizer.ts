import { EventType, type BaseEvent } from "@ag-ui/client";
import { createCustomEvent, type GoalRuntimeAdapter } from "@open-data-agent/agent-runtime";
import type { MetadataStore } from "@open-data-agent/metadata";

export type RunStatus = "running" | "suspended" | "completed" | "failed" | "canceled";

type RunFinalizerInput = {
  destroyWorkspace(): Promise<void>;
  emit(event: BaseEvent): void;
  flushCompletedMemory(input: { emit(event: BaseEvent): void; signal: AbortSignal }): Promise<void>;
  memoryExtractionTimeoutMs: number;
  metadataStore: MetadataStore;
  runId: string;
  userId: string;
};

/** Owns terminal run state transitions and their externally visible AG-UI event order. */
export class RunFinalizer {
  private readonly input: RunFinalizerInput;

  constructor(input: RunFinalizerInput) {
    this.input = input;
  }

  suspend(): void {
    this.input.metadataStore.runs.updateStatus({
      user_id: this.input.userId,
      run_id: this.input.runId,
      status: "suspended"
    });
    this.input.emit(createRunStatusDelta("suspended"));
  }

  async cancel(input: { interactionResolvedEvent: BaseEvent; terminalEvent: BaseEvent }): Promise<void> {
    this.input.emit(input.interactionResolvedEvent);
    this.input.metadataStore.runs.updateStatus({
      user_id: this.input.userId,
      run_id: this.input.runId,
      status: "canceled"
    });
    this.input.emit(createRunStatusDelta("canceled"));
    await this.input.destroyWorkspace().catch(() => undefined);
    this.input.emit(input.terminalEvent);
  }

  async complete(input: { goalRuntime?: GoalRuntimeAdapter | undefined; terminalEvent: BaseEvent }): Promise<void> {
    if (input.goalRuntime) {
      this.input.emit(createCustomEvent("goal.updated", {
        goal: await input.goalRuntime.getSnapshot(),
        source: "mastra-native-goal"
      }));
    }
    await this.flushCompletedMemoryWithTimeout();
    this.input.metadataStore.runs.updateStatus({
      user_id: this.input.userId,
      run_id: this.input.runId,
      status: "completed"
    });
    this.input.emit(createRunStatusDelta("completed"));
    await this.input.destroyWorkspace().catch(() => undefined);
    this.input.emit(input.terminalEvent);
  }

  fail(input: { errorMessage: string; terminalEvent: BaseEvent }): void {
    this.input.metadataStore.runs.updateStatus({
      user_id: this.input.userId,
      run_id: this.input.runId,
      status: "failed",
      error_message: input.errorMessage
    });
    this.input.emit(createRunStatusDelta("failed", input.errorMessage));
    void this.input.destroyWorkspace().catch(() => undefined);
    this.input.emit(input.terminalEvent);
  }

  private async flushCompletedMemoryWithTimeout(): Promise<void> {
    const timeoutMs = normalizeTimeoutMs(this.input.memoryExtractionTimeoutMs);
    const controller = new AbortController();
    const memoryEmitter = createScopedEmitter(this.input.emit);
    const task = this.input.flushCompletedMemory({
      emit: memoryEmitter.emit,
      signal: controller.signal
    });
    const result = await settleWithTimeout(task, timeoutMs, () => {
      controller.abort(new Error("MEMORY_EXTRACTION_TIMEOUT"));
      memoryEmitter.close();
    });

    if (result.status === "timeout") {
      this.input.emit(createCustomEvent("memory.completed-flush.timeout", {
        source: "completed-run",
        timeout_ms: timeoutMs
      }));
      return;
    }
    if (result.status === "failed") {
      this.input.emit(createCustomEvent("memory.completed-flush.failed", {
        error_message: result.errorMessage,
        source: "completed-run"
      }));
    }
  }
}

export const createRunStatusDelta = (
  status: RunStatus,
  errorMessage?: string
): BaseEvent => ({
  type: EventType.STATE_DELTA,
  delta: [
    { op: "replace", path: "/runStatus", value: status },
    ...(errorMessage ? [{ op: "add", path: "/errorMessage", value: errorMessage }] : [])
  ],
  timestamp: Date.now()
});

const DEFAULT_MEMORY_EXTRACTION_TIMEOUT_MS = 2000;

type TimeoutResult =
  | { status: "completed" }
  | { errorMessage: string; status: "failed" }
  | { status: "timeout" };

const settleWithTimeout = async (
  task: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<TimeoutResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchedTask = task.then(
    () => ({ status: "completed" as const }),
    (error: unknown) => ({ errorMessage: errorMessage(error), status: "failed" as const })
  );
  const timeout = new Promise<TimeoutResult>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve({ status: "timeout" });
    }, timeoutMs);
  });
  const result = await Promise.race([watchedTask, timeout]);
  if (timer) {
    clearTimeout(timer);
  }
  void watchedTask.catch(() => undefined);
  return result;
};

const createScopedEmitter = (emit: (event: BaseEvent) => void): {
  close(): void;
  emit(event: BaseEvent): void;
} => {
  let closed = false;
  return {
    close: () => {
      closed = true;
    },
    emit: (event) => {
      if (!closed) {
        emit(event);
      }
    }
  };
};

const normalizeTimeoutMs = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : DEFAULT_MEMORY_EXTRACTION_TIMEOUT_MS;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "Unknown memory flush error";
