# Memory Context Source Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让所有 memory-like 内容通过统一 ContextPackage source inventory 进入预算、来源治理、审计和 ContextPromptView，避免 compact memory 的不同物理投影、long-term memory、Semantic Recall、Observational Memory、Knowledge retrieval 在模型 prompt 中重复或绕路注入。

**Architecture:** 定义逻辑 memory authority，而不是让物理存储直接决定 prompt。当前 `metadata.conversation_summaries` 是 `CompactConversationMemory` 的 authoritative backend，Mastra WorkingMemory 是它的 runtime projection；`metadata.long_term_memories` 是当前 LTM authoritative backend。新增 Memory Source Governance 层，将 logical compact memory、long-term memory、future semantic recall / OM candidates 统一表达为 ContextItem / ContextGroup，再由 `ContextStepPlanner` 统一选择，由 `ContextPromptMaterializer` 物化为 provider-neutral prompt view。

**Tech Stack:** TypeScript, Mastra processors, AG-UI events, metadata SQLite repositories, ContextPackage v2, existing smoke scripts.

---

## 1. 背景和动机

当前 Agent 主链路已经从 `server.ts` 中拆出 Config / Identity / MemoryAssembly / AgentAssembly / EventPipeline / Finalizer。下一阶段的核心风险不再是 run orchestration，而是上下文来源越来越多后，模型 prompt 可能出现重复、绕路、不可审计的 memory 注入。

本计划的分层、命名和目录约定以 ADR-0003 为准：

- `docs/engineering/adr-0003-context-layering-and-naming.md`

当前同时存在这些 memory-like source：

| Source | 当前状态 | Prompt 风险 |
| --- | --- | --- |
| `metadata.conversation_messages` | 权威多轮历史，由 `ConversationMemoryService` 选择窗口 | 与 Mastra MessageHistory 必须互斥，目前已关闭 `lastMessages` |
| `metadata.conversation_summaries` | 当前是 `CompactConversationMemory` 的 authoritative backend | 不能和 WorkingMemory projection 被当成两个独立 logical source |
| Mastra read-only WorkingMemory | 当前默认 compact memory runtime projection | 由 Mastra 原生 processor 注入，projection ownership 不够显式 |
| `metadata.long_term_memories` | 已本地抽取和召回，经 `LongTermMemoryContextSource` + `MastraContextRuntimeSourceProcessor` 注入 | 已消除 production synthetic message 绕行；materialization 已收口到 `ContextPromptMaterializer` |
| future Semantic Recall / OM | 尚未生产启用 | 很容易与 summary、LTM、Knowledge 重复 |
| Knowledge retrieval | tool result adapter 已治理 | 与 long-term memory / semantic recall 可能包含相同事实 |

必须建立的原则：

1. **所有 memory-like 内容先进入 ContextPackage source inventory。**
2. **只有 ContextStepPlanner / ContextPromptMaterializer / ContextPromptView 可以决定哪些 source model-visible。**
3. **CompactConversationMemory 必须是一个 logical source；metadata summary 和 WorkingMemory 只是 backend/projection 关系。**
4. **未来 Semantic Recall / OM 默认 shadow-only，除非实现 `RuntimeContextSource`、budget policy、audit event。**
5. **完成阶段的 memory extraction 不应拖慢用户看到 terminal 状态。**

## 2. 当前真实链路

详见 HTML walkthrough：

- `docs/engineering/2026-06-23-memory-context-prompt-walkthrough.html`

当前典型任务 `分析 orders 表，先看 schema。` 的真实模型请求：

1. CopilotKit 调用 `/api/copilotkit` 的 `agent/run`。
2. `createRunMemoryAssembly()` 写入当前 user message，构造 `conversationMessages`，召回 `longTermMemories`。
3. `createRunAgentAssembly()` 调用 `createDataAgent()` 并装配 MastraAgent。
4. Mastra provider prompt 首轮包含：
   - Data Agent system instructions
   - Mastra workspace system message
   - Mastra WorkingMemory system/context message
   - 当前 user message
   - `tools` 字段中的 tool schema
5. 每个 ReAct step 前按顺序运行：
   - `MastraTaskStateContextProcessor`
   - `MastraContextRuntimeSourceProcessor`
   - `MastraContextBudgetProcessor`
   - `MastraProviderPromptGuardProcessor`
6. Mastra `MastraContextRuntimeSourceProcessor` 会把 run-scoped source（当前包括 long-term memory）收集到
   `ContextRunState`。
7. `MastraContextBudgetProcessor` 会把当前 messages / systemMessages 建成 live ContextPackage，然后
   `ContextPromptMaterializer` 从 `ContextPackage.groups` 构造 source / turn prompt groups，再由
   `ContextStepPlanner` 选择 `ContextPromptView.messages`。
8. `RUN_FINISHED` 后，`RunFinalizer.complete()` 触发 conversation summary 和 long-term memory extraction。

## 3. 关键问题

### 3.1 ContextPackage 还不是唯一上下文编译层

当前 `ContextPackage` 已经是 tool observations、runtime source 和 live message inventory 的核心结构。
`ContextPromptMaterializer` 已经从 `ContextPackage.groups` 读取 model-visible source groups 和 turn groups，
再交给 planner 做选择和 reduction decisions。`MastraConversationContextAdapter` 已经负责把 Mastra
messages/systemMessages 转成 live package items；`MastraContextBudgetProcessor` 只负责调用该 protocol source、merge package、
触发 planner 和审计事件。

当前长期记忆已采用 runtime source 过渡链路：

```text
metadata.long_term_memories
  -> LongTermMemoryContextSource
  -> MastraContextRuntimeSourceProcessor
  -> ContextRunState.merge(source package)
  -> ContextStepPlanner selects source group
  -> materialized prompt message: id=context:long-term-memory
```

它已经消除了 synthetic message 绕行，materialization 也已收口到 `ContextPromptMaterializer`。目标应该是：

```text
metadata.long_term_memories
  -> LongTermMemoryContextSource
  -> ContextRunState inventory
  -> ContextStepPlanner plans source groups directly
  -> ContextPromptMaterializer materializes selected source groups
```

### 3.2 Compact memory source 需要从断言升级为策略

当前 `assertCompactMemoryPromptBoundary()` 能防止 WorkingMemory 模式下再注入 `memory-summary:*` message，但这只是单点断言。未来 source 增多后，需要统一 authority/projection policy：

- 同一个 logical source `compact-conversation-memory` 只能有一个 model-visible prompt projection。
- `metadata-summary` 是当前 authoritative backend。
- `mastra-working-memory` 是 runtime projection/cache，不是独立 authority。
- future OM summary 如果启用，也只能作为候选生成器或 projection，不能直接成为第二个 compact source。
- shadow source 可以存在，但不能进入 ContextPromptView。

### 3.3 完成阶段 memory extraction 增加 terminal 延迟

当前 completed 分支中，summary / LTM extraction 发生在标记 completed 和发 `RUN_FINISHED` 前。虽然失败被吞掉，但 LLM extractor 耗时仍会拖慢 terminal event。

目标：

- terminal 用户感知优先。
- memory extraction 可 timeout / background / 阈值触发。
- extraction 结果仍可审计。
- suspended / canceled / failed 不写 partial assistant memory。

### 3.4 metadata repository 边界会继续承压

metadata 当前同时承担 business state、config resources、conversation memory、summaries、long-term memories、knowledge base 底座。local-first 阶段可接受，但 memory governance 会继续增加写入点和 background job，需要提前规范 repository 边界和 migration。

本计划只处理 memory/context single entry；metadata repository 拆分作为后续计划。

## 4. 设计约束

### 4.1 不变量

1. `metadata.conversation_messages` 是权威多轮对话历史。
2. `CompactConversationMemory` 是逻辑权威对象；当前 authoritative backend 是 `metadata.conversation_summaries`。
3. Mastra WorkingMemory 是 `CompactConversationMemory` 的派生投影/cache，不是独立权威源。
4. Mastra MessageHistory 保持关闭：`lastMessages=false`。
5. Semantic Recall / OM 未治理前不能 model-visible。
6. AG-UI 北向事件类型不自定义替代，不破坏 CopilotKit 协议。
7. 不持久化 hidden thought，不把完整 provider prompt 落库。
8. `context.compiled` / `context.prompt-verified` 只能记录 bounded metadata。
9. 工具大结果必须经过 `ToolObservationAdapter`；memory-like 内容必须经过 `RuntimeContextSource`。
10. 所有 source 必须带 provenance：source type、source id、scope、trust、retention、content hash。

### 4.2 非目标

本阶段不做：

- 不启用 Mastra Semantic Recall 生产注入。
- 不启用 Observational Memory 生产注入。
- 不接新向量模型。
- 不重构 Data Gateway。
- 不改变 CopilotKit 北向协议。
- 不引入额外 server 端口。
- 不把 prompt 全量持久化。

### 4.3 兼容约束

1. 现有 smoke 必须继续通过。
2. `working-memory-readonly` 默认行为不能倒退。
3. `off` / `shadow` / `working-memory-readonly` 模式语义必须可解释。
4. `LongTermMemoryContextProcessor` prepend-message path 已删除；LTM 只能通过 runtime source inventory 进入 prompt。
5. 每一步都要能独立回滚。

## 5. 目标架构

### 5.1 Runtime Source Registry and Tool Observation Registry

早期工具 adapter registry 混用了 source 和 tool observation 概念；当前实现已拆成两个 registry。

目标架构不继续把 memory-like source 塞进这个类里。我们将明确拆分两个概念：

1. `RuntimeContextSourceRegistry`
   - 管 logical / run-scoped context sources。
   - 包括 compact conversation memory、long-term memory、future semantic recall candidate、future OM candidate。
   - 未来也可以承载 conversation source / selected datasource context source。

2. `ToolObservationAdapterRegistry`
   - 管 tool observation / tool result projection。
   - 包括 `inspect_schema`、`run_sql_readonly`、`retrieve_knowledge`、workspace tools、task tools、collaboration tools、MCP tools。
   - 当前 production path 使用 `ToolObservationAdapterRegistry`，不存在旧兼容 wrapper。

这个拆分是有意的：tool adapter 回答“某个工具 observation 如何投影给下一轮模型”，runtime source 回答“某个逻辑上下文来源是否、为何、以什么优先级进入 prompt”。两者不应混在同一个 registry 里。

候选接口：

```ts
export type ContextSourceInput = {
  kind: "conversation" | "compact-memory" | "long-term-memory" | "knowledge" | "tool-observation" | string;
  raw: unknown;
  sourceId: string;
  scope?: {
    userId?: string;
    sessionId?: string;
    datasourceId?: string;
  };
  visibilityPolicy?: "model-visible" | "shadow" | "audit-only";
};

export interface RuntimeContextSource {
  readonly sourceType: string;
  collect(input: RuntimeContextSourceInput): ContextItem[] | Promise<ContextItem[]>;
}
```

建议新增的 runtime sources：

```ts
CompactConversationMemoryContextSource
LongTermMemoryContextSource
WorkingMemoryProjectionContextSource
SemanticRecallCandidateContextSource
ObservationalMemoryCandidateContextSource
```

其中 `WorkingMemoryProjectionContextSource` 默认只做 projection snapshot / audit，不直接声明独立 authority。

迁移原则：

- `RuntimeContextSourceRegistry` 已新增。
- 工具 registry production path 使用 `ToolObservationAdapterRegistry`。
- `ToolObservationPackager` 明确依赖 tool observation registry；`MastraContextBudgetProcessor` / source compiler 明确依赖 runtime source registry。

### 5.2 Source Policy

新增 `ContextSourcePolicy`，在 planner 前处理 source 可见性、互斥和去重。

核心字段建议放在 `ContextItem.metadata`：

```ts
{
  sourceKind: "compact-memory" | "long-term-memory" | "knowledge",
  sourceOwner: "metadata-summary" | "mastra-working-memory" | "metadata-ltm" | "knowledge-tool",
  exclusivityKey: "compact-conversation-memory",
  dedupeKeys: ["fact:orders.refund-rate", "citation:..."],
  shadow: false,
  memoryIds: [...],
  summaryId: "...",
  confidence: 0.88
}
```

策略：

- `shadow=true` 的 item 进入 ContextPackage inventory，但不能进入 ContextPromptView。
- 同一 `exclusivityKey` 下，最多一个 group model-visible。
- Compact memory 不靠 dedupe 解决重复，而靠 authority/projection ownership。
- 同一 `dedupeKey` 多个 independent source 命中时，优先级：
  1. tool observation / fresh data
  2. Knowledge citation
  3. metadata long-term memory
  4. compact conversation memory
  5. semantic recall / OM shadow
- 被去重或省略的 source 必须记录到 `ContextDecision`。

### 5.3 Prompt Materializer

当前 `ContextPromptMaterializer` 已经负责从 `ContextPackage.groups` 中的 source groups / message turn groups 物化
`ContextPromptView`，`ContextStepPlanner` 负责选择和 reduction decisions：

```text
ContextPackage.items
  -> groups
  -> source policy
  -> reduction strategy
  -> selected groups
  -> ContextPromptMaterializer
  -> ContextPromptView.systemMessages + ContextPromptView.messages
```

当前最小实现：

- conversation turn 已来自 `ContextPackage` inventory；messages 只作为 processor 构建 live package 的输入。
- memory source group 默认物化为 compiler-controlled user context block；system message 只保留运行策略、安全边界和工具约束。
- source message id 当前由 compiler 生成，例如 `context:long-term-memory`。
- 不允许 `RuntimeContextSource` 自己直接往 `args.messages` 头部插 message。

### 5.4 Audit Events

扩展 `context.compiled` payload，但不记录完整内容：

```ts
{
  selected_sources: [
    {
      source_type: "long-term-memory",
      source_id: "long-term-memory",
      group_id: "source:long-term-memory",
      content_hash: "...",
      token_cost: 123,
      retention: "supporting"
    }
  ],
  omitted_sources: [
    {
      source_type: "metadata-summary",
      group_id: "compact-memory:metadata-summary",
      reason: "exclusive_source_replaced_by_working_memory"
    }
  ]
}
```

## 6. Phase Plan

### 6.0 Implementation Status on 2026-06-23

已完成：

- `ContextItem` / `ContextPackage` / `ContextPackageBuilder` / `ContextRunState` 实现移动到 `context/inventory/*`。
- 新增 `ToolObservationAdapterRegistry`，生产路径使用它管理工具观测 adapter；旧混合 registry 已删除。
- 新增 `RuntimeContextSourceRegistry` 和 Mastra `MastraContextRuntimeSourceProcessor`。
- 新增 `LongTermMemoryContextSource`，production LTM 注入不再使用 prepend message processor。
- `ContextSourcePolicy` 当前在 Mastra context processor 中先处理 source 可见性、authority 和去重；
  `ContextPromptMaterializer` 再从 `ContextPackage.groups` 合并保留的 runtime source group 和 turn group。
- `ContextStepPlanner` 已移动到 `context/policy/context-step-planner.ts`，统一做预算选择和 reduction decisions。
- `smoke-long-term-memory` 已更新为验证 `context-runtime-source` processor 和 source materialization。
- `smoke-context-compilation` 已更新为直接验证 `ContextPromptMaterializer`。
- 新增 source metadata helpers：`sourceKind` / `sourceOwner` / `exclusivityKey` / `dedupeKeys` / `shadow` / `scope`。
- `ContextPackage.sourceSnapshots` 已包含 bounded source metadata summary。
- 新增 `ContextSourcePolicy`，处理 shadow omission、同一 exclusivity key 的 authority/projection 选择、
  exact source duplicate omission。
- `memory-summary:*` 已在 `MastraContextBudgetProcessor` 中转成 `compact-conversation-memory` source，并由
  `ContextPromptMaterializer` 物化为 `context:compact-conversation-memory`。
- `context.compiled` 已包含 bounded `selected_sources` / `omitted_sources` metadata。
- 新增 `WorkingMemoryProjectionContextSource`，Mastra WorkingMemory projection 现在会作为 shadow
  `compact-conversation-memory` source 进入 ContextPackage snapshot，但不会进入模型 prompt。
- Mastra `MastraContextRuntimeSourceProcessor` 已支持 async runtime source collection。
- 新增 `MastraConversationContextAdapter`，live conversation/system messages 的 inventory 转换已从
  `MastraContextBudgetProcessor` 内联逻辑中移出，并位于 `context/protocol/mastra`。

仍未完成：

- WorkingMemory 原生 system context 仍由 Mastra memory processor 注入；ContextPackage 目前记录它的 shadow
  projection snapshot，用于审计和 one-source policy。
- Future Semantic Recall / OM 仍未启用，也不应 model-visible。

### Phase 0: Baseline Capture and Guard Rails

目的：在改编译器前锁住当前行为。

**Files:**

- Modify: `scripts/smoke-copilotkit-run.mjs`
- Create: `scripts/smoke-prompt-source-governance.mjs`
- Modify: `package.json`
- Reference: `docs/engineering/2026-06-23-memory-context-prompt-walkthrough.html`

**Tasks:**

1. Add a prompt capture helper to record provider request bodies from a fake OpenAI-compatible endpoint.
2. Assert first provider request includes:
   - Data Agent system instruction.
   - WorkingMemory system message in `working-memory-readonly` mode.
   - No `memory-summary:*` user message in `working-memory-readonly`.
   - Current user message preserved.
3. Assert completed run may trigger LTM extractor as a separate provider request.
4. Add smoke script `smoke:prompt-source-governance`.

**Acceptance:**

```bash
npm run smoke:prompt-source-governance
npm run smoke:conversation-memory
npm run smoke:long-term-memory
npm run smoke:context-compilation
```

All pass.

### Phase 1: Source Metadata Contract

目的：先统一 source metadata，不改变 prompt 形态。

Status: completed. Helpers live in `context/inventory/context-source-metadata.ts`, and source snapshot metadata is
covered by `smoke-context-compilation`.

**Files:**

- Modify: `packages/agent-runtime/src/context/tool-observation/tool-observation-adapter.ts`
- Modify: `packages/agent-runtime/src/context/inventory/context-package.ts`
- Modify: `packages/agent-runtime/src/context/inventory/context-package-builder.ts`
- Modify: `packages/agent-runtime/src/context/inventory/context-run-state.ts`
- Modify: `scripts/smoke-context-compilation.mjs`

**Tasks:**

1. Add typed metadata helpers for source governance:
   - `sourceKind`
   - `sourceOwner`
   - `exclusivityKey`
   - `dedupeKeys`
   - `shadow`
   - `scope`
2. Keep `ContextItem.metadata` as the storage shape for compatibility.
3. Add helper functions rather than hardcoding string checks everywhere:
   - `isShadowContextItem(item)`
   - `contextItemExclusivityKey(item)`
   - `contextItemDedupeKeys(item)`
4. Add smoke coverage for source snapshots including metadata fields.

**Acceptance:**

- No runtime behavior change.
- ContextPackage source snapshots expose enough metadata for decisions.
- Existing tests pass.

### Phase 2: Compact Memory Authority / Projection Policy

目的：把 `assertCompactMemoryPromptBoundary()` 升级为统一 authority/projection policy。

Status: core policy completed for ContextPackage sources. `assertCompactMemoryPromptBoundary()` remains as an ingress
guard for Mastra WorkingMemory native injection, because WorkingMemory is still provider/runtime system context rather
than a ContextPackage source.

**Files:**

- Modify: `apps/api/src/run-memory-assembly.ts`
- Modify: `apps/api/src/conversation-memory.ts`
- Create: `packages/agent-runtime/src/context/policy/context-source-policy.ts`
- Modify: `packages/agent-runtime/src/context/policy/context-step-planner.ts`
- Modify: `scripts/smoke-conversation-memory.mjs`
- Modify: `scripts/smoke-prompt-source-governance.mjs`

**Tasks:**

1. Introduce `ContextSourcePolicy`.
2. Define one logical source: `compact-conversation-memory`.
3. Define current backend/projection ownership:
   - authoritative backend: `metadata-summary`
   - runtime projection: `mastra-working-memory`
   - future candidate/projection: `observational-summary`
4. Convert current duplicate summary assertion into policy-level authority check where possible.
5. Keep fail-closed behavior if two compact memory prompt projections are both marked model-visible before planner can choose.
5. Emit omitted decision reason:
   - `non_authoritative_projection_omitted`
   - `shadow_source_not_model_visible`
   - `duplicate_exact_source_omitted`

**Acceptance:**

- `working-memory-readonly` prompt has WorkingMemory and no `memory-summary:*`.
- `off` mode can still inject metadata summary.
- Forced duplicate compact projection fails or emits deterministic omission decision.

### Phase 3: Long-Term Memory Direct Runtime Source

目的：移除 LTM “先 synthetic user message 再识别为 source”的绕行。

Status: production path completed for local LTM records. LTM now enters inventory through
`LongTermMemoryContextSource`; the old prepend-message adapter path has been removed.

**Files:**

- Modify: `packages/agent-runtime/src/context/source/long-term-memory-context-source.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/api/src/run-agent-assembly.ts`
- Modify: `scripts/smoke-long-term-memory.mjs`
- Modify: `scripts/smoke-context-compilation.mjs`

**Tasks:**

1. Keep LTM code behind `LongTermMemoryContextSource`; do not expose a separate memory `ContextAdapter`.
2. Register LTM records as source items on `ContextRunState` before each model step.
3. Change planner/materializer so selected LTM source group is materialized by compiler, not by processor mutating `args.messages`.
4. Keep message id stable and compiler-owned:
   - current: `context:long-term-memory`
   - target if multiple LTM groups are introduced: `context-source:long-term-memory:<contentHash>`
5. Mark LTM group:
   - `sourceKind=long-term-memory`
   - `sourceOwner=metadata-ltm`
   - `trust=memory`
   - `retention=supporting`
   - `priority=35`
6. Add smoke assertion that production configures LTM only through `MastraContextRuntimeSourceProcessor`.

**Acceptance:**

- LTM still appears in provider prompt when records exist.
- `context.compiled` selected sources include `long-term-memory`.
- No direct LTM processor message prepend remains in production path.

### Phase 4: Prompt Materializer

目的：让 `ContextPromptView` 成为唯一 provider prompt 投影。

Status: minimal implementation completed. `ContextSourcePolicy` runs before prompt group materialization, and
`ContextPromptMaterializer` owns prompt group creation plus `ContextPromptView` assembly. Prompt group token cost is
computed by `ContextStepPlanner` / `PromptTokenCounter`, so projection no longer depends on model profiles or token
counters. Remaining work is to move more policy metadata into `ContextDecision`.

**Files:**

- Create: `packages/agent-runtime/src/context/projection/context-prompt-materializer.ts`
- Modify: `packages/agent-runtime/src/context/policy/context-step-planner.ts`
- Modify: `packages/agent-runtime/src/context/protocol/mastra/mastra-context-budget-processor.ts`
- Modify: `scripts/smoke-context-compilation.mjs`

**Tasks:**

1. Add `ContextPromptMaterializer`.
2. Support at least these group kinds:
   - `system`
   - `turn`
   - `source`
   - `tool-exchange`
3. Materialize selected source groups into bounded provider messages.
4. Preserve conversation turn atomicity.
5. Keep current `ContextPromptView` shape:
   - `systemMessages`
   - `messages`
   - `tokenReport`
6. Add source-level token costs to `ContextPlan`.

**Acceptance:**

- Planner can omit source groups without mutating original messages.
- `MastraProviderPromptGuardProcessor` still validates final prompt.
- Existing ReAct tool result loop still works.

### Phase 5: Knowledge / Memory Overlap Reporting

目的：为 future Semantic Recall / OM 和 Knowledge/LTM 事实重叠治理做准备，但不启用新召回、不做激进语义删除。

Status: Implemented as bounded source metadata and policy decisions. Knowledge retrieval now enters the source inventory
as `sourceKind=knowledge`; each retrieved Knowledge chunk becomes its own model-visible `ContextItem`, so exact dedupe
can omit a duplicate chunk without dropping unrelated chunks from the same retrieval. LTM records and Knowledge chunks
expose deterministic dedupe/overlap keys. The policy omits only exact duplicates and records cross-source overlap as
`cross_source_overlap_flagged` while keeping both sources model-visible.

**Files:**

- Modify: `packages/agent-runtime/src/context/tool-observation/adapters/data-tool-observation-adapters.ts`
- Modify: `packages/agent-runtime/src/context/source/long-term-memory-context-source.ts`
- Modify: `packages/agent-runtime/src/context/policy/context-source-policy.ts`
- Modify: `packages/agent-runtime/src/context/projection/context-prompt-materializer.ts`
- Modify: `scripts/smoke-context-compilation.mjs`
- Keep: `scripts/smoke-memory-recall-shadow.mjs`

**Tasks:**

1. Add optional `dedupeKeys` for exact Knowledge chunks and LTM records.
2. Use simple deterministic keys first:
   - source id
   - citation id
   - datasource id + normalized content hash
3. Do not add embedding similarity yet.
4. Surface overlap candidates through source metadata and `context.compiled` decisions; `smoke:context-compilation`
   asserts Knowledge/LTM overlap behavior.
5. Omit exact duplicates only. Flag semantic overlap but keep both sources model-visible until embeddings/reranking exist.

**Acceptance:**

- Knowledge/LTM overlap is covered by `smoke:context-compilation`.
- No semantic recall production injection.
- No vector model added.

### Phase 6: Completed Memory Extraction Latency Control

目的：让 post-run completed terminal 不被 summary / long-term memory extractor 长时间阻塞。在线 prompt compaction 不属于这一阶段，仍必须同步完成。

Status: Implemented with timeout-first control. `MEMORY_EXTRACTION_TIMEOUT_MS` bounds completed-run summary/LTM
optimization before terminal emission. `RunFinalizer` emits `memory.completed-flush.timeout` before `RUN_FINISHED` when
the bound is exceeded, closes the scoped memory emitter to prevent late custom events, and preserves suspended/canceled
behavior. Conversation assistant draft persistence still happens before extraction optimization; prompt-time compaction
is unchanged and remains synchronous.

**Files:**

- Modify: `apps/api/src/run-memory-assembly.ts`
- Modify: `apps/api/src/run-finalizer.ts`
- Create or Modify: metadata repository for memory job state if needed
- Modify: `scripts/smoke-copilotkit-run.mjs`
- Modify: `scripts/smoke-long-term-memory.mjs`

**Options:**

1. **Timeout-first**
   - Add timeout around summary and LTM extraction.
   - If timeout, emit bounded custom event and skip.
   - Lowest complexity.

2. **Background job**
   - Mark run completed first.
   - Queue memory extraction in local background executor.
   - Emit extraction event only if subscriber still active, otherwise persist as metadata job event.
   - More correct long-term, more moving parts.

3. **Threshold trigger**
   - Extract only when assistant text length / message count / run importance crosses threshold.
   - Reduces cost but does not solve worst-case latency alone.

**Recommendation:** implement timeout-first for post-run extraction now, design background job next. Online context compression remains synchronous.

Implemented behavior:

- `RunFinalizer.complete()` waits for completed-run memory flush only up to `MEMORY_EXTRACTION_TIMEOUT_MS`.
- The flush receives an `AbortSignal`; summary and LTM services check it before post-LLM persistence.
- Late memory events are dropped after timeout by a scoped emitter.
- The terminal sequence remains: optional timeout/failure custom event -> `runStatus=completed` delta -> workspace
  destroy -> `RUN_FINISHED`.
- Background job persistence is still not enabled.

**Acceptance:**

- `RUN_FINISHED` terminal order remains stable. Covered by `smoke:copilotkit-run`.
- Slow extractor cannot delay terminal beyond configured timeout. Covered by `memory.completed-flush.timeout` assertion
  in `smoke:copilotkit-run`.
- Suspended/canceled runs still do not flush partial assistant memory. Covered by `smoke:copilotkit-run`.

## 7. Implementation Order

Recommended order:

1. Phase 0 baseline smoke.
2. Phase 1 source metadata contract.
3. Phase 2 compact memory source policy.
4. Phase 3 LTM direct `RuntimeContextSource`.
5. Phase 4 PromptMaterializer.
6. Phase 6 timeout-first post-run extraction control.
7. Phase 5 Knowledge/LTM overlap reporting.

Reasoning:

- Phase 0-2 gives immediate guard rails without deep prompt compiler surgery.
- Phase 3-4 addresses the real architectural issue.
- Extraction latency can be solved after source visibility is safe, unless user-facing delay becomes urgent.
- Cross-source semantic overlap handling should wait until source metadata and materializer are stable.

## 8. Smoke and Regression Matrix

Run after each phase:

```bash
npm run build
npm run smoke:context-compilation
npm run smoke:conversation-memory
npm run smoke:long-term-memory
npm run smoke:memory-recall-shadow
npm run smoke:copilotkit-run
npm run smoke:api-context
npm run smoke:collaboration
```

Additional new smoke:

```bash
npm run smoke:prompt-source-governance
```

It must verify:

- provider prompt does not contain multiple compact memory projections;
- selected / omitted source decisions are observable;
- LTM enters through source governance path;
- final prompt stays under budget;
- ReAct second step still receives governed tool observation.

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Planner refactor breaks ReAct tool result messages | High | Phase 0 prompt capture smoke before refactor; keep turn atomicity mandatory |
| Source direct injection makes memory disappear from prompt | High | Add provider prompt capture assertions for LTM |
| Too much source metadata bloats events | Medium | Emit hashes, ids, token cost, decisions only; never emit full prompt |
| WorkingMemory remains opaque because Mastra injects it internally | Medium | Represent WorkingMemory as derived source snapshot and assert no metadata summary duplicate |
| Overlap rules remove useful context | Medium | Omit exact duplicates only; semantic overlap is shadow/flag-only before embeddings |
| Background extraction introduces job complexity | Medium | Implement timeout-first before background job |

## 10. Open Decisions

These need confirmation before implementation:

1. **Materialized memory source role:** should compiler materialize memory source as `system` message or `user` message?
   - Decision: compiler-owned memory context should default to user-role context blocks. System messages are reserved for runtime policy, safety, and tool constraints. Current Mastra WorkingMemory may still be injected by Mastra as system/context until we fully own prompt materialization.

2. **Fail-closed vs omit duplicate:** if two compact memory prompt projections are model-visible, should we fail the run or deterministically choose one?
   - Decision: fail-closed during current early product stage and in smoke tests. Deterministic omission can be considered later after context source metrics exist.

3. **Extraction latency strategy:** timeout-first or background job first?
   - Decision: this only applies to post-run summary/LTM extraction. Use timeout-first now and design background job later. Online context compression remains synchronous because it affects the next model call.

4. **Semantic Recall policy:** when future vector recall is enabled, does it recall raw messages, summaries, or LTM records?
   - Decision: LTM means metadata-backed structured long-term memory. Future recall should return source refs to summaries/LTM first; raw message recall requires privacy/audit review.

5. **Knowledge vs memory dedupe:** without embeddings, should duplicate content be omitted or merely flagged?
   - Decision: omit exact duplicates only; semantic overlap is flagged, not removed.

## 11. Definition of Done

This governance work is complete when:

1. No production memory-like source directly prepends messages outside the ContextPromptView compiler.
2. `context.compiled` can explain selected and omitted memory sources by id/hash/reason.
3. compact memory has one logical source; metadata summary and WorkingMemory cannot both appear as independent model-visible prompt sources.
4. LTM is represented as source inventory before materialization.
5. future Semantic Recall / OM have documented adapter gates and cannot bypass ContextPackage.
6. terminal event latency is bounded against slow memory extraction.
7. all existing and new smoke tests pass.
