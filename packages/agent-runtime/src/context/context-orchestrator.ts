// Packages source-governed tool results into ContextPackage layers.

import type { AgentRunContext } from "../types.js";
import type { ContextPackage } from "./context-package.js";
import { ContextPackageBuilder } from "./context-package-builder.js";
import type { ContextBudgetAllocator } from "./context-budget-allocator.js";
import type { ContextSourceRegistry } from "./context-source-registry.js";
import type { ContextPolicy } from "./context-policy.js";
import type { ContextItem } from "./tool-result-adapter.js";
import type { ContextRunState } from "./context-run-state.js";

export type PackageToolResultInput = {
  toolName: string;
  rawResult: unknown;
  runContext: AgentRunContext;
};

export class ContextOrchestrator {
  private readonly packageBuilder = new ContextPackageBuilder();

  constructor(
    private budgetAllocator: ContextBudgetAllocator,
    private sourceRegistry: ContextSourceRegistry,
    private policy: ContextPolicy,
    private runState?: ContextRunState
  ) {}

  packageToolResult(input: PackageToolResultInput): ContextPackage {
    const adapter = this.sourceRegistry.resolveByToolName(input.toolName);

    if (!adapter) {
      throw new Error(`CONTEXT_ADAPTER_REQUIRED:${input.toolName}`);
    }

    const budget = this.budgetAllocator.allocate({
      runContext: input.runContext,
      sourceType: adapter.sourceType,
      toolName: input.toolName
    });
    const items = adapter.toContextItems(input.rawResult, budget);
    const governedItems = this.policy.applyBudget(this.policy.redact(items), budget, (text) =>
      this.budgetAllocator.countTokensSync(text, input.runContext.model_name)
    );
    const contextPackage = this.packageBuilder.build(governedItems, createPackageOptions(input.runContext));
    this.runState?.registerObservation(contextPackage);
    return contextPackage;
  }

  /** Return whether a tool has an exact result adapter registered. */
  hasToolAdapter(toolName: string): boolean {
    return this.sourceRegistry.resolveByToolName(toolName) !== undefined;
  }

}

const createPackageOptions = (runContext: AgentRunContext) => ({
  resourceId: runContext.user_id,
  sessionId: runContext.session_id,
  runId: runContext.run_id
});
