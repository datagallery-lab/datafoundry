import { describe, expect, it } from "vitest";
import {
  createChatSession,
  dedupeChatSessions,
  emptyPerRunSelection,
  getSessionDisabled,
  prunePerRunSelection,
  sessionEnabledIds,
  sessionResourceCounts,
  togglePerRunMention,
  toggleSessionResource,
  type WorkspaceConfigStore,
} from "../data-task-state";

function item(id: string, name = id) {
  return { id, name, description: `${name} desc`, enabled: true };
}

const store: WorkspaceConfigStore = {
  db: [item("db-default"), item("db-orders")],
  kb: [item("kb-docs")],
  mcp: [item("mcp-fs")],
  skill: [item("skill-a"), item("skill-b")],
  llm: [item("llm-1")],
};

describe("session config disabled map", () => {
  it("defaults to all enabled when config is omitted", () => {
    const session = createChatSession();
    expect(getSessionDisabled(session)).toEqual({
      db: [],
      kb: [],
      mcp: [],
      skill: [],
    });
    expect(sessionEnabledIds(store, "db", session)).toEqual([
      "db-default",
      "db-orders",
    ]);
  });

  it("toggleSessionResource adds and removes disabled ids idempotently", () => {
    let session = createChatSession();
    session = toggleSessionResource(session, "db", "db-orders");
    expect(getSessionDisabled(session).db).toEqual(["db-orders"]);
    expect(sessionEnabledIds(store, "db", session)).toEqual(["db-default"]);

    session = toggleSessionResource(session, "db", "db-orders");
    expect(getSessionDisabled(session).db).toEqual([]);
    expect(sessionEnabledIds(store, "db", session)).toEqual([
      "db-default",
      "db-orders",
    ]);
  });

  it("sessionResourceCounts reflects enabled vs total", () => {
    let session = createChatSession();
    expect(sessionResourceCounts(store, "db", session)).toEqual({
      enabled: 2,
      total: 2,
    });
    session = toggleSessionResource(session, "db", "db-default");
    expect(sessionResourceCounts(store, "db", session)).toEqual({
      enabled: 1,
      total: 2,
    });
  });

  it("prunePerRunSelection drops mentions disabled in session", () => {
    let session = createChatSession();
    session = toggleSessionResource(session, "db", "db-orders");
    let selection = emptyPerRunSelection();
    selection = togglePerRunMention(selection, "db", "db-orders");
    selection = togglePerRunMention(selection, "db", "db-default");
    const pruned = prunePerRunSelection(store, session, selection);
    expect(pruned.db).toEqual(["db-default"]);
  });

  it("deduplicates stored sessions by session and thread id", () => {
    const first = { ...createChatSession("A"), id: "same", threadId: "same" };
    const duplicateId = { ...createChatSession("B"), id: "same", threadId: "thread-b" };
    const duplicateThread = { ...createChatSession("C"), id: "id-c", threadId: "same" };
    const unique = { ...createChatSession("D"), id: "id-d", threadId: "thread-d" };

    expect(dedupeChatSessions([first, duplicateId, duplicateThread, unique])).toEqual([
      first,
      unique,
    ]);
  });
});
