import type { ProcessLLMRequestArgs, ProcessLLMRequestResult, Processor } from "@mastra/core/processors";

import { ModelContextProfileRegistry } from "../../policy/model-context-profile.js";
import { PromptTokenCounter } from "../../policy/prompt-token-counter.js";
import type { ContextProtocolEventSink } from "../context-protocol-event-sink.js";

export type MastraProviderPromptGuardProcessorOptions = {
  eventSink: ContextProtocolEventSink;
  modelName: string | undefined;
  profileRegistry?: ModelContextProfileRegistry;
  tokenCounter?: PromptTokenCounter;
};

export class MastraProviderPromptGuardProcessor implements Processor<"provider-prompt-guard"> {
  readonly id = "provider-prompt-guard";
  readonly name = "Provider Prompt Guard";
  private readonly profileRegistry: ModelContextProfileRegistry;
  private readonly tokenCounter: PromptTokenCounter;

  constructor(private readonly options: MastraProviderPromptGuardProcessorOptions) {
    this.profileRegistry = options.profileRegistry ?? new ModelContextProfileRegistry();
    this.tokenCounter = options.tokenCounter ?? new PromptTokenCounter();
  }

  processLLMRequest(args: ProcessLLMRequestArgs): ProcessLLMRequestResult {
    const profile = this.profileRegistry.resolve(this.options.modelName);
    const promptTokens = this.tokenCounter.countProviderPrompt(args.prompt, this.options.modelName);
    const inputBudget = Math.max(profile.contextWindow - profile.outputReserve - profile.safetyMargin, 0);
    const remainingTokens = inputBudget - promptTokens;
    this.options.eventSink.emitContextEvent("context.prompt-verified", {
      step_number: args.stepNumber,
      model_profile_id: profile.id,
      prompt_tokens: promptTokens,
      input_budget: inputBudget,
      remaining_tokens: remainingTokens
    });

    if (promptTokens > inputBudget) {
      args.abort("CONTEXT_FINAL_PROMPT_EXCEEDS_BUDGET", {
        metadata: { inputBudget, promptTokens, stepNumber: args.stepNumber }
      });
    }

    return undefined;
  }
}
