import { describe, expect, it } from "vitest";
import {
  chatPaneClassName,
  clampRightPanelWidth,
  fixedGridColumn,
  getRequiredWorkspaceWidth,
  getWorkspaceGridTemplateColumns,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  resolveResponsiveSidebars,
  CHAT_MIN_WIDTH,
} from "../workspace-layout";

describe("workspace layout", () => {
  it("uses fixed minmax columns for left and right panels", () => {
    expect(
      getWorkspaceGridTemplateColumns({
        isConfigPanelOpen: false,
        isRightPanelOpen: true,
        sidebarCollapsed: false,
        rightPanelWidth: 400,
      }),
    ).toBe(
      `${fixedGridColumn(320)} minmax(${CHAT_MIN_WIDTH}px, 1fr) ${fixedGridColumn(400)}`,
    );
  });

  it("falls back to the default width when none is supplied", () => {
    expect(
      getWorkspaceGridTemplateColumns({
        isConfigPanelOpen: false,
        isRightPanelOpen: true,
        sidebarCollapsed: false,
      }),
    ).toContain(fixedGridColumn(RIGHT_PANEL_DEFAULT_WIDTH));
  });

  it("releases the middle column when the right console is closed", () => {
    expect(
      getWorkspaceGridTemplateColumns({
        isConfigPanelOpen: false,
        isRightPanelOpen: false,
        sidebarCollapsed: false,
      }),
    ).toBe(`${fixedGridColumn(320)} minmax(${CHAT_MIN_WIDTH}px, 1fr)`);
  });

  it("does not cap the chat surface width", () => {
    expect(chatPaneClassName).not.toContain("max-w");
    expect(chatPaneClassName).toContain("w-full");
  });
});

describe("clampRightPanelWidth", () => {
  it("never drops below the minimum width", () => {
    expect(clampRightPanelWidth(100)).toBe(RIGHT_PANEL_MIN_WIDTH);
  });

  it("caps at the absolute maximum", () => {
    expect(clampRightPanelWidth(900)).toBe(RIGHT_PANEL_MAX_WIDTH);
  });

  it("keeps a requested width within bounds", () => {
    expect(clampRightPanelWidth(420)).toBe(420);
  });

  it("does not shrink width on a narrow viewport", () => {
    expect(clampRightPanelWidth(360)).toBe(360);
  });
});

describe("resolveResponsiveSidebars", () => {
  it("keeps user preferences when the viewport is wide enough", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1200,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: true,
    });
  });

  it("auto-collapses the left panel instead of shrinking panel widths", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 900,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: true,
      rightPanelOpen: true,
    });
  });

  it("closes the right panel when the viewport is still too narrow", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 700,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: true,
      rightPanelOpen: false,
    });
  });

  it("restores user preferences when the viewport becomes wide enough again", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1300,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: true,
    });
  });
});

describe("getRequiredWorkspaceWidth", () => {
  it("sums fixed side widths plus the chat minimum", () => {
    expect(
      getRequiredWorkspaceWidth({
        sidebarCollapsed: false,
        rightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toBe(320 + 360 + CHAT_MIN_WIDTH);
  });
});
