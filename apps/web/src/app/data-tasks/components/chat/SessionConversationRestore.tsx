"use client";

import { useAgent, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api/client";
import { getRuntimeCapabilities } from "../../../../lib/config-api/capabilities";
import {
  conversationToAgentMessages,
  collaborationResponsesFromConversation,
  hydrateLiveRunFromConversation,
  isIgnorableConversationRestoreError,
  shouldRestoreConversation,
} from "../../conversation-restore";
import { hydrateCollaborationResponses } from "./collaboration-responses";
import { useLiveRunSetters } from "../../use-data-agent-run";

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
  const { setLiveRun } = useLiveRunSetters();
  const restoredMessagesRef = useRef(new Set<string>());
  const hydratedLiveRunRef = useRef(new Set<string>());
  const inFlightThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId || !capabilitiesReady) {
      return;
    }

    const conversationMemoryEnabled = getRuntimeCapabilities().conversationMemory;
    if (!conversationMemoryEnabled) {
      return;
    }

    const messageCount = agent.messages?.length ?? 0;
    const alreadyRestoredMessages = restoredMessagesRef.current.has(threadId);
    const alreadyHydratedLiveRun = hydratedLiveRunRef.current.has(threadId);
    const canRestoreMessages = shouldRestoreConversation({
      conversationMemoryEnabled,
      messageCount,
      isRunning: Boolean(agent.isRunning),
      alreadyRestored: alreadyRestoredMessages,
    });

    if ((!canRestoreMessages && alreadyHydratedLiveRun) || inFlightThreadIdRef.current === threadId) {
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
        if (currentCount === 0 && !agent.isRunning && !alreadyRestoredMessages) {
          const restored = conversationToAgentMessages(conversation);
          if (restored.length > 0) {
            agent.setMessages(restored);
          }
          restoredMessagesRef.current.add(threadId);
        }

        if (!alreadyHydratedLiveRun) {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
          if (cancelled) {
            return;
          }
          setLiveRun((current) => hydrateLiveRunFromConversation(current, conversation));
          hydratedLiveRunRef.current.add(threadId);
        }

        hydrateCollaborationResponses(
          collaborationResponsesFromConversation(threadId, conversation),
        );
      } catch (error) {
        if (isIgnorableConversationRestoreError(error)) {
          restoredMessagesRef.current.add(threadId);
          hydratedLiveRunRef.current.add(threadId);
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
      hydratedLiveRunRef.current.delete(threadId);
    };
  }, [agent, agent.isRunning, agent.messages?.length, capabilitiesReady, setLiveRun, threadId]);

  return null;
}
