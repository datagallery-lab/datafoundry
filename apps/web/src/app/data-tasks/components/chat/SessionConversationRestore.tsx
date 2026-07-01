"use client";

import { useAgent, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect, useLayoutEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api/client";
import { getRuntimeCapabilities } from "../../../../lib/config-api/capabilities";
import {
  collaborationResponsesFromConversation,
  conversationToAgentMessages,
  hydrateLiveRunFromConversation,
  hydratePendingInteractionLiveRun,
  hydrateSessionUsageFromConversation,
  isIgnorableConversationRestoreError,
  latestUserQuestionFromConversation,
  pendingInteractionsFromConversation,
  shouldRestoreConversationMessages,
} from "../../conversation-restore";
import { reconcileSuspendedLiveRunState } from "../../collaboration-recap";
import {
  getCollaborationResponsesForThread,
  hydrateCollaborationResponses,
} from "./collaboration-responses";
import {
  clearRestoredInterrupts,
  hydrateRestoredInterrupts,
} from "./restored-interrupts";
import { clearPendingCollaborationInterrupt } from "./pending-collaboration-interrupt";
import {
  useConversationRestoreGate,
  useLiveRunSetters,
} from "../../use-data-agent-run";

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
  const { setLiveRun, setLatestQuestion, setSessionUsage } = useLiveRunSetters();
  const { setIsRestoringConversation } = useConversationRestoreGate();
  const fetchGenerationRef = useRef(0);
  const prevThreadIdRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (!threadId || !capabilitiesReady) {
      return;
    }
    if (!getRuntimeCapabilities().conversationMemory) {
      return;
    }
    const threadChanged = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;
    if (!threadChanged) {
      return;
    }
    if (Boolean(agent.isRunning)) {
      return;
    }
    setIsRestoringConversation(true);
    agent.setMessages([]);
    clearRestoredInterrupts(threadId);
    clearPendingCollaborationInterrupt(threadId);
  }, [agent, capabilitiesReady, setIsRestoringConversation, threadId]);

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

        const restoredCollaboration = collaborationResponsesFromConversation(
          threadId,
          conversation,
        );
        hydrateCollaborationResponses(restoredCollaboration);

        hydrateRestoredInterrupts(
          pendingInteractionsFromConversation(threadId, conversation),
        );

        setSessionUsage(hydrateSessionUsageFromConversation(conversation));

        const collaborationRecords = getCollaborationResponsesForThread(threadId);
        setLiveRun((current) =>
          reconcileSuspendedLiveRunState(
            hydratePendingInteractionLiveRun(
              hydrateLiveRunFromConversation(current, conversation),
              threadId,
              conversation,
              collaborationRecords,
            ),
            collaborationRecords,
          ),
        );

        const question = latestUserQuestionFromConversation(conversation);
        if (question) {
          setLatestQuestion(question);
        }
      } catch (error) {
        if (isIgnorableConversationRestoreError(error)) {
          return;
        }
        if (typeof window !== "undefined") {
          console.warn("[conversation-restore] failed to load session history", error);
        }
      } finally {
        if (!cancelled && fetchGenerationRef.current === generation) {
          setIsRestoringConversation(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    agent,
    agent.isRunning,
    capabilitiesReady,
    setIsRestoringConversation,
    setLatestQuestion,
    setLiveRun,
    setSessionUsage,
    threadId,
  ]);

  return null;
}
