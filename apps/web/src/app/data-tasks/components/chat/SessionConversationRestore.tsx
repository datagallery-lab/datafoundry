"use client";

import { useAgent, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api/client";
import { getRuntimeCapabilities } from "../../../../lib/config-api/capabilities";
import {
  conversationToAgentMessages,
  isIgnorableConversationRestoreError,
  shouldRestoreConversation,
} from "../../conversation-restore";

export function SessionConversationRestore({
  agentId,
  capabilitiesReady,
}: {
  agentId: string;
  capabilitiesReady: boolean;
}) {
  const chatConfig = useCopilotChatConfiguration();
  const threadId = chatConfig?.threadId;
  const { agent } = useAgent({ agentId });
  const restoredThreadIdsRef = useRef(new Set<string>());
  const inFlightThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId || !capabilitiesReady) {
      return;
    }

    const messageCount = agent.messages?.length ?? 0;
    const alreadyRestored = restoredThreadIdsRef.current.has(threadId);
    const canRestore = shouldRestoreConversation({
      conversationMemoryEnabled: getRuntimeCapabilities().conversationMemory,
      messageCount,
      isRunning: Boolean(agent.isRunning),
      alreadyRestored,
    });

    if (!canRestore || inFlightThreadIdRef.current === threadId) {
      return;
    }

    inFlightThreadIdRef.current = threadId;
    let cancelled = false;

    void (async () => {
      try {
        const conversation = await configApi.getSessionConversation(threadId);
        if (cancelled) {
          return;
        }
        const currentCount = agent.messages?.length ?? 0;
        if (currentCount > 0 || agent.isRunning) {
          return;
        }
        const restored = conversationToAgentMessages(conversation);
        if (restored.length === 0) {
          restoredThreadIdsRef.current.add(threadId);
          return;
        }
        agent.setMessages(restored);
        restoredThreadIdsRef.current.add(threadId);
      } catch (error) {
        if (isIgnorableConversationRestoreError(error)) {
          restoredThreadIdsRef.current.add(threadId);
          return;
        }
        if (typeof window !== "undefined") {
          console.warn("[conversation-restore] failed to load session history", error);
        }
      } finally {
        if (inFlightThreadIdRef.current === threadId) {
          inFlightThreadIdRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, agent.isRunning, agent.messages?.length, capabilitiesReady, threadId]);

  return null;
}
