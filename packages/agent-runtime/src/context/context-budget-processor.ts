import type { MastraDBMessage } from "@mastra/core/agent";
import type { ProcessInputStepArgs, ProcessInputStepResult, Processor } from "@mastra/core/processors";

import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";
import { ContextPackageBuilder } from "./context-package-builder.js";
import type { ContextRunState } from "./context-run-state.js";
import { groupMessagesByTurn, isToolObservationMessage } from "./mastra-message-utils.js";
import { StepContextPlanner } from "./step-context-planner.js";
import { createContextItem, type ContextItem } from "./tool-result-adapter.js";

export type ContextBudgetProcessorOptions = {
  emitter: AgUiEventEmitter;
  modelName: string | undefined;
  planner?: StepContextPlanner;
  runState: ContextRunState;
};

export class ContextBudgetProcessor implements Processor<"context-budget"> {
  readonly id = "context-budget";
  readonly name = "Context Budget Processor";
  private readonly builder = new ContextPackageBuilder();
  private readonly planner: StepContextPlanner;

  constructor(private readonly options: ContextBudgetProcessorOptions) {
    this.planner = options.planner ?? new StepContextPlanner();
  }

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    const livePackage = this.builder.build(createLiveContextItems(args.messages, args.systemMessages), {
      resourceId: this.options.runState.identity.resourceId,
      sessionId: this.options.runState.identity.sessionId,
      runId: this.options.runState.identity.runId
    });
    const contextPackage = this.options.runState.merge(livePackage);
    const result = this.planner.plan({
      contextPackage,
      stepNumber: args.stepNumber,
      systemMessages: args.systemMessages,
      ...(args.tools ? { tools: args.tools } : {}),
      messages: args.messages,
      modelName: this.options.modelName
    });
    this.options.runState.recordPlan(result.plan);
    this.options.emitter.emit(createCustomEvent("context.compiled", {
      package_revision: result.plan.packageRevision,
      plan_id: result.plan.planId,
      step_number: result.plan.stepNumber,
      selected_group_ids: result.plan.selectedGroupIds,
      omitted_group_ids: result.plan.omittedGroupIds,
      decisions: result.plan.decisions,
      token_report: result.plan.tokenReport,
      budget: result.plan.budget
    }));

    return { messages: result.promptView.messages };
  }
}

const createLiveContextItems = (messages: MastraDBMessage[], systemMessages: unknown[]): ContextItem[] => {
  const items = systemMessages.map((message, index) => createContextItem({
    id: `system-${index}`,
    sourceType: "system",
    sourceId: `system-${index}`,
    groupId: `system-${index}`,
    visibility: "model",
    trust: "runtime",
    retention: "mandatory",
    priority: 100,
    content: message,
    metadata: { atomic: true, groupKind: "system", messageKind: "system" }
  }));

  groupMessagesByTurn(messages).forEach((group) => {
    group.members.forEach((member) => {
      items.push(createContextItem({
        id: `message-${member.id}`,
        sourceType: isToolObservationMessage(member.message) ? "tool-observation" : "conversation",
        sourceId: member.id,
        groupId: group.id,
        visibility: "model",
        trust: "untrusted-client",
        retention: group.retention,
        priority: group.isCurrent ? 80 : 40,
        content: member.message,
        metadata: {
          atomic: true,
          groupKind: "turn",
          mandatory: group.mandatory,
          messageKind: "message",
          role: member.message.role
        }
      }));
    });
  });

  return items;
};
