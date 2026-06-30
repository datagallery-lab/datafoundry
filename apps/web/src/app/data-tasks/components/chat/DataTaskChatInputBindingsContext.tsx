"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  ChatSession,
  FileMentionResource,
  MentionResource,
  PerRunMentionKind,
  PerRunFileSelection,
  PerRunSelection,
  SessionStartedHints,
  WorkspaceConfigItem,
  WorkspaceConfigStore,
} from "../../data-task-state";
import type { LiveRunStatus } from "../../live-run-state";

export type DataTaskChatInputBindings = {
  activeLlmId: string | null;
  llmOptions: WorkspaceConfigItem[];
  onActiveLlmChange: (llmId: string) => void;
  onOpenLlmConfig: () => void;
  mentionResources: MentionResource[];
  perRunSelection: PerRunSelection;
  onTogglePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onRemovePerRunMention: (kind: PerRunMentionKind, id: string) => void;
  onClearPerRunMentions: () => void;
  fileMentionResources: FileMentionResource[];
  perRunFiles: PerRunFileSelection;
  onTogglePerRunFileMention: (resource: FileMentionResource) => void;
  onRemovePerRunFileMention: (resource: FileMentionResource) => void;
  onClearPerRunFileMentions: () => void;
  workspaceConfig: WorkspaceConfigStore;
  activeSession: ChatSession | null;
  sessionStartedHints?: SessionStartedHints;
  onToggleSessionResource: (kind: PerRunMentionKind, id: string) => void;
  chatColumnWidth: number;
  agentId: string;
  activeThreadId: string | null;
  capabilitiesReady: boolean;
  onUserMessageSubmitted: (text: string) => void;
  liveRunStatus: LiveRunStatus;
  liveRunRunId: string | null;
  onCancelRun?: () => Promise<void> | void;
  cancelRunBusy?: boolean;
};

const DataTaskChatInputBindingsContext =
  createContext<DataTaskChatInputBindings | null>(null);

export function DataTaskChatInputBindingsProvider({
  value,
  children,
}: {
  value: DataTaskChatInputBindings;
  children: ReactNode;
}) {
  return (
    <DataTaskChatInputBindingsContext.Provider value={value}>
      {children}
    </DataTaskChatInputBindingsContext.Provider>
  );
}

export function useDataTaskChatInputBindings(): DataTaskChatInputBindings {
  const value = useContext(DataTaskChatInputBindingsContext);
  if (!value) {
    throw new Error(
      "useDataTaskChatInputBindings must be used within DataTaskChatInputBindingsProvider",
    );
  }
  return value;
}
