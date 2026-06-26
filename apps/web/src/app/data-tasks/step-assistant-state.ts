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
  if (!liveRun) return false;

  const assistants = messages.filter((item) => item.role === "assistant");
  const assistantIndex = assistants.findIndex((item) => item.id === message.id);
  if (assistantIndex < 0) return false;

  let liveToolIndex = 0;
  for (let index = 0; index < assistantIndex; index += 1) {
    const toolCount = assistants[index].toolCalls?.length ?? 0;
    liveToolIndex += toolCount > 0 ? toolCount : 1;
  }

  const currentToolCount = message.toolCalls?.length ?? 0;
  const sliceEnd = liveToolIndex + (currentToolCount > 0 ? currentToolCount : 1);
  const candidates = liveRun.toolCalls.slice(liveToolIndex, sliceEnd);
  return candidates.some((call) => COLLABORATION_TOOL_NAMES.has(call.name));
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
  const isLast = messages[messages.length - 1]?.id === message.id;
  const isWaitingForUser = liveRunStatus === "suspended" && isLast;
  const linkedCollaboration = findLinkedCollaborationResponse(
    message,
    messages,
    collaborationResponses,
  );
  const isCollaborationStep =
    rawToolNames.some((name) => COLLABORATION_TOOL_NAMES.has(name)) ||
    inferCollaborationFromLiveRun(message, messages, liveRun) ||
    Boolean(linkedCollaboration) ||
    (isWaitingForUser && isLast);
  const isCollaborationComplete = Boolean(linkedCollaboration);
  const orphanPreamble =
    !hasToolCalls && content.length > 0 && hasLaterAssistantMessage(message.id, messages);
  const isActive =
    isLast && !!isRunning && !isCollaborationComplete && !orphanPreamble;
  const isFinalAnswer =
    isLast &&
    content.length > 0 &&
    !hasToolCalls &&
    !isWaitingForUser &&
    !isCollaborationStep &&
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
