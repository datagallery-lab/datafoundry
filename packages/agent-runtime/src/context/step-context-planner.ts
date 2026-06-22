import type { MastraDBMessage } from "@mastra/core/agent";
import { randomUUID } from "node:crypto";

import type { ContextPackage } from "./context-package.js";
import {
  LowestQualityLossSelector,
  OmitHistoricalGroupStrategy,
  ReductionStrategyRegistry,
  type ReductionCandidateSelector,
  type ReductionGroup,
  type ReductionProposal
} from "./context-reduction-strategy.js";
import { ModelContextProfileRegistry, type ModelContextProfile } from "./model-context-profile.js";
import { groupMessagesByTurn } from "./mastra-message-utils.js";
import { PromptTokenCounter, type PromptTokenReport } from "./prompt-token-counter.js";

export type ContextDecision = {
  strategyId: string;
  affectedGroupIds: string[];
  tokenSavings: number;
  reason: string;
};

export type GlobalContextBudget = {
  contextWindow: number;
  outputReserve: number;
  safetyMargin: number;
  inputBudget: number;
};

export type ContextPlan = {
  planId: string;
  stepNumber: number;
  packageRevision: number;
  selectedGroupIds: string[];
  omittedGroupIds: string[];
  decisions: ContextDecision[];
  budget: GlobalContextBudget;
  tokenReport: PromptTokenReport;
};

export type PromptView = {
  systemMessages: unknown[];
  messages: MastraDBMessage[];
  tokenReport: PromptTokenReport;
};

export type PromptMessageGroup = ReductionGroup & {
  messages: MastraDBMessage[];
};

export type StepContextPlannerOptions = {
  profileRegistry?: ModelContextProfileRegistry;
  tokenCounter?: PromptTokenCounter;
  strategyRegistry?: ReductionStrategyRegistry;
  candidateSelector?: ReductionCandidateSelector;
  registerDefaultStrategies?: boolean;
};

export class StepContextPlanner {
  private readonly profileRegistry: ModelContextProfileRegistry;
  private readonly tokenCounter: PromptTokenCounter;
  private readonly strategyRegistry: ReductionStrategyRegistry;
  private readonly candidateSelector: ReductionCandidateSelector;

  constructor(options: StepContextPlannerOptions = {}) {
    this.profileRegistry = options.profileRegistry ?? new ModelContextProfileRegistry();
    this.tokenCounter = options.tokenCounter ?? new PromptTokenCounter();
    this.strategyRegistry = options.strategyRegistry ?? new ReductionStrategyRegistry();
    this.candidateSelector = options.candidateSelector ?? new LowestQualityLossSelector();

    if (options.registerDefaultStrategies !== false) {
      this.strategyRegistry.register(new OmitHistoricalGroupStrategy());
    }
  }

  plan(input: {
    contextPackage: ContextPackage;
    stepNumber: number;
    systemMessages: unknown[];
    tools?: Record<string, unknown>;
    messages: MastraDBMessage[];
    modelName: string | undefined;
  }): { plan: ContextPlan; promptView: PromptView; groups: PromptMessageGroup[] } {
    const profile = this.profileRegistry.resolve(input.modelName);
    const groups = createPromptGroups(input.messages, profile, this.tokenCounter, input.modelName);
    const selectedGroupIds = new Set(groups.map((group) => group.id));
    const decisions: ContextDecision[] = [];
    let report = this.createReport(input, selectedGroupIds, groups, profile);

    this.assertMandatorySetFits(input, groups, profile);

    while (report.totalInputTokens > report.inputBudget) {
      const state = {
        groups,
        selectedGroupIds,
        excessTokens: report.totalInputTokens - report.inputBudget
      };
      const proposal = this.candidateSelector.select(this.strategyRegistry.propose(state), state);
      this.applyProposal(proposal, selectedGroupIds, decisions);
      report = this.createReport(input, selectedGroupIds, groups, profile);
    }

    const selectedMessages = groups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => group.messages);
    const plan: ContextPlan = {
      planId: randomUUID(),
      stepNumber: input.stepNumber,
      packageRevision: input.contextPackage.revision,
      selectedGroupIds: [...selectedGroupIds],
      omittedGroupIds: groups.filter((group) => !selectedGroupIds.has(group.id)).map((group) => group.id),
      decisions,
      budget: createBudget(profile),
      tokenReport: report
    };

    return {
      plan,
      promptView: { systemMessages: input.systemMessages, messages: selectedMessages, tokenReport: report },
      groups
    };
  }

  private createReport(
    input: {
      systemMessages: unknown[];
      tools?: Record<string, unknown>;
      modelName: string | undefined;
    },
    selectedGroupIds: ReadonlySet<string>,
    groups: PromptMessageGroup[],
    profile: ModelContextProfile
  ): PromptTokenReport {
    const messages = groups.filter((group) => selectedGroupIds.has(group.id)).flatMap((group) => group.messages);
    return this.tokenCounter.count({
      systemMessages: input.systemMessages,
      ...(input.tools ? { tools: input.tools } : {}),
      messages,
      modelName: input.modelName,
      profile
    });
  }

  private assertMandatorySetFits(
    input: {
      systemMessages: unknown[];
      tools?: Record<string, unknown>;
      modelName: string | undefined;
    },
    groups: PromptMessageGroup[],
    profile: ModelContextProfile
  ): void {
    const messages = groups.filter((group) => group.mandatory).flatMap((group) => group.messages);
    const report = this.tokenCounter.count({
      systemMessages: input.systemMessages,
      ...(input.tools ? { tools: input.tools } : {}),
      messages,
      modelName: input.modelName,
      profile
    });

    if (report.totalInputTokens > report.inputBudget) {
      throw new Error("CONTEXT_MINIMUM_SET_EXCEEDS_BUDGET");
    }
  }

  private applyProposal(
    proposal: ReductionProposal | undefined,
    selectedGroupIds: Set<string>,
    decisions: ContextDecision[]
  ): void {
    if (!proposal || proposal.removeGroupIds.every((groupId) => !selectedGroupIds.has(groupId))) {
      throw new Error("CONTEXT_REDUCTION_STRATEGY_EXHAUSTED");
    }

    proposal.removeGroupIds.forEach((groupId) => selectedGroupIds.delete(groupId));
    decisions.push({
      strategyId: proposal.strategyId,
      affectedGroupIds: proposal.removeGroupIds,
      tokenSavings: proposal.expectedTokenSavings,
      reason: proposal.reason
    });
  }
}

const createPromptGroups = (
  messages: MastraDBMessage[],
  profile: ModelContextProfile,
  tokenCounter: PromptTokenCounter,
  modelName?: string
): PromptMessageGroup[] => {
  return groupMessagesByTurn(messages).map((group) => {
    const groupedMessages = group.members.map((member) => member.message);
    return {
      id: group.id,
      order: group.order,
      retention: group.retention,
      mandatory: group.mandatory,
      messages: groupedMessages,
      tokenCost: tokenCounter.countMessages(groupedMessages, modelName, profile)
    };
  });
};

const createBudget = (profile: ModelContextProfile): GlobalContextBudget => ({
  contextWindow: profile.contextWindow,
  outputReserve: profile.outputReserve,
  safetyMargin: profile.safetyMargin,
  inputBudget: Math.max(profile.contextWindow - profile.outputReserve - profile.safetyMargin, 0)
});
