export type CollaborationToolName = "ask_user" | "submit_plan";

type ChoiceOption = { label: string; value: string; description?: string };

export type CollaborationResponseLayout = {
  recapSide: "assistant";
  choiceSide: "user";
  planRenderer: "markdown" | undefined;
};

export function collaborationResponseLayout(
  toolName: CollaborationToolName,
): CollaborationResponseLayout {
  return {
    recapSide: "assistant",
    choiceSide: "user",
    planRenderer: toolName === "submit_plan" ? "markdown" : undefined,
  };
}

export function formatCollaborationResponseDisplay(
  toolName: CollaborationToolName,
  response: unknown,
  options: ChoiceOption[] = [],
): string {
  if (toolName === "submit_plan") {
    if (response && typeof response === "object") {
      const record = response as { action?: string; feedback?: string };
      if (record.action === "approved") return "已批准执行计划";
      if (record.action === "rejected") {
        return record.feedback?.trim()
          ? `已拒绝计划：${record.feedback.trim()}`
          : "已拒绝执行计划";
      }
    }
    return "已提交计划审批结果";
  }

  if (typeof response === "string") {
    const trimmed = response.trim();
    const matched = options.find((option) => option.value === trimmed);
    return matched?.label ?? trimmed;
  }

  if (typeof response === "number" || typeof response === "boolean") {
    return String(response);
  }

  if (response && typeof response === "object") {
    try {
      return JSON.stringify(response);
    } catch {
      return "已提交回答";
    }
  }

  return "已提交回答";
}
