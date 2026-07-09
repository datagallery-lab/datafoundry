import type {
  ConversationBranchDto,
  ConversationCheckpointDto,
  ConversationMessageDto,
  SessionConversationDto,
} from "../../lib/config-api/types";

const ENDED_RUN_STATUSES = new Set<ConversationCheckpointDto["status"]>([
  "completed",
  "failed",
  "canceled",
]);

const ACTIVE_RUN_STATUSES = new Set<ConversationCheckpointDto["status"]>([
  "queued",
  "running",
  "suspended",
]);

export type UserMessageBranchState = {
  branchable: boolean;
  currentIndex: number;
  nextSessionId?: string;
  options: ConversationBranchDto[];
  previousSessionId?: string;
  refreshOnly: boolean;
  runId: string;
  status: ConversationCheckpointDto["status"];
  total: number;
};

export function resolveUserMessageBranchState(input: {
  activeSessionId: string | null | undefined;
  conversation: SessionConversationDto | null | undefined;
  messageId: string | undefined;
}): UserMessageBranchState | null {
  if (!input.conversation || !input.messageId) {
    return null;
  }
  const userMessage = findConversationUserMessage(input.conversation, input.messageId);
  if (!userMessage) {
    return null;
  }
  const checkpoint = findCheckpointForMessage(input.conversation, userMessage);
  if (!checkpoint) {
    return null;
  }
  const options = branchOptionsForRun(
    input.conversation,
    checkpoint.runId,
    input.activeSessionId,
  );
  const matchedIndex = options.findIndex((option) => option.sessionId === input.activeSessionId);
  const currentIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const total = Math.max(1, options.length);
  const previous = total > 1 ? options[(currentIndex - 1 + total) % total] : undefined;
  const next = total > 1 ? options[(currentIndex + 1) % total] : undefined;
  const status = checkpoint.status;

  return {
    branchable: ENDED_RUN_STATUSES.has(status),
    currentIndex,
    options,
    ...(previous ? { previousSessionId: previous.sessionId } : {}),
    ...(next ? { nextSessionId: next.sessionId } : {}),
    refreshOnly: ACTIVE_RUN_STATUSES.has(status),
    runId: checkpoint.runId,
    status,
    total,
  };
}

function findConversationUserMessage(
  conversation: SessionConversationDto,
  messageId: string,
): ConversationMessageDto | undefined {
  return conversation.messages.find((message) =>
    message.role === "user" &&
    (message.messageId === messageId || message.id === messageId)
  );
}

function findCheckpointForMessage(
  conversation: SessionConversationDto,
  message: ConversationMessageDto,
): ConversationCheckpointDto | undefined {
  return (conversation.checkpoints ?? []).find((checkpoint) => {
    if (checkpoint.runId === message.runId) {
      return true;
    }
    const start = checkpoint.messageStartPosition;
    const end = checkpoint.messageEndPosition;
    return (
      start !== undefined &&
      end !== undefined &&
      message.position >= start &&
      message.position <= end
    );
  });
}

function resolveForkRunIdForBranchOptions(
  conversation: SessionConversationDto,
  runId: string,
  activeSessionId?: string | null,
): string {
  const branches = conversation.branches ?? [];
  if (branches.some((branch) => branch.forkRunId === runId && !branch.forkCheckpointId)) {
    return runId;
  }
  if (!activeSessionId) {
    return runId;
  }
  const activeBranch = branches.find((branch) => branch.sessionId === activeSessionId);
  return activeBranch && !activeBranch.forkCheckpointId ? activeBranch.forkRunId : runId;
}

function branchOptionsForRun(
  conversation: SessionConversationDto,
  runId: string,
  activeSessionId?: string | null,
): ConversationBranchDto[] {
  const forkRunId = resolveForkRunIdForBranchOptions(conversation, runId, activeSessionId);
  const branches = (conversation.branches ?? []).filter((branch) =>
    branch.forkRunId === forkRunId && !branch.forkCheckpointId
  );
  if (branches.length === 0) {
    return [];
  }
  return [...branches].sort((left, right) =>
    Number(right.isOriginal ?? false) - Number(left.isOriginal ?? false) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.sessionId.localeCompare(right.sessionId)
  );
}
