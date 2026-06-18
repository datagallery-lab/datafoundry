import { createOpenAI } from "@ai-sdk/openai";
import { createEnvConfig } from "@open-data-agent/contracts";

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
  const providerName = config.llm.provider.toLowerCase();

  if (!config.llm.api_key) {
    return {
      kind: "mock",
      model_name: config.llm.model
    };
  }

  if (!isOpenAiCompatibleProvider(providerName)) {
    const modelId = normalizeMastraRouterModelId(providerName, config.llm.model);

    return {
      kind: "mastra-router",
      model_name: modelId,
      model: {
        id: modelId,
        url: config.llm.base_url,
        apiKey: config.llm.api_key
      }
    };
  }

  const provider = createOpenAI({
    apiKey: config.llm.api_key,
    baseURL: config.llm.base_url
  });

  return {
    kind: "openai-compatible",
    model_name: config.llm.model,
    model: provider.chat(config.llm.model)
  };
};

const normalizeMastraRouterModelId = (provider: string, model: string): string =>
  model.includes("/") ? model : `${provider}/${model}`;

const isOpenAiCompatibleProvider = (provider: string): boolean =>
  provider === "openai-compatible" || provider === "openai_compatible" || provider === "bailian";
