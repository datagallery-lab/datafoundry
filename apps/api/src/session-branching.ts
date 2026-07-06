import type {
  ConversationMessageRecord,
  ConversationSummaryRecord,
  MetadataStore,
  RunRecord,
  SessionBranchRecord,
  SessionRecord
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

const BRANCHABLE_RUN_STATUSES = new Set<RunRecord["status"]>(["completed", "failed", "canceled"]);

export type VisibleConversationSegment = {
  sessionId: string;
  maxPosition?: number;
};

export type SessionLineage = {
  branch?: SessionBranchRecord;
  segments: VisibleConversationSegment[];
};

export type ConversationBranchOption = {
  createdAt: string;
  forkMessageEndPosition: number;
  forkRunId: string;
  isOriginal: boolean;
  parentSessionId: string;
  rootSessionId: string;
  sessionId: string;
  title?: string;
};

export type CreatedSessionBranch = {
  branch: SessionBranchRecord;
  session: SessionRecord;
};

export function resolveSessionLineage(input: {
  metadataStore: MetadataStore;
  sessionId: string;
  userId: string;
}): SessionLineage {
  return resolveSessionLineageInner(input, new Set<string>());
}

export function listVisibleConversationMessages(input: {
  excludeRunId?: string;
  limit: number;
  lineage: SessionLineage;
  metadataStore: MetadataStore;
  userId: string;
}): ConversationMessageRecord[] {
  const records = input.lineage.segments.flatMap((segment) =>
    input.metadataStore.conversationMessages.listBySessionRange({
      user_id: input.userId,
      session_id: segment.sessionId,
      ...(segment.maxPosition !== undefined ? { max_position: segment.maxPosition } : {}),
      ...(input.excludeRunId ? { exclude_run_id: input.excludeRunId } : {})
    })
  );
  return records.slice(Math.max(0, records.length - Math.max(0, Math.floor(input.limit))));
}

export function latestVisibleConversationSummary(input: {
  lineage: SessionLineage;
  metadataStore: MetadataStore;
  sessionId: string;
  userId: string;
}): ConversationSummaryRecord | undefined {
  if (input.lineage.branch) {
    return undefined;
  }
  return input.metadataStore.conversationSummaries.latest({
    user_id: input.userId,
    session_id: input.sessionId
  });
}

export function createSessionBranch(input: {
  activeSessionId: string;
  metadataStore: MetadataStore;
  runId: string;
  title?: string;
  userId: string;
}): CreatedSessionBranch {
  const activeLineage = resolveSessionLineage({
    metadataStore: input.metadataStore,
    sessionId: input.activeSessionId,
    userId: input.userId
  });
  const run = input.metadataStore.runs.get({ user_id: input.userId, run_id: input.runId });
  const visibleSessionIds = new Set(activeLineage.segments.map((segment) => segment.sessionId));
  if (!visibleSessionIds.has(run.session_id)) {
    throw new Error(`RUN_NOT_VISIBLE:${input.runId}`);
  }
  if (!BRANCHABLE_RUN_STATUSES.has(run.status)) {
    throw new Error(`RUN_NOT_BRANCHABLE:${input.runId}:${run.status}`);
  }

  const runMessages = input.metadataStore.conversationMessages.listBySessionRange({
    user_id: input.userId,
    session_id: run.session_id
  }).filter((message) => message.run_id === run.id);
  const positions = runMessages.map((message) => message.position);
  const forkMessageEndPosition = positions.length > 0 ? Math.min(...positions) - 1 : 0;
  const parentLineage = resolveSessionLineage({
    metadataStore: input.metadataStore,
    sessionId: run.session_id,
    userId: input.userId
  });
  const parentRootSessionId = parentLineage.branch?.root_session_id ?? run.session_id;
  const parentSession = input.metadataStore.sessions.get({
    user_id: input.userId,
    session_id: run.session_id
  });
  const childSessionId = randomUUID();
  const session = input.metadataStore.sessions.create({
    user_id: input.userId,
    id: childSessionId,
    title: input.title?.trim().slice(0, 80) || parentSession.title || "Branched conversation",
    title_source: input.title?.trim() ? "user" : parentSession.title_source ?? "fallback",
    ...(parentSession.selected_datasource_id ? { selected_datasource_id: parentSession.selected_datasource_id } : {}),
    ...(parentSession.selected_collection_id ? { selected_collection_id: parentSession.selected_collection_id } : {})
  });
  const branch = input.metadataStore.sessionBranches.create({
    user_id: input.userId,
    id: `branch:${childSessionId}`,
    child_session_id: childSessionId,
    parent_session_id: run.session_id,
    root_session_id: parentRootSessionId,
    fork_run_id: run.id,
    fork_message_end_position: Math.max(0, forkMessageEndPosition)
  });
  return { branch, session };
}

export function listConversationBranchOptions(input: {
  lineage: SessionLineage;
  metadataStore: MetadataStore;
  sessionId: string;
  userId: string;
}): ConversationBranchOption[] {
  const parentSessionIds = input.lineage.segments.map((segment) => segment.sessionId);
  const childBranches = input.metadataStore.sessionBranches.listChildrenForParents({
    user_id: input.userId,
    parent_session_ids: parentSessionIds
  });
  const activeBranch = input.lineage.branch;
  const branchByKey = new Map<string, ConversationBranchOption>();

  for (const branch of childBranches) {
    const child = safeGetSession(input.metadataStore, input.userId, branch.child_session_id);
    if (!child) {
      continue;
    }
    branchByKey.set(branchOptionKey(branch.child_session_id, branch.fork_run_id), {
      createdAt: branch.created_at,
      forkMessageEndPosition: branch.fork_message_end_position,
      forkRunId: branch.fork_run_id,
      isOriginal: false,
      parentSessionId: branch.parent_session_id,
      rootSessionId: branch.root_session_id,
      sessionId: branch.child_session_id,
      ...(child.title ? { title: child.title } : {})
    });
  }

  if (activeBranch) {
    const activeSession = safeGetSession(input.metadataStore, input.userId, activeBranch.child_session_id);
    if (activeSession) {
      branchByKey.set(branchOptionKey(activeBranch.child_session_id, activeBranch.fork_run_id), {
        createdAt: activeBranch.created_at,
        forkMessageEndPosition: activeBranch.fork_message_end_position,
        forkRunId: activeBranch.fork_run_id,
        isOriginal: false,
        parentSessionId: activeBranch.parent_session_id,
        rootSessionId: activeBranch.root_session_id,
        sessionId: activeBranch.child_session_id,
        ...(activeSession.title ? { title: activeSession.title } : {})
      });
    }
  }

  const originalForks = new Map<string, ConversationBranchOption>();
  for (const option of branchByKey.values()) {
    const parent = safeGetSession(input.metadataStore, input.userId, option.parentSessionId);
    if (!parent) {
      continue;
    }
    originalForks.set(`${option.parentSessionId}:${option.forkRunId}`, {
      createdAt: parent.created_at,
      forkMessageEndPosition: option.forkMessageEndPosition,
      forkRunId: option.forkRunId,
      isOriginal: true,
      parentSessionId: option.parentSessionId,
      rootSessionId: option.rootSessionId,
      sessionId: option.parentSessionId,
      ...(parent.title ? { title: parent.title } : {})
    });
  }

  return [...originalForks.values(), ...branchByKey.values()]
    .sort((left, right) =>
      left.forkRunId.localeCompare(right.forkRunId)
      || Number(right.isOriginal) - Number(left.isOriginal)
      || left.createdAt.localeCompare(right.createdAt)
      || left.sessionId.localeCompare(right.sessionId)
    );
}

export function isRunVisibleInSessionLineage(input: {
  lineage: SessionLineage;
  run: RunRecord;
}): boolean {
  return input.lineage.segments.some((segment) => segment.sessionId === input.run.session_id);
}

function resolveSessionLineageInner(input: {
  metadataStore: MetadataStore;
  sessionId: string;
  userId: string;
}, seen: Set<string>): SessionLineage {
  if (seen.has(input.sessionId)) {
    throw new Error(`SESSION_BRANCH_CYCLE:${input.sessionId}`);
  }
  seen.add(input.sessionId);
  input.metadataStore.sessions.get({ user_id: input.userId, session_id: input.sessionId });
  const branch = input.metadataStore.sessionBranches.findByChild({
    user_id: input.userId,
    child_session_id: input.sessionId
  });
  if (!branch) {
    return { segments: [{ sessionId: input.sessionId }] };
  }
  const parentLineage = resolveSessionLineageInner({
    metadataStore: input.metadataStore,
    sessionId: branch.parent_session_id,
    userId: input.userId
  }, seen);
  const parentSegments = clampLineageAtSession(
    parentLineage.segments,
    branch.parent_session_id,
    branch.fork_message_end_position
  );
  return {
    branch,
    segments: [...parentSegments, { sessionId: input.sessionId }]
  };
}

function clampLineageAtSession(
  segments: VisibleConversationSegment[],
  sessionId: string,
  maxPosition: number
): VisibleConversationSegment[] {
  const index = segments.findIndex((segment) => segment.sessionId === sessionId);
  if (index < 0) {
    throw new Error(`SESSION_BRANCH_PARENT_NOT_VISIBLE:${sessionId}`);
  }
  return segments.slice(0, index + 1).map((segment, segmentIndex) => {
    if (segmentIndex !== index) {
      return segment;
    }
    return {
      sessionId: segment.sessionId,
      maxPosition: segment.maxPosition === undefined
        ? maxPosition
        : Math.min(segment.maxPosition, maxPosition)
    };
  });
}

function safeGetSession(
  metadataStore: MetadataStore,
  userId: string,
  sessionId: string
): SessionRecord | undefined {
  try {
    return metadataStore.sessions.get({ user_id: userId, session_id: sessionId });
  } catch {
    return undefined;
  }
}

function branchOptionKey(sessionId: string, forkRunId: string): string {
  return `${sessionId}:${forkRunId}`;
}
