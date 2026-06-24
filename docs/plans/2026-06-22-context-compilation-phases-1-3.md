# Context Compilation Phases 1-3 Implementation Plan

状态：已完成（2026-06-22）

**Goal:** Implement ContextPackage v2, Mastra per-step context compilation, extensible reduction strategies, global token budgeting, and a provider-boundary prompt guard.

**Architecture:** Keep deterministic `ToolObservationAdapter`s at tool boundaries, but move final conversation and prompt selection into Mastra `processInputStep`. Represent normalized context as ContextPackage revisions, generate immutable ContextPlan objects per step, and keep reduction policy replaceable through strategy and candidate-selector interfaces.

**Tech Stack:** TypeScript, Mastra 1.42 processors, AG-UI events, existing ContextTokenCounter, Node smoke tests.

---

### Task 1: ContextPackage v2 contracts and run state

**Files:**
- Modify: `packages/agent-runtime/src/context/inventory/context-package.ts`
- Modify: `packages/agent-runtime/src/context/inventory/context-item.ts`
- Modify: `packages/agent-runtime/src/context/inventory/context-package-builder.ts`
- Create: `packages/agent-runtime/src/context/inventory/context-run-state.ts`
- Modify: schema, SQL, conversation source, and tool observation adapters

**Steps:**
1. Add package identity, revision, normalized items, atomic groups, trust, retention, and content hashes.
2. Preserve model/activity projections as explicit package outputs rather than the internal source of truth.
3. Implement immutable package merging and plan recording in `ContextRunState`.
4. Add smoke assertions for revision increment, deduplication, and group preservation.

### Task 2: Extensible token-first planner

**Files:**
- Create: `packages/agent-runtime/src/context/policy/model-context-profile.ts`
- Create: `packages/agent-runtime/src/context/policy/prompt-token-counter.ts`
- Create: `packages/agent-runtime/src/context/policy/context-reduction-strategy.ts`
- Create: `packages/agent-runtime/src/context/policy/context-step-planner.ts`

**Steps:**
1. Add injectable model context profiles and token accounting for system, tools, messages, output reserve, and safety margin.
2. Define reduction strategy proposals separately from candidate selection.
3. Provide only a deterministic historical-group omission strategy as the default baseline.
4. Abort when the mandatory prompt set exceeds budget or no strategy can make progress.
5. Test custom strategy registration and candidate selection without changing planner code.

### Task 3: Mastra step processor and final prompt guard

**Files:**
- Create: `packages/agent-runtime/src/context/protocol/mastra/mastra-context-budget-processor.ts`
- Create: `packages/agent-runtime/src/context/protocol/mastra/mastra-provider-prompt-guard-processor.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Steps:**
1. Normalize Mastra messages into complete turn groups on every `processInputStep` invocation.
2. Merge the live snapshot into request-scoped `ContextRunState`.
3. Return the planner's step-specific messages and system messages to Mastra.
4. Count and reject an oversized provider-shaped prompt in `processLLMRequest` without mutating it.
5. Emit bounded AG-UI `CUSTOM context.compiled` audit events.

### Task 4: Tool observation linkage

**Files:**
- Modify: `packages/agent-runtime/src/context/tool-observation/tool-observation-packager.ts`
- Modify: `packages/agent-runtime/src/tools/data-tools.ts` only if required by the run-state boundary

**Steps:**
1. Register source-governed tool packages in `ContextRunState`.
2. Keep current tool output schemas and bounded model projections intact.
3. Verify artifact/audit references survive package merges and later step planning.

### Task 5: Verification and documentation

**Files:**
- Create: `scripts/smoke-context-compilation.mjs`
- Modify: `package.json`
- Modify: `docs/engineering/agent-context-management-design.md`
- Modify: `todo_list.md`

**Steps:**
1. Build and run focused context compilation smoke tests.
2. Run Agent, metadata, Data Gateway, SQL, and CopilotKit context smoke tests.
3. Update section 7.4 to describe strategy proposals and candidate selection rather than a fixed compression order.
4. Mark Phase 1-3 implementation status accurately.
