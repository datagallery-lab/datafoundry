"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { BaseEvent } from "@ag-ui/client";
import {
  accumulateSessionUsage,
  createInitialLiveRun,
  createInitialSessionUsage,
  deriveSegmentRunUsage,
  reduceLiveRunEvent,
  shouldIgnoreIncomingRunError,
  type LiveRun,
  type LiveRunStatus,
  type SessionUsageStats,
} from "./live-run-state";
import {
  isCollaborationEchoUserMessage,
  normalizeUserQuestionText,
} from "./conversation-restore";
import { reconcileSuspendedLiveRunState } from "./collaboration-recap";
import { getCollaborationResponsesForThread } from "./components/chat/collaboration-responses";

type LiveRunContextValue = {
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  latestQuestion?: string;
  runningThreadIds: ReadonlySet<string>;
};

type LiveRunSetters = {
  setLiveRun: Dispatch<SetStateAction<LiveRun>>;
  setSessionUsage: Dispatch<SetStateAction<SessionUsageStats>>;
  setLatestQuestion: Dispatch<SetStateAction<string | undefined>>;
  syncRunningThreadStatus: (threadId: string | undefined, status: LiveRunStatus) => void;
};

type ConversationRestoreGate = {
  isRestoringConversation: boolean;
  setIsRestoringConversation: Dispatch<SetStateAction<boolean>>;
};

const LiveRunContext = createContext<LiveRunContextValue | null>(null);
const LiveRunSettersContext = createContext<LiveRunSetters | null>(null);
const ConversationRestoreGateContext = createContext<ConversationRestoreGate | null>(null);

function normalizeUserQuestion(text: string): string | undefined {
  return normalizeUserQuestionText(text);
}

function isRunBoundaryReplayEvent(event: BaseEvent): boolean {
  const type = (event as { type?: string }).type;
  return (
    type === "RUN_STARTED" ||
    type === "RUN_FINISHED" ||
    type === "RUN_ERROR" ||
    type === "STATE_SNAPSHOT"
  );
}

function extractLatestUserQuestion(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  let fallback: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | null;
    if (!message || message.role !== "user") continue;
    const content = message.content;
    let text: string | undefined;
    if (typeof content === "string") {
      text = normalizeUserQuestion(content);
    } else if (Array.isArray(content)) {
      text = normalizeUserQuestion(
        content
          .map((part) => {
            if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
              return String((part as { text?: unknown }).text ?? "");
            }
            return "";
          })
          .join(""),
      );
    }
    if (!text) continue;
    fallback ??= text;
    if (!isCollaborationEchoUserMessage(text)) {
      return text;
    }
  }
  return fallback;
}

function syncRunningThreadIdSet(
  current: Set<string>,
  threadId: string,
  status: LiveRunStatus,
): Set<string> {
  const active = status === "running" || status === "suspended";
  const has = current.has(threadId);
  if (active === has) {
    return current;
  }
  const next = new Set(current);
  if (active) {
    next.add(threadId);
  } else {
    next.delete(threadId);
  }
  return next;
}

export function LiveRunProvider({ children }: { children: ReactNode }) {
  const [liveRun, setLiveRun] = useState<LiveRun>(() => createInitialLiveRun());
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats>(() =>
    createInitialSessionUsage(),
  );
  const [latestQuestion, setLatestQuestion] = useState<string | undefined>();
  const [runningThreadIds, setRunningThreadIds] = useState<Set<string>>(() => new Set());
  const [isRestoringConversation, setIsRestoringConversation] = useState(false);
  const prevRunStatusRef = useRef<LiveRunStatus>("idle");

  const syncRunningThreadStatus = useCallback(
    (threadId: string | undefined, status: LiveRunStatus) => {
      if (!threadId) {
        return;
      }
      setRunningThreadIds((current) => syncRunningThreadIdSet(current, threadId, status));
    },
    [],
  );

  const setters = useMemo(
    () => ({ setLiveRun, setSessionUsage, setLatestQuestion, syncRunningThreadStatus }),
    [syncRunningThreadStatus],
  );

  const restoreGate = useMemo(
    () => ({
      isRestoringConversation,
      setIsRestoringConversation,
    }),
    [isRestoringConversation],
  );

  useLayoutEffect(() => {
    const previous = prevRunStatusRef.current;
    const current = liveRun.runStatus;
    if (previous === "running" && current === "completed") {
      setSessionUsage((stats) =>
        accumulateSessionUsage(stats, deriveSegmentRunUsage(liveRun), "completed"),
      );
    } else if (previous === "running" && current === "failed") {
      setSessionUsage((stats) =>
        accumulateSessionUsage(stats, deriveSegmentRunUsage(liveRun), "failed"),
      );
    }
    prevRunStatusRef.current = current;
  }, [liveRun]);

  return (
    <LiveRunSettersContext.Provider value={setters}>
      <ConversationRestoreGateContext.Provider value={restoreGate}>
        <LiveRunContext.Provider
          value={{ liveRun, sessionUsage, latestQuestion, runningThreadIds }}
        >
          {children}
        </LiveRunContext.Provider>
      </ConversationRestoreGateContext.Provider>
    </LiveRunSettersContext.Provider>
  );
}

export function useLiveRun(): LiveRunContextValue {
  const ctx = useContext(LiveRunContext);
  if (!ctx) {
    throw new Error("useLiveRun must be used within LiveRunProvider");
  }
  return ctx;
}

export function useLiveRunSetters(): LiveRunSetters {
  const setters = useContext(LiveRunSettersContext);
  if (!setters) {
    throw new Error("useLiveRunSetters must be used within LiveRunProvider");
  }
  return setters;
}

export function useConversationRestoreGate(): ConversationRestoreGate {
  const gate = useContext(ConversationRestoreGateContext);
  if (!gate) {
    throw new Error("useConversationRestoreGate must be used within LiveRunProvider");
  }
  return gate;
}

/**
 * Subscribes to AG-UI events for the active thread. Must render as a sibling
 * **before** `<CopilotChat>` inside `<CopilotChatConfigurationProvider>` so
 * its effect runs before connectAgent replays historical events.
 */
export function LiveRunEventSubscriber({
  agentId,
  threadId,
}: {
  agentId: string;
  threadId?: string;
}) {
  const setters = useContext(LiveRunSettersContext);
  if (!setters) {
    throw new Error("LiveRunEventSubscriber requires LiveRunProvider");
  }
  const { setLiveRun, setSessionUsage, setLatestQuestion, syncRunningThreadStatus } = setters;
  const { isRestoringConversation } = useConversationRestoreGate();
  const isRestoringConversationRef = useRef(isRestoringConversation);
  isRestoringConversationRef.current = isRestoringConversation;

  const { agent } = useAgent({
    agentId,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnStateChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });

  useLayoutEffect(() => {
    setLiveRun(createInitialLiveRun());
    setSessionUsage(createInitialSessionUsage());
    setLatestQuestion(undefined);
  }, [threadId, setLatestQuestion, setLiveRun, setSessionUsage]);

  useEffect(() => {
    const applyEvent = (event: BaseEvent) => {
      if (isRestoringConversationRef.current && isRunBoundaryReplayEvent(event)) {
        return;
      }
      setLiveRun((current) => {
        const next = reduceLiveRunEvent(current, event);
        const reconciled =
          threadId &&
          (event.type === "RUN_FINISHED" || event.type === "STATE_SNAPSHOT")
            ? reconcileSuspendedLiveRunState(
                next,
                getCollaborationResponsesForThread(threadId),
              )
            : next;
        syncRunningThreadStatus(threadId, reconciled.runStatus);
        return reconciled;
      });
    };

    const subscription = agent.subscribe({
      onEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onRunStartedEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onRunFinishedEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onRunErrorEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onActivitySnapshotEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onActivityDeltaEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onStateSnapshotEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onStateDeltaEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onToolCallStartEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onToolCallArgsEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onToolCallEndEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onToolCallResultEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onCustomEvent: ({ event }) => {
        applyEvent(event as BaseEvent);
      },
      onRunFailed: ({ error }) => {
        if (isRestoringConversationRef.current) {
          return;
        }
        setLiveRun((current) => {
          if (shouldIgnoreIncomingRunError(current)) {
            return current;
          }
          const next = reduceLiveRunEvent(current, {
            type: "RUN_ERROR",
            message: error.message,
          });
          syncRunningThreadStatus(threadId, next.runStatus);
          return next;
        });
      },
    });

    return () => subscription.unsubscribe();
  }, [agent, setLiveRun, syncRunningThreadStatus, threadId]);

  useEffect(() => {
    if (isRestoringConversationRef.current) {
      return;
    }
    const state = agent.state as Record<string, unknown> | undefined;
    if (!state || Object.keys(state).length === 0) return;

    setLiveRun((current) => {
      const next = reduceLiveRunEvent(current, {
        type: "STATE_SNAPSHOT",
        snapshot: state,
      });
      const reconciled = threadId
        ? reconcileSuspendedLiveRunState(
            next,
            getCollaborationResponsesForThread(threadId),
          )
        : next;
      syncRunningThreadStatus(threadId, reconciled.runStatus);
      return reconciled;
    });
  }, [agent.state, setLiveRun, isRestoringConversation, syncRunningThreadStatus, threadId]);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setLiveRun((current) => {
        if (shouldIgnoreIncomingRunError(current)) {
          return current;
        }
        const next = reduceLiveRunEvent(current, {
          type: "RUN_ERROR",
          message: detail?.message,
        });
        syncRunningThreadStatus(threadId, next.runStatus);
        return next;
      });
    };

    window.addEventListener("datafoundry-run-error", onError);
    return () => {
      window.removeEventListener("datafoundry-run-error", onError);
    };
  }, [setLiveRun, syncRunningThreadStatus, threadId]);

  const latestQuestion = extractLatestUserQuestion(
    (agent as { messages?: unknown }).messages,
  );
  useEffect(() => {
    if (isRestoringConversationRef.current) {
      return;
    }
    setLatestQuestion(latestQuestion);
  }, [isRestoringConversation, latestQuestion, setLatestQuestion]);

  return null;
}
