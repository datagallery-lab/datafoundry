import { describe, expect, it } from "vitest";
import {
  defaultWorkspaceConfig,
  getEnabledLlmItems,
  resolveActiveLlmProfileId,
  summarizeConfigItems,
  summarizeLlmItems,
  summarizeMcpItems,
  type WorkspaceConfigStore,
} from "../data-task-state";

describe("workspace config defaults", () => {
  it("starts with empty lists instead of hardcoded builtin demo/server-default", () => {
    expect(defaultWorkspaceConfig()).toEqual({
      db: [],
      kb: [],
      mcp: [],
      llm: [],
      skill: [],
    });
  });

  it("summarizes configured items as default available even if legacy enabled is false", () => {
    const item = {
      id: "db-1",
      name: "Orders DB",
      description: "Read-only warehouse",
      enabled: false,
    };

    expect(summarizeConfigItems([item], "未配置")).toBe("Orders DB");
    expect(summarizeMcpItems([item], "未配置")).toBe("Orders DB");
  });

  it("keeps llm profiles available even if legacy enabled is false", () => {
    const workspaceConfig: WorkspaceConfigStore = {
      db: [],
      kb: [],
      mcp: [],
      skill: [],
      llm: [
        {
          id: "server-default",
          name: "default",
          description: "Server env",
          enabled: false,
          settings: { modelName: "qwen-plus" },
        },
      ],
    };

    expect(getEnabledLlmItems(workspaceConfig).map((item) => item.id)).toEqual([
      "server-default",
    ]);
    expect(summarizeLlmItems(workspaceConfig.llm, "未配置")).toBe("default");
  });
});

describe("active LLM selection", () => {
  it("keeps a valid dialog selection instead of restoring the workspace default", () => {
    const profiles = [
      { id: "server-default", name: "default", description: "", enabled: true },
      { id: "profile-b", name: "Profile B", description: "", enabled: true },
    ];

    expect(
      resolveActiveLlmProfileId(profiles, "profile-b", "server-default"),
    ).toBe("profile-b");
  });

  it("returns null when no profiles are available", () => {
    expect(resolveActiveLlmProfileId([], null, "server-default")).toBeNull();
    expect(resolveActiveLlmProfileId([], "stale-id", null)).toBeNull();
  });
});
