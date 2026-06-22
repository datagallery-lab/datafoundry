"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import {
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from "../../workspace-layout";

type PanelResizeHandleProps = {
  width: number;
  isResizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onReset: () => void;
};

/**
 * Vertical drag handle that overlays the left edge of the right console.
 * Sits on top of the panel border without occupying its own grid column.
 */
export function PanelResizeHandle({
  width,
  isResizing,
  onResizeStart,
  onReset,
}: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整任务控制台宽度"
      aria-valuenow={Math.round(width)}
      aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
      aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onResizeStart}
      onDoubleClick={onReset}
      title="拖动调整宽度，双击复位"
      className={[
        "absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize",
        "transition-colors duration-150",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-slate-200 before:content-['']",
        "hover:before:bg-violet-400",
        isResizing ? "before:bg-violet-500" : "",
      ].join(" ")}
    />
  );
}
