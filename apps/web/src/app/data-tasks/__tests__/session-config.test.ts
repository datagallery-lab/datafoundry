import { describe, expect, it } from "vitest";
import {
  applyAutoTitle,
  createChatSession,
  dedupeChatSessions,
  deleteChatSession,
  deriveSnippetTitle,
  emptyPerRunSelection,
  getSessionDisabled,
  prunePerRunSelection,
  renameChatSession,
  sessionEnabledIds,
  sessionResourceCounts,
  sortChatSessions,
  togglePinChatSession,
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

  it("tracks manual session renames as user-authored titles", () => {
    const session = createChatSession();
    const renamed = renameChatSession([session], session.id, "订单分析")[0];

    expect(renamed.title).toBe("订单分析");
    expect(renamed.titleSource).toBe("user");
  });

  it("lets llm titles replace default or snippet titles but not user titles", () => {
    const session = createChatSession();
    const snippet = applyAutoTitle([session], session.id, "订单趋势", "auto-snippet")[0];
    expect(snippet.title).toBe("订单趋势");
    expect(snippet.titleSource).toBe("auto-snippet");

    const llm = applyAutoTitle([snippet], session.id, "渠道订单分析", "llm")[0];
    expect(llm.title).toBe("渠道订单分析");
    expect(llm.titleSource).toBe("llm");

    const user = renameChatSession([llm], session.id, "我的复盘")[0];
    const unchanged = applyAutoTitle([user], session.id, "模型新标题", "llm")[0];
    expect(unchanged.title).toBe("我的复盘");
    expect(unchanged.titleSource).toBe("user");
  });

  it("derives compact snippet titles from the first user question", () => {
    expect(deriveSnippetTitle("  帮我分析一下\n最近 30 天不同渠道的订单走势和异常原因  ")).toBe(
      "帮我分析一下 最近 30 天不同渠道的订单走势…",
    );
    expect(deriveSnippetTitle("")).toBe("新数据任务");
  });

  it("deletes sessions and keeps pinned sessions ahead of others", () => {
    const first = { ...createChatSession("A"), pinned: true };
    const second = createChatSession("B");
    const third = createChatSession("C");

    expect(deleteChatSession([first, second, third], second.id)).toEqual([
      first,
      third,
    ]);
    expect(togglePinChatSession([first, second], second.id)[1]?.pinned).toBe(true);
    expect(togglePinChatSession([first, second], second.id)[1]?.pinnedAt).toBeTypeOf(
      "number",
    );
    expect(sortChatSessions([second, first]).map((session) => session.title)).toEqual([
      "A",
      "B",
    ]);
    const pinnedFirst = {
      ...createChatSession("Pinned first"),
      pinned: true,
      pinnedAt: 100,
    };
    const pinnedSecond = {
      ...createChatSession("Pinned second"),
      pinned: true,
      pinnedAt: 200,
    };
    expect(
      sortChatSessions([pinnedFirst, pinnedSecond]).map((session) => session.title),
    ).toEqual(["Pinned second", "Pinned first"]);
  });
});
