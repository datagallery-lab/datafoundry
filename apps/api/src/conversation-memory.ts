import { EventType, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/client";
import { ContextTokenCounter, type ConversationMemoryBridge } from "@datafoundry/agent-runtime";
import type { EvidenceRef } from "@datafoundry/contracts";
import {
  type ConversationMessageRecord,
  type ConversationMessageRepository,
  type ConversationSummaryRecord,
  type ConversationSummaryRepository,
  type RunEventRecord,
  type RunEventRepository
} from "@datafoundry/metadata";
import { createHash } from "node:crypto";

const DEFAULT_HISTORY_LIMIT = 24;
const DEFAULT_HISTORY_LOAD_LIMIT = 96;
const DEFAULT_MAX_HISTORY_TOKENS = 6000;
const DEFAULT_MAX_MESSAGE_CHARS = 6000;
const DEFAULT_MAX_TOTAL_CHARS = 24000;
const DEFAULT_SUMMARY_MAX_CHARS = 2000;
const DEFAULT_SUMMARY_TRIGGER_MESSAGES = 18;
const DEFAULT_SUMMARY_KEEP_RECENT_MESSAGES = 8;
const MESSAGE_TOKEN_OVERHEAD = 4;

export type ConversationMemoryWindowPolicy = {
  historyLoadLimit?: number;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
  maxMessageChars?: number;
  maxTotalChars?: number;
  summaryKeepRecentMessages?: number;
  summaryMaxChars?: number;
  summaryTriggerMessages?: number;
};

export type ConversationCompactMemorySource = "metadata-summary" | "mastra-working-memory";

export type ConversationMemoryWindowReport = {
  availableHistoryMessages: number;
  droppedHistoryMessages: number;
  includedSummary: boolean;
  maxHistoryMessages: number;
  maxHistoryTokens: number;
  maxTotalChars: number;
  selectedHistoryMessages: number;
  selectedHistoryTokens: number;
  selectedTotalChars: number;
};

export type ConversationMemoryRunMessages = {
  messages: Message[];
  report: ConversationMemoryWindowReport;
};

export type ConversationMemoryHistoryProvider = (input: {
  excludeRunId: string;
  limit: number;
  sessionId: string;
  userId: string;
}) => {
  history: ConversationMessageRecord[];
  summary?: ConversationSummaryRecord;
};

export type ConversationMemoryServiceInput = {
  compactMemorySource?: ConversationCompactMemorySource | undefined;
  historyProvider?: ConversationMemoryHistoryProvider | undefined;
  memoryBridge?: ConversationMemoryBridge | undefined;
  policy?: ConversationMemoryWindowPolicy | undefined;
  repository: ConversationMessageRepository;
  runEvents?: RunEventRepository | undefined;
  sessionId: string;
  summarizer?: ConversationSummarizer | undefined;
  summaryRepository?: ConversationSummaryRepository | undefined;
  tokenCounter?: ContextTokenCounter | undefined;
  userId: string;
};

export type ConversationSummarizerInput = {
  maxChars: number;
  previousSummary?: ConversationSummaryRecord | undefined;
  runId: string;
  sessionId: string;
  sourceMessages: ConversationMessageRecord[];
  userId: string;
};

export type ConversationSummarizer = {
  readonly kind: string;
  summarize(input: ConversationSummarizerInput): Promise<string> | string;
};

type BuildConversationMessagesInput = {
  compactMemorySource?: ConversationCompactMemorySource | undefined;
  currentUserText: string;
  history: ConversationMessageRecord[];
  modelName?: string | undefined;
  policy?: ConversationMemoryWindowPolicy | undefined;
  runId: string;
  runInput: RunAgentInput;
  summary?: ConversationSummaryRecord | undefined;
  toolCheckpoints?: Map<string, string> | undefined;
  historyLimit?: number;
  maxMessageChars?: number;
};

type PersistCurrentUserMessageInput = {
  currentUserText: string;
  evidenceRefs?: EvidenceRef[];
  repository: ConversationMessageRepository;
  runId: string;
  runInput: RunAgentInput;
  sessionId: string;
  userId: string;
};

type ConversationMemoryEventObserverInput = {
  memoryBridge?: ConversationMemoryBridge | undefined;
  policy?: ConversationMemoryWindowPolicy | undefined;
  repository: ConversationMessageRepository;
  runId: string;
  sessionId: string;
  summarizer?: ConversationSummarizer | undefined;
  summaryRepository?: ConversationSummaryRepository | undefined;
  userId: string;
  maxMessageChars?: number;
};

type AssistantDraft = {
  messageId: string;
  role: "assistant" | "user" | "system" | "developer";
  text: string;
};

export class ConversationMemoryService {
  private readonly input: ConversationMemoryServiceInput;
  private readonly summarizer: ConversationSummarizer;
  private readonly tokenCounter: ContextTokenCounter;

  constructor(input: ConversationMemoryServiceInput) {
    this.input = input;
    this.summarizer = input.summarizer ?? new DeterministicConversationSummarizer();
    this.tokenCounter = input.tokenCounter ?? new ContextTokenCounter();
  }

  buildRunMessages(input: {
    currentUserText: string;
    modelName?: string | undefined;
    runId: string;
    runInput: RunAgentInput;
  }): ConversationMemoryRunMessages {
    const policy = normalizePolicy(this.input.policy);
    const provided = this.input.historyProvider?.({
      excludeRunId: input.runId,
      limit: policy.historyLoadLimit,
      sessionId: this.input.sessionId,
      userId: this.input.userId
    });
    const history = provided?.history ?? this.input.repository.listRecent({
      user_id: this.input.userId,
      session_id: this.input.sessionId,
      exclude_run_id: input.runId,
      limit: policy.historyLoadLimit
    });
    const summary = provided
      ? provided.summary
      : this.input.summaryRepository?.latest({
        user_id: this.input.userId,
        session_id: this.input.sessionId
      });
    const effectiveHistory = summary ? history.filter((record) => record.position > summary.to_position) : history;
    const toolCheckpoints = this.input.runEvents
      ? buildToolCheckpointsForHistory({
        history: effectiveHistory,
        maxChars: policy.maxMessageChars,
        runEvents: this.input.runEvents,
        userId: this.input.userId
      })
      : undefined;
    return buildConversationMemoryMessagesWithReport({
      compactMemorySource: this.input.compactMemorySource,
      currentUserText: input.currentUserText,
      history: effectiveHistory,
      modelName: input.modelName,
      policy,
      runId: input.runId,
      runInput: input.runInput,
      summary,
      toolCheckpoints,
      tokenCounter: this.tokenCounter
    });
  }

  createEventObserver(input: { runId: string }): ConversationMemoryEventObserver {
    return new ConversationMemoryEventObserver({
      policy: this.input.policy,
      memoryBridge: this.input.memoryBridge,
      repository: this.input.repository,
      runId: input.runId,
      sessionId: this.input.sessionId,
      summarizer: this.summarizer,
      summaryRepository: this.input.summaryRepository,
      userId: this.input.userId
    });
  }

  persistCurrentUserMessage(input: {
    currentUserText: string;
    evidenceRefs?: EvidenceRef[];
    runId: string;
    runInput: RunAgentInput;
  }): ConversationMessageRecord {
    return persistCurrentUserMessage({
      currentUserText: input.currentUserText,
      evidenceRefs: input.evidenceRefs ?? [],
      repository: this.input.repository,
      runId: input.runId,
      runInput: input.runInput,
      sessionId: this.input.sessionId,
      userId: this.input.userId
    });
  }

  async syncLatestSummaryToMemory(): Promise<boolean> {
    if (!this.input.memoryBridge || !this.input.summaryRepository) {
      return false;
    }
    const summary = this.input.summaryRepository.latest({
      user_id: this.input.userId,
      session_id: this.input.sessionId
    });
    if (!summary) {
      return false;
    }
    await this.input.memoryBridge.mirrorSummary({
      projection: {
        fromPosition: summary.from_position,
        summaryText: summary.summary_text,
        toPosition: summary.to_position
      },
      resourceId: this.input.userId,
      threadId: this.input.sessionId
    });
    return true;
  }
}

export class DeterministicConversationSummarizer implements ConversationSummarizer {
  readonly kind = "deterministic";

  summarize(input: ConversationSummarizerInput): string {
    return buildDeterministicSummary({
      previousSummary: input.previousSummary,
      sourceMessages: input.sourceMessages,
      maxChars: input.maxChars
    });
  }
}

export const buildConversationMemoryMessages = (input: BuildConversationMessagesInput): Message[] =>
  buildConversationMemoryMessagesWithReport({
    ...input,
    policy: normalizePolicy({
      ...input.policy,
      ...(input.historyLimit ? { maxHistoryMessages: input.historyLimit } : {}),
      ...(input.maxMessageChars ? { maxMessageChars: input.maxMessageChars } : {})
    }),
    tokenCounter: new ContextTokenCounter()
  }).messages;

export const buildConversationMemoryMessagesWithReport = (
  input: BuildConversationMessagesInput & {
    policy?: ConversationMemoryWindowPolicy | undefined;
    tokenCounter?: ContextTokenCounter | undefined;
  }
): ConversationMemoryRunMessages => {
  const policy = normalizePolicy({
    ...input.policy,
    ...(input.historyLimit ? { maxHistoryMessages: input.historyLimit } : {}),
    ...(input.maxMessageChars ? { maxMessageChars: input.maxMessageChars } : {})
  });
  const selected = selectBudgetedHistory({
    currentUserText: input.currentUserText,
    history: input.history,
    modelName: input.modelName,
    policy,
    summary: shouldInjectMetadataSummary(input.compactMemorySource) ? input.summary : undefined,
    tokenCounter: input.tokenCounter ?? new ContextTokenCounter()
  });
  const currentUserMessageId = lastUserMessage(input.runInput)?.id ?? `${input.runId}:user`;
  const messages: Message[] = selected.summary ? [summaryToMessage(selected.summary, policy.maxMessageChars)] : [];
  messages.push(
    ...normalizeHistoryMessagePairs(selected.history, policy.maxMessageChars, input.toolCheckpoints)
  );

  messages.push({
    id: currentUserMessageId,
    role: "user",
    content: boundText(input.currentUserText, policy.maxMessageChars)
  });

  return { messages, report: selected.report };
};

export const persistCurrentUserMessage = (input: PersistCurrentUserMessageInput): ConversationMessageRecord => {
  const message = lastUserMessage(input.runInput);
  return input.repository.append({
    user_id: input.userId,
    session_id: input.sessionId,
    run_id: input.runId,
    id: `${input.runId}:user`,
    role: "user",
    source: "client",
    content_text: input.currentUserText,
    content: {
      text: input.currentUserText,
      ...((input.evidenceRefs?.length ?? 0) > 0 ? { evidenceRefs: input.evidenceRefs } : {})
    },
    ...(message?.id ? { message_id: message.id } : {})
  });
};

export class ConversationMemoryEventObserver {
  private readonly drafts = new Map<string, AssistantDraft>();
  private readonly input: ConversationMemoryEventObserverInput;

  constructor(input: ConversationMemoryEventObserverInput) {
    this.input = input;
  }

  observe(event: BaseEvent): void {
    if (event.type === EventType.TEXT_MESSAGE_START) {
      const messageId = stringValue(readEventField(event, "messageId"));
      if (!messageId) {
        return;
      }
      this.drafts.set(messageId, {
        messageId,
        role: conversationRole(readEventField(event, "role")) ?? "assistant",
        text: this.drafts.get(messageId)?.text ?? ""
      });
      return;
    }

    if (event.type !== EventType.TEXT_MESSAGE_CONTENT && event.type !== EventType.TEXT_MESSAGE_CHUNK) {
      return;
    }

    const delta = typeof event.delta === "string" ? event.delta : "";
    if (!delta) {
      return;
    }
    const messageId = stringValue(readEventField(event, "messageId")) ?? `${this.input.runId}:assistant`;
    const current = this.drafts.get(messageId);
    this.drafts.set(messageId, {
      messageId,
      role: conversationRole(readEventField(event, "role")) ?? current?.role ?? "assistant",
      text: `${current?.text ?? ""}${delta}`
    });
  }

  async flushCompleted(input: { signal?: AbortSignal | undefined } = {}): Promise<ConversationMessageRecord[]> {
    const records = this.persistAssistantDrafts();
    throwIfAborted(input.signal);
    await this.maybeCreateSummary(input.signal);
    return records;
  }

  /** Persist in-flight assistant drafts without summarization (e.g. on HITL suspend). */
  flushDrafts(): ConversationMessageRecord[] {
    return this.persistAssistantDrafts();
  }

  private persistAssistantDrafts(): ConversationMessageRecord[] {
    const maxMessageChars = normalizePolicy({
      ...this.input.policy,
      ...(this.input.maxMessageChars ? { maxMessageChars: this.input.maxMessageChars } : {})
    }).maxMessageChars;
    const records: ConversationMessageRecord[] = [];
    for (const draft of this.drafts.values()) {
      if (draft.role !== "assistant") {
        continue;
      }
      const text = draft.text.trim();
      if (!text) {
        continue;
      }
      records.push(this.input.repository.append({
        user_id: this.input.userId,
        session_id: this.input.sessionId,
        run_id: this.input.runId,
        id: `${this.input.runId}:assistant:${shortHash(draft.messageId)}`,
        role: "assistant",
        source: "agent",
        message_id: draft.messageId,
        content_text: boundText(text, maxMessageChars),
        content: { text: boundText(text, maxMessageChars) }
      }));
    }
    this.drafts.clear();
    return records;
  }

  private async maybeCreateSummary(signal?: AbortSignal | undefined): Promise<ConversationSummaryRecord | undefined> {
    if (!this.input.summaryRepository) {
      return undefined;
    }
    try {
      return await createAutomaticConversationSummary({
        policy: normalizePolicy(this.input.policy),
        memoryBridge: this.input.memoryBridge,
        repository: this.input.repository,
        runId: this.input.runId,
        sessionId: this.input.sessionId,
        signal,
        summarizer: this.input.summarizer ?? new DeterministicConversationSummarizer(),
        summaryRepository: this.input.summaryRepository,
        userId: this.input.userId
      });
    } catch {
      return undefined;
    }
  }
}

export const createAutomaticConversationSummary = async (input: {
  memoryBridge?: ConversationMemoryBridge | undefined;
  policy?: ConversationMemoryWindowPolicy | Required<ConversationMemoryWindowPolicy>;
  repository: ConversationMessageRepository;
  runId: string;
  sessionId: string;
  signal?: AbortSignal | undefined;
  summarizer?: ConversationSummarizer | undefined;
  summaryRepository: ConversationSummaryRepository;
  userId: string;
}): Promise<ConversationSummaryRecord | undefined> => {
  const policy = normalizePolicy(input.policy);
  const latestSummary = input.summaryRepository.latest({
    user_id: input.userId,
    session_id: input.sessionId
  });
  const history = input.repository.listRecent({
    user_id: input.userId,
    session_id: input.sessionId,
    limit: policy.historyLoadLimit
  });
  const unsummarized = latestSummary
    ? history.filter((record) => record.position > latestSummary.to_position)
    : history;
  if (unsummarized.length < policy.summaryTriggerMessages) {
    return undefined;
  }
  const summarizeCount = unsummarized.length - policy.summaryKeepRecentMessages;
  if (summarizeCount <= 0) {
    return undefined;
  }
  const sourceMessages = unsummarized.slice(0, summarizeCount);
  const first = sourceMessages[0];
  const last = sourceMessages.at(-1);
  if (!first || !last) {
    return undefined;
  }
  throwIfAborted(input.signal);
  const summaryText = boundText(await generateSummaryText({
    maxChars: policy.summaryMaxChars,
    previousSummary: latestSummary,
    runId: input.runId,
    sessionId: input.sessionId,
    sourceMessages,
    summarizer: input.summarizer ?? new DeterministicConversationSummarizer(),
    userId: input.userId
  }), policy.summaryMaxChars);
  throwIfAborted(input.signal);
  const summary = input.summaryRepository.create({
    user_id: input.userId,
    session_id: input.sessionId,
    id: `summary:${input.sessionId}:${first.position}-${last.position}`,
    source_run_id: input.runId,
    from_position: latestSummary?.from_position ?? first.position,
    to_position: last.position,
    summary_text: summaryText
  });
  throwIfAborted(input.signal);
  await input.memoryBridge?.mirrorSummary({
    projection: {
      fromPosition: summary.from_position,
      summaryText: summary.summary_text,
      toPosition: summary.to_position
    },
    resourceId: input.userId,
    threadId: input.sessionId
  }).catch(() => undefined);
  return summary;
};

const generateSummaryText = async (input: {
  maxChars: number;
  previousSummary?: ConversationSummaryRecord | undefined;
  runId: string;
  sessionId: string;
  sourceMessages: ConversationMessageRecord[];
  summarizer: ConversationSummarizer;
  userId: string;
}): Promise<string> => {
  try {
    const summaryText = await input.summarizer.summarize({
      maxChars: input.maxChars,
      previousSummary: input.previousSummary,
      runId: input.runId,
      sessionId: input.sessionId,
      sourceMessages: input.sourceMessages,
      userId: input.userId
    });
    const normalized = summaryText.trim();
    if (normalized) {
      return normalized;
    }
  } catch {
    // Summary generation is a best-effort memory optimization; never fail the primary agent run.
  }
  return new DeterministicConversationSummarizer().summarize({
    maxChars: input.maxChars,
    previousSummary: input.previousSummary,
    runId: input.runId,
    sessionId: input.sessionId,
    sourceMessages: input.sourceMessages,
    userId: input.userId
  });
};

/**
 * Normalises orphaned user messages in conversation history into valid
 * user/assistant pairs by injecting a synthetic assistant error reply.
 *
 * An orphaned user message is a user-role record that is NOT followed by an
 * assistant reply – either it sits at the tail of the history or it is
 * directly followed by another user message.  This happens when a run fails
 * before the agent produces any output: `persistCurrentUserMessage` has
 * already written the record but no corresponding assistant record is stored.
 *
 * Simply discarding these records loses conversation context.  Instead we
 * inject a placeholder assistant message so the LLM:
 *   1. Sees the full history of what the user asked.
 *   2. Understands that the previous attempt failed to produce a response.
 *   3. Receives a strictly alternating user/assistant sequence, which all
 *      major providers (Anthropic, DashScope, …) require.
 */
const ORPHANED_USER_MESSAGE_PLACEHOLDER =
  "Previous request failed before the assistant produced a response.";

const normalizeHistoryMessagePairs = (
  records: ConversationMessageRecord[],
  maxMessageChars: number,
  toolCheckpoints?: Map<string, string> | undefined
): Message[] => {
  const result: Message[] = [];
  const consumedCheckpointRunIds = new Set<string>();
  const consumeToolCheckpoint = (runId: string): string | undefined => {
    if (consumedCheckpointRunIds.has(runId)) {
      return undefined;
    }
    consumedCheckpointRunIds.add(runId);
    return toolCheckpoints?.get(runId);
  };
  for (let i = 0; i < records.length; i++) {
    const cur = records[i]!;
    const next = records[i + 1] as ConversationMessageRecord | undefined;
    const checkpoint = cur.role === "assistant" ? consumeToolCheckpoint(cur.run_id) : undefined;
    result.push({
      id: `memory:${cur.id}`,
      role: cur.role,
      content: boundText(appendToolCheckpoint(cur.content_text, checkpoint), maxMessageChars)
    });
    if (cur.role === "user" && (!next || next.role === "user")) {
      const orphanedCheckpoint = consumeToolCheckpoint(cur.run_id);
      result.push({
        id: `memory:${cur.id}:error-placeholder`,
        role: "assistant",
        content: boundText(
          appendToolCheckpoint(ORPHANED_USER_MESSAGE_PLACEHOLDER, orphanedCheckpoint),
          maxMessageChars
        )
      });
    }
  }
  return result;
};

const appendToolCheckpoint = (content: string, checkpoint: string | undefined): string =>
  checkpoint ? `${content}\n\n${checkpoint}` : content;

const buildToolCheckpointsForHistory = (input: {
  history: ConversationMessageRecord[];
  maxChars: number;
  runEvents: RunEventRepository;
  userId: string;
}): Map<string, string> => {
  const runIds = [...new Set(input.history.map((record) => record.run_id))];
  const checkpoints = new Map<string, string>();
  for (const runId of runIds) {
    const events = input.runEvents.listByRun({ user_id: input.userId, run_id: runId });
    const checkpoint = toolCheckpointText(runId, events, input.maxChars);
    if (checkpoint) {
      checkpoints.set(runId, checkpoint);
    }
  }
  return checkpoints;
};

type ToolCheckpointCall = {
  args?: unknown;
  result?: unknown;
  resultSeq?: number;
  status: "completed" | "failed";
  toolCallId: string;
  toolName?: string;
};

const toolCheckpointText = (
  runId: string,
  events: RunEventRecord[],
  maxChars: number
): string | undefined => {
  const calls = new Map<string, Partial<ToolCheckpointCall> & { toolCallId: string }>();
  for (const eventRecord of events) {
    const event = parseJsonObject(eventRecord.payload_json);
    const type = stringValue(event.type);
    const toolCallId = stringValue(event.toolCallId);
    if (!type || !toolCallId) {
      continue;
    }
    const existing = calls.get(toolCallId) ?? { toolCallId };
    const toolName = stringValue(event.toolCallName) ?? existing.toolName;
    if (type === EventType.TOOL_CALL_START || type === EventType.TOOL_CALL_END) {
      calls.set(toolCallId, {
        ...existing,
        ...(toolName ? { toolName } : {}),
        ...(existing.args !== undefined ? { args: existing.args } : {}),
        ...(existing.args === undefined && toolCallArgs(event) !== undefined ? { args: toolCallArgs(event) } : {})
      });
      continue;
    }
    if (type === EventType.TOOL_CALL_RESULT) {
      calls.set(toolCallId, {
        ...existing,
        ...(toolName ? { toolName } : {}),
        result: event.content,
        resultSeq: eventRecord.seq,
        status: isToolResultError(event.content) ? "failed" : "completed"
      });
    }
  }

  const completed = [...calls.values()]
    .filter((call): call is ToolCheckpointCall => call.result !== undefined && call.status !== undefined)
    .sort((a, b) => (a.resultSeq ?? 0) - (b.resultSeq ?? 0));
  if (completed.length === 0) {
    return undefined;
  }

  const maxPayloadChars = Math.max(500, Math.floor(maxChars / Math.max(completed.length, 1)) - 400);
  const blocks = completed.map((call) => [
    `<tool_checkpoint run_id="${escapeAttribute(runId)}" tool_call_id="${escapeAttribute(call.toolCallId)}"`
      + `${call.toolName ? ` tool_name="${escapeAttribute(call.toolName)}"` : ""}`
      + ` status="${call.status}">`,
    "Completed tool observation from a previous run. Reuse this result when it answers the current task; repeat the tool only if the result is stale or insufficient.",
    call.args !== undefined ? `args: ${boundedSerializedValue(call.args, Math.min(1200, maxPayloadChars))}` : undefined,
    `result: ${boundedSerializedValue(call.result, maxPayloadChars)}`,
    "</tool_checkpoint>"
  ].filter((line): line is string => line !== undefined).join("\n"));

  return boundText(blocks.join("\n\n"), maxChars);
};

const toolCallArgs = (event: Record<string, unknown>): unknown => {
  if (event.args !== undefined) {
    return event.args;
  }
  if (event.input !== undefined) {
    return event.input;
  }
  if (typeof event.argsText === "string") {
    return parseJsonValue(event.argsText) ?? event.argsText;
  }
  return undefined;
};

const boundedSerializedValue = (value: unknown, maxChars: number): string =>
  escapeTaggedText(boundText(serializeToolValue(value), maxChars));

const serializeToolValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : {};
};

const parseJsonValue = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const isToolResultError = (value: unknown): boolean =>
  isRecord(value)
    && (value.error === true
      || typeof value.error === "string"
      || typeof value.errorMessage === "string"
      || value.isError === true);

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeTaggedText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const selectBudgetedHistory = (input: {
  currentUserText: string;
  history: ConversationMessageRecord[];
  modelName?: string | undefined;
  policy: Required<ConversationMemoryWindowPolicy>;
  summary?: ConversationSummaryRecord | undefined;
  tokenCounter: ContextTokenCounter;
}): {
  history: ConversationMessageRecord[];
  report: ConversationMemoryWindowReport;
  summary?: ConversationSummaryRecord | undefined;
} => {
  const selected: ConversationMessageRecord[] = [];
  const recent = input.history.slice(-input.policy.maxHistoryMessages).reverse();
  let totalChars = boundText(input.currentUserText, input.policy.maxMessageChars).length;
  let totalTokens = countTextTokens(input.currentUserText, input.tokenCounter, input.modelName);
  let selectedSummary: ConversationSummaryRecord | undefined;
  if (input.summary) {
    const summaryText = summaryToText(input.summary, input.policy.maxMessageChars);
    const nextChars = totalChars + summaryText.length;
    const nextTokens = totalTokens + countTextTokens(summaryText, input.tokenCounter, input.modelName);
    if (nextChars <= input.policy.maxTotalChars && nextTokens <= input.policy.maxHistoryTokens) {
      totalChars = nextChars;
      totalTokens = nextTokens;
      selectedSummary = input.summary;
    }
  }

  for (const record of recent) {
    const bounded = boundText(record.content_text, input.policy.maxMessageChars);
    const nextChars = totalChars + bounded.length;
    const nextTokens = totalTokens + countTextTokens(bounded, input.tokenCounter, input.modelName);
    if (nextChars > input.policy.maxTotalChars || nextTokens > input.policy.maxHistoryTokens) {
      continue;
    }
    totalChars = nextChars;
    totalTokens = nextTokens;
    selected.push(record);
  }

  const ordered = selected.reverse();
  return {
    history: ordered,
    report: {
      availableHistoryMessages: input.history.length,
      droppedHistoryMessages: input.history.length - ordered.length,
      includedSummary: selectedSummary !== undefined,
      maxHistoryMessages: input.policy.maxHistoryMessages,
      maxHistoryTokens: input.policy.maxHistoryTokens,
      maxTotalChars: input.policy.maxTotalChars,
      selectedHistoryMessages: ordered.length,
      selectedHistoryTokens: totalTokens,
      selectedTotalChars: totalChars
    },
    ...(selectedSummary ? { summary: selectedSummary } : {})
  };
};

const normalizePolicy = (
  policy: ConversationMemoryWindowPolicy = {}
): Required<ConversationMemoryWindowPolicy> => ({
  historyLoadLimit: policy.historyLoadLimit ?? DEFAULT_HISTORY_LOAD_LIMIT,
  maxHistoryMessages: policy.maxHistoryMessages ?? DEFAULT_HISTORY_LIMIT,
  maxHistoryTokens: policy.maxHistoryTokens ?? DEFAULT_MAX_HISTORY_TOKENS,
  maxMessageChars: policy.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS,
  maxTotalChars: policy.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS,
  summaryKeepRecentMessages: policy.summaryKeepRecentMessages ?? DEFAULT_SUMMARY_KEEP_RECENT_MESSAGES,
  summaryMaxChars: policy.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS,
  summaryTriggerMessages: policy.summaryTriggerMessages ?? DEFAULT_SUMMARY_TRIGGER_MESSAGES
});

const buildDeterministicSummary = (input: {
  previousSummary?: ConversationSummaryRecord | undefined;
  sourceMessages: ConversationMessageRecord[];
  maxChars: number;
}): string => {
  const parts: string[] = [];
  if (input.previousSummary) {
    parts.push(`Previous summary:\n${input.previousSummary.summary_text.trim()}`);
  }
  parts.push("New summarized turns:");
  input.sourceMessages.forEach((message) => {
    parts.push(`- ${message.role}: ${compactLine(message.content_text)}`);
  });
  return boundText(parts.join("\n"), input.maxChars);
};

const compactLine = (text: string): string => text.replaceAll(/\s+/gu, " ").trim().slice(0, 280);

const countTextTokens = (text: string, tokenCounter: ContextTokenCounter, modelName?: string): number =>
  tokenCounter.countTokensSync(text, modelName) + MESSAGE_TOKEN_OVERHEAD;

const lastUserMessage = (input: RunAgentInput): Extract<Message, { role: "user" }> | undefined =>
  [...input.messages].reverse().find((message): message is Extract<Message, { role: "user" }> =>
    message.role === "user");

const boundText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n[conversation message truncated: original_chars=${text.length}]`;
};

const summaryToMessage = (summary: ConversationSummaryRecord, maxChars: number): Message => ({
  id: `memory-summary:${summary.id}`,
  role: "user",
  content: summaryToText(summary, maxChars)
});

const summaryToText = (summary: ConversationSummaryRecord, maxChars: number): string =>
  `<conversation_summary from_position="${summary.from_position}" to_position="${summary.to_position}">\n`
  + `${boundText(summary.summary_text, maxChars)}\n`
  + "</conversation_summary>";

const shouldInjectMetadataSummary = (source: ConversationCompactMemorySource | undefined): boolean =>
  source !== "mastra-working-memory";

const readEventField = (event: BaseEvent, key: string): unknown => (event as Record<string, unknown>)[key];

const stringValue = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const conversationRole = (value: unknown): AssistantDraft["role"] | undefined => {
  if (value === "assistant" || value === "user" || value === "system" || value === "developer") {
    return value;
  }
  return undefined;
};

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("CONVERSATION_MEMORY_ABORTED");
  }
};
