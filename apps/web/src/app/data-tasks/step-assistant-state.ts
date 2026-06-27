import type { LiveRun } from "./live-run-state";
import type { CollaborationResponseRecord } from "./components/chat/collaboration-responses";

export const COLLABORATION_TOOL_NAMES = new Set(["ask_user", "submit_plan"]);

type MessageLike = {
  id?: string;
  role?: string;
  toolCalls?: Array<{ id?: string; function?: { name?: string } }>;
  content?: unknown;
};

export type StepAssistantFlags = {
  hasToolCalls: boolean;
  isLast: boolean;
  isWaitingForUser: boolean;
  isCollaborationStep: boolean;
  isCollaborationComplete: boolean;
  isActive: boolean;
  isFinalAnswer: boolean;
  isFinalAnswerComplete: boolean;
  isThought: boolean;
  linkedCollaboration?: CollaborationResponseRecord;
};

export function messageHasToolCall(message: MessageLike, toolCallId: string): boolean {
  if (!Array.isArray(message.toolCalls)) return false;
  return message.toolCalls.some((call) => call?.id === toolCallId);
}

export function hasLaterAssistantMessage(
  messageId: string | undefined,
  messages: MessageLike[],
): boolean {
  if (!messageId) return false;
  const index = messages.findIndex((item) => item.id === messageId);
  if (index < 0) return false;
  return messages.slice(index + 1).some((item) => item.role === "assistant");
}

export function inferCollaborationFromLiveRun(
  message: MessageLike,
  messages: MessageLike[],
  liveRun: LiveRun | null,
): boolean {
  return liveRunCollaborationCandidate(message, messages, liveRun) !== undefined;
}

function liveRunCandidateRange(
  message: MessageLike,
  messages: MessageLike[],
  liveRun: LiveRun | null,
): { start: number; end: number } | null {
  if (!liveRun) return null;

  const assistants = messages.filter((item) => item.role === "assistant");
  const assistantIndex = assistants.findIndex((item) => item.id === message.id);
  if (assistantIndex < 0) return null;

  let liveToolIndex = 0;
  for (let index = 0; index < assistantIndex; index += 1) {
    const toolCount = assistants[index].toolCalls?.length ?? 0;
    liveToolIndex += toolCount > 0 ? toolCount : 1;
  }

  const currentToolCount = message.toolCalls?.length ?? 0;
  const sliceEnd = liveToolIndex + (currentToolCount > 0 ? currentToolCount : 1);
  return { start: liveToolIndex, end: sliceEnd };
}

function liveRunCollaborationCandidate(
  message: MessageLike,
  messages: MessageLike[],
  liveRun: LiveRun | null,
): { index: number; name: string } | undefined {
  const range = liveRunCandidateRange(message, messages, liveRun);
  if (!range || !liveRun) return undefined;
  const candidates = liveRun.toolCalls.slice(range.start, range.end);
  const relativeIndex = candidates.findIndex((call) => COLLABORATION_TOOL_NAMES.has(call.name));
  if (relativeIndex < 0) return undefined;
  const call = candidates[relativeIndex];
  return { index: range.start + relativeIndex, name: call.name };
}

export function findLinkedCollaborationResponse(
  message: MessageLike,
  _messages: MessageLike[],
  responses: CollaborationResponseRecord[],
): CollaborationResponseRecord | undefined {
  if (!message.id) return undefined;

  return responses.find(
    (response) =>
      response.assistantMessageId === message.id ||
      messageHasToolCall(message, response.toolCallId),
  );
}

export function resolveStepAssistantFlags(input: {
  message: MessageLike;
  messages: MessageLike[];
  content: string;
  isRunning: boolean;
  liveRunStatus: "idle" | "running" | "suspended" | "completed" | "failed";
  liveRun: LiveRun | null;
  collaborationResponses: CollaborationResponseRecord[];
}): StepAssistantFlags {
  const { message, messages, content, isRunning, liveRunStatus, liveRun, collaborationResponses } =
    input;
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const hasToolCalls = toolCalls.length > 0;
  const rawToolNames = toolCalls.map((call) => call?.function?.name ?? "");
  const hasNamedToolCalls = rawToolNames.some((name) => name.trim().length > 0);
  const isLast = messages[messages.length - 1]?.id === message.id;
  const isWaitingForUser = liveRunStatus === "suspended" && isLast;
  const hasLaterAssistant = hasLaterAssistantMessage(message.id, messages);
  const canInferCollaborationFromLiveRun =
    !hasNamedToolCalls && (content.length === 0 || hasLaterAssistant);
  const linkedCollaboration = findLinkedCollaborationResponse(
    message,
    messages,
    collaborationResponses,
  );
  const isCollaborationComplete = Boolean(linkedCollaboration);
  const isCollaborationStep =
    !isCollaborationComplete &&
    (rawToolNames.some((name) => COLLABORATION_TOOL_NAMES.has(name)) ||
      (canInferCollaborationFromLiveRun &&
        inferCollaborationFromLiveRun(message, messages, liveRun)) ||
      (isWaitingForUser && isLast));
  const orphanPreamble =
    !hasToolCalls && content.length > 0 && hasLaterAssistant;
  const isActive =
    isLast && !!isRunning && !isCollaborationComplete && !orphanPreamble;
  const isFinalAnswer =
    isLast &&
    content.length > 0 &&
    !hasToolCalls &&
    !isWaitingForUser &&
    !isCollaborationStep &&
    !isCollaborationComplete &&
    !orphanPreamble;
  const isFinalAnswerComplete = isFinalAnswer && !isActive;
  const isThought =
    orphanPreamble ||
    (!hasToolCalls && !isFinalAnswer && !isCollaborationStep && content.length > 0);

  return {
    hasToolCalls,
    isLast,
    isWaitingForUser,
    isCollaborationStep,
    isCollaborationComplete,
    isActive,
    isFinalAnswer,
    isFinalAnswerComplete,
    isThought,
    linkedCollaboration,
  };
}

export function resolveAssistantToolStepNumber(input: {
  message: MessageLike;
  messages: MessageLike[];
  liveRun: LiveRun | null;
  collaborationResponses: CollaborationResponseRecord[];
}): number {
  const { message, messages, liveRun, collaborationResponses } = input;
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  if (toolCalls.length > 0) {
    return (
      messages
        .filter(
          (item) =>
            item.role === "assistant" &&
            Array.isArray(item.toolCalls) &&
            item.toolCalls.length > 0,
        )
        .findIndex((item) => item.id === message.id) + 1
    );
  }

  const linkedCollaboration = findLinkedCollaborationResponse(
    message,
    messages,
    collaborationResponses,
  );
  if (linkedCollaboration && liveRun) {
    const liveToolIndex = liveRun.toolCalls.findIndex(
      (call) => call.id === linkedCollaboration.toolCallId,
    );
    if (liveToolIndex >= 0) return liveToolIndex + 1;
  }

  const inferred = liveRunCollaborationCandidate(message, messages, liveRun);
  return inferred ? inferred.index + 1 : 0;
}
