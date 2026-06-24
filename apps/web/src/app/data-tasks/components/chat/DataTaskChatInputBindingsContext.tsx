"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  ChatSession,
  MentionResource,
  PerRunMentionKind,
  PerRunSelection,
  WorkspaceConfigItem,
  WorkspaceConfigStore,
} from "../../data-task-state";

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
  workspaceConfig: WorkspaceConfigStore;
  activeSession: ChatSession | null;
  onToggleSessionResource: (kind: PerRunMentionKind, id: string) => void;
  chatColumnWidth: number;
  agentId: string;
  activeThreadId: string | null;
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
