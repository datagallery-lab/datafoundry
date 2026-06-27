import { describe, expect, it } from "vitest";
import {
  getCollapsedWorkspaceRailCopy,
  getCollapsedWorkspacePreviewClassNames,
  getSessionListItemIconSlots,
} from "../session-pane-ui";

describe("session pane ui conventions", () => {
  it("names the collapsed sidebar as a workspace quick rail", () => {
    expect(getCollapsedWorkspaceRailCopy()).toEqual({
      expandLabel: "展开工作区快捷栏",
      railLabel: "工作区快捷栏",
      sessionCountLabel: "会话数量",
    });
  });

  it("keeps the chat type icon on the left and pinned state on the right", () => {
    expect(getSessionListItemIconSlots({ pinned: true })).toEqual({
      leading: "session",
      trailing: "pin",
    });
    expect(getSessionListItemIconSlots({ pinned: false })).toEqual({
      leading: "session",
      trailing: "none",
    });
  });

  it("keeps the collapsed hover preview as a compact floating card", () => {
    const classes = getCollapsedWorkspacePreviewClassNames();

    expect(classes.panel).toContain("absolute");
    expect(classes.panel).toContain("w-[320px]");
    expect(classes.panel).toContain("-translate-x-2");
    expect(classes.panel).toContain("opacity-0");
    expect(classes.panel).toContain("transition-[opacity,transform]");
    expect(classes.panel).toContain("group-hover:translate-x-0");
    expect(classes.panel).toContain("group-hover:opacity-100");
    expect(classes.panel).toContain("before:-left-3");
    expect(classes.panel).toContain("before:w-3");
    expect(classes.panel).toContain("max-h-[min(720px,calc(100vh-24px))]");
    expect(classes.panel).not.toContain(" h-full ");
    expect(classes.panel).not.toContain("h-screen");
    expect(classes.sessionList).toContain("max-h-64");
    expect(classes.sessionList).not.toContain("flex-1");
  });
});
