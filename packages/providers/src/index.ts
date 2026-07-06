import { createOpenAI } from "@ai-sdk/openai";
import { createEnvConfig } from "@datafoundry/contracts";

export type ChatProviderConfig = {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
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
      model_name: string;
      model: unknown;
    }
  | {
      kind: "mock";
      model_name: string;
    };

export const createModelProvider = (env: Record<string, string | undefined>): ModelProvider => {
  const config = createEnvConfig(env);
  return createModelProviderFromConfig({
    provider: config.llm.provider,
    model: config.llm.model,
    base_url: config.llm.base_url,
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

  const provider = createOpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url
  });

  return {
    kind: "openai-compatible",
    model_name: config.model,
    model: provider.chat(config.model)
  };
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
