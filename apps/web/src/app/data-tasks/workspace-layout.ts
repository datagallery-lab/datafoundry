export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 640;
export const RIGHT_PANEL_DEFAULT_WIDTH = 400;
export const CHAT_MIN_WIDTH = 400;
export const LEFT_PANEL_WIDTH_EXPANDED = 320;
export const LEFT_PANEL_WIDTH_COLLAPSED = 56;

/** Prevent CSS Grid from compressing a side column below its design width. */
export function fixedGridColumn(width: number): string {
  return `minmax(${width}px, ${width}px)`;
}

export function getLeftPanelWidth(sidebarCollapsed: boolean): number {
  return sidebarCollapsed
    ? LEFT_PANEL_WIDTH_COLLAPSED
    : LEFT_PANEL_WIDTH_EXPANDED;
}

export function getRequiredWorkspaceWidth({
  sidebarCollapsed,
  rightPanelOpen,
  rightPanelWidth,
}: {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const left = getLeftPanelWidth(sidebarCollapsed);
  const right = rightPanelOpen ? rightPanelWidth : 0;
  return left + right + CHAT_MIN_WIDTH;
}

export function getWorkspaceGridTemplateColumns({
  isConfigPanelOpen,
  isRightPanelOpen,
  sidebarCollapsed,
  rightPanelWidth = RIGHT_PANEL_DEFAULT_WIDTH,
}: {
  isConfigPanelOpen: boolean;
  isRightPanelOpen: boolean;
  sidebarCollapsed: boolean;
  rightPanelWidth?: number;
}): string {
  const leftColumn = fixedGridColumn(getLeftPanelWidth(sidebarCollapsed));
  const chatColumn = `minmax(${CHAT_MIN_WIDTH}px, 1fr)`;

  if (isConfigPanelOpen || !isRightPanelOpen) {
    return `${leftColumn} ${chatColumn}`;
  }

  return `${leftColumn} ${chatColumn} ${fixedGridColumn(rightPanelWidth)}`;
}

/**
 * Clamp the right panel width to the absolute drag range only.
 * Viewport pressure is handled by `resolveResponsiveSidebars` (fold/close),
 * not by shrinking panel widths.
 */
export function clampRightPanelWidth(width: number): number {
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(width, RIGHT_PANEL_MAX_WIDTH),
  );
}

/**
 * When the viewport is too narrow for the user's sidebar preferences, collapse
 * the left panel first, then close the right panel. When space returns, user
 * preferences are restored by re-running this from the latest user* state.
 */
export function resolveResponsiveSidebars({
  viewportWidth,
  userSidebarCollapsed,
  userRightPanelOpen,
  rightPanelWidth,
}: {
  viewportWidth: number;
  userSidebarCollapsed: boolean;
  userRightPanelOpen: boolean;
  rightPanelWidth: number;
}): {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
} {
  let sidebarCollapsed = userSidebarCollapsed;
  let rightPanelOpen = userRightPanelOpen;

  const overflows = () =>
    getRequiredWorkspaceWidth({
      sidebarCollapsed,
      rightPanelOpen,
      rightPanelWidth,
    }) > viewportWidth;

  if (overflows() && !sidebarCollapsed) {
    sidebarCollapsed = true;
  }

  if (overflows() && rightPanelOpen) {
    rightPanelOpen = false;
  }

  return { sidebarCollapsed, rightPanelOpen };
}

export const chatPaneClassName = "min-h-0 w-full flex-1";
