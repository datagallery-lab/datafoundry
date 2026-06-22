import type { ProcessLLMRequestArgs, ProcessLLMRequestResult, Processor } from "@mastra/core/processors";

import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";
import { ModelContextProfileRegistry } from "./model-context-profile.js";
import { PromptTokenCounter } from "./prompt-token-counter.js";

export type ProviderPromptGuardProcessorOptions = {
  emitter: AgUiEventEmitter;
  modelName: string | undefined;
  profileRegistry?: ModelContextProfileRegistry;
  tokenCounter?: PromptTokenCounter;
};

export class ProviderPromptGuardProcessor implements Processor<"provider-prompt-guard"> {
  readonly id = "provider-prompt-guard";
  readonly name = "Provider Prompt Guard";
  private readonly profileRegistry: ModelContextProfileRegistry;
  private readonly tokenCounter: PromptTokenCounter;

  constructor(private readonly options: ProviderPromptGuardProcessorOptions) {
    this.profileRegistry = options.profileRegistry ?? new ModelContextProfileRegistry();
    this.tokenCounter = options.tokenCounter ?? new PromptTokenCounter();
  }

  processLLMRequest(args: ProcessLLMRequestArgs): ProcessLLMRequestResult {
    const profile = this.profileRegistry.resolve(this.options.modelName);
    const promptTokens = this.tokenCounter.countProviderPrompt(args.prompt, this.options.modelName);
    const inputBudget = Math.max(profile.contextWindow - profile.outputReserve - profile.safetyMargin, 0);
    const remainingTokens = inputBudget - promptTokens;
    this.options.emitter.emit(createCustomEvent("context.prompt-verified", {
      step_number: args.stepNumber,
      model_profile_id: profile.id,
      prompt_tokens: promptTokens,
      input_budget: inputBudget,
      remaining_tokens: remainingTokens
    }));

    if (promptTokens > inputBudget) {
      args.abort("CONTEXT_FINAL_PROMPT_EXCEEDS_BUDGET", {
        metadata: { inputBudget, promptTokens, stepNumber: args.stepNumber }
      });
    }

    return undefined;
  }
}
