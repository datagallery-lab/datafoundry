import { createOpenAI } from "@ai-sdk/openai";
import { createEnvConfig } from "@datafoundry/contracts";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export const DEFAULT_MODEL_CONNECT_TIMEOUT_MS = 30_000;
const MIN_MODEL_CONNECT_TIMEOUT_MS = 1_000;
const MAX_MODEL_CONNECT_TIMEOUT_MS = 120_000;

const modelFetchTransports = new Map<number, typeof globalThis.fetch>();

export type ChatProviderConfig = {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
  connect_timeout_ms?: number;
};

export type EmbeddingProviderConfig = {
  provider: string;
  model: string;
  base_url: string;
  embedding_dim: number;
  output_type: "dense";
  api_key?: string;
};

export type ModelProvider =
  | {
      kind: "openai-compatible";
      connect_timeout_ms: number;
      model_name: string;
      model: unknown;
      prompt_compat?: ModelPromptCompatibility;
    }
  | {
      kind: "mock";
      model_name: string;
    };

export type ModelPromptCompatibility = {
  requires_non_empty_message_content?: boolean;
};

export const createModelProvider = (env: Record<string, string | undefined>): ModelProvider => {
  const config = createEnvConfig(env);
  return createModelProviderFromConfig({
    provider: config.llm.provider,
    model: config.llm.model,
    base_url: config.llm.base_url,
    connect_timeout_ms: config.llm.connect_timeout_ms,
    ...(config.llm.api_key ? { api_key: config.llm.api_key } : {})
  });
};

/** Create one model provider from a persisted model-profile configuration. */
export const createModelProviderFromConfig = (config: ChatProviderConfig): ModelProvider => {
  const providerName = normalizeChatProviderName(config.provider);
  if (!providerName) {
    throw new Error(`PROVIDER_UNSUPPORTED:${config.provider}`);
  }

  if (!config.api_key) {
    return {
      kind: "mock",
      model_name: config.model
    };
  }

  const connectTimeoutMs = normalizeModelConnectTimeoutMs(config.connect_timeout_ms);
  const provider = createOpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    fetch: modelFetchTransport(connectTimeoutMs)
  });
  const promptCompat = resolvePromptCompatibility(config);

  return {
    kind: "openai-compatible",
    connect_timeout_ms: connectTimeoutMs,
    model_name: config.model,
    model: provider.chat(config.model),
    ...(promptCompat ? { prompt_compat: promptCompat } : {})
  };
};

/** Keep provider connects above Undici's 10s default while bounding bad config. */
export const normalizeModelConnectTimeoutMs = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MODEL_CONNECT_TIMEOUT_MS;
  }
  return Math.max(
    MIN_MODEL_CONNECT_TIMEOUT_MS,
    Math.min(MAX_MODEL_CONNECT_TIMEOUT_MS, Math.floor(value))
  );
};

const modelFetchTransport = (connectTimeoutMs: number): typeof globalThis.fetch => {
  const cached = modelFetchTransports.get(connectTimeoutMs);
  if (cached) {
    return cached;
  }

  const dispatcher = new EnvHttpProxyAgent({ connectTimeout: connectTimeoutMs });
  const fetchTransport: typeof globalThis.fetch = (input, init) =>
    undiciFetch(input as never, {
      ...(init as object),
      dispatcher
    } as never) as unknown as Promise<Response>;
  modelFetchTransports.set(connectTimeoutMs, fetchTransport);
  return fetchTransport;
};

const normalizeChatProviderName = (provider: string): "openai-compatible" | undefined => {
  const normalized = provider.trim().toLowerCase().replaceAll("_", "-");
  if (
    normalized === "openai-compatible"
    || normalized === "bailian"
    || normalized === "deepseek"
    || normalized === "openai"
  ) {
    return "openai-compatible";
  }

  return undefined;
};

const resolvePromptCompatibility = (config: ChatProviderConfig): ModelPromptCompatibility | undefined => {
  const normalizedProvider = config.provider.trim().toLowerCase().replaceAll("_", "-");
  const normalizedBaseUrl = config.base_url.trim().toLowerCase();
  const requiresNonEmptyMessageContent =
    normalizedProvider === "bailian"
    || normalizedBaseUrl.includes("dashscope.aliyuncs.com");

  return requiresNonEmptyMessageContent
    ? { requires_non_empty_message_content: true }
    : undefined;
};
