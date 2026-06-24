# ADR-0003: Context Layering, Naming, and File Organization

Status: Accepted

Date: 2026-06-23

## Context

The context module has grown from a tool-result governance utility into the core prompt/context governance layer for
the data agent. It now touches tool observations, conversation windows, compact memory, long-term memory, task state,
knowledge retrieval, prompt budgeting, and provider message generation.

The current code already contains useful concepts, and the first migration step has moved the core boundaries toward
this model:

- `ToolObservationAdapterRegistry` is the only registry for tool observations; the earlier mixed source/tool registry
  wrapper has been removed.
- `ContextItem`, `ContextBudget`, context limits, `ContextPackage`, `ContextPackageBuilder`, `ContextPlan`,
  `ContextRunState`, `ContextSourceMetadata`, text helpers, and token reports now live under the inventory layer.
- `RuntimeContextSourceRegistry` owns logical run-scoped sources; Mastra protocol processors collect them before budget
  planning.
- `MastraConversationContextAdapter` is a Mastra protocol adapter for live messages/system messages. It produces
  inventory items but does not implement `RuntimeContextSource` and must not be registered in
  `RuntimeContextSourceRegistry`.
- Mastra source-message classification for `memory-summary:*`, `context:long-term-memory`, and future protocol-carried
  context source messages is centralized in `mastra-context-source-message.ts`. `MastraConversationContextAdapter`
  consumes the classifier and must not hard-code compact memory or long-term memory ownership rules.
- long-term memory is now registered as a runtime context source in production instead of entering the prompt as a
  synthetic user message.
- `ContextPromptMaterializer` now owns source/turn prompt group materialization from policy-filtered
  `ContextPackage.groups` and `ContextPromptView` assembly.
- `ContextStepPlanner` owns selection, reduction, and budget decisions.
- `ContextStepPlanner` / `PromptTokenCounter` own prompt group token cost calculation; projection does not depend on
  model profiles or token counters.
- `ContextSourcePolicy` now owns shadow omission, exact source duplicate omission, authority/projection selection, and
  cross-source overlap reporting for source items such as compact conversation memory, long-term memory, and Knowledge
  retrieval.
- `ContextSourcePolicy.applyPackage()` owns source candidate selection from `ContextPackage`; protocol processors must
  not reimplement source item filtering before applying source policy.
- `ContextSourcePolicy` must not expose a public raw-item `apply(items)` entrypoint; raw item policy execution is an
  internal implementation detail behind `applyPackage()`.
- `ContextBudgetAllocator` is profile-driven. It must not hard-code concrete tool names or schema/SQL limit constants;
  tool-observation budget profiles or tests provide `sourceLimitProfiles` for specific tools.
- `WorkingMemoryProjectionContextSource` records Mastra WorkingMemory as a shadow compact-memory projection source for
  audit/source-policy visibility without adding a second model-visible prompt block.
- `MastraConversationContextAdapter` owns live Mastra message/system-message ingestion into inventory items under
  the Mastra protocol layer. It is intentionally not a `RuntimeContextSource`; runtime sources are reserved for
  registry-managed run-scoped context such as long-term memory, working-memory projections, Knowledge, and future
  Semantic Recall candidates.
- System messages are captured as system `ContextItem`s and projected back out by `ContextPromptMaterializer`. Mastra
  processors may pass raw `args.systemMessages` into the live-message adapter for ingestion, but planner budget checks
  and returned provider input must use the inventory-projected system messages.
- Mastra-specific processors and message utilities now live under `context/protocol/mastra`, not in the context root
  or policy layer.
- Mastra context processors emit bounded context events through the protocol-neutral `ContextProtocolEventSink`. They do
  not import AG-UI event helpers directly; AG-UI `CUSTOM` wrapping is owned by `createAgUiContextEventSink` under the
  AG-UI protocol implementation.
- `MastraContextBudgetProcessor` delegates `context.compiled` payload shaping to `mastra-context-compiled-event.ts`.
  The processor owns the step pipeline, while protocol helpers own protocol event payload shape.
- `ContextTokenCounter`, `PromptTokenCounter`, model profiles, budget allocation, source policy, and reduction
  strategies now live under `context/policy`; budget and plan record DTOs live in inventory.
- `packages/agent-runtime/src/index.ts` is the application-facing API surface. It must not re-export context internals
  such as inventory structures, planners, protocol processors, source registries, or tool-observation registries.
  Smoke tests that need internal seams import `packages/agent-runtime/src/testing.ts` after build via
  `dist/testing.js`. Application code must not import the testing entry point.

We need a stable conceptual model before adding more memory-like sources such as Semantic Recall or Observational
Memory.

## Decision

The context system is split into five explicit layers:

```text
Source Layer
  -> Inventory Layer
  -> Policy / Decision Layer
  -> Projection Layer
  -> Protocol Layer
```

All future context code must fit one of these layers. File names and exported types should make the layer visible.
Step planning is a policy/decision implementation detail because it selects, omits, reduces, and records decisions over
inventory-owned groups.

`context/tool-observation` is not a sixth conceptual layer. It is the source-side subdomain for ReAct tool execution
results, separated from `context/source` because tool observations are pushed after tool execution while runtime
sources are pulled before a model step. After an exact tool adapter projects the raw result, the output must still enter
the shared `ContextItem` / `ContextPackage` / policy / budget / run-state flow.

## Layer Model

### 1. Source Layer

Responsibility:

- Answer where context comes from.
- Convert external/runtime objects into `ContextItem[]`.
- Never decide final prompt visibility by itself.

Naming:

- Interfaces/classes use the `ContextSource` suffix.
- Runtime logical sources implement `RuntimeContextSource`.
- Tool observations use `ToolObservationAdapter`.

Examples:

```ts
RuntimeContextSource
CompactConversationMemoryContextSource
LongTermMemoryContextSource
WorkingMemoryProjectionContextSource
SemanticRecallCandidateContextSource
ObservationalMemoryCandidateContextSource
ToolObservationAdapter
SchemaToolObservationAdapter
SqlResultToolObservationAdapter
```

Registry names:

```ts
RuntimeContextSourceRegistry
ToolObservationAdapterRegistry
```

Current migration:

- Production tool observation wiring uses `ToolObservationAdapterRegistry`.
- Tool observations register only with `ToolObservationAdapterRegistry`.
- New runtime/memory-like sources register with `RuntimeContextSourceRegistry`.
- `LongTermMemoryContextSource` is the first runtime source wired into production.
- `WorkingMemoryProjectionContextSource` is wired as a shadow runtime source when task/memory runtime is available.
- `runtime-context-source-boundary.ts` owns default runtime source registry assembly for long-term memory and
  WorkingMemory projection. Agent assembly calls `createDefaultRuntimeContextSourceRegistry()` and does not manually
  register built-in runtime sources.
- New run-scoped sources that are not yet built in should enter through `additionalSources` on the source-layer
  runtime registry boundary, then through `additionalRuntimeSources` on the Mastra processor boundary. They must not
  require `createDataAgent()` to manually instantiate or register runtime sources.
- Runtime source processors replace the current inventory snapshot for their registered `sourceType`s on every step,
  including when a source returns no items. Runtime sources are therefore fresh step-scoped projections, not append-only
  history; durable history must enter through memory/metadata repositories or explicit tool-history reference records.
- `ToolObservationProjectionPolicy` owns deterministic schema/SQL observation projection and truncation before tool
  observations enter `ContextPackage`; generic `ContextPolicy` remains the final fail-closed item budget/redaction
  boundary.
- `ToolObservationProjection` and `toolObservationProjectionToItems` live in the tool-observation layer. Inventory must
  not construct `tool-observation:*` metadata or know schema/SQL observation projection details.
- `ToolObservationAdapter` and `ToolObservationProjectionPolicy` must stay policy-free. They shape raw tool output into
  inventory items only.
- `ToolObservationPackager` is the only tool-observation coordinator allowed to call `ContextBudgetAllocator` and
  `ContextPolicy`. It resolves the exact adapter, allocates a tool/source budget, applies generic budget/redaction, and
  registers a history-shaped copy with `ContextRunState`.
- Tool observation results returned directly from a tool execution may expose a model projection for the live
  tool-call result. Before that package is registered as run history, `ToolObservationPackager` converts every
  model-visible tool-observation item into `reference` inventory through `tool-observation-history.ts`. The next
  prompt sees tool results through live Mastra messages, not by re-projecting historical tool output as source or
  tool-exchange groups. Knowledge that must persist beyond the live tool result should enter later as an explicit
  runtime/retrieval source, not by keeping the tool history model-visible.
- `default-tool-observation-adapters.ts` owns default adapter registration. Agent assembly calls
  `registerDefaultToolObservationAdapters()` and does not import or instantiate individual default adapters.
- `tool-observation-boundary.ts` owns the default tool-observation boundary assembly: budget allocator, adapter
  registry, generic item policy, run state, packager, default adapters, and extension adapters.
- Tool-observation boundary exposes only `ContextRunState` and `ToolObservationPackager` to agent assembly. Its
  `ContextBudgetAllocator` and `ToolObservationAdapterRegistry` are internal because they carry tool-observation
  profiles and must not become a shared runtime-source dependency.
- Runtime source processors use their own generic/default `ContextBudgetAllocator` unless explicitly configured by a
  runtime-source boundary. They accept budget options, not shared allocator instances, and must not borrow the
  tool-observation boundary allocator.
- `ToolObservationRunScope` is the narrow run identity/model scope consumed by tool-observation packaging. The
  provider-neutral tool-observation layer must not import full `AgentRunContext`.
- `RuntimeContextRunScope` is the narrow run identity scope consumed by runtime context sources. Mastra protocol
  processors may build this scope from `AgentRunContext`, but runtime sources must not receive the full agent run
  context.
- `inventory/context-source-metadata.ts` owns shared source metadata helpers for `sourceKind`, `sourceOwner`,
  `exclusivityKey`, `dedupeKeys`, `overlapKeys`, `shadow`, and `scope`. Source metadata is an inventory contract,
  not a `RuntimeContextSource` implementation.
- Context internals are not part of the root package API. Application code passes external protocol facts such as
  `mcpToolNames`; the tool-observation boundary creates the concrete adapters internally. Internal registries,
  packagers, planners, processors, source classes, and tool-observation adapters stay behind package-internal paths or
  the test-only entry point.

Suggested files:

```text
packages/agent-runtime/src/context/source/runtime-context-source.ts
packages/agent-runtime/src/context/source/runtime-context-source-boundary.ts
packages/agent-runtime/src/context/source/runtime-context-source-registry.ts
packages/agent-runtime/src/context/source/compact-conversation-memory-context-source.ts
packages/agent-runtime/src/context/source/long-term-memory-context-source.ts
packages/agent-runtime/src/context/source/working-memory-projection-context-source.ts
packages/agent-runtime/src/context/tool-observation/default-tool-observation-adapters.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-adapter.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-adapter-registry.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-budget-profile.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-boundary.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-history.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-projection-items.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-projection-policy.ts
packages/agent-runtime/src/context/tool-observation/tool-observation-run-scope.ts
packages/agent-runtime/src/context/tool-observation/adapters/schema-tool-observation-adapter.ts
packages/agent-runtime/src/context/tool-observation/adapters/sql-result-tool-observation-adapter.ts
```

### 2. Inventory Layer

Responsibility:

- Store the current run's context inventory.
- Preserve provenance, trust, retention, priority, grouping, and content hashes.
- Represent snapshots/revisions, not protocol messages.

Core types:

```ts
ContextItem
ContextBudget
ContextLimits
ContextGroup
ContextPackage
ContextPlan
ContextRunState
ContextSourceMetadata
ContextText
PromptTokenReport
```

Definitions:

- `ContextItem`: smallest context inventory unit.
- `ContextGroup`: atomic planner selection unit.
- `ContextPackage`: one run's inventory snapshot at one revision.
- `ContextPlan`: immutable record of one step's selected/omitted groups, budget, token report, and decisions.
- `ContextDecision`: auditable decision record produced by policy/planner code and stored with a `ContextPlan`.
- `ContextBudget`: source/tool budget DTO allocated by policy code and consumed by source/tool boundaries.
- `ContextLimits`: shared shaping constants such as hard context size, schema bounds, and SQL preview bounds.
- `ContextSourceMetadata`: shared provenance/dedupe/authority metadata contract carried by `ContextItem.metadata`.
- `ContextText`: shared deterministic text truncation helpers.
- `ContextRunState`: owns the current package revision and recorded plans for a run.

Naming:

- Inventory layer keeps the existing `Context*` names.
- No abstract base class is required for this layer; these are mostly data structures and state containers.

Suggested files:

```text
packages/agent-runtime/src/context/inventory/context-item.ts
packages/agent-runtime/src/context/inventory/context-budget.ts
packages/agent-runtime/src/context/inventory/context-limits.ts
packages/agent-runtime/src/context/inventory/context-package.ts
packages/agent-runtime/src/context/inventory/context-package-builder.ts
packages/agent-runtime/src/context/inventory/context-plan.ts
packages/agent-runtime/src/context/inventory/context-run-state.ts
packages/agent-runtime/src/context/inventory/context-source-metadata.ts
packages/agent-runtime/src/context/inventory/context-text.ts
packages/agent-runtime/src/context/inventory/context-token-report.ts
```

Migration note:

- `ContextItem`, `ContextBudget`, context limits, `ContextPlan`, `ContextDecision`, `ContextSourceMetadata`, text
  helpers, and token reports have moved to inventory.
- Tool adapter interfaces import `ContextItem`, but do not own it conceptually.
- Source and tool-observation interfaces import `ContextBudget`, but do not own budget allocation.
- `ContextSourceSnapshot` includes bounded metadata summaries so policy/audit code does not need full source content.
- `ContextPackage` does not own folded `model` / `activity` projections. Those are tool-observation compatibility
  outputs computed from package items by `toolObservationModelFromPackage` /
  `toolObservationActivityFromPackage`.
- `ContextRunState.registerPackage()` is a generic inventory operation. It namespaces incoming item/group IDs and
  merges the package; it must not inspect `tool-exchange`, memory, Knowledge, or any other source-specific semantics.
  Source-specific history shaping must happen before a package reaches inventory.

### 3. Policy / Decision Layer

Responsibility:

- Decide what is allowed, preferred, shadow-only, omitted, redacted, fail-closed, selected, or reduced.
- Read `ContextPackage` and `ContextItem.metadata`.
- Produce an inventory-owned `ContextPlan` for one model step.
- Select or omit `ContextGroup`s.
- Record token reports and reduction decisions.
- Output inventory-owned decisions and plans, not protocol messages.

Policy and decision types:

```ts
ContextPolicy
ContextSourcePolicy
ContextReductionStrategy
ReductionCandidateSelector
ContextTokenCounter
ModelContextProfile
PromptTokenCounter
```

Future policy-rule interfaces can be introduced when the layer has more than one concrete rule family:

```ts
export interface ContextPolicyRule {
  readonly id: string;
  apply(input: ContextPolicyInput): ContextPolicyResult;
}
```

Policy / Decision should be a first-class layer, not a sidecar log and not embedded inside `ContextItem`. Items carry
metadata; policy components and `ContextStepPlanner` read that metadata and produce inventory-owned
`ContextDecision` / `ContextPlan` records.

Current migration:

- `ContextStepPlanner` is the current planner implementation.
- It now plans over prompt groups materialized from `ContextPackage.groups`.
- `MastraContextBudgetProcessor` still invokes live message ingestion before planning, but the conversion itself lives in
  `MastraConversationContextAdapter` under `context/protocol/mastra`.
- Existing `ContextSourcePolicy` is the first policy rule implementation used by the Mastra context processor before
  prompt group materialization. It receives the whole `ContextPackage` through `applyPackage()` and owns the
  model-visible source item candidate rule, so exact duplicates and overlap flags can cross source-group boundaries.
- Generic `ContextPolicy` only applies final item budget/redaction checks. It must stay tool-agnostic and must not own
  schema/SQL projection rules.
- `ContextBudgetAllocator` receives concrete source/tool limit profiles from tool-observation budget profiles. This
  keeps generic policy code and agent assembly independent from data-tool shaping details while preserving the same
  runtime limits for `inspect_schema` and `run_sql_readonly`.
- Default tool observation adapter registration lives in `default-tool-observation-adapters.ts`, keeping agent assembly
  independent from the concrete adapter class list.
- Default tool observation boundary assembly lives in `tool-observation-boundary.ts`, keeping agent assembly independent
  from the registry/packager/policy/allocator wiring details.
- `ContextSourcePolicy` owns the source-policy algorithm only, while `context-source-authority-profile.ts` owns default
  source owner authority profiles and the `createDefaultContextSourcePolicy()` factory.

Suggested files:

```text
packages/agent-runtime/src/context/policy/context-source-authority-profile.ts
packages/agent-runtime/src/context/policy/context-source-policy.ts
packages/agent-runtime/src/context/policy/context-step-planner.ts
packages/agent-runtime/src/context/policy/context-reduction-strategy.ts
packages/agent-runtime/src/context/policy/model-context-profile.ts
packages/agent-runtime/src/context/policy/context-token-counter.ts
packages/agent-runtime/src/context/policy/prompt-token-counter.ts
```

### 4. Projection Layer

Responsibility:

- Convert selected inventory groups into consumer-specific views.
- Own prompt materialization.
- Stay independent from a specific provider protocol where possible.

Projection types:

```ts
ContextPromptView
```

Future non-prompt projection builders can be added only after a concrete consumer exists:

```ts
export interface ContextProjectionBuilder<TView> {
  readonly viewType: string;
  build(input: ContextViewProjectionInput): TView;
}
```

Prompt projection:

```ts
ContextPromptMaterializer
ContextPromptView
ContextPromptMessage
```

Important rule:

- `ContextPromptView` is not the same thing as OpenAI messages, Mastra messages, or LangChain messages.
- `ContextPromptView` is our provider-neutral model-input view.
- `ContextPromptView.messages` contains `ContextPromptMessage[]`; protocol adapters convert it into
  `MastraDBMessage[]`, OpenAI chat messages, or other provider-specific shapes.
- `ContextPromptView.systemMessages` is projected from `ContextPackage` system groups, not copied directly from a
  protocol processor argument.

Suggested files:

```text
packages/agent-runtime/src/context/projection/context-prompt-materializer.ts
packages/agent-runtime/src/context/projection/context-prompt-view.ts
packages/agent-runtime/src/context/projection/context-prompt-message.ts
packages/agent-runtime/src/context/projection/context-source-prompt-materializer.ts
```

### 5. Protocol Layer

Responsibility:

- Convert projection views into framework/provider protocols.
- Keep Mastra / AG-UI / OpenAI-compatible / Vercel AI SDK details out of inventory and policy.
- Convert context governance events into protocol-specific event streams through an explicit event sink.

Protocol adapters:

```ts
MastraContextProtocolAdapter
ContextProtocolEventSink
```

Current migration:

- `mastra-context-processor-boundary.ts` owns Mastra context processor assembly. Agent assembly calls
  `createMastraContextProcessorBoundary()` and must not manually construct `MastraContextBudgetProcessor`,
  `MastraContextRuntimeSourceProcessor`, `MastraProviderPromptGuardProcessor`, `MastraTaskStateContextProcessor`,
  `MastraToolObservationRouter`, planner, materializer, token counter, model profile registry, or source policy.
- `mastra-context-protocol-adapter.ts` owns `ContextPromptView -> MastraDBMessage[] / systemMessages` conversion.
  `MastraContextBudgetProcessor` must not call lower-level message mappers directly for final prompt output.
- `mastra-context-source-message.ts` owns Mastra protocol-carried source message classification. It is the only place
  for message-id based rules such as `memory-summary:*` and `context:long-term-memory`.
- The Mastra processor boundary is also the only production path that connects the source-layer runtime registry
  boundary to Mastra processors. This keeps long-term memory and WorkingMemory projection registration out of
  `createDataAgent()`.
- `createDataAgent()` still creates the AG-UI event sink because AG-UI wrapping is a northbound protocol concern; the
  Mastra processor boundary consumes only the protocol-neutral `ContextProtocolEventSink`.

Abstract base/interface:

```ts
export interface ContextProtocolAdapter<TView, TProtocol> {
  readonly protocol: string;
  toProtocol(view: TView): TProtocol;
}
```

Suggested files:

```text
packages/agent-runtime/src/context/protocol/context-protocol-adapter.ts
packages/agent-runtime/src/context/protocol/context-protocol-event-sink.ts
packages/agent-runtime/src/context/protocol/ag-ui/ag-ui-context-event-sink.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-context-budget-processor.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-context-processor-boundary.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-context-protocol-adapter.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-context-source-message.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-provider-prompt-guard-processor.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-task-state-context-processor.ts
packages/agent-runtime/src/context/protocol/mastra/mastra-message-utils.ts
packages/agent-runtime/src/context/protocol/openai-context-protocol-adapter.ts
packages/agent-runtime/src/context/protocol/ag-ui/ag-ui-context-event-protocol-adapter.ts
```

## Core Relationships

```text
RuntimeContextSource produces ContextItem[]

ToolObservationAdapter produces ContextItem[]

ContextItem belongs to ContextGroup

ContextPackage contains ContextItem[] + ContextGroup[] + sourceSnapshots

ContextRunState owns current ContextPackage revision

ToolObservationPackager registers reference-shaped tool history with ContextRunState

ContextPolicyRule reads ContextPackage and emits decisions

ContextStepPlanner is part of Policy / Decision and emits an inventory-owned ContextPlan

ContextPlan selects / omits ContextGroup

ContextPromptMaterializer reads ContextPackage + ContextPlan + policy-kept source item ids and emits ContextPromptView

ContextStepPlanner computes token costs for prompt groups before selection

ContextProtocolAdapter converts ContextPromptView into Mastra/OpenAI/AG-UI protocol data

MastraContextSourceMessage classifier converts Mastra protocol-carried source messages into source metadata decisions

MastraContextCompiledEvent helper converts ContextPackage + ContextPlan into protocol audit payload
```

## Mapping to Model Messages

Internal context abstractions do not map 1:1 to model messages.

```text
ContextItem != message
ContextGroup != message
ContextPackage != messages
ContextPromptView ~= provider-neutral model input
Protocol messages = provider/framework-specific serialization
```

Example:

```text
ContextPackage rev=2
  group: source:compact-conversation-memory
  group: source:long-term-memory
  group: turn:current-user
  group: tool-exchange:inspect_schema

ContextPromptMaterializer
  -> ContextPromptView
  -> ContextPromptMessage[]

MastraContextProtocolAdapter
  -> MastraDBMessage[]

future OpenAiContextProtocolAdapter
  -> { role, content, tool_calls }[]
```

## Naming Rules

Class and type names must reveal their layer without requiring the reader to inspect imports or file paths. Each layer
has a shared prefix or suffix family.

| Layer | Required naming family | Examples | Avoid |
| --- | --- | --- | --- |
| Source | `*ContextSource`, `*ContextSourceRegistry` | `LongTermMemoryContextSource`, `RuntimeContextSourceRegistry` | `LongTermMemoryAdapter`, `MemoryRegistry`, `LongTermMemoryContextAdapter` |
| Tool observation | `*ToolObservationAdapter`, `*ToolObservationRegistry` | `SqlToolObservationAdapter`, `ToolObservationAdapterRegistry` | `SqlContextSource`, `ToolObservationAdapterRegistry` for tool-only registry |
| Inventory | `Context*` | `ContextItem`, `ContextBudget`, `ContextGroup`, `ContextPackage`, `ContextPlan`, `ContextRunState` | `PromptItem`, `MemoryGroup` |
| Policy / Decision | `Context*Policy`, `Context*PolicyResult`, `ContextStepPlanner`, `Context*ReductionStrategy`, `Context*TokenCounter` | `ContextSourcePolicy`, `ContextStepPlanner`, `ContextTokenCounter` | `AuthorityManager`, `MemoryDeduper`, `StepContextPlanner` |
| Projection | `Context*View`, `Context*Materializer` | `ContextPromptView`, `ContextPromptMaterializer` | `PromptView`, `MessageBuilder` |
| Protocol | `*ContextProtocolAdapter` or `<Protocol>ContextAdapter` | `MastraContextProtocolAdapter` | `MastraPromptAdapter`, `MessageAdapter` |

Rules:

1. Source layer exports must use `ContextSource` naming unless they are specifically tool-observation adapters.
2. Tool result/observation classes must use `ToolObservation` naming, not `ContextSource`, even though they produce
   `ContextItem[]`.
3. Inventory layer exports must begin with `Context` and represent data/state structures. Inventory is the exception
   where no abstract base class is required.
4. Policy / Decision layer exports must begin with `Context` and use `Policy`, `PolicyRule`, `PolicyResult`,
   `Planner`, `ReductionStrategy`, or `TokenCounter` suffixes. Plan and decision record DTOs live in inventory.
5. The planner implementation must stay under `context/policy` and use `ContextStepPlanner`; do not introduce a
   separate planner directory, `ContextPlanner`, or `StepContextPlanner` as public concepts.
6. Projection layer exports must begin with `Context`; do not introduce `PromptView` aliases for new provider views.
7. Protocol layer exports must include `ContextProtocolAdapter` or `<Protocol>ContextAdapter`.
8. Do not use `SourceRegistry` for tool-only registries.
9. Do not name provider-specific message types as `ContextMessage`; use protocol-specific names.
10. Do not re-export context internals from `packages/agent-runtime/src/index.ts`; use `src/testing.ts` for smoke-only
    internal verification.

## Consequences

Positive:

- memory-like sources and tool observations no longer compete inside one registry concept;
- `ContextPackage` becomes a real inventory snapshot, not an implicit prompt;
- `ContextPromptView` becomes the only route to model-visible context;
- Mastra/OpenAI/AG-UI protocol details stop leaking into source and policy code;
- future Semantic Recall / OM can be added as sources or candidate generators without bypassing governance.

Negative:

- several files need migration when new context source types are added;
- adding protocol adapters will create new boundaries that must remain explicit;
- planner refactor must be done carefully to preserve ReAct tool-result behavior.

## Migration Guidance

1. Add `RuntimeContextSourceRegistry` without touching current tool adapters.
2. Register tool observations only through `ToolObservationAdapterRegistry`.
3. Keep `ContextItem` and related inventory types under `context/inventory/*`.
4. Use `ContextPromptMaterializer` and `ContextPromptView` as the prompt projection boundary.
5. Move LTM from synthetic-message injection to runtime source inventory.
6. Register built-in runtime context sources through `createDefaultRuntimeContextSourceRegistry()`.
7. Continue moving processor responsibilities toward source/policy/projection objects as new context sources are added.

## Related Documents

- `docs/engineering/context-governance-pipeline.svg`
- `docs/engineering/context-governance-pipeline.mmd`
- `docs/engineering/adr-0002-memory-authority-and-mastra-memory-boundary.md`
- `docs/plans/2026-06-23-memory-context-source-unification.md`
- `docs/engineering/2026-06-23-memory-context-prompt-walkthrough.html`
