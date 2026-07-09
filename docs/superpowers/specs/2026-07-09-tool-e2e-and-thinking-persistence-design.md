# Design: Tool e2e duration idempotency + Thinking fold persistence

Date: 2026-07-09  
Status: Approved (user confirmed A+B; artifact preview deferred)  
Scope: dataagent web + api conversation memory

## Problem

Three frontend case issues were diagnosed. This design covers **(1)** and **(3)** only.

1. **Tool e2e duration inflates on session switch** — and grows each time the user switches back.
2. **Artifact preview empty** — deferred; discuss separately (not in this change).
3. **Thinking missing / unstable** — after restore, during live run, or after a step completes.

## Goals

1. Completed tool step e2e duration stays stable across AG-UI replay and session restore.
2. Model reasoning/thinking survives session restore by folding into existing assistant messages (no new DB role).
3. Live run and post-step UI keep showing thinking when CopilotKit render messages are ephemeral.
4. Reasoning must **not** be fed back into the next model prompt.

## Non-goals

- Artifact `/preview` vs `/content` contract (issue 2).
- Extending `ConversationMessageRole` with `"reasoning"`.
- Persisting tool-level `startedAt`/`finishedAt` on the backend DTO (optional later).
- Changing Task Console canned `thought` template strings in `live-run-state`.
- Feeding reasoning into agent ingress / model context.

---

## Part A — Tool e2e duration idempotency

### Root cause

UI e2e = `finishedAtMs - startedAtMs` on `LiveToolCallRecord`.

On live run, both timestamps are wall-clock at START/RESULT and look correct (ms).

On session switch-back:

1. In-memory `liveRunsByThreadId` keeps the original `startedAtMs`.
2. CopilotKit/AG-UI replays historical `TOOL_CALL_RESULT`.
3. `reduceToolEvent` **always** sets `finishedAtMs = Date.now()` on RESULT.
4. Restore only skips run-boundary events (`RUN_STARTED` / `FINISHED` / `ERROR` / `STATE_SNAPSHOT`), not tool events.

Result: duration ≈ now − first start, and increases on every switch-back.

### Design

#### A1. Idempotent terminal timestamps

In `apps/web/src/app/data-tasks/live-run-state.ts` `reduceToolEvent`:

- On `TOOL_CALL_RESULT`: if `existing.status` is `success` or `failed` **and** `existing.finishedAtMs` is set, **do not** overwrite `startedAtMs` / `finishedAtMs`. Result payload / failure status may still update if needed.
- On `TOOL_CALL_END`: keep current guard (`!existing?.finishedAtMs`); ensure it never clears or rewinds an existing finish time.

#### A2. Restore-time tool replay guard

In `apps/web/src/app/data-tasks/use-data-foundry-run.tsx` (and any equivalent subscriber):

While `isRestoringConversation` is true:

- Continue skipping run-boundary replay events.
- Also skip `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` when the tool call already exists in live run with terminal status (`success` | `failed`) and `finishedAtMs`.

Rationale: REST hydrate already rebuilt tools; AG-UI replay must not mutate timing.

#### A3. Tests

Add/extend web unit tests:

1. Completed tool with `startedAtMs=1000`, `finishedAtMs=1050` → replay `TOOL_CALL_RESULT` → duration still 50ms.
2. During restore flag, completed tool ignores RESULT replay (same assertion).
3. First-time RESULT still sets `finishedAtMs` (live path unchanged).

### Out of scope for A

- Backend `ConversationToolCallDto` timestamps.
- Using SQL gateway `elapsed_ms` as step e2e.

---

## Part B — Thinking persistence (fold into assistant)

### Root cause (summary)

| Symptom | Cause |
|---------|--------|
| Missing after restore | Backend only persists `TEXT_MESSAGE_*` assistant text; AG-UI `REASONING_MESSAGE_*` ignored; DTO has no parts; restore maps string `contentText` only |
| Missing during live | Render/agent dual-source; fingerprint ignores reasoning length |
| Gone after step | Ephemeral reasoning messages + collapse / `return null` when content parses empty |

Chat Thinking comes from CopilotKit messages (`role: "reasoning"` and/or `{type:"reasoning"}` parts), **not** from `live-run-state.thought` (canned Task Console copy).

AG-UI already defines `REASONING_MESSAGE_START|CONTENT|CHUNK|END` (`@ag-ui/core`). This codebase does not observe them today.

### Storage contract (option 1 — fold)

Keep `role: "assistant"`. Extend `content_json` (backward compatible):

```json
{
  "text": "final assistant text or reasoning fallback",
  "parts": [
    { "type": "reasoning", "text": "先检查 schema…" },
    { "type": "text", "text": "最终回复" }
  ]
}
```

Rules:

1. `parts` optional; legacy `{ "text": "..." }` unchanged.
2. `content_text` = prefer concatenated/final **text** parts; if only reasoning exists, use reasoning text so empty-draft skip does not drop the message.
3. Preserve existing fields (`evidenceRefs`, etc.).
4. Do **not** add `"reasoning"` to `ConversationMessageRole`.

### Backend collection

Update `apps/api/src/conversation-memory.ts` `ConversationMemoryEventObserver`:

1. Observe `REASONING_MESSAGE_START` / `CONTENT` / `CHUNK` / `END` (and deprecated aliases if still emitted).
2. Buffer reasoning deltas by `messageId` (same draft map as text, or sibling buffer merged at flush).
3. Continue observing `TEXT_MESSAGE_*` for text.
4. On `persistAssistantDrafts`:
   - Build `parts` from reasoning + text buffers.
   - Persist when **either** reasoning or text is non-empty (after trim / meaningful-text policy aligned with frontend where practical).
   - `content: { text, parts }` (plus any existing keys).

Message attribution: one AG-UI `messageId` → one assistant row. If reasoning and final text use different messageIds (per-step segmentation), they become separate assistant rows; frontend `resolveToolStepThoughtContent` already walks adjacent messages.

#### Bridge gap (implementation gate)

If a real run’s SSE does **not** emit `REASONING_MESSAGE_*` (reasoning only appears in CopilotKit client render state), implementers must:

1. Confirm Mastra → `@ag-ui/mastra` mapping for reasoning chunks; and/or
2. Emit/normalize `REASONING_MESSAGE_*` in `packages/agent-runtime` stream path so the API observer can see them.

User approved allowing bridge/normalizer work **without** changing DB role (still fold into assistant).

Reasoning must remain filtered from model ingress (`normalizeIngressMessages` already drops `role: "reasoning"`). Persisted parts must not be re-injected as model-visible reasoning turns unless explicitly designed later (default: history assembly uses `content_text` / text parts only).

### API / DTO

Extend conversation message DTO:

```ts
contentParts?: Array<{ type: "reasoning" | "text"; text: string }>
```

- Populate from `content_json.parts` in `conversationMessageDto` (`apps/api/src/config-api.ts`).
- Keep `contentText` for compatibility.
- Frontend `ConversationMessageDto` in `apps/web/src/lib/config-api/types.ts` mirrors the field.

### Frontend restore

In `conversationToAgentMessages` (`conversation-restore.ts`):

- If `contentParts` present and non-empty → set message `content` to that parts array (CopilotKit-compatible).
- Else → keep string `contentText` behavior.
- Empty text-only assistants still restored when tool-parent placeholders require them (`assistantIdsToRestore`).

Existing `messageTextContent` / `resolveToolStepThoughtContent` already read `{type:"reasoning"}` parts.

### Frontend live hardening (required with B)

1. **Fingerprint** (`agent-message-render-sync.ts`): include reasoning text length (and preferably role) so render-only reasoning updates re-render steps.
2. **Step-local snapshot** (optional but recommended): when a tool step’s `processContent` / thought resolves non-empty, keep a step-scoped snapshot so collapse after `isActive=false` does not depend on ephemeral reasoning bubbles.
3. **Avoid false `return null`**: do not drop a completed step that had meaningful thinking/parts solely because live tool binding cleared and string content looks empty—prefer parts/snapshot.

### Tests

Backend:

- Observer: REASONING + TEXT → `content_json.parts` correct; reasoning-only draft persists.
- Legacy TEXT-only still `{ text }` (or `parts` with only text — pick one and document; prefer writing `parts` when any structured content exists, always set `text`).

API DTO:

- `contentParts` round-trip from stored `content_json`.

Frontend:

- Restore with `contentParts` → thinking visible via `resolveToolStepThoughtContent`.
- Fingerprint changes when reasoning grows.
- e2e duration tests from Part A.

Smoke (manual or script):

- Run with reasoning model → switch session → thinking still in middle column; tool duration stable.

## Acceptance criteria

1. Live tool e2e remains millisecond-scale; switch away and back does **not** increase duration.
2. Runs that produced reasoning: after refresh / session switch, Thinking still appears in the step UI.
3. Legacy conversations without `parts` restore unchanged.
4. Reasoning is not included in the next model prompt / ingress messages.

## Implementation order

1. Part A (idempotent timestamps + restore guard + tests) — ship first.
2. Verify whether SSE emits `REASONING_MESSAGE_*`; if not, bridge/normalizer fix.
3. Part B observer + DTO + restore + live fingerprint/snapshot + tests.

## Open follow-ups (not this design)

- Artifact preview empty (`publish_artifact` / `/preview` vs `/content`).
- Optional backend tool timing fields for perfect restore without wall clock.
