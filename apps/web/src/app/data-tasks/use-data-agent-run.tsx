"use client";

import {
  createContext,
  useContext,
  useEffect,
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
  type LiveRun,
  type LiveRunStatus,
  type SessionUsageStats,
} from "./live-run-state";

type LiveRunContextValue = {
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  latestQuestion?: string;
};

type LiveRunSetters = {
  setLiveRun: Dispatch<SetStateAction<LiveRun>>;
  setSessionUsage: Dispatch<SetStateAction<SessionUsageStats>>;
  setLatestQuestion: Dispatch<SetStateAction<string | undefined>>;
};

const LiveRunContext = createContext<LiveRunContextValue | null>(null);
const LiveRunSettersContext = createContext<LiveRunSetters | null>(null);

function extractLatestUserQuestion(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | null;
    if (!message || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
            return String((part as { text?: unknown }).text ?? "");
          }
          return "";
        })
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

export function LiveRunProvider({ children }: { children: ReactNode }) {
  const [liveRun, setLiveRun] = useState<LiveRun>(() => createInitialLiveRun());
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats>(() =>
    createInitialSessionUsage(),
  );
  const [latestQuestion, setLatestQuestion] = useState<string | undefined>();
  const prevRunStatusRef = useRef<LiveRunStatus>("idle");

  const setters = useMemo(
    () => ({ setLiveRun, setSessionUsage, setLatestQuestion }),
    [],
  );

  useEffect(() => {
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
      <LiveRunContext.Provider value={{ liveRun, sessionUsage, latestQuestion }}>
        {children}
      </LiveRunContext.Provider>
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
  const { setLiveRun, setSessionUsage, setLatestQuestion } = setters;

  const { agent } = useAgent({
    agentId,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnStateChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });

  useEffect(() => {
    setLiveRun(createInitialLiveRun());
    setSessionUsage(createInitialSessionUsage());
  }, [threadId, setLiveRun, setSessionUsage]);

  useEffect(() => {
    const applyEvent = (event: BaseEvent) => {
      setLiveRun((current) => reduceLiveRunEvent(current, event));
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
        setLiveRun((current) =>
          reduceLiveRunEvent(current, {
            type: "RUN_ERROR",
            message: error.message,
          }),
        );
      },
    });

    return () => subscription.unsubscribe();
  }, [agent, setLiveRun]);

  useEffect(() => {
    const state = agent.state as Record<string, unknown> | undefined;
    if (!state || Object.keys(state).length === 0) return;

    setLiveRun((current) =>
      reduceLiveRunEvent(current, {
        type: "STATE_SNAPSHOT",
        snapshot: state,
      }),
    );
  }, [agent.state, setLiveRun]);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setLiveRun((current) =>
        reduceLiveRunEvent(current, {
          type: "RUN_ERROR",
          message: detail?.message,
        }),
      );
    };

    window.addEventListener("dataagent-run-error", onError);
    return () => {
      window.removeEventListener("dataagent-run-error", onError);
    };
  }, [setLiveRun]);

  const latestQuestion = extractLatestUserQuestion(
    (agent as { messages?: unknown }).messages,
  );
  useEffect(() => {
    setLatestQuestion(latestQuestion);
  }, [latestQuestion, setLatestQuestion]);

  return null;
}
