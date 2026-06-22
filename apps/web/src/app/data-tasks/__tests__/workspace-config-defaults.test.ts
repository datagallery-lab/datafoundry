import { describe, expect, it } from "vitest";
import {
  getEnabledLlmItems,
  summarizeConfigItems,
  summarizeLlmItems,
  summarizeMcpItems,
  type WorkspaceConfigStore,
} from "../data-task-state";

describe("workspace config defaults", () => {
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
          name: "服务端默认",
          description: "Server env",
          enabled: false,
          settings: { modelName: "qwen-plus" },
        },
      ],
    };

    expect(getEnabledLlmItems(workspaceConfig).map((item) => item.id)).toEqual([
      "server-default",
    ]);
    expect(summarizeLlmItems(workspaceConfig.llm, "未配置")).toBe("qwen-plus");
  });
});
