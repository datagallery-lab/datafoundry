# Mastra Memory Controlled Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 接入 Mastra Memory，但保持 metadata 的 `conversation_messages` / `conversation_summaries` 为权威历史，只把 Mastra Memory 作为受控的长期记忆增强层。

**Architecture:** DataAgent 继续由服务端 `ConversationMemoryService` 组装权威入口上下文；Mastra Memory 先以 `lastMessages=false` 接入同一个 DataAgent memory slot，避免 MessageHistory 自动注入重复历史。第一阶段只把权威 summary 单向 mirror 到 Mastra read-only working memory，后续再按门禁开启 semantic recall 或 observational memory。

**Tech Stack:** TypeScript, `@mastra/core`, `@mastra/memory`, `@mastra/libsql`, `@ag-ui/mastra`, metadata SQLite, existing smoke scripts.

---

## Implementation Status

Updated: 2026-06-23

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1: Memory Runtime Refactor | Done | Added `AgentMemoryRuntime` / `createAgentMemoryRuntime` while preserving `TaskStateRuntime` / `createTaskStateRuntime`. Runtime mode is explicit and always keeps `lastMessages=false`, `semanticRecall=false`, and `observationalMemory=false`. |
| Phase 2: Shadow WorkingMemory Projection | Done | Added `ConversationMemoryBridge`; after a metadata summary commit, the latest summary is mirrored into Mastra WorkingMemory. This is shadow-only and does not enter provider prompts. |
| Phase 3: Read-Only WorkingMemory Injection | Done | Server default is `working-memory-readonly`; latest metadata summary is synced to Mastra WorkingMemory before a new run, duplicate `memory-summary:*` injection is blocked, and read-only memory tools are not exposed. |
| Phase 4a: Local Long-Term Memory Source | Done | Added metadata-backed `long_term_memories`, automatic completed-run extraction, local relevance retrieval, and a governed `LongTermMemoryContextSource` that enters ContextPackage before any semantic recall is made model-visible. |
| Phase 4b: Semantic Recall Evaluation | Shadow gate started | Added `smoke:memory-recall-shadow` report shape comparing local long-term memory and Knowledge retrieval. Mastra Semantic Recall remains `not_configured` until vector/embedder policy is approved. |
| Phase 5: Observational Memory Shadow Mode | Not started | Requires quality/latency/audit comparison with metadata summaries. |

## Research Summary

### Official Mastra Behavior

Mastra Memory 包含四类核心能力：

| Capability | 官方语义 | 对当前项目的判断 |
| --- | --- | --- |
| Message History | 自动加载最近历史，并在模型响应后持久化新消息。官方也提醒 client 应只发送新消息，避免全量历史和存储历史冲突。 | 暂不启用。我们当前已经由服务端组装权威历史；启用会产生重复 history 和排序风险。 |
| Working Memory | 持久化结构化用户/任务状态，可按 resource 或 thread 作用域注入 prompt。 | 适合作为第一阶段接入点，但必须 read-only 注入，更新由后端 bridge 控制。 |
| Semantic Recall | 用 vector + embedder 从历史消息中召回语义相关消息，并为新消息生成 embedding。 | 第二阶段以后接入。会增加延迟和向量存储，需要先确定它召回的是权威摘要、原始消息还是二者之一。 |
| Observational Memory | 用 Observer/Reflector 后台 agents 把长历史压缩为 dense observation log，是 Mastra 推荐的长上下文方案。 | 第三阶段以后 shadow-first。它和我们现有 summary 语义重叠，不能直接接管权威摘要。 |

Source references:

- Mastra Memory overview: https://mastra.ai/docs/memory/overview
- Message History: https://mastra.ai/docs/memory/message-history
- Memory processors: https://mastra.ai/docs/memory/memory-processors
- Working Memory: https://mastra.ai/docs/memory/working-memory
- Semantic Recall: https://mastra.ai/docs/memory/semantic-recall
- Observational Memory: https://mastra.ai/docs/memory/observational-memory
- Multi-user memory layer guidance: https://mastra.ai/docs/memory/multi-user-threads

### Local Package Findings

Installed dependencies already include:

- `@mastra/core@1.43.0`
- `@mastra/memory@1.21.0`
- `@mastra/libsql@1.14.0`

Current code already creates a Mastra `Memory` in `packages/agent-runtime/src/memory/task-state-runtime.ts`, but it is intentionally constrained:

```ts
options: {
  generateTitle: false,
  lastMessages: false,
  observationalMemory: false,
  readOnly: true,
  semanticRecall: false,
  workingMemory: { enabled: false }
}
```

`@ag-ui/mastra` local agent path passes `memory: { thread: input.threadId, resource: resourceId }` to `agent.stream()`. Therefore any non-disabled Memory processor attached to the DataAgent can enter the prompt/persistence pipeline automatically.

## Architecture Decision

### ADR: Metadata Remains Authoritative; Mastra Memory Is an Enhancement Layer

**Status:** Proposed.

**Context:** The project already stores AG-UI events, conversation messages, and conversation summaries in metadata. DataAgent currently receives server-authoritative history and rejects client-supplied old assistant/system/developer messages as model history. Mastra MessageHistory would load and persist history independently, which would duplicate or conflict with this ownership model.

**Decision:** Do not enable Mastra MessageHistory for production prompt history. Configure DataAgent Memory with `lastMessages=false`. Use Mastra WorkingMemory first as a read-only compact memory projection sourced from `conversation_summaries`.

**Consequences:**

- Positive: keeps one authoritative history source, avoids duplicate prompt history, allows gradual use of Mastra-native memory APIs.
- Negative: does not immediately use Mastra's automatic raw history persistence.
- Neutral: we keep two stores temporarily: metadata as source of truth, Mastra LibSQL as derived memory projection.

**Alternatives considered:**

- Enable `lastMessages` and remove our entry history builder: rejected because this transfers authority to Mastra storage too early and breaks existing replay/audit assumptions.
- Enable Observational Memory immediately: rejected because OM overlaps with our summary lifecycle and adds background model calls before we have comparison tests.
- Keep only custom metadata summary forever: rejected because Mastra WorkingMemory/SemanticRecall can provide native integration with agent processors once governed.

## Target Architecture

Architecture diagram:

- HTML diagram: `docs/engineering/mastra-memory-controlled-integration.html`

Runtime flow:

1. API receives AG-UI run with current user message.
2. `ConversationMemoryService` persists current user and builds authoritative window from metadata.
3. `createDataAgent` attaches one `AgentMemoryRuntime.memory` to the Mastra Agent.
4. The memory is configured with `lastMessages=false` so raw Mastra message history does not enter the prompt.
5. Before a new non-resume run, the latest metadata summary is synced into Mastra WorkingMemory when
   `MASTRA_CONVERSATION_MEMORY_MODE=working-memory-readonly`.
6. During `agent.stream()`, Mastra's own memory input processor injects WorkingMemory as read-only context.
7. After `RUN_FINISHED`, metadata summary is generated and committed, then `MemoryBridge` mirrors the trusted summary
   into Mastra WorkingMemory for later runs.

## History Injection And Trigger Plan

This is the explicit ownership model for history injection. There must be exactly one compact conversation-history source in the model-visible prompt for any production mode.

| Mode | What injects history | Trigger | Prompt-visible form | Mastra Memory role |
| --- | --- | --- | --- | --- |
| `off` | `ConversationMemoryService.buildRunMessages()` | After run claim, before `createDataAgent()` on a non-resume run. | `memory-summary:*` tagged user message, unsummarized recent user/assistant messages, current user message. | Not used for conversation memory. |
| `shadow` | Same as `off`. | Same as `off`. | Same as `off`. | After summary commit, `MemoryBridge` mirrors latest summary into WorkingMemory, but it does not enter prompt. |
| `working-memory-readonly` | Mastra WorkingMemory injects compact memory; `ConversationMemoryService` still injects current user and any unsummarized recent messages. | WorkingMemory projection is written after summary commit; injection happens on the next Mastra `stream()` input processor pass. | Read-only WorkingMemory system/context message, unsummarized recent user/assistant messages, current user message. The tagged `memory-summary:*` user message is not injected in this mode. | Derived compact memory projection only; `lastMessages=false`. |
| `semantic-recall-shadow` | Same as `working-memory-readonly` for prompt history. | Recall experiments are triggered by test/spike scripts or gated runtime flag. | Recalled items are logged/compared but not model-visible until they have a `RuntimeContextSource` representation and budget policy. | Vector recall evaluation only. |
| `observational-shadow` | Same as `working-memory-readonly` for prompt history. | OM observer runs only in disposable/shadow storage after test-seeded messages. | OM observations are compared with metadata summaries but not trusted as prompt history. | Quality/latency/audit comparison only. |

### Concrete Trigger Points

1. **Current user persistence**
   - Trigger: new non-resume AG-UI run after identity validation and run claim.
   - Action: write current user text to `conversation_messages`.
   - Reason: keeps metadata authoritative before any provider call.

2. **Entry window injection**
   - Trigger: immediately before `createDataAgent()`.
   - Action: load latest summary and unsummarized recent history from metadata, then pass the resulting `Message[]` into DataAgent.
   - Guard: do not trust client-supplied old assistant/system/developer messages.

3. **Assistant persistence**
   - Trigger: AG-UI `RUN_FINISHED` on a completed run.
   - Action: collect streamed assistant text chunks and append one assistant message per completed assistant draft.
   - Guard: suspended, canceled, and failed runs do not write partial assistant text.

4. **LLM summary generation**
   - Trigger: after assistant persistence, only when unsummarized message count reaches `summaryTriggerMessages`.
   - Action: call `MastraConversationSummarizer`; fallback to deterministic summarizer if the LLM fails or returns empty text.
   - Output: new `conversation_summaries` record with `from_position` / `to_position`.

5. **Mastra WorkingMemory mirror**
   - Trigger: only after `conversation_summaries.create()` succeeds.
   - Action: write a structured projection to Mastra WorkingMemory.
   - Guard: this is one-way from metadata to Mastra. The model does not write working memory in Phase 2.

6. **Read-only WorkingMemory prompt injection**
   - Trigger: current server default is `working-memory-readonly`; injection happens inside Mastra's memory input
     processor pipeline during `agent.stream()`.
   - Action: inject the mirrored compact memory as read-only context.
   - Guard: `lastMessages=false`; `ConversationMemoryService` still filters summarized raw messages, but does not add
     a `memory-summary:*` user message in this mode. `assertCompactMemoryPromptBoundary()` fails the run if that duplicate
     compact source reappears.

## Non-Functional Requirements

| Category | Requirement |
| --- | --- |
| Correctness | No duplicate history: a summarized message must not appear both through metadata summary and Mastra MessageHistory. |
| Security | Model must not write arbitrary memory until memory tools are governed and audited. |
| Auditability | metadata remains sufficient to replay runs and explain why a memory projection exists. |
| Latency | Phase 1 must not add model calls beyond the already implemented summary generation. |
| Rollback | Feature must be disableable by env/config without schema rollback. |
| Observability | Smoke tests must prove which memory layers are enabled and what enters model-visible context. |

## Phase Plan

### Phase 1: Memory Runtime Refactor, No Behavior Change

Create a unified memory runtime abstraction but keep current behavior:

- One DataAgent memory instance still supports task-state and goal.
- `lastMessages=false`, `semanticRecall=false`, `observationalMemory=false`, `workingMemory.enabled=false`.
- Existing smoke tests must remain unchanged from a behavior perspective.

### Phase 2: Shadow WorkingMemory Projection

Add `MemoryBridge` that mirrors `conversation_summaries.latest()` into Mastra WorkingMemory after summary commit.

Rules:

- One-way write: metadata summary -> Mastra WorkingMemory.
- Do not expose `updateWorkingMemory` or `setWorkingMemory` to the model.
- Do not inject WorkingMemory into provider prompt yet.
- Add a smoke test that reads `memory.getWorkingMemory({ threadId, resourceId })` and verifies it matches the latest summary range.

### Phase 3: Read-Only WorkingMemory Injection

Enable WorkingMemory read-only injection for DataAgent.

Rules:

- Keep `lastMessages=false`.
- Keep `semanticRecall=false`.
- Keep `observationalMemory=false`.
- Stop injecting the same `conversation_summary` user message when read-only WorkingMemory is enabled, or explicitly mark one as shadow-only. There must be exactly one compact memory source in the provider prompt.
- Add `MastraContextBudgetProcessor` coverage proving the injected memory appears before provider call and is budget governed.

Implemented details:

- `createAgentMemoryRuntime(path, { conversationMemoryMode: "working-memory-readonly" })` enables thread-scoped
  read-only WorkingMemory with the shared conversation summary template.
- The API server resolves `MASTRA_CONVERSATION_MEMORY_MODE=off|shadow|working-memory-readonly`; default is now
  `working-memory-readonly`.
- `ConversationMemoryService.syncLatestSummaryToMemory()` backfills the latest metadata summary into Mastra WorkingMemory
  before a non-resume run, so pre-Phase-2 summaries can be consumed after switching mode.
- In `working-memory-readonly`, `ConversationMemoryService` continues to remove raw messages covered by the latest summary
  but omits the tagged metadata summary message. Mastra injects the compact summary through its native memory context.
- Smoke coverage verifies no `updateWorkingMemory` / `setWorkingMemory` tool is exposed and `Memory.getContext()` contains
  the mirrored summary as read-only context.

### Phase 4a: Local Long-Term Memory Source

Before enabling Mastra Semantic Recall in production, the project now has a local authoritative long-term memory source.

Implemented rules:

- `metadata.long_term_memories` stores durable records under `user`, `session`, or `datasource` scope.
- `RUN_FINISHED` triggers best-effort extraction from persisted user/assistant natural-language messages. The extractor
  does not read hidden thoughts, tool results, SQL raw output, or artifact bodies.
- Production uses a Mastra LLM extractor with deterministic fallback. Candidate memories are filtered for scope, length,
  and sensitive terms before upsert.
- `LongTermMemoryRepository.listRelevant()` performs local bounded relevance retrieval by current user input and active
  session/datasource. This avoids adding embedding/model calls to the hot path.
- `DataAgentAgUiAgent` resolves at most six records before `createDataAgent()`.
- `LongTermMemoryContextSource` and Mastra `MastraContextRuntimeSourceProcessor` convert records into ContextPackage source
  inventory; `ContextPromptMaterializer` later emits the `context:long-term-memory` prompt view message.
- The source inventory uses `sourceType=long-term-memory`, `trust=memory`, and supporting retention, so it is budgeted
  and auditable instead of bypassing ContextPackage.
- Successful writes emit `memory.long-term.extracted` with count and memory ids only.
- `smoke:long-term-memory` verifies repository idempotency, scoped retrieval, access marking, context injection, and
  DataAgent processor registration, automatic extraction, and sensitive candidate filtering.

This is intentionally not Mastra Semantic Recall yet. It provides the governed context shape that semantic recall must
feed later.

### Phase 4b: Semantic Recall Evaluation

Evaluate semantic recall only after Phase 4a is stable.

Current shadow gate:

- `smoke:memory-recall-shadow` seeds the same query across local long-term memory and Knowledge.
- The report keeps separate sections for `localLongTermMemory`, `knowledge`, and `mastraSemanticRecall`.
- `mastraSemanticRecall.status` is currently `not_configured` because production memory runtime still has
  `semanticRecall=false`, `vector=false`, and no approved memory embedder/vector policy.
- This prevents silent competition between Knowledge, local long-term memory, and future Mastra recall.

Open design questions:

- Should embeddings be built from raw `conversation_messages`, from `conversation_summaries`, or from both with different filters?
- Should this use the existing Knowledge embedding profile, a Mastra Model Router embedder, or a local FastEmbed path?
- How should recalled snippets be represented in `ContextPackage` so Knowledge and Memory do not compete silently?

Default answer until tested: do not enable semantic recall in production. Recalled snippets must first be converted into
the same `long-term-memory` ContextPackage source shape or an explicitly reviewed sibling source.

### Phase 5: Observational Memory Shadow Mode

Run OM only in shadow mode and compare against our summary generator.

Rules:

- Use the same user/session resource/thread identity.
- Do not let OM replace metadata summary until quality, latency, and auditability are reviewed.
- If OM becomes primary long-context summarizer, metadata still stores the accepted projection and range cursor.

## Implementation Tasks

### Task 1: Create Target Architecture Diagram

**Files:**

- Create: `docs/engineering/mastra-memory-controlled-integration.html`

**Steps:**

1. Create a self-contained HTML architecture diagram using the shared light cartoon style.
2. Verify the HTML exists.

   ```bash
   test -f docs/engineering/mastra-memory-controlled-integration.html
   ```

### Task 2: Create Unified Agent Memory Runtime

**Files:**

- Modify: `packages/agent-runtime/src/memory/task-state-runtime.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `scripts/smoke-task-state.mjs`
- Test: `scripts/smoke-conversation-memory.mjs`

**Steps:**

1. Rename the exported runtime type conceptually from `TaskStateRuntime` to an additive `AgentMemoryRuntime` shape while preserving current public exports if needed.
2. Keep the existing task-state storage path as the default backing store for now.
3. Ensure the default `Memory` config remains:

   ```ts
   {
     generateTitle: false,
     lastMessages: false,
     observationalMemory: false,
     readOnly: true,
     semanticRecall: false,
     workingMemory: { enabled: false }
   }
   ```

4. Run:

   ```bash
   npm run smoke:task-state
   npm run smoke:conversation-memory
   ```

Expected: behavior unchanged.

### Task 3: Add MemoryBridge Shadow Projection

**Files:**

- Create: `packages/agent-runtime/src/memory/conversation-memory-bridge.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/conversation-memory.ts`
- Test: `scripts/smoke-conversation-memory.mjs`

**Steps:**

1. Add a bridge interface:

   ```ts
   export type ConversationMemoryProjection = {
     fromPosition: number;
     toPosition: number;
     summaryText: string;
   };

   export type ConversationMemoryBridge = {
     mirrorSummary(input: {
       projection: ConversationMemoryProjection;
       resourceId: string;
       threadId: string;
     }): Promise<void>;
   };
   ```

2. Implement a Mastra bridge that calls `memory.updateWorkingMemory`.
3. In `ConversationMemoryEventObserver.flushCompleted()`, after `conversation_summaries` commit succeeds, call the bridge.
4. The working memory body should be explicitly structured:

   ```text
   # Conversation Summary
   from_position: ...
   to_position: ...

   ...
   ```

5. Add smoke assertions:

   - latest metadata summary exists.
   - Mastra `getWorkingMemory({ threadId, resourceId })` returns the mirrored summary.
   - model-visible messages are unchanged in shadow mode.

### Task 4: Enable Read-Only WorkingMemory Injection Behind Config

**Files:**

- Modify: `packages/agent-runtime/src/memory/task-state-runtime.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/conversation-memory.ts`
- Test: `scripts/smoke-conversation-memory.mjs`
- Test: `scripts/smoke-context-compilation.mjs`

**Steps:**

1. Add a local config switch:

   ```text
   MASTRA_CONVERSATION_MEMORY_MODE=off|shadow|working-memory-readonly
   ```

2. In `working-memory-readonly`, configure memory:

   ```ts
   {
     lastMessages: false,
     semanticRecall: false,
     observationalMemory: false,
     workingMemory: {
       enabled: true,
       scope: "thread",
       template: "# Conversation Summary\n- Range:\n- Durable facts:\n- User constraints:\n- Open questions:"
     }
   }
   ```

3. Ensure model-writeable memory tools are not exposed. If Mastra still exposes them, do not enable this phase until the tool can be wrapped by `GovernedToolFactory`.
4. Prevent duplicate compact memory:

   - In `off` / `shadow`, keep current `conversation_summary` tagged message.
   - In `working-memory-readonly`, do not inject the metadata summary as a user message if WorkingMemory is already injecting the same projection.

5. Add prompt-boundary smoke:

   - summary appears once.
   - raw messages covered by summary do not appear.
   - `MastraContextBudgetProcessor` still records budget metrics.

### Task 5: Add Semantic Recall Design Gate

**Files:**

- Modify: `docs/engineering/2026-06-23-conversation-memory-design.md`
- Modify: `todo_list.md`
- Optional test spike: `scripts/spike-mastra-semantic-recall.mjs`

**Steps:**

1. Document semantic recall as disabled-by-default.
2. Create a spike script that seeds a few sanitized messages and compares:

   - metadata summary retrieval.
   - Mastra `recall({ vectorSearchString })`.
   - Knowledge `retrieve_knowledge`.

3. Do not merge production semantic recall until it has a `RuntimeContextSource` representation and token budget rules.

### Task 6: Add Observational Memory Shadow Spike

**Files:**

- Optional test spike: `scripts/spike-mastra-observational-memory.mjs`
- Modify: `docs/engineering/2026-06-23-conversation-memory-design.md`

**Steps:**

1. Configure OM in a disposable LibSQL file with the same model profile used by the summarizer.
2. Feed sanitized conversation turns.
3. Compare OM observations with `conversation_summaries.summary_text`.
4. Record:

   - latency.
   - extra model calls.
   - observation quality.
   - audit explainability.

5. Keep OM out of production until review.

## Acceptance Criteria

- `npm run build` passes.
- `npm run smoke:task-state` passes.
- `npm run smoke:conversation-memory` passes in all modes:
  - `off`
  - `shadow`
  - `working-memory-readonly`
- `npm run smoke:long-term-memory` passes.
- `npm run smoke:memory-recall-shadow` passes.
- Provider-bound prompt contains compact memory exactly once.
- No Mastra MessageHistory raw conversation injection is enabled in production.
- No model-writeable memory tool is exposed unless wrapped, audited, and documented.
- metadata can still replay runs without reading Mastra memory storage.

## Risks

| Risk | Mitigation |
| --- | --- |
| Duplicate history enters prompt | Keep `lastMessages=false`; add prompt-boundary smoke. |
| Memory tools bypass governance | Start with read-only injection; block phase if tools appear unwrapped. |
| WorkingMemory competes with tagged summary | Use mode switch and one-source-only prompt assertion. |
| OM creates a second summary truth | Shadow-only until accepted projection is written back to metadata. |
| Semantic recall duplicates Knowledge | Require `RuntimeContextSource` and budget policy before production. |

## Recommended Next Step

Phase 1-4a are implemented and Phase 4b has a shadow report gate. Next work should approve a vector/embedder policy for
Mastra Semantic Recall, then fill the `mastraSemanticRecall` section without changing production prompt injection.
