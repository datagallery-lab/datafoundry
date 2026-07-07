import { describe, expect, it } from "vitest";
import {
  canDockRightPanel,
  chatPaneClassName,
  clampLeftPanelWidth,
  clampRightPanelWidth,
  fixedGridColumn,
  getChatInputReservedWidth,
  getMinimumWorkspaceWidth,
  getRequiredWorkspaceWidth,
  getWorkspaceGridTemplateColumns,
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
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
      `${fixedGridColumn(LEFT_PANEL_DEFAULT_WIDTH)} minmax(${CHAT_MIN_WIDTH}px, 1fr) ${fixedGridColumn(400)}`,
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

  it("collapses the right track to zero (keeping three tracks) when the console is closed", () => {
    // Track count stays constant so `grid-template-columns` transitions
    // smoothly instead of leaving an empty reserved column mid-animation.
    expect(
      getWorkspaceGridTemplateColumns({
        isConfigPanelOpen: false,
        isRightPanelOpen: false,
        sidebarCollapsed: false,
      }),
    ).toBe(
      `${fixedGridColumn(LEFT_PANEL_DEFAULT_WIDTH)} minmax(${CHAT_MIN_WIDTH}px, 1fr) ${fixedGridColumn(0)}`,
    );
  });

  it("collapses the right track to zero when a config panel takes over the middle column", () => {
    expect(
      getWorkspaceGridTemplateColumns({
        isConfigPanelOpen: true,
        isRightPanelOpen: true,
        sidebarCollapsed: false,
      }),
    ).toBe(
      `${fixedGridColumn(LEFT_PANEL_DEFAULT_WIDTH)} minmax(${CHAT_MIN_WIDTH}px, 1fr) ${fixedGridColumn(0)}`,
    );
  });

  it("does not cap the chat surface width", () => {
    expect(chatPaneClassName).not.toContain("max-w");
    expect(chatPaneClassName).toContain("w-full");
  });
});

describe("clampLeftPanelWidth", () => {
  it("never drops below the minimum width", () => {
    expect(clampLeftPanelWidth(100)).toBe(LEFT_PANEL_MIN_WIDTH);
  });

  it("caps at the absolute maximum", () => {
    expect(clampLeftPanelWidth(400)).toBe(LEFT_PANEL_MAX_WIDTH);
  });

  it("keeps a requested width within bounds", () => {
    expect(clampLeftPanelWidth(240)).toBe(240);
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

  it("keeps the left sidebar expanded when the docked console still fits the chat minimum", () => {
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

  it("keeps the left sidebar expanded before closing the console for preferred-width pressure", () => {
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

  it("closes the right panel before folding the left sidebar", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 900,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: false,
    });
  });

  it("keeps the left panel on narrow viewports when closing the right panel is enough", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 700,
        userSidebarCollapsed: false,
        userRightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toEqual({
      sidebarCollapsed: false,
      rightPanelOpen: false,
    });
  });

  it("collapses the left panel only when the minimum chat column would still overflow", () => {
    expect(
      resolveResponsiveSidebars({
        viewportWidth: 500,
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
    ).toBe(LEFT_PANEL_DEFAULT_WIDTH + 360 + getChatInputReservedWidth());
  });
});

describe("getMinimumWorkspaceWidth", () => {
  it("sums fixed side widths plus the chat column minimum", () => {
    expect(
      getMinimumWorkspaceWidth({
        sidebarCollapsed: false,
        rightPanelOpen: true,
        rightPanelWidth: 360,
      }),
    ).toBe(LEFT_PANEL_DEFAULT_WIDTH + 360 + CHAT_MIN_WIDTH);
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
