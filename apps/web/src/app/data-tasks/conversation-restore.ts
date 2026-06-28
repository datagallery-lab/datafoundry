import type { Message } from "@ag-ui/core";
import type {
  ConversationMessageDto,
  ConversationToolCallDto,
  SessionConversationDto,
} from "../../lib/config-api/types";
import { ConfigApiError } from "../../lib/config-api/types";
import {
  formatCollaborationResponseDisplay,
  type CollaborationToolName,
} from "./components/chat/collaboration-response-display";
import type { CollaborationResponseRecord } from "./components/chat/collaboration-responses";
import {
  archiveCurrentRunSegment,
  createInitialLiveRun,
  reconcileLiveRunArtifacts,
  reduceLiveRunEvent,
  type LiveRun,
} from "./live-run-state";

/** Whether the client should fetch server conversation history for this thread. */
export function shouldRestoreConversation(input: {
  conversationMemoryEnabled: boolean;
  messageCount: number;
  isRunning: boolean;
  alreadyRestored: boolean;
}): boolean {
  return (
    input.conversationMemoryEnabled &&
    input.messageCount === 0 &&
    !input.isRunning &&
    !input.alreadyRestored
  );
}

/** True when agent chat messages already reflect the persisted conversation. */
export function agentMessagesMatchConversation(
  agentMessages: unknown,
  dto: SessionConversationDto,
): boolean {
  const expected = conversationToAgentMessages(dto);
  if (expected.length === 0) {
    return true;
  }
  if (!Array.isArray(agentMessages) || agentMessages.length === 0) {
    return false;
  }
  if (agentMessages.length !== expected.length) {
    return false;
  }
  const lastAgent = agentMessages[agentMessages.length - 1] as { id?: string } | undefined;
  const lastExpected = expected[expected.length - 1];
  return lastAgent?.id === lastExpected?.id;
}

/** Whether chat messages should be replaced from server conversation metadata. */
export function shouldRestoreConversationMessages(input: {
  conversationMemoryEnabled: boolean;
  isRunning: boolean;
  agentMessages: unknown;
  dto: SessionConversationDto;
}): boolean {
  if (!input.conversationMemoryEnabled || input.isRunning) {
    return false;
  }
  const expected = conversationToAgentMessages(input.dto);
  if (expected.length === 0) {
    return false;
  }
  return !agentMessagesMatchConversation(input.agentMessages, input.dto);
}

/** Whether live-run tool timeline should be rebuilt from persisted tool calls. */
export function shouldHydrateLiveRunFromConversation(
  state: LiveRun,
  dto: SessionConversationDto,
): boolean {
  if (dto.toolCalls.length === 0) {
    return false;
  }
  // AG-UI may replay RUN_STARTED before REST hydrate finishes, leaving a running
  // shell with empty toolCalls and bogus runHistory boundaries.
  if (state.toolCalls.length === 0) {
    return true;
  }
  if (state.toolCalls.length < dto.toolCalls.length) {
    return true;
  }
  const liveToolIds = new Set(state.toolCalls.map((call) => call.id));
  if (dto.toolCalls.some((toolCall) => !liveToolIds.has(toolCall.toolCallId))) {
    return true;
  }
  return false;
}

/** Latest user utterance in a persisted conversation (for console overview). */
export function isCollaborationEchoUserMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    /^调用\s*ask\s*_?user(\s+tool)?[.!]?$/.test(normalized) ||
    /^调用\s*submit\s*_?plan(\s+tool)?[.!]?$/.test(normalized) ||
    /^call\s*ask\s*_?user(\s+tool)?[.!]?$/.test(normalized)
  );
}

export function normalizeUserQuestionText(text: string): string | undefined {
  const trimmed = text.trim().replace(/^(undefined\s*)+/i, "").trim();
  return trimmed || undefined;
}

export function latestUserQuestionFromConversation(
  dto: SessionConversationDto,
): string | undefined {
  const sorted = [...dto.messages].sort((left, right) => left.position - right.position);
  let fallback: string | undefined;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index];
    if (entry?.role !== "user") {
      continue;
    }
    const text = normalizeUserQuestionText(entry.contentText);
    if (!text) continue;
    fallback ??= text;
    if (!isCollaborationEchoUserMessage(text)) {
      return text;
    }
  }
  return fallback;
}

export function isIgnorableConversationRestoreError(error: unknown): boolean {
  if (error instanceof ConfigApiError) {
    return error.status === 404 || error.code === "RESOURCE_NOT_FOUND";
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { status?: unknown; code?: unknown };
  return record.status === 404 || record.code === "RESOURCE_NOT_FOUND";
}

type RestoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const COLLABORATION_TOOL_NAMES = new Set<CollaborationToolName>([
  "ask_user",
  "submit_plan",
]);

type ChoiceOption = { label: string; value: string; description?: string };

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function serializeToolCallArguments(toolCall: ConversationToolCallDto): string {
  if (toolCall.args !== undefined) {
    if (typeof toolCall.args === "string") return toolCall.args;
    try {
      return JSON.stringify(toolCall.args);
    } catch {
      return "{}";
    }
  }
  return toolCall.resultPreview ?? "{}";
}

function normalizeChoiceOptions(raw: unknown): ChoiceOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChoiceOption | null => {
      if (typeof item === "string" && item.trim()) {
        const label = item.trim();
        return { label, value: label };
      }
      const record = parseRecord(item);
      if (!record) return null;
      const label =
        typeof record.label === "string"
          ? record.label
          : typeof record.value === "string"
            ? record.value
            : null;
      if (!label) return null;
      return {
        label,
        value: typeof record.value === "string" ? record.value : label,
        ...(typeof record.description === "string"
          ? { description: record.description }
          : {}),
      };
    })
    .filter((item): item is ChoiceOption => Boolean(item));
}

function readCollaborationArgs(toolCall: ConversationToolCallDto): {
  question?: string;
  plan?: string;
  options: ChoiceOption[];
} {
  const record = parseRecord(toolCall.args) ?? {};
  const suspendPayload = parseRecord(record.suspendPayload) ?? {};
  const options = normalizeChoiceOptions(record.options ?? suspendPayload.options);
  const question =
    typeof record.question === "string"
      ? record.question
      : typeof suspendPayload.question === "string"
        ? suspendPayload.question
        : typeof record.title === "string"
          ? record.title
          : undefined;
  const plan =
    typeof record.plan === "string"
      ? record.plan
      : typeof suspendPayload.plan === "string"
        ? suspendPayload.plan
        : undefined;
  return { question, plan, options };
}

function parseCollaborationResumeValue(
  toolName: CollaborationToolName,
  result: unknown,
): unknown {
  if (result === undefined) return undefined;
  if (toolName === "submit_plan") {
    const record = parseRecord(result);
    if (record && typeof record.action === "string") {
      return {
        action: record.action,
        ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
      };
    }
  }
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return undefined;
    const record = parseRecord(trimmed);
    if (record) {
      if (record.response !== undefined) return record.response;
      if (toolName === "submit_plan" && typeof record.action === "string") {
        return {
          action: record.action,
          ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
        };
      }
      if (typeof record.content === "string" && record.content.trim()) {
        return record.content.trim();
      }
    }
    return trimmed;
  }
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    if (record.response !== undefined) return record.response;
    if (toolName === "submit_plan" && typeof record.action === "string") {
      return {
        action: record.action,
        ...(typeof record.feedback === "string" ? { feedback: record.feedback } : {}),
      };
    }
    if (typeof record.content === "string" && record.content.trim()) {
      return record.content.trim();
    }
  }
  return undefined;
}

function resolvePersistedMessageId(
  sortedEntries: ConversationMessageDto[],
  messageId: string,
): string | undefined {
  const entryIndexByMessageId = new Map<string, number>();
  sortedEntries.forEach((entry, index) => {
    entryIndexByMessageId.set(entry.messageId ?? entry.id, index);
  });
  const index = entryIndexByMessageId.get(messageId);
  if (index === undefined) {
    return undefined;
  }
  const entry = sortedEntries[index];
  return entry?.messageId ?? entry?.id;
}

function findAssistantMessageIdForToolCall(
  sortedEntries: ConversationMessageDto[],
  toolCall: ConversationToolCallDto,
): string | undefined {
  if (toolCall.parentMessageId) {
    const resolved = resolvePersistedMessageId(sortedEntries, toolCall.parentMessageId);
    if (resolved) {
      return resolved;
    }
  }

  const entryIndexByMessageId = new Map<string, number>();
  sortedEntries.forEach((entry, index) => {
    entryIndexByMessageId.set(entry.messageId ?? entry.id, index);
  });

  if (toolCall.resultMessageId) {
    const resultIndex = entryIndexByMessageId.get(toolCall.resultMessageId);
    if (resultIndex !== undefined) {
      for (let index = resultIndex - 1; index >= 0; index -= 1) {
        const entry = sortedEntries[index];
        if (entry?.role === "assistant" && entry.runId === toolCall.runId) {
          return entry.messageId ?? entry.id;
        }
      }
    }
  }

  return undefined;
}

function assistantMessageIdsForRun(
  sortedEntries: ConversationMessageDto[],
  runId: string,
  restoredMessageIds: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const entry of sortedEntries) {
    if (entry.role !== "assistant" || entry.runId !== runId) {
      continue;
    }
    if (!entry.contentText.trim()) {
      continue;
    }
    const id = entry.messageId ?? entry.id;
    if (restoredMessageIds.has(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function assignToolCallsByAssistantOrder(
  sortedEntries: ConversationMessageDto[],
  messages: Message[],
  toolCalls: ConversationToolCallDto[],
  alreadyAssigned: Set<string>,
): Map<string, RestoredToolCall[]> {
  const restoredMessageIds = new Set(messages.map((message) => message.id));
  const toolsByRun = new Map<string, ConversationToolCallDto[]>();

  for (const toolCall of toolCalls) {
    if (alreadyAssigned.has(toolCall.toolCallId)) {
      continue;
    }
    const existing = toolsByRun.get(toolCall.runId) ?? [];
    existing.push(toolCall);
    toolsByRun.set(toolCall.runId, existing);
  }

  const toolsByMessageId = new Map<string, RestoredToolCall[]>();

  for (const [runId, runTools] of toolsByRun) {
    const sortedTools = [...runTools].sort(
      (left, right) => toolCallSortKey(left) - toolCallSortKey(right),
    );
    const assistantIds = assistantMessageIdsForRun(
      sortedEntries,
      runId,
      restoredMessageIds,
    );
    if (assistantIds.length === 0 || sortedTools.length === 0) {
      continue;
    }

    if (sortedTools.length <= assistantIds.length) {
      sortedTools.forEach((toolCall, index) => {
        const messageId = assistantIds[index];
        if (!messageId) return;
        const restoredCall = toRestoredToolCall(toolCall);
        const existing = toolsByMessageId.get(messageId) ?? [];
        existing.push(restoredCall);
        toolsByMessageId.set(messageId, existing);
      });
      continue;
    }

    const lastAssistantId = assistantIds[assistantIds.length - 1];
    for (let index = 0; index < assistantIds.length - 1; index += 1) {
      const toolCall = sortedTools[index];
      const messageId = assistantIds[index];
      if (!toolCall || !messageId) continue;
      const existing = toolsByMessageId.get(messageId) ?? [];
      existing.push(toRestoredToolCall(toolCall));
      toolsByMessageId.set(messageId, existing);
    }
    if (lastAssistantId) {
      const trailing = sortedTools.slice(assistantIds.length - 1).map(toRestoredToolCall);
      if (trailing.length > 0) {
        const existing = toolsByMessageId.get(lastAssistantId) ?? [];
        toolsByMessageId.set(lastAssistantId, [...existing, ...trailing]);
      }
    }
  }

  return toolsByMessageId;
}

function resolveToolCallAssistantMessageId(
  sortedEntries: ConversationMessageDto[],
  toolCall: ConversationToolCallDto,
  toolCalls: ConversationToolCallDto[],
): string | undefined {
  const direct = findAssistantMessageIdForToolCall(sortedEntries, toolCall);
  if (direct) {
    return direct;
  }

  const restoredMessageIds = new Set<string>();
  for (const entry of sortedEntries) {
    if (entry.role !== "assistant" || entry.runId !== toolCall.runId) {
      continue;
    }
    if (!entry.contentText.trim()) {
      continue;
    }
    restoredMessageIds.add(entry.messageId ?? entry.id);
  }

  const assistants = assistantMessageIdsForRun(
    sortedEntries,
    toolCall.runId,
    restoredMessageIds,
  );
  const sortedTools = toolCalls
    .filter((entry) => entry.runId === toolCall.runId)
    .sort((left, right) => toolCallSortKey(left) - toolCallSortKey(right));
  const toolIndex = sortedTools.findIndex(
    (entry) => entry.toolCallId === toolCall.toolCallId,
  );
  if (toolIndex < 0 || assistants.length === 0) {
    return undefined;
  }
  if (toolIndex < assistants.length) {
    return assistants[toolIndex];
  }
  return assistants[assistants.length - 1];
}

function toRestoredToolCall(toolCall: ConversationToolCallDto): RestoredToolCall {
  const toolName = toolCall.toolName ?? toolCall.name ?? "tool";
  return {
    id: toolCall.toolCallId,
    type: "function",
    function: {
      name: toolName,
      arguments: serializeToolCallArguments(toolCall),
    },
  };
}

function attachRestoredToolCalls(
  messages: Message[],
  sortedEntries: ConversationMessageDto[],
  toolCalls: ConversationToolCallDto[],
): Message[] {
  if (toolCalls.length === 0) {
    return messages;
  }

  const toolsByMessageIndex = new Map<number, RestoredToolCall[]>();
  const assignedToolCallIds = new Set<string>();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.toolName ?? toolCall.name;
    if (!toolName) {
      continue;
    }

    const assistantMessageId = findAssistantMessageIdForToolCall(sortedEntries, toolCall);
    if (!assistantMessageId) {
      continue;
    }

    const messageIndex = messages.findIndex((message) => message.id === assistantMessageId);
    if (messageIndex < 0) {
      continue;
    }

    assignedToolCallIds.add(toolCall.toolCallId);
    const existing = toolsByMessageIndex.get(messageIndex) ?? [];
    existing.push(toRestoredToolCall(toolCall));
    toolsByMessageIndex.set(messageIndex, existing);
  }

  const orderedAssignments = assignToolCallsByAssistantOrder(
    sortedEntries,
    messages,
    toolCalls,
    assignedToolCallIds,
  );

  for (const [messageId, toolCallEntries] of orderedAssignments) {
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      continue;
    }
    const existing = toolsByMessageIndex.get(messageIndex) ?? [];
    toolsByMessageIndex.set(messageIndex, [...existing, ...toolCallEntries]);
  }

  return messages.map((message, index) => {
    const toolCallEntries = toolsByMessageIndex.get(index);
    if (!toolCallEntries?.length) {
      return message;
    }
    return {
      ...message,
      toolCalls: toolCallEntries,
    };
  });
}

/**
 * Maps server-authoritative conversation messages to AG-UI chat messages.
 * Tool calls from `dto.toolCalls` are attached to the nearest preceding
 * assistant message in the same run so step UI can render historical tools.
 */
export function conversationToAgentMessages(
  dto: SessionConversationDto,
): Message[] {
  const sorted = [...dto.messages].sort((a, b) => a.position - b.position);
  const messages: Message[] = [];

  for (const entry of sorted) {
    if (entry.role !== "user" && entry.role !== "assistant") {
      continue;
    }
    const content = entry.contentText.trim();
    if (!content) {
      continue;
    }
    const id = entry.messageId ?? entry.id;
    if (entry.role === "user") {
      messages.push({
        id,
        role: "user",
        content,
      });
      continue;
    }
    messages.push({
      id,
      role: "assistant",
      content,
    });
  }

  return attachRestoredToolCalls(messages, sorted, dto.toolCalls);
}

/**
 * Rebuilds client-side collaboration response records from persisted tool-call
 * metadata so ask_user / submit_plan steps stay answered after session switch.
 */
export function collaborationResponsesFromConversation(
  threadId: string,
  dto: SessionConversationDto,
): Array<Omit<CollaborationResponseRecord, "id" | "createdAt">> {
  if (dto.toolCalls.length === 0) {
    return [];
  }

  const sortedEntries = [...dto.messages].sort((left, right) => left.position - right.position);
  const records: Array<Omit<CollaborationResponseRecord, "id" | "createdAt">> = [];

  for (const toolCall of dto.toolCalls) {
    const toolName = (toolCall.toolName ?? toolCall.name) as CollaborationToolName | undefined;
    if (!toolName || !COLLABORATION_TOOL_NAMES.has(toolName)) {
      continue;
    }
    if (toolCall.status !== "completed") {
      continue;
    }

    const resumeValue = parseCollaborationResumeValue(
      toolName,
      toolCall.result ?? toolCall.resultPreview,
    );
    if (resumeValue === undefined) {
      continue;
    }

    const { question, plan, options } = readCollaborationArgs(toolCall);
    records.push({
      threadId,
      toolCallId: toolCall.toolCallId,
      toolName,
      ...(question ? { question } : {}),
      ...(plan ? { plan } : {}),
      displayText: formatCollaborationResponseDisplay(toolName, resumeValue, options),
      assistantMessageId: resolveToolCallAssistantMessageId(
        sortedEntries,
        toolCall,
        dto.toolCalls,
      ),
    });
  }

  return records;
}

function toolCallSortKey(toolCall: ConversationToolCallDto): number {
  return (
    toolCall.callEventSeq ??
    toolCall.resultEventSeq ??
    toolCall.endEventSeq ??
    0
  );
}

function serializeToolCallResult(toolCall: ConversationToolCallDto): string | undefined {
  if (typeof toolCall.result === "string") return toolCall.result;
  if (toolCall.resultPreview) return toolCall.resultPreview;
  if (toolCall.result !== undefined) {
    try {
      return JSON.stringify(toolCall.result);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function runOrderFromUserMessages(messages: ConversationMessageDto[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const sorted = [...messages].sort((left, right) => left.position - right.position);
  for (const message of sorted) {
    if (message.role !== "user" || !message.runId || seen.has(message.runId)) {
      continue;
    }
    seen.add(message.runId);
    order.push(message.runId);
  }
  return order;
}

function groupToolCallsByRun(
  toolCalls: ConversationToolCallDto[],
  messages: ConversationMessageDto[],
): ConversationToolCallDto[][] {
  const groups = new Map<string, ConversationToolCallDto[]>();

  for (const toolCall of toolCalls) {
    const runId = toolCall.runId || "default";
    const bucket = groups.get(runId) ?? [];
    bucket.push(toolCall);
    groups.set(runId, bucket);
  }

  const userRunOrder = runOrderFromUserMessages(messages);
  const orderedRunIds = [
    ...userRunOrder.filter((runId) => groups.has(runId)),
    ...[...groups.keys()]
      .filter((runId) => !userRunOrder.includes(runId))
      .sort((left, right) => {
        const leftKey = Math.min(
          ...(groups.get(left) ?? []).map((toolCall) => toolCallSortKey(toolCall)),
        );
        const rightKey = Math.min(
          ...(groups.get(right) ?? []).map((toolCall) => toolCallSortKey(toolCall)),
        );
        return leftKey - rightKey;
      }),
  ];

  return orderedRunIds.map((runId) =>
    [...(groups.get(runId) ?? [])].sort(
      (left, right) => toolCallSortKey(left) - toolCallSortKey(right),
    ),
  );
}

function resolveConversationToolName(toolCall: ConversationToolCallDto): string {
  const direct = toolCall.toolName ?? toolCall.name;
  if (direct && direct !== "tool" && direct !== "unknown") {
    return direct;
  }

  const result = serializeToolCallResult(toolCall);
  if (result) {
    if (result.includes("mastra-collaboration") || result.includes("User answered")) {
      return "ask_user";
    }
    try {
      const parsed = JSON.parse(result) as { source?: string };
      if (parsed.source === "mastra-collaboration") {
        return "ask_user";
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return direct ?? "tool";
}

function isPendingCollaborationRunEnd(tools: ConversationToolCallDto[]): boolean {
  const last = tools.at(-1);
  if (!last) return false;
  const toolName = last.toolName ?? last.name;
  if (last.status === "pending") return true;
  if (toolName !== "ask_user" && toolName !== "submit_plan") return false;
  return serializeToolCallResult(last) === undefined;
}

function applyConversationToolCall(state: LiveRun, toolCall: ConversationToolCallDto): LiveRun {
  const toolName = resolveConversationToolName(toolCall);
  const toolCallId = toolCall.toolCallId;
  let next = reduceLiveRunEvent(state, {
    type: "TOOL_CALL_START",
    toolCallId,
    toolCallName: toolName,
    ...(toolCall.args && typeof toolCall.args === "object"
      ? { args: toolCall.args as Record<string, unknown> }
      : {}),
  });

  const result = serializeToolCallResult(toolCall);
  if (result !== undefined) {
    next = reduceLiveRunEvent(next, {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      toolCallName: toolName,
      result,
    });
  } else if (toolCall.status === "failed") {
    next = reduceLiveRunEvent(next, {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      toolCallName: toolName,
      result: JSON.stringify({ error: "Tool execution failed" }),
    });
  }

  return next;
}

function finalizeHydratedRunSegment(
  state: LiveRun,
  tools: ConversationToolCallDto[],
): LiveRun {
  if (tools.length === 0) {
    return state;
  }
  if (isPendingCollaborationRunEnd(tools)) {
    let next = reduceLiveRunEvent(state, {
      type: "STATE_DELTA",
      delta: [{ op: "replace", path: "/runStatus", value: "suspended" }],
    });
    next = reduceLiveRunEvent(next, { type: "RUN_FINISHED" });
    return next;
  }
  return reduceLiveRunEvent(state, { type: "RUN_FINISHED" });
}

function startNextHydratedRunGroup(state: LiveRun, runId?: string): LiveRun {
  if (state.runStatus === "suspended") {
    const archived: LiveRun = {
      ...state,
      runHistory: archiveCurrentRunSegment(state),
      runStartedAt: undefined,
      runFinishedAt: undefined,
      runStatus: "idle",
    };
    return reduceLiveRunEvent(archived, { type: "RUN_STARTED", ...(runId ? { runId } : {}) });
  }
  return reduceLiveRunEvent(state, { type: "RUN_STARTED", ...(runId ? { runId } : {}) });
}

function mergePreservedLiveRunSessionData(previous: LiveRun, hydrated: LiveRun): LiveRun {
  const artifactIds = new Set(hydrated.artifacts.map((artifact) => artifact.id));
  const eventIds = new Set(hydrated.events.map((event) => event.id));
  const auditIds = new Set(hydrated.audits.map((audit) => audit.id));

  return {
    ...hydrated,
    artifacts: [
      ...hydrated.artifacts,
      ...previous.artifacts.filter((artifact) => !artifactIds.has(artifact.id)),
    ],
    events: [
      ...hydrated.events,
      ...previous.events.filter((event) => !eventIds.has(event.id)),
    ],
    audits: [
      ...hydrated.audits,
      ...previous.audits.filter((audit) => !auditIds.has(audit.id)),
    ],
  };
}

/**
 * Rebuilds console/trace tool-call state from persisted conversation metadata.
 * Used when chat messages are restored via REST instead of AG-UI event replay.
 */
export function hydrateLiveRunFromConversation(
  state: LiveRun,
  dto: SessionConversationDto,
): LiveRun {
  if (!shouldHydrateLiveRunFromConversation(state, dto)) {
    return state;
  }

  const sorted = [...dto.toolCalls].sort(
    (left, right) => toolCallSortKey(left) - toolCallSortKey(right),
  );
  const runGroups = groupToolCallsByRun(sorted, dto.messages);

  let next = createInitialLiveRun();
  for (const [index, tools] of runGroups.entries()) {
    const runId = tools[0]?.runId;
    next =
      index === 0
        ? reduceLiveRunEvent(next, { type: "RUN_STARTED", ...(runId ? { runId } : {}) })
        : startNextHydratedRunGroup(next, runId);

    for (const toolCall of tools) {
      next = applyConversationToolCall(next, toolCall);
    }

    next = finalizeHydratedRunSegment(next, tools);
  }

  next = reconcileLiveRunArtifacts(mergePreservedLiveRunSessionData(state, next));
  return next;
}
