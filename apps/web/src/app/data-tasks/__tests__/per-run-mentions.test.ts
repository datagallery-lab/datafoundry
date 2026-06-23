import { describe, expect, it } from "vitest";
import {
  buildMentionResources,
  buildRunConfig,
  countPerRunMentions,
  createChatSession,
  emptyPerRunSelection,
  removePerRunMention,
  resolveActiveDatasourceId,
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

const session = createChatSession();

describe("per-run mention selection", () => {
  it("toggles ids on and off per kind without touching others", () => {
    let selection = emptyPerRunSelection();
    selection = togglePerRunMention(selection, "db", "db-orders");
    selection = togglePerRunMention(selection, "skill", "skill-b");
    expect(selection.db).toEqual(["db-orders"]);
    expect(selection.skill).toEqual(["skill-b"]);
    expect(countPerRunMentions(selection)).toBe(2);

    selection = togglePerRunMention(selection, "db", "db-orders");
    expect(selection.db).toEqual([]);
    expect(countPerRunMentions(selection)).toBe(1);
  });

  it("removePerRunMention is idempotent", () => {
    const selection = togglePerRunMention(
      emptyPerRunSelection(),
      "kb",
      "kb-docs",
    );
    const removed = removePerRunMention(selection, "kb", "kb-docs");
    expect(removed.kb).toEqual([]);
    expect(removePerRunMention(removed, "kb", "kb-docs").kb).toEqual([]);
  });

  it("lists only session-enabled resources for @ picker", () => {
    const narrowed = toggleSessionResource(session, "db", "db-orders");
    const resources = buildMentionResources(store, narrowed);
    expect(resources).toHaveLength(5); // db(1)+kb(1)+mcp(1)+skill(2)
    expect(resources.some((r) => r.id === "db-orders")).toBe(false);
    const db = resources.find((r) => r.id === "db-default");
    const kb = resources.find((r) => r.id === "kb-docs");
    expect(db?.backendSupported).toBe(true);
    expect(kb?.backendSupported).toBe(false);
    expect(resources.some((r) => r.kind === "llm")).toBe(false);
  });
});

describe("buildRunConfig", () => {
  it("sends session-enabled ids when there is no @ selection", () => {
    const config = buildRunConfig(store, {
      activeLlmId: "llm-1",
      defaultDatasourceId: "db-default",
      session,
    });
    expect(config.enabledDatasourceIds).toEqual(["db-default", "db-orders"]);
    expect(config.enabledSkillIds).toEqual(["skill-a", "skill-b"]);
    expect(config.activeDatasourceId).toBe("db-default");
    expect(config.activeLlmProfileId).toBe("llm-1");
    expect(config.mentioned).toEqual(emptyPerRunSelection());
  });

  it("keeps enabled*Ids as full session set while @ sets active/mentioned only", () => {
    let selection = emptyPerRunSelection();
    selection = togglePerRunMention(selection, "db", "db-orders");
    selection = togglePerRunMention(selection, "skill", "skill-b");
    const config = buildRunConfig(store, {
      activeLlmId: "llm-1",
      defaultDatasourceId: "db-default",
      session,
      perRunSelection: selection,
    });
    // enabled stays full session set — @ does not narrow availability
    expect(config.enabledDatasourceIds).toEqual(["db-default", "db-orders"]);
    expect(config.enabledSkillIds).toEqual(["skill-a", "skill-b"]);
    expect(config.enabledKnowledgeIds).toEqual(["kb-docs"]);
    // active + mentioned reflect @ picks
    expect(config.activeDatasourceId).toBe("db-orders");
    expect(config.activeSkillId).toBe("skill-b");
    expect(config.mentioned.db).toEqual(["db-orders"]);
    expect(config.mentioned.skill).toEqual(["skill-b"]);
  });

  it("narrows enabled*Ids when session disables resources", () => {
    const narrowed = toggleSessionResource(session, "db", "db-default");
    const config = buildRunConfig(store, {
      activeLlmId: "llm-1",
      defaultDatasourceId: "db-default",
      session: narrowed,
    });
    expect(config.enabledDatasourceIds).toEqual(["db-orders"]);
    expect(config.activeDatasourceId).toBe("db-orders");
  });
});

describe("resolveActiveDatasourceId", () => {
  it("uses the first valid @db within session-enabled set, else fallback", () => {
    const selection = togglePerRunMention(
      emptyPerRunSelection(),
      "db",
      "db-orders",
    );
    expect(
      resolveActiveDatasourceId(store, session, selection, "db-default"),
    ).toBe("db-orders");
    expect(
      resolveActiveDatasourceId(
        store,
        session,
        emptyPerRunSelection(),
        "db-default",
      ),
    ).toBe("db-default");
  });

  it("ignores @db mentions disabled in session", () => {
    const narrowed = toggleSessionResource(session, "db", "db-orders");
    const selection = togglePerRunMention(
      emptyPerRunSelection(),
      "db",
      "db-orders",
    );
    expect(
      resolveActiveDatasourceId(store, narrowed, selection, "db-default"),
    ).toBe("db-default");
  });
});
