import { asRecord, BaseToolContextAdapter, pickFields } from "./base-tool-context-adapter.js";

abstract class BaseTaskToolContextAdapter extends BaseToolContextAdapter {
  protected project(raw: unknown): unknown {
    const record = asRecord(raw);
    return {
      ...pickFields(record, ["content", "tasks", "summary", "incompleteTasks", "isError"]),
      source: "mastra-task-state"
    };
  }
}

export class TaskWriteContextAdapter extends BaseTaskToolContextAdapter {
  readonly toolName = "task_write";
  readonly resultType = "task-write";
}

export class TaskUpdateContextAdapter extends BaseTaskToolContextAdapter {
  readonly toolName = "task_update";
  readonly resultType = "task-update";
}

export class TaskCompleteContextAdapter extends BaseTaskToolContextAdapter {
  readonly toolName = "task_complete";
  readonly resultType = "task-complete";
}

export class TaskCheckContextAdapter extends BaseTaskToolContextAdapter {
  readonly toolName = "task_check";
  readonly resultType = "task-check";
}
