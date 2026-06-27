import { describe, expect, it } from "vitest";
import {
  resolveStepBadgePresentation,
  resolveCollaborationStepLabel,
  resolveStepSummaryText,
  resolveToolStepActionLabel,
} from "../step-display-label";

describe("resolveToolStepActionLabel", () => {
  it("uses specific action labels for common data tools", () => {
    expect(resolveToolStepActionLabel(["list_data_sources"])).toBe("查看数据源");
    expect(resolveToolStepActionLabel(["inspect_schema"])).toBe("检查表结构");
    expect(resolveToolStepActionLabel(["preview_table"])).toBe("预览数据");
    expect(resolveToolStepActionLabel(["run_sql_readonly"])).toBe("执行查询");
  });

  it("uses specific action labels for file and knowledge tools", () => {
    expect(resolveToolStepActionLabel(["retrieve_knowledge"])).toBe("检索知识");
    expect(resolveToolStepActionLabel(["edit_file"])).toBe("编辑文件");
    expect(resolveToolStepActionLabel(["read_file"])).toBe("读取文件");
  });

  it("summarizes mixed or unknown tool sets without templated wording", () => {
    expect(resolveToolStepActionLabel(["read_file", "edit_file"])).toBe("处理文件");
    expect(resolveToolStepActionLabel(["list_files", "grep"])).toBe("操作工作区");
    expect(resolveToolStepActionLabel(["unknown_tool", "another_tool"])).toBe("调用 2 个工具");
  });
});

describe("resolveStepSummaryText", () => {
  it("prefers Chinese tool labels over English body text when tools ran", () => {
    expect(
      resolveStepSummaryText({
        content: "I'll inspect the schema for you.",
        hasToolCalls: true,
        displayToolNames: "检查数据源 Schema",
        toolActionLabel: "检查表结构",
        isThought: false,
      }),
    ).toBe("调用 检查数据源 Schema");
  });

  it("falls back to thought label for English-only interim text", () => {
    expect(
      resolveStepSummaryText({
        content: "Let me think about this query.",
        hasToolCalls: false,
        displayToolNames: "",
        toolActionLabel: "思考",
        isThought: true,
      }),
    ).toBe("思考");
  });
});

describe("resolveCollaborationStepLabel", () => {
  it("labels completed ask_user steps by interaction type, not accepted result", () => {
    expect(resolveCollaborationStepLabel(["ask_user"], false)).toBe("用户协作");
  });

  it("labels submit_plan steps distinctly from ask_user", () => {
    expect(resolveCollaborationStepLabel(["submit_plan"], false)).toBe("计划审批");
  });

  it("uses the linked collaboration tool name when the chat message has no raw toolCalls", () => {
    expect(resolveCollaborationStepLabel([], false, "submit_plan")).toBe("计划审批");
    expect(resolveCollaborationStepLabel([], false, "ask_user")).toBe("用户协作");
  });
});

describe("resolveStepBadgePresentation", () => {
  it("keeps collaboration tools in the numbered tool sequence", () => {
    expect(
      resolveStepBadgePresentation({
        stepNumber: 2,
        isCollaboration: true,
        isWaitingForUser: false,
        isActive: false,
        isFinalAnswer: false,
        isStreamingAnswer: false,
        isThought: false,
      }),
    ).toEqual({ kind: "number", value: 2 });
  });
});
