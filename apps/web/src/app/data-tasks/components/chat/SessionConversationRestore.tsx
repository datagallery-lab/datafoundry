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
  isConversationRestoreRunActive,
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
  useLiveRun,
  useLiveRunSetters,
} from "../../use-data-foundry-run";
import {
  clearConversationBranchSnapshot,
  setConversationBranchSnapshot,
} from "../../conversation-branch-store";

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
  const { liveRun } = useLiveRun(threadId);
  const {
    setLiveRunForThread,
    setLatestQuestionForThread,
    setSessionUsageForThread,
  } = useLiveRunSetters();
  const { setIsRestoringConversation } = useConversationRestoreGate();
  const fetchGenerationRef = useRef(0);
  const prevThreadIdRef = useRef<string | undefined>(undefined);
  const restoreRunActive = isConversationRestoreRunActive({
    agentIsRunning: Boolean(agent.isRunning),
    liveRunStatus: liveRun.runStatus,
  });

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
    if (restoreRunActive) {
      return;
    }
    setIsRestoringConversation(true);
    agent.setMessages([]);
    clearRestoredInterrupts(threadId);
    clearPendingCollaborationInterrupt(threadId);
    clearConversationBranchSnapshot(threadId);
  }, [agent, capabilitiesReady, restoreRunActive, setIsRestoringConversation, threadId]);

  useEffect(() => {
    if (!threadId || !capabilitiesReady) {
      return;
    }

    const conversationMemoryEnabled = getRuntimeCapabilities().conversationMemory;
    if (!conversationMemoryEnabled) {
      return;
    }

    if (restoreRunActive) {
      fetchGenerationRef.current += 1;
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
        setConversationBranchSnapshot(threadId, conversation);

        if (
          shouldRestoreConversationMessages({
            conversationMemoryEnabled,
            isRunning: restoreRunActive,
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

        setSessionUsageForThread(threadId, hydrateSessionUsageFromConversation(conversation));

        const collaborationRecords = getCollaborationResponsesForThread(threadId);
        setLiveRunForThread(threadId, (current) =>
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
          setLatestQuestionForThread(threadId, question);
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
    capabilitiesReady,
    restoreRunActive,
    setIsRestoringConversation,
    setLatestQuestionForThread,
    setLiveRunForThread,
    setSessionUsageForThread,
    threadId,
  ]);

  return null;
}
