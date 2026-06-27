const toolActionLabels: Record<string, string> = {
  list_data_sources: "查看数据源",
  inspect_schema: "检查表结构",
  preview_table: "预览数据",
  run_sql_readonly: "执行查询",
  retrieve_knowledge: "检索知识",
  read_file: "读取文件",
  edit_file: "编辑文件",
  write_file: "写入文件",
  list_files: "浏览文件",
  grep: "搜索文件",
  mkdir: "创建目录",
  file_stat: "查看文件信息",
  execute_command: "执行命令",
  publish_artifact: "发布产物",
  promote_workspace_file: "提升工作区文件",
  task_write: "写入任务",
  task_update: "更新任务",
  task_complete: "完成任务",
  task_check: "检查任务",
  ask_user: "等待确认",
  submit_plan: "提交计划",
};

const fileToolNames = new Set(["read_file", "edit_file", "write_file"]);
const dataToolNames = new Set([
  "list_data_sources",
  "inspect_schema",
  "preview_table",
  "run_sql_readonly",
]);
const workspaceToolNames = new Set([
  "list_files",
  "grep",
  "mkdir",
  "file_stat",
  "execute_command",
  "publish_artifact",
  "promote_workspace_file",
  "task_write",
  "task_update",
  "task_complete",
  "task_check",
]);

export function resolveToolStepActionLabel(toolNames: string[]): string {
  const normalized = toolNames.map((name) => name.trim()).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 0) return "思考";
  if (unique.length === 1) return toolActionLabels[unique[0]] ?? "调用工具";

  if (unique.every((name) => fileToolNames.has(name))) return "处理文件";
  if (unique.every((name) => dataToolNames.has(name))) return "分析数据";
  if (unique.every((name) => workspaceToolNames.has(name))) return "操作工作区";

  const firstKnown = unique.find((name) => toolActionLabels[name]);
  if (firstKnown && unique.length === 2) {
    return `${toolActionLabels[firstKnown]}等`;
  }
  return `调用 ${unique.length} 个工具`;
}

function firstSummaryLine(text: string): string {
  const line = text.split("\n").find((segment) => segment.trim().length > 0) ?? "";
  return line
    .replace(/^[#>*\-\s]+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function looksChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** Step card subtitle — prefer Chinese tool labels over English LLM body text. */
export function resolveStepSummaryText(input: {
  content: string;
  hasToolCalls: boolean;
  displayToolNames: string;
  toolActionLabel: string;
  isThought: boolean;
}): string {
  if (input.hasToolCalls) {
    if (input.displayToolNames) return `调用 ${input.displayToolNames}`;
    return input.toolActionLabel;
  }
  if (input.isThought) return "思考";
  const line = firstSummaryLine(input.content);
  if (line && looksChinese(line)) {
    return line.length > 64 ? `${line.slice(0, 64)}…` : line;
  }
  return line ? "思考" : "步骤";
}

export function resolveCollaborationStepLabel(
  toolNames: string[],
  isActive: boolean,
  linkedToolName?: string,
): string {
  const normalized = new Set(toolNames.map((name) => name.trim()).filter(Boolean));
  if (linkedToolName) normalized.add(linkedToolName);
  if (normalized.has("submit_plan")) return "计划审批";
  if (normalized.has("ask_user")) return isActive ? "等待用户选择" : "用户协作";
  return isActive ? "等待确认" : "协作步骤";
}

export function resolveStepBadgePresentation({
  stepNumber,
  isFinalAnswer,
  isStreamingAnswer,
  isActive,
  isThought,
  isCollaboration,
  isWaitingForUser,
}: {
  stepNumber: number;
  isFinalAnswer: boolean;
  isStreamingAnswer: boolean;
  isActive: boolean;
  isThought?: boolean;
  isCollaboration?: boolean;
  isWaitingForUser?: boolean;
}):
  | { kind: "number"; value: number }
  | { kind: "waiting" }
  | { kind: "collaboration" }
  | { kind: "final" }
  | { kind: "streaming" }
  | { kind: "thought" }
  | { kind: "empty" } {
  if (stepNumber > 0) return { kind: "number", value: stepNumber };
  if (isWaitingForUser || (isCollaboration && isActive)) return { kind: "waiting" };
  if (isCollaboration) return { kind: "collaboration" };
  if (isFinalAnswer) return { kind: "final" };
  if (isStreamingAnswer) return { kind: "streaming" };
  if (isThought) return { kind: "thought" };
  return { kind: "empty" };
}
