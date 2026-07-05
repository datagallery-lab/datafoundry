import type { Attachment } from "@copilotkit/react-core/v2";
import type { LiveRunStatus } from "../../live-run-state";
import type { RunForwardedProps } from "../../data-task-state";

export type QueuedChatPromptStatus = "queued" | "interrupting";

export type QueuedChatPrompt = {
  id: string;
  text: string;
  attachments: Attachment[];
  forwardedProps: RunForwardedProps;
  createdAt: number;
  status: QueuedChatPromptStatus;
};

export type QueuedChatPromptInput = {
  id: string;
  text: string;
  attachments: Attachment[];
  forwardedProps: RunForwardedProps;
  createdAt: number;
};

export function createQueuedChatPrompt(
  input: QueuedChatPromptInput,
): QueuedChatPrompt {
  return {
    ...input,
    attachments: [...input.attachments],
    status: "queued",
  };
}

export function editQueuedChatPrompt(
  queue: QueuedChatPrompt[],
  id: string,
  text: string,
): QueuedChatPrompt[] {
  return queue.map((prompt) =>
    prompt.id === id ? { ...prompt, text } : prompt,
  );
}

export function deleteQueuedChatPrompt(
  queue: QueuedChatPrompt[],
  id: string,
): QueuedChatPrompt[] {
  return queue.filter((prompt) => prompt.id !== id);
}

export function markQueuedChatPromptInterrupting(
  queue: QueuedChatPrompt[],
  id: string,
): QueuedChatPrompt[] {
  const target = queue.find((prompt) => prompt.id === id);
  if (!target) return queue;
  const rest = queue.filter((prompt) => prompt.id !== id);
  return [{ ...target, status: "interrupting" }, ...rest];
}

export function takeNextQueuedChatPrompt(queue: QueuedChatPrompt[]): {
  prompt: QueuedChatPrompt | null;
  queue: QueuedChatPrompt[];
} {
  const [prompt, ...rest] = queue;
  return {
    prompt: prompt ?? null,
    queue: rest,
  };
}

export function resolveQueuedSubmitMode(input: {
  agentIsRunning: boolean;
  liveRunStatus: LiveRunStatus;
}): "queue" | "dispatch" {
  if (
    input.agentIsRunning ||
    input.liveRunStatus === "running" ||
    input.liveRunStatus === "suspended"
  ) {
    return "queue";
  }
  return "dispatch";
}

export function shouldShowRunningStopControl(input: {
  agentIsRunning: boolean;
  liveRunStatus: LiveRunStatus;
  draftText: string;
}): boolean {
  const activeRun =
    input.agentIsRunning ||
    input.liveRunStatus === "running" ||
    input.liveRunStatus === "suspended";
  return activeRun && input.draftText.trim().length === 0;
}

export function queuedPromptToRunInput(prompt: QueuedChatPrompt): {
  text: string;
  attachments: Attachment[];
  forwardedProps: RunForwardedProps;
} {
  return {
    text: prompt.text,
    attachments: prompt.attachments,
    forwardedProps: prompt.forwardedProps,
  };
}
