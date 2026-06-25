import { useEffect } from "react";
import type { DataArtifact, TimelineEvent } from "../../data-task-state";
import type { LiveRun, SessionUsageStats } from "../../live-run-state";
import type { TaskSelection } from "../../page";
import { overlayBackdropClass, overlayPanelClass } from "../../ui-tokens";
import { TaskConsole } from "./TaskConsole";

type TaskConsoleDrawerProps = {
  artifacts: DataArtifact[];
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  selection: TaskSelection;
  visibleEvents: TimelineEvent[];
  currentQuestion?: string;
  artifactFocusId?: string | null;
  onArtifactFocusHandled?: () => void;
  onClearSelection: () => void;
  isOpen: boolean;
  onClose: () => void;
  onOpenTrace: () => void;
  onSelectEvent: (eventId: string) => void;
};

export function TaskConsoleDrawer({
  artifacts,
  liveRun,
  sessionUsage,
  selection,
  visibleEvents,
  currentQuestion,
  artifactFocusId,
  onArtifactFocusHandled,
  onClearSelection,
  isOpen,
  onClose,
  onOpenTrace,
  onSelectEvent,
}: TaskConsoleDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`${overlayBackdropClass} p-2 sm:p-4`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`mx-auto h-full max-w-lg sm:max-w-xl ${overlayPanelClass}`}>
        <TaskConsole
          artifacts={artifacts}
          liveRun={liveRun}
          sessionUsage={sessionUsage}
          selection={selection}
          visibleEvents={visibleEvents}
          currentQuestion={currentQuestion}
          artifactFocusId={artifactFocusId}
          onArtifactFocusHandled={onArtifactFocusHandled}
          onClearSelection={onClearSelection}
          onClose={onClose}
          onOpenTrace={onOpenTrace}
          onSelectEvent={onSelectEvent}
        />
      </div>
    </div>
  );
}
