import { asRecord, BaseToolContextAdapter, pickFields } from "./base-tool-context-adapter.js";

abstract class BaseCollaborationToolContextAdapter extends BaseToolContextAdapter {
  protected project(raw: unknown): unknown {
    return {
      ...pickFields(asRecord(raw), ["content", "isError"]),
      source: "mastra-collaboration"
    };
  }
}

export class AskUserContextAdapter extends BaseCollaborationToolContextAdapter {
  readonly toolName = "ask_user";
  readonly resultType = "ask-user";
}

export class SubmitPlanContextAdapter extends BaseCollaborationToolContextAdapter {
  readonly toolName = "submit_plan";
  readonly resultType = "submit-plan";
}
