"use client";

import { useAgent, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api/client";
import { getRuntimeCapabilities } from "../../../../lib/config-api/capabilities";
import {
  collaborationResponsesFromConversation,
  conversationToAgentMessages,
  hydrateLiveRunFromConversation,
  isIgnorableConversationRestoreError,
  latestUserQuestionFromConversation,
  shouldRestoreConversationMessages,
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
  const { setLiveRun, setLatestQuestion } = useLiveRunSetters();
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    if (!threadId || !capabilitiesReady) {
      return;
    }

    const conversationMemoryEnabled = getRuntimeCapabilities().conversationMemory;
    if (!conversationMemoryEnabled) {
      return;
    }

    if (Boolean(agent.isRunning)) {
      return;
    }

    const generation = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = generation;
    let cancelled = false;

    void (async () => {
      try {
        const conversation = await configApi.getSessionConversation(threadId);
        if (cancelled || fetchGenerationRef.current !== generation) {
          return;
        }

        if (
          shouldRestoreConversationMessages({
            conversationMemoryEnabled,
            isRunning: Boolean(agent.isRunning),
            agentMessages: agent.messages,
            dto: conversation,
          })
        ) {
          const restored = conversationToAgentMessages(conversation);
          if (restored.length > 0) {
            agent.setMessages(restored);
          }
        }

        setLiveRun((current) => hydrateLiveRunFromConversation(current, conversation));

        const question = latestUserQuestionFromConversation(conversation);
        if (question) {
          setLatestQuestion(question);
        }

        hydrateCollaborationResponses(
          collaborationResponsesFromConversation(threadId, conversation),
        );
      } catch (error) {
        if (isIgnorableConversationRestoreError(error)) {
          return;
        }
        if (typeof window !== "undefined") {
          console.warn("[conversation-restore] failed to load session history", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, agent.isRunning, capabilitiesReady, setLatestQuestion, setLiveRun, threadId]);

  return null;
}
