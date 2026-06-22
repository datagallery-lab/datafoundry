import type { MastraDBMessage } from "@mastra/core/agent";

import type { ModelContextProfile } from "./model-context-profile.js";
import { TokenCounter } from "./token-counter.js";

export type PromptTokenReport = {
  systemTokens: number;
  toolTokens: number;
  messageTokens: number;
  totalInputTokens: number;
  inputBudget: number;
  remainingTokens: number;
  countQuality: "cached-tokenizer" | "estimated";
};

export class PromptTokenCounter {
  constructor(private readonly tokenCounter: TokenCounter = new TokenCounter()) {}

  count(input: {
    systemMessages: unknown[];
    tools?: Record<string, unknown>;
    messages: MastraDBMessage[];
    modelName: string | undefined;
    profile: ModelContextProfile;
  }): PromptTokenReport {
    const systemTokens = this.countValue(input.systemMessages, input.modelName)
      + input.systemMessages.length * input.profile.messageOverhead;
    const toolEntries = Object.entries(input.tools ?? {});
    const toolTokens = this.countValue(toolEntries, input.modelName)
      + toolEntries.length * input.profile.toolSchemaOverhead;
    const messageTokens = this.countValue(input.messages, input.modelName)
      + input.messages.length * input.profile.messageOverhead;
    const totalInputTokens = systemTokens + toolTokens + messageTokens;
    const inputBudget = Math.max(
      input.profile.contextWindow - input.profile.outputReserve - input.profile.safetyMargin,
      0
    );

    return {
      systemTokens,
      toolTokens,
      messageTokens,
      totalInputTokens,
      inputBudget,
      remainingTokens: inputBudget - totalInputTokens,
      countQuality: "estimated"
    };
  }

  countMessages(messages: MastraDBMessage[], modelName: string | undefined, profile: ModelContextProfile): number {
    return this.countValue(messages, modelName) + messages.length * profile.messageOverhead;
  }

  countProviderPrompt(prompt: unknown, modelName: string | undefined): number {
    return this.countValue(prompt, modelName);
  }

  private countValue(value: unknown, modelName?: string): number {
    return this.tokenCounter.countTokensSync(safeSerialize(value), modelName);
  }
}

const safeSerialize = (value: unknown): string => {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "function") {
      return `[function:${entry.name || "anonymous"}]`;
    }
    if (typeof entry !== "object" || entry === null) {
      return entry;
    }
    if (seen.has(entry)) {
      return "[circular]";
    }
    seen.add(entry);
    return entry;
  });
};
