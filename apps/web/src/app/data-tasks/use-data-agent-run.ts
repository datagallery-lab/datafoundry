"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { BaseEvent } from "@ag-ui/client";
import {
  accumulateSessionUsage,
  createInitialLiveRun,
  createInitialSessionUsage,
  deriveRunUsage,
  reduceLiveRunEvent,
  type LiveRun,
  type LiveRunStatus,
  type SessionUsageStats,
} from "./live-run-state";

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

export function useDataAgentRun(
  agentId: string,
  threadId?: string,
): {
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  latestQuestion?: string;
} {
  const { agent } = useAgent({
    agentId,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnStateChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });
  const [liveRun, setLiveRun] = useState<LiveRun>(() => createInitialLiveRun());
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats>(() =>
    createInitialSessionUsage(),
  );
  const prevRunStatusRef = useRef<LiveRunStatus>("idle");

  useEffect(() => {
    setLiveRun(createInitialLiveRun());
    setSessionUsage(createInitialSessionUsage());
    prevRunStatusRef.current = "idle";
  }, [threadId]);

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
  }, [agent]);

  useEffect(() => {
    const state = agent.state as Record<string, unknown> | undefined;
    if (!state || Object.keys(state).length === 0) return;

    setLiveRun((current) =>
      reduceLiveRunEvent(current, {
        type: "STATE_SNAPSHOT",
        snapshot: state,
      }),
    );
  }, [agent.state]);

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
  }, []);

  useEffect(() => {
    const previous = prevRunStatusRef.current;
    const current = liveRun.runStatus;
    if (previous === "running" && current === "completed") {
      setSessionUsage((stats) =>
        accumulateSessionUsage(stats, deriveRunUsage(liveRun), "completed"),
      );
    } else if (previous === "running" && current === "failed") {
      setSessionUsage((stats) =>
        accumulateSessionUsage(stats, deriveRunUsage(liveRun), "failed"),
      );
    }
    prevRunStatusRef.current = current;
  }, [liveRun]);

  const latestQuestion = extractLatestUserQuestion(
    (agent as { messages?: unknown }).messages,
  );

  return { liveRun, sessionUsage, latestQuestion };
}
