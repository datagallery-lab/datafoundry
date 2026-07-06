import { useEffect } from "react";
import type { EvidenceRef } from "@datafoundry/contracts";
import type { DataArtifact, TimelineEvent } from "../../data-task-state";
import type { JobDto } from "../../../../lib/config-api";
import type { LiveRun, SessionUsageStats } from "../../live-run-state";
import type { ProcessToolGroup } from "../../process-tool-groups";
import type { TaskSelection } from "../../page";
import type { EvidenceCard } from "../../evidence";
import { overlayBackdropClass, overlayPanelClass } from "../../ui-tokens";
import { TaskConsole } from "./TaskConsole";

type TaskConsoleDrawerProps = {
  artifacts: DataArtifact[];
  evidenceCards: EvidenceCard[];
  liveRun: LiveRun;
  toolGroups: ProcessToolGroup[];
  sessionUsage: SessionUsageStats;
  selection: TaskSelection;
  visibleEvents: TimelineEvent[];
  currentQuestion?: string;
  artifactFocusId?: string | null;
  onArtifactFocusHandled?: () => void;
  onClearSelection: () => void;
  onMentionArtifact?: (artifact: DataArtifact) => void;
  onToggleEvidenceRef?: (ref: EvidenceRef) => void;
  onClearEvidenceRefs?: () => void;
  isOpen: boolean;
  onClose: () => void;
  onOpenTrace: () => void;
  onPromoteArtifact?: (artifact: DataArtifact) => Promise<void> | void;
  onArtifactExportJob?: (job: JobDto) => void;
  onSelectEvent: (eventId: string) => void;
  onSelectToolGroup: (groupId: string) => void;
  promotedArtifactIds?: ReadonlySet<string>;
  selectedEvidenceRefs?: EvidenceRef[];
};

export function TaskConsoleDrawer({
  artifacts,
  evidenceCards,
  liveRun,
  toolGroups,
  sessionUsage,
  selection,
  visibleEvents,
  currentQuestion,
  artifactFocusId,
  onArtifactFocusHandled,
  onClearSelection,
  onMentionArtifact,
  onToggleEvidenceRef,
  onClearEvidenceRefs,
  isOpen,
  onClose,
  onOpenTrace,
  onPromoteArtifact,
  onArtifactExportJob,
  onSelectEvent,
  onSelectToolGroup,
  promotedArtifactIds,
  selectedEvidenceRefs,
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
          evidenceCards={evidenceCards}
          liveRun={liveRun}
          toolGroups={toolGroups}
          sessionUsage={sessionUsage}
          selection={selection}
          visibleEvents={visibleEvents}
          currentQuestion={currentQuestion}
          artifactFocusId={artifactFocusId}
          onArtifactFocusHandled={onArtifactFocusHandled}
          onClearSelection={onClearSelection}
          onClose={onClose}
          onMentionArtifact={onMentionArtifact}
          onToggleEvidenceRef={onToggleEvidenceRef}
          onClearEvidenceRefs={onClearEvidenceRefs}
          onOpenTrace={onOpenTrace}
          onPromoteArtifact={onPromoteArtifact}
          onArtifactExportJob={onArtifactExportJob}
          onSelectEvent={onSelectEvent}
          onSelectToolGroup={onSelectToolGroup}
          promotedArtifactIds={promotedArtifactIds}
          selectedEvidenceRefs={selectedEvidenceRefs}
        />
      </div>
    </div>
  );
}
