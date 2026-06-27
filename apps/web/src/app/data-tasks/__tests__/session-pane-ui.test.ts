import { describe, expect, it } from "vitest";
import {
  getCollapsedWorkspaceRailCopy,
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
});
