"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  loadRightPanelWidth,
  persistRightPanelWidth,
} from "../data-task-state";
import {
  clampRightPanelWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from "../workspace-layout";

type UsePanelResizeOptions = {
  enabled: boolean;
};

type UsePanelResizeResult = {
  width: number;
  isResizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  resetWidth: () => void;
};

/**
 * Owns the right console width: drag-to-resize from the panel's left edge,
 * absolute min/max clamping (320–640px), persistence to localStorage, and a
 * double-click reset to the default width. Window resize does not shrink the
 * stored width — responsive fold/close is handled separately.
 */
export function usePanelResize({
  enabled,
}: UsePanelResizeOptions): UsePanelResizeResult {
  const [width, setWidth] = useState<number>(() => loadRightPanelWidth());
  const [isResizing, setIsResizing] = useState(false);

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const applyWidth = useCallback((next: number) => {
    setWidth(clampRightPanelWidth(next));
  }, []);

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = { startX: event.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  const resetWidth = useCallback(() => {
    applyWidth(RIGHT_PANEL_DEFAULT_WIDTH);
    persistRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH);
  }, [applyWidth]);

  // Global pointer handlers active only while dragging.
  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // Drag from the panel's left edge: moving left widens the panel.
      const next = drag.startWidth - (event.clientX - drag.startX);
      applyWidth(next);
    };

    const stop = () => {
      dragStateRef.current = null;
      setIsResizing(false);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, applyWidth]);

  // Persist once a drag settles.
  useEffect(() => {
    if (!isResizing || !enabled) return;
    persistRightPanelWidth(width);
  }, [isResizing, enabled, width]);

  return { width, isResizing, onResizeStart, resetWidth };
}
