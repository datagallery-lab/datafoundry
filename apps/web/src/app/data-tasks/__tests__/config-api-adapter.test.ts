import { afterEach, describe, expect, it, vi } from "vitest";
import {
  datasourceDtoToItem,
  itemToCreateBody,
  itemToPatchBody,
  mcpServerDtoToItem,
  workspaceConfigDtoToStore,
} from "../../../lib/config-api/adapter";
import { configApi } from "../../../lib/config-api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_CONFIG_API_URL;
});

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
        secure: "true",
      },
    });

    expect(body.credentials).toEqual({ password: "secret" });
    expect(body.config).toMatchObject({
      host: "127.0.0.1",
      database: "sales",
      secure: true,
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

  it("builds llm advanced sampling body", () => {
    const body = itemToCreateBody("llm", {
      id: "qwen-long",
      name: "Qwen Long",
      description: "",
      enabled: true,
      settings: {
        provider: "openai-compatible",
        modelName: "qwen-long",
        baseUrl: "https://example.com/v1",
        contextLength: "128000",
        reasoningModel: "true",
      },
    });

    expect(body.contextLength).toBe(128000);
    expect(body.reasoningModel).toBe(true);
  });

  it("maps workspace config dto to store buckets", () => {
    const store = workspaceConfigDtoToStore({
      datasources: [],
      knowledgeBases: [
        {
          id: "metrics-docs",
          name: "Metrics",
          chunkOverlap: 64,
          chunkSize: 1200,
          citationRequired: false,
          retrievalTopK: 8,
          scoreThreshold: 0.2,
          scope: "project",
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
    expect(store.kb[0]?.settings?.chunkSize).toBe("1200");
    expect(store.kb[0]?.settings?.chunkOverlap).toBe("64");
    expect(store.kb[0]?.settings?.citationRequired).toBe("false");
    expect(store.kb[0]?.settings?.scope).toBe("project");
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
        chunkSize: "1200",
        chunkOverlap: "64",
        citationRequired: "true",
        scope: "workspace",
        embeddingProvider: "bailian",
        embeddingModel: "text-embedding-v4",
        embeddingBaseUrl: "https://example.com/v1",
        embeddingApiKey: "emb-secret",
      },
    });

    expect(body.embeddingProvider).toBe("bailian");
    expect(body.embeddingModel).toBe("text-embedding-v4");
    expect(body.chunkSize).toBe(1200);
    expect(body.chunkOverlap).toBe(64);
    expect(body.citationRequired).toBe(true);
    expect(body.scope).toBe("workspace");
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
        toolAllowlist: "search, fetch_page",
        timeoutMs: "45000",
      },
    });

    expect(body.authType).toBe("bearer");
    expect(body.toolAllowlist).toEqual(["search", "fetch_page"]);
    expect(body.timeoutMs).toBe(45000);
    expect(body.credentials).toEqual({ token: "token-value" });
  });

  it("builds mcp patch body with tool policy fields", () => {
    const body = itemToPatchBody("mcp", {
      id: "notion",
      name: "Notion",
      description: "",
      enabled: true,
      settings: {
        transport: "sse",
        serverUrl: "https://example.com/mcp/sse",
        authType: "bearer",
        toolAllowlist: "search, fetch_page",
        timeoutMs: "45000",
      },
    });

    expect(body.toolAllowlist).toEqual(["search", "fetch_page"]);
    expect(body.timeoutMs).toBe(45000);
  });

  it("builds mcp stdio create body with command args cwd env", () => {
    const body = itemToCreateBody("mcp", {
      id: "local-fs",
      name: "Local FS",
      description: "",
      enabled: true,
      settings: {
        transport: "stdio",
        serverUrl: "",
        command: "/usr/bin/npx",
        args: "-y @modelcontextprotocol/server-filesystem /data",
        cwd: "/home/agent",
        env: '{ "NODE_ENV": "production" }',
      },
    });

    expect(body.transport).toBe("stdio");
    expect(body.command).toBe("/usr/bin/npx");
    expect(body.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/data",
    ]);
    expect(body.cwd).toBe("/home/agent");
    expect(body.env).toEqual({ NODE_ENV: "production" });
  });

  it("maps stdio mcp dto fields into workspace item settings", () => {
    const item = mcpServerDtoToItem({
      id: "local-fs",
      name: "Local FS",
      transport: "stdio",
      command: "/usr/bin/npx",
      args: ["-y", "pkg"],
      cwd: "/tmp",
      env: { FOO: "bar" },
    });

    expect(item.settings?.command).toBe("/usr/bin/npx");
    expect(item.settings?.args).toBe("-y pkg");
    expect(item.settings?.cwd).toBe("/tmp");
    expect(item.settings?.env).toContain("FOO");
  });

  it("builds skill resource binding bodies", () => {
    const item = {
      id: "sales-skill",
      name: "Sales Skill",
      description: "",
      enabled: true,
      revision: 3,
      settings: {
        defaultDbIds: "sales-pg, finance-pg",
        defaultKbIds: "sales-docs",
        defaultMcpIds: "notion",
        modelProfileId: "qwen-plus",
      },
    };

    expect(itemToCreateBody("skill", item)).toMatchObject({
      defaultDbIds: ["sales-pg", "finance-pg"],
      defaultKbIds: ["sales-docs"],
      defaultMcpIds: ["notion"],
      modelProfileId: "qwen-plus",
    });
    expect(itemToPatchBody("skill", item)).toMatchObject({
      defaultDbIds: ["sales-pg", "finance-pg"],
      defaultKbIds: ["sales-docs"],
      defaultMcpIds: ["notion"],
      modelProfileId: "qwen-plus",
      revision: 3,
    });
  });

  it("loads server authoritative session conversation through the config client", async () => {
    process.env.NEXT_PUBLIC_CONFIG_API_URL = "http://config.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        sessionId: "thread-1",
        messages: [{ id: "run-1:user", runId: "run-1", role: "user", source: "client", contentText: "hi", position: 1, createdAt: "now" }],
        runEventRefs: [{ runId: "run-1", eventCount: 3 }],
        toolCalls: [{ runId: "run-1", toolCallId: "call-1", status: "completed", toolName: "inspect_schema" }],
      },
    }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const conversation = await configApi.getSessionConversation("thread-1", 25);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://config.test/api/v1/sessions/thread-1/conversation?limit=25",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
    expect(conversation.sessionId).toBe("thread-1");
    expect(conversation.messages[0]?.contentText).toBe("hi");
    expect(conversation.toolCalls[0]?.toolName).toBe("inspect_schema");
  });
});
