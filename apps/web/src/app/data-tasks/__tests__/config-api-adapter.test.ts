import { describe, expect, it } from "vitest";
import {
  datasourceDtoToItem,
  itemToCreateBody,
  itemToPatchBody,
  workspaceConfigDtoToStore,
} from "../../../lib/config-api/adapter";

describe("config api adapter", () => {
  it("maps datasource dto into workspace item settings", () => {
    const item = datasourceDtoToItem({
      id: "sales-pg",
      name: "Sales PG",
      description: "Readonly",
      type: "postgresql",
      config: {
        host: "127.0.0.1",
        port: 5432,
        database: "sales",
        queryPolicy: { maxRows: 500, timeoutMs: 5000 },
      },
      hasSecret: true,
      defaultEnabled: true,
      connectionStatus: "connected",
      revision: 2,
    });

    expect(item.settings?.host).toBe("127.0.0.1");
    expect(item.settings?.maxRows).toBe("500");
    expect(item.hasSecret).toBe(true);
    expect(item.revision).toBe(2);
  });

  it("builds create body with credentials separated from config", () => {
    const body = itemToCreateBody("db", {
      id: "sales-pg",
      name: "Sales PG",
      description: "",
      enabled: true,
      settings: {
        datasourceId: "sales-pg",
        type: "postgresql",
        host: "127.0.0.1",
        port: "5432",
        database: "sales",
        username: "readonly",
        password: "secret",
      },
    });

    expect(body.credentials).toEqual({ password: "secret" });
    expect(body.config).toMatchObject({
      host: "127.0.0.1",
      database: "sales",
    });
    expect(JSON.stringify(body.config)).not.toContain("secret");
  });

  it("includes revision on patch body", () => {
    const body = itemToPatchBody("llm", {
      id: "deepseek",
      name: "DeepSeek",
      description: "",
      enabled: true,
      revision: 4,
      settings: { modelName: "deepseek-chat" },
    });

    expect(body.revision).toBe(4);
  });

  it("maps workspace config dto to store buckets", () => {
    const store = workspaceConfigDtoToStore({
      datasources: [],
      knowledgeBases: [
        {
          id: "metrics-docs",
          name: "Metrics",
          retrievalTopK: 8,
          scoreThreshold: 0.2,
          defaultEnabled: true,
          indexStatus: "ready",
        },
      ],
      mcpServers: [],
      modelProfiles: [],
      skills: [],
    });

    expect(store.kb).toHaveLength(1);
    expect(store.kb[0]?.settings?.retrievalTopK).toBe("8");
  });

  it("builds kb create body with embedding fields", () => {
    const body = itemToCreateBody("kb", {
      id: "metrics-docs",
      name: "Metrics",
      description: "",
      enabled: true,
      settings: {
        indexName: "metrics-docs",
        retrievalTopK: "8",
        scoreThreshold: "0.2",
        embeddingProvider: "bailian",
        embeddingModel: "text-embedding-v4",
        embeddingBaseUrl: "https://example.com/v1",
        embeddingApiKey: "emb-secret",
      },
    });

    expect(body.embeddingProvider).toBe("bailian");
    expect(body.embeddingModel).toBe("text-embedding-v4");
    expect(body.credentials).toEqual({ apiKey: "emb-secret" });
  });

  it("builds mcp create body with auth type and token", () => {
    const body = itemToCreateBody("mcp", {
      id: "notion",
      name: "Notion",
      description: "",
      enabled: true,
      settings: {
        transport: "sse",
        serverUrl: "https://example.com/mcp/sse",
        authType: "bearer",
        apiKey: "token-value",
      },
    });

    expect(body.authType).toBe("bearer");
    expect(body.credentials).toEqual({ token: "token-value" });
  });
});
