import { Agent } from "@mastra/core/agent";
import type { Message } from "@ag-ui/core";
import type { DataGateway } from "@open-data-agent/data-gateway";
import { createModelProvider, type ModelProvider } from "@open-data-agent/providers";

import { AGENT_MAX_STEPS } from "./context/defaults.js";
import { ContextBudgetAllocator } from "./context/context-budget-allocator.js";
import { ContextBudgetProcessor } from "./context/context-budget-processor.js";
import { ContextOrchestrator } from "./context/context-orchestrator.js";
import { ContextPolicy } from "./context/context-policy.js";
import { ContextSourceRegistry } from "./context/context-source-registry.js";
import { ContextRunState } from "./context/context-run-state.js";
import {
  ReductionStrategyRegistry,
  type ReductionCandidateSelector
} from "./context/context-reduction-strategy.js";
import { SchemaContextAdapter } from "./context/schema-context-adapter.js";
import { SqlResultContextAdapter } from "./context/sql-result-context-adapter.js";
import { ProviderPromptGuardProcessor } from "./context/provider-prompt-guard-processor.js";
import { ModelContextProfileRegistry } from "./context/model-context-profile.js";
import { PromptTokenCounter } from "./context/prompt-token-counter.js";
import { StepContextPlanner } from "./context/step-context-planner.js";
import { createDataAgentToolRegistry, type ToolRegistry } from "./tools/data-tools.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export {
  DEFAULT_AGENT_CONTEXT_POLICY,
  applySchemaContextPolicy,
  applySqlModelContextPolicy,
  truncateContextText,
  type AgentContextPolicy
} from "./context/context-policy.js";
export type {
  ArtifactRef,
  AuditRef,
  ContextPackage,
  ContextProjection,
  ContextGroup,
  ContextGroupKind,
  ContextSourceSnapshot,
  ContextTruncation
} from "./context/context-package.js";
export type {
  ContextItem,
  ContextItemVisibility,
  ContextRetention,
  ContextTrust,
  ContextSourceAdapter,
  ToolResultAdapter
} from "./context/tool-result-adapter.js";
export { createContextItem, hashContextContent } from "./context/tool-result-adapter.js";
export { SchemaContextAdapter } from "./context/schema-context-adapter.js";
export { SqlResultContextAdapter } from "./context/sql-result-context-adapter.js";
export { ContextBudgetAllocator } from "./context/context-budget-allocator.js";
export { ContextPackageBuilder } from "./context/context-package-builder.js";
export { ContextOrchestrator } from "./context/context-orchestrator.js";
export { ContextRunState, type ContextRunIdentity } from "./context/context-run-state.js";
export { ContextBudgetProcessor } from "./context/context-budget-processor.js";
export { ProviderPromptGuardProcessor } from "./context/provider-prompt-guard-processor.js";
export {
  StepContextPlanner,
  type ContextDecision,
  type ContextPlan,
  type GlobalContextBudget,
  type PromptView,
  type PromptMessageGroup
} from "./context/step-context-planner.js";
export {
  LowestQualityLossSelector,
  OmitHistoricalGroupStrategy,
  ReductionStrategyRegistry,
  type ContextReductionStrategy,
  type ReductionCandidateSelector,
  type ReductionGroup,
  type ReductionProposal,
  type ReductionState
} from "./context/context-reduction-strategy.js";
export {
  ModelContextProfileRegistry,
  type ModelContextProfile,
  type ModelContextProfileRegistryOptions
} from "./context/model-context-profile.js";
export { PromptTokenCounter, type PromptTokenReport } from "./context/prompt-token-counter.js";
export {
  groupMessagesByTurn,
  isConversationTurnStart,
  isToolObservationMessage,
  type ConversationTurnGroup,
  type GroupedConversationMessage
} from "./context/mastra-message-utils.js";
export { ContextPolicy } from "./context/context-policy.js";
export { ContextSourceRegistry } from "./context/context-source-registry.js";
export { TokenCounter } from "./context/token-counter.js";
export { createActivityDelta, createPlanActivityEvent } from "./events.js";
export { createDataAgentToolRegistry, type ToolRegistry } from "./tools/data-tools.js";

export type CreateDataAgentInput = {
  contextCompilation?: ContextCompilationOptions;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  messages: Message[];
};

export type ContextCompilationOptions = {
  candidateSelector?: ReductionCandidateSelector;
  profileRegistry?: ModelContextProfileRegistry;
  registerDefaultStrategies?: boolean;
  strategyRegistry?: ReductionStrategyRegistry;
  tokenCounter?: PromptTokenCounter;
};

export const createDataAgent = (
  input: CreateDataAgentInput
): { agent: Agent; contextRunState: ContextRunState; governedMessages: Message[]; registry: ToolRegistry } => {
  // Create context orchestrator
  const budgetAllocator = new ContextBudgetAllocator();
  const sourceRegistry = new ContextSourceRegistry();
  const policy = new ContextPolicy();
  const contextRunState = new ContextRunState({
    resourceId: input.runContext.user_id,
    sessionId: input.runContext.session_id,
    runId: input.runContext.run_id
  });
  const orchestrator = new ContextOrchestrator(budgetAllocator, sourceRegistry, policy, contextRunState);

  // Register tool adapters
  sourceRegistry.registerToolAdapter(new SchemaContextAdapter());
  sourceRegistry.registerToolAdapter(new SqlResultContextAdapter());

  const governedMessages = sanitizeIngressMessages(input.messages);

  const registry = createDataAgentToolRegistry({
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext,
    orchestrator
  });
  const profileRegistry = input.contextCompilation?.profileRegistry ?? new ModelContextProfileRegistry();
  const tokenCounter = input.contextCompilation?.tokenCounter ?? new PromptTokenCounter();
  const planner = new StepContextPlanner({
    profileRegistry,
    tokenCounter,
    ...(input.contextCompilation?.strategyRegistry
      ? { strategyRegistry: input.contextCompilation.strategyRegistry }
      : {}),
    ...(input.contextCompilation?.candidateSelector
      ? { candidateSelector: input.contextCompilation.candidateSelector }
      : {}),
    ...(input.contextCompilation?.registerDefaultStrategies !== undefined
      ? { registerDefaultStrategies: input.contextCompilation.registerDefaultStrategies }
      : {})
  });
  const contextBudgetProcessor = new ContextBudgetProcessor({
    emitter: input.emitter,
    modelName: input.runContext.model_name,
    planner,
    runState: contextRunState
  });
  const providerPromptGuard = new ProviderPromptGuardProcessor({
    emitter: input.emitter,
    modelName: input.runContext.model_name,
    profileRegistry,
    tokenCounter
  });
  const agent = new Agent({
    id: "data-agent",
    name: "Data Agent",
    instructions: buildAgentInstructions(input.runContext),
    model: input.modelProvider.model as never,
    tools: registry.mastraTools,
    inputProcessors: [contextBudgetProcessor, providerPromptGuard],
    defaultOptions: {
      maxSteps: AGENT_MAX_STEPS,
      providerOptions: {
        openai: {
          systemMessageMode: "system"
        }
      }
    }
  });

  return { agent, contextRunState, governedMessages, registry };
};

export const createDataAgentRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }

  return input;
};

export const createModelProviderFromEnv = (env: Record<string, string | undefined>): ModelProvider =>
  createModelProvider(env);

const buildAgentInstructions = (context: AgentRunContext): string => `
You are a read-only data analysis ReAct agent.

You can only access data through tools. Never invent schema, rows, or SQL execution results.
The selected datasource_id is "${context.selected_datasource_id}". Use only this datasource.

Required policy:
1. For any data analysis request, call inspect_schema before writing SQL.
2. After observing schema, generate a SELECT or WITH SQL query.
3. Execute SQL only through run_sql_readonly.
4. If schema or SQL execution fails, explain the failure. Do not fabricate results.
5. Do not reveal credentials, datasource config, or internal environment values.
`;

const sanitizeIngressMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => message.role !== "activity" && message.role !== "reasoning");
