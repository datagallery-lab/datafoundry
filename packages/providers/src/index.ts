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
      kind: "mastra-router";
      model_name: string;
      model: unknown;
    }
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
  const providerName = config.provider.toLowerCase();

  if (!config.api_key) {
    return {
      kind: "mock",
      model_name: config.model
    };
  }

  if (!isOpenAiCompatibleProvider(providerName)) {
    const modelId = normalizeMastraRouterModelId(providerName, config.model);

    return {
      kind: "mastra-router",
      model_name: modelId,
      model: {
        id: modelId,
        url: config.base_url,
        apiKey: config.api_key
      }
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

const normalizeMastraRouterModelId = (provider: string, model: string): string =>
  model.includes("/") ? model : `${provider}/${model}`;

const isOpenAiCompatibleProvider = (provider: string): boolean =>
  provider === "openai-compatible" || provider === "openai_compatible" || provider === "bailian";
