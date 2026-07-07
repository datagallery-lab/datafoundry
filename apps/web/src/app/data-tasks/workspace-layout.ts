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
export const LEFT_PANEL_MIN_WIDTH = 200;
export const LEFT_PANEL_MAX_WIDTH = 280;
export const LEFT_PANEL_DEFAULT_WIDTH = 260;
/** @deprecated Use {@link LEFT_PANEL_DEFAULT_WIDTH} — expanded width is user-resizable. */
export const LEFT_PANEL_WIDTH_EXPANDED = LEFT_PANEL_DEFAULT_WIDTH;
export const LEFT_PANEL_WIDTH_COLLAPSED = 56;

/** Width the middle column must reserve for the chat input at full size. */
export function getChatInputReservedWidth(): number {
  return CHAT_INPUT_PREFERRED_WIDTH + CHAT_INPUT_HORIZONTAL_PADDING;
}

/** Prevent CSS Grid from compressing a side column below its design width. */
export function fixedGridColumn(width: number): string {
  return `minmax(${width}px, ${width}px)`;
}

export function clampLeftPanelWidth(width: number): number {
  return Math.max(
    LEFT_PANEL_MIN_WIDTH,
    Math.min(width, LEFT_PANEL_MAX_WIDTH),
  );
}

export function getLeftPanelWidth(
  sidebarCollapsed: boolean,
  leftPanelWidth: number = LEFT_PANEL_DEFAULT_WIDTH,
): number {
  return sidebarCollapsed
    ? LEFT_PANEL_WIDTH_COLLAPSED
    : clampLeftPanelWidth(leftPanelWidth);
}

export function getRequiredWorkspaceWidth({
  sidebarCollapsed,
  rightPanelOpen,
  rightPanelWidth,
  leftPanelWidth = LEFT_PANEL_DEFAULT_WIDTH,
}: {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  leftPanelWidth?: number;
}): number {
  const left = getLeftPanelWidth(sidebarCollapsed, leftPanelWidth);
  const right = rightPanelOpen ? rightPanelWidth : 0;
  return left + right + getChatInputReservedWidth();
}

export function getMinimumWorkspaceWidth({
  sidebarCollapsed,
  rightPanelOpen,
  rightPanelWidth,
  leftPanelWidth = LEFT_PANEL_DEFAULT_WIDTH,
}: {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  leftPanelWidth?: number;
}): number {
  const left = getLeftPanelWidth(sidebarCollapsed, leftPanelWidth);
  const right = rightPanelOpen ? rightPanelWidth : 0;
  return left + right + CHAT_MIN_WIDTH;
}

export function getWorkspaceGridTemplateColumns({
  isConfigPanelOpen,
  isRightPanelOpen,
  sidebarCollapsed,
  rightPanelWidth = RIGHT_PANEL_DEFAULT_WIDTH,
  leftPanelWidth = LEFT_PANEL_DEFAULT_WIDTH,
}: {
  isConfigPanelOpen: boolean;
  isRightPanelOpen: boolean;
  sidebarCollapsed: boolean;
  rightPanelWidth?: number;
  leftPanelWidth?: number;
}): string {
  const leftColumn = fixedGridColumn(
    getLeftPanelWidth(sidebarCollapsed, leftPanelWidth),
  );
  const chatColumn = `minmax(${CHAT_MIN_WIDTH}px, 1fr)`;

  // Keep the track *count* constant (always three columns) so a CSS transition
  // on `grid-template-columns` can interpolate width smoothly. Removing/adding
  // the right track instead makes the transition discrete: the browser holds
  // the old track count for part of the duration, briefly reserving an empty
  // fixed-width column flush to the page's right edge while the panel DOM node
  // has already unmounted. Collapsing the right track to 0 avoids that gap.
  const rightVisible = !isConfigPanelOpen && isRightPanelOpen;
  const rightColumn = fixedGridColumn(rightVisible ? rightPanelWidth : 0);

  return `${leftColumn} ${chatColumn} ${rightColumn}`;
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
 * Keep user sidebar intent unless the layout cannot satisfy the chat minimum.
 * If the right panel causes minimum-width overflow, close it before folding left.
 */
export function resolveResponsiveSidebars({
  viewportWidth,
  userSidebarCollapsed,
  userRightPanelOpen,
  rightPanelWidth,
  leftPanelWidth = LEFT_PANEL_DEFAULT_WIDTH,
}: {
  viewportWidth: number;
  userSidebarCollapsed: boolean;
  userRightPanelOpen: boolean;
  rightPanelWidth: number;
  leftPanelWidth?: number;
}): {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
} {
  let sidebarCollapsed = userSidebarCollapsed;
  let rightPanelOpen = userRightPanelOpen;

  const minimumOverflows = () =>
    viewportWidth > 0 &&
    getMinimumWorkspaceWidth({
      sidebarCollapsed,
      rightPanelOpen,
      rightPanelWidth,
      leftPanelWidth,
    }) > viewportWidth;

  if (minimumOverflows() && rightPanelOpen) {
    rightPanelOpen = false;
  }

  if (minimumOverflows() && !sidebarCollapsed) {
    sidebarCollapsed = true;
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
  leftPanelWidth = LEFT_PANEL_DEFAULT_WIDTH,
}: {
  viewportWidth: number;
  userRightPanelOpen: boolean;
  rightPanelWidth: number;
  leftPanelWidth?: number;
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
      leftPanelWidth,
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
