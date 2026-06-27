import { describe, expect, it } from "vitest";
import {
  canDockRightPanel,
  chatPaneClassName,
  clampRightPanelWidth,
  fixedGridColumn,
  getChatInputReservedWidth,
  getRequiredWorkspaceWidth,
  getWorkspaceGridTemplateColumns,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  resolveResponsiveSidebars,
  resolveSidebarExpandPreferences,
  CHAT_MIN_WIDTH,
  LEFT_PANEL_WIDTH_COLLAPSED,
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
  it("keeps user preferences when the viewport fits the preferred chat input", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1500,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: true,
    });
  });

  it("collapses the left sidebar and closes the right panel when both are needed", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1200,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: true,
      rightPanelOpen: false,
    });
  });

  it("collapses the left sidebar before closing the console when the user wants it open", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1300,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: true,
      rightPanelOpen: true,
    });
  });

  it("collapses the left panel when closing the right panel is not enough", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 900,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: true,
      rightPanelOpen: false,
    });
  });

  it("collapses the left panel on very narrow viewports", () => {
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
        viewportWidth: 1500,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: true,
    });
  });

  it("keeps an explicitly expanded left panel when only the chat input preference overflows", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 1000,
        userSidebarCollapsed: false,
        userRightPanelOpen: false,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: false,
    });
  });
});

describe("getRequiredWorkspaceWidth", () => {
  it("sums fixed side widths plus the preferred chat input reservation", () => {
    expect(
      getRequiredWorkspaceWidth({
        sidebarCollapsed: false,
        rightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toBe(320 + 360 + getChatInputReservedWidth());
  });
});

describe("canDockRightPanel", () => {
  it("returns true when the viewport fits collapsed left + right + chat reservation", () => {
    const minWidth =
      LEFT_PANEL_WIDTH_COLLAPSED +
      RIGHT_PANEL_MIN_WIDTH +
      getChatInputReservedWidth();
    expect(
      canDockRightPanel({
        viewportWidth: minWidth,
        rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
      }),
    ).toBe(true);
  });

  it("returns false when the viewport is narrower than the dock minimum", () => {
    const minWidth =
      LEFT_PANEL_WIDTH_COLLAPSED +
      RIGHT_PANEL_MIN_WIDTH +
      getChatInputReservedWidth();
    expect(
      canDockRightPanel({
        viewportWidth: minWidth - 1,
        rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
      }),
    ).toBe(false);
  });

  it("returns true for unknown viewport width (SSR/hydration)", () => {
    expect(
      canDockRightPanel({
        viewportWidth: 0,
        rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
      }),
    ).toBe(true);
  });
});

describe("resolveSidebarExpandPreferences", () => {
  it("keeps right panel open when the viewport fits expanded left + right", () => {
    expect(
      resolveSidebarExpandPreferences({
        viewportWidth: 1500,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      userSidebarCollapsed: false,
      userRightPanelOpen: true,
    });
  });

  it("closes the right panel when expanding left would overflow", () => {
    expect(
      resolveSidebarExpandPreferences({
        viewportWidth: 1200,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      userSidebarCollapsed: false,
      userRightPanelOpen: false,
    });
  });
});
