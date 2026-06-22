"use client";

import { useMemo } from "react";
import { resolveResponsiveSidebars } from "../workspace-layout";

type UseWorkspaceResponsiveLayoutOptions = {
  viewportWidth: number;
  userSidebarCollapsed: boolean;
  userRightPanelOpen: boolean;
  rightPanelWidth: number;
  enabled: boolean;
};

type UseWorkspaceResponsiveLayoutResult = {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  isAutoLayout: boolean;
};

/**
 * Applies viewport-driven sidebar overrides: auto-collapse left, then close
 * right, while preserving user preferences for restoration when space returns.
 */
export function useWorkspaceResponsiveLayout({
  viewportWidth,
  userSidebarCollapsed,
  userRightPanelOpen,
  rightPanelWidth,
  enabled,
}: UseWorkspaceResponsiveLayoutOptions): UseWorkspaceResponsiveLayoutResult {
  return useMemo(() => {
    if (!enabled) {
      return {
        sidebarCollapsed: userSidebarCollapsed,
        rightPanelOpen: userRightPanelOpen,
        isAutoLayout: false,
      };
    }

    const resolved = resolveResponsiveSidebars({
      viewportWidth,
      userSidebarCollapsed,
      userRightPanelOpen,
      rightPanelWidth,
    });

    return {
      ...resolved,
      isAutoLayout:
        resolved.sidebarCollapsed !== userSidebarCollapsed ||
        resolved.rightPanelOpen !== userRightPanelOpen,
    };
  }, [
    enabled,
    viewportWidth,
    userSidebarCollapsed,
    userRightPanelOpen,
    rightPanelWidth,
  ]);
}
