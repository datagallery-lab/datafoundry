export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 640;
export const RIGHT_PANEL_DEFAULT_WIDTH = 400;
export const CHAT_MIN_WIDTH = 400;
/** Preferred chat input card width (Tailwind `max-w-3xl`). */
export const CHAT_INPUT_PREFERRED_WIDTH = 768;
/** Minimum chat input card width before extreme squeeze. */
export const CHAT_INPUT_MIN_WIDTH = 360;
/** Horizontal margin around the chat input within the middle column. */
export const CHAT_INPUT_HORIZONTAL_PADDING = 32;
export const LEFT_PANEL_WIDTH_EXPANDED = 320;
export const LEFT_PANEL_WIDTH_COLLAPSED = 56;

/** Width the middle column must reserve for the chat input at full size. */
export function getChatInputReservedWidth(): number {
  return CHAT_INPUT_PREFERRED_WIDTH + CHAT_INPUT_HORIZONTAL_PADDING;
}

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
  return left + right + getChatInputReservedWidth();
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
 * When the viewport is too narrow for the user's sidebar preferences, close
 * the right panel first, then collapse the left panel. When space returns,
 * user preferences are restored by re-running this from the latest user* state.
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

  // Prefer collapsing the left sidebar before closing the console when the user
  // wants it open — keeps dock mode reachable on medium-width viewports (e.g.
  // 16" laptops with OS scaling).
  if (userRightPanelOpen && overflows() && !sidebarCollapsed) {
    sidebarCollapsed = true;
  }

  if (overflows() && rightPanelOpen) {
    rightPanelOpen = false;
  }

  return { sidebarCollapsed, rightPanelOpen };
}

/**
 * When the user explicitly expands the left panel, honor that intent even if the
 * viewport cannot fit a docked right console at the same time.
 */
export function resolveSidebarExpandPreferences({
  viewportWidth,
  userRightPanelOpen,
  rightPanelWidth,
}: {
  viewportWidth: number;
  userRightPanelOpen: boolean;
  rightPanelWidth: number;
}): {
  userSidebarCollapsed: false;
  userRightPanelOpen: boolean;
} {
  let nextRightPanelOpen = userRightPanelOpen;
  const expandedWidthExceedsViewport = (rightPanelOpen: boolean) =>
    getRequiredWorkspaceWidth({
      sidebarCollapsed: false,
      rightPanelOpen,
      rightPanelWidth,
    }) > viewportWidth;

  if (expandedWidthExceedsViewport(nextRightPanelOpen) && nextRightPanelOpen) {
    nextRightPanelOpen = false;
  }

  return {
    userSidebarCollapsed: false,
    userRightPanelOpen: nextRightPanelOpen,
  };
}

/**
 * Whether the viewport can fit a docked right panel (left collapsed + chat
 * reservation + right panel). When false, TaskConsole should use drawer mode.
 */
export function canDockRightPanel({
  viewportWidth,
  rightPanelWidth,
}: {
  viewportWidth: number;
  rightPanelWidth: number;
}): boolean {
  if (viewportWidth <= 0) return true;
  return (
    getRequiredWorkspaceWidth({
      sidebarCollapsed: true,
      rightPanelOpen: true,
      rightPanelWidth,
    }) <= viewportWidth
  );
}

export const chatPaneClassName =
  "min-h-0 w-full flex-1 [&_[data-testid='copilot-scrollable']]:pb-32";
