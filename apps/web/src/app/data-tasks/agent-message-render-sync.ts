"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import { useEffect, useSyncExternalStore } from "react";

type SyncSnapshot = {
  generation: number;
  messageCount: number;
  lastMessageId?: string;
  isRunning: boolean;
  runStatus: string;
};

let snapshot: SyncSnapshot = {
  generation: 0,
  messageCount: 0,
  isRunning: false,
  runStatus: "idle",
};

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot.generation;
}

/** Bump when agent messages / run status change so memoized assistant rows re-render. */
export function bumpAgentMessageRenderSync(input: {
  messageCount: number;
  lastMessageId?: string;
  isRunning: boolean;
  runStatus: string;
}) {
  if (
    snapshot.messageCount === input.messageCount &&
    snapshot.lastMessageId === input.lastMessageId &&
    snapshot.isRunning === input.isRunning &&
    snapshot.runStatus === input.runStatus
  ) {
    return;
  }
  snapshot = {
    generation: snapshot.generation + 1,
    messageCount: input.messageCount,
    lastMessageId: input.lastMessageId,
    isRunning: input.isRunning,
    runStatus: input.runStatus,
  };
  emitChange();
}

/** Subscribe inside StepAssistantMessage to bypass CopilotKit memo stale props. */
export function useAgentMessageRenderGeneration(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Keeps assistant step cards in sync when CopilotKit memo skips prop updates. */
export function AgentMessageRenderSync({
  agentId,
  runStatus,
}: {
  agentId: string;
  runStatus: string;
}) {
  const { agent } = useAgent({ agentId });
  const messages = agent.messages ?? [];

  useEffect(() => {
    bumpAgentMessageRenderSync({
      messageCount: messages.length,
      lastMessageId: messages[messages.length - 1]?.id,
      isRunning: Boolean(agent.isRunning),
      runStatus,
    });
  }, [agent.isRunning, messages, runStatus]);

  return null;
}
