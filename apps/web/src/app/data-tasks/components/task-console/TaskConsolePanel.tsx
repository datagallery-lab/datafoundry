"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvidenceRef } from "@datafoundry/contracts";
import { artifactToneForType } from "../../ui-tokens";
import { TaskConsole, type TaskConsoleProps } from "./TaskConsole";
import { ExpandedArtifactView } from "./ExpandedArtifactView";

type TaskConsolePanelProps = Omit<TaskConsoleProps, "onOpenArtifactPage"> & {
  sessionId: string;
  runId?: string;
  onReferenceEvidence: (ref: EvidenceRef) => void;
};

const CONSOLE_PAGE = "console";

/**
 * Right-panel shell that hosts the Task Console and any number of expanded artifact
 * pages as sibling tabs. The console tab is fixed; each opened artifact becomes its
 * own closable page peer to the console.
 */
export function TaskConsolePanel({
  sessionId,
  runId,
  onReferenceEvidence,
  ...consoleProps
}: TaskConsolePanelProps) {
  const { artifacts } = consoleProps;
  const { artifactFocusId, onArtifactFocusHandled } = consoleProps;
  const [openArtifactIds, setOpenArtifactIds] = useState<string[]>([]);
  const [activePageId, setActivePageId] = useState<string>(CONSOLE_PAGE);

  // Drop pages whose artifact is gone (e.g. after switching sessions/runs).
  useEffect(() => {
    const available = new Set(artifacts.map((artifact) => artifact.id));
    setOpenArtifactIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [artifacts]);

  useEffect(() => {
    if (activePageId === CONSOLE_PAGE) return;
    if (!artifacts.some((artifact) => artifact.id === activePageId)) {
      setActivePageId(CONSOLE_PAGE);
    }
  }, [activePageId, artifacts]);

  const openArtifactPage = useCallback((artifactId: string) => {
    setOpenArtifactIds((current) =>
      current.includes(artifactId) ? current : [...current, artifactId],
    );
    setActivePageId(artifactId);
  }, []);

  // A focus request (e.g. from the Trace overlay) opens the artifact's peer page.
  useEffect(() => {
    if (!artifactFocusId) return;
    if (artifacts.some((artifact) => artifact.id === artifactFocusId)) {
      openArtifactPage(artifactFocusId);
    }
    onArtifactFocusHandled?.();
  }, [artifactFocusId, artifacts, onArtifactFocusHandled, openArtifactPage]);

  const closeArtifactPage = useCallback(
    (artifactId: string) => {
      setOpenArtifactIds((current) => current.filter((id) => id !== artifactId));
      setActivePageId((current) => (current === artifactId ? CONSOLE_PAGE : current));
    },
    [],
  );

  const activeArtifact =
    activePageId === CONSOLE_PAGE
      ? null
      : artifacts.find((artifact) => artifact.id === activePageId) ?? null;

  const hasPages = openArtifactIds.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {hasPages ? (
        <nav className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-l border-border bg-surface px-2 py-1.5">
          <PageTab
            label="Console"
            active={activePageId === CONSOLE_PAGE}
            onSelect={() => setActivePageId(CONSOLE_PAGE)}
          />
          {openArtifactIds.map((id) => {
            const artifact = artifacts.find((entry) => entry.id === id);
            if (!artifact) return null;
            const tone = artifactToneForType(artifact.type ?? artifact.kind);
            return (
              <PageTab
                key={id}
                label={artifact.title}
                icon={tone.icon}
                active={activePageId === id}
                onSelect={() => setActivePageId(id)}
                onClose={() => closeArtifactPage(id)}
              />
            );
          })}
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeArtifact ? (
          <div className="h-full border-l border-border bg-surface">
            <ExpandedArtifactView
              key={activeArtifact.id}
              artifact={activeArtifact}
              sessionId={sessionId}
              runId={runId}
              onReferenceEvidence={onReferenceEvidence}
              onArtifactExportJob={consoleProps.onArtifactExportJob}
            />
          </div>
        ) : (
          <TaskConsole {...consoleProps} onOpenArtifactPage={openArtifactPage} />
        )}
      </div>
    </div>
  );
}

function PageTab({
  label,
  icon,
  active,
  onSelect,
  onClose,
}: {
  label: string;
  icon?: string;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={[
        "flex max-w-[180px] shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
        active ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 cursor-pointer items-center gap-1.5"
      >
        {icon ? <span className="shrink-0 text-[10px] leading-none">{icon}</span> : null}
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className={[
            "grid h-4 w-4 shrink-0 place-items-center rounded transition-colors",
            active ? "text-white/70 hover:bg-white/20" : "text-muted-light hover:bg-surface",
          ].join(" ")}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ×
          </span>
        </button>
      ) : null}
    </div>
  );
}
