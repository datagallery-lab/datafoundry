# ADR-0002: Memory Authority and Mastra Memory Boundary

Status: Accepted

Date: 2026-06-23

## Context

The data agent now has multiple memory-like mechanisms:

- authoritative conversation history in `metadata.conversation_messages`;
- compact conversation summaries in `metadata.conversation_summaries`;
- Mastra WorkingMemory configured as read-only runtime memory;
- metadata-backed long-term memories in `metadata.long_term_memories`;
- possible future Mastra Semantic Recall and Observational Memory.

These mechanisms overlap. Without a clear authority model, the same fact can enter the provider prompt through multiple
paths, for example through a metadata summary, Mastra WorkingMemory, long-term memory, and future observational memory.
This would waste context budget, create inconsistent priority, and make audit/replay unclear.

The project also has a stricter requirement than a generic chatbot memory layer: data-foundry context must be scoped,
auditable, and governed before it reaches the model. In particular, datasource-scoped memory must not leak across
datasources, fresh SQL/tool evidence must outrank stale memory, and prompt-visible context must be explainable through
`ContextPackage` / `ContextPromptView`.

## Decision

We define logical memory authority separately from physical storage or runtime projection.

### 1. Compact Conversation Memory

`CompactConversationMemory` is a logical authority object.

Current authoritative backend:

- `metadata.conversation_summaries`

Current runtime projection:

- Mastra WorkingMemory

Mastra WorkingMemory is not a second compact memory authority. It is a runtime projection/cache of the authoritative
compact conversation memory.

Only one logical compact conversation memory source may be model-visible in a provider prompt. The implementation must
not treat `metadata.conversation_summaries` and Mastra WorkingMemory as two competing prompt sources.

### 2. Long-Term Memory

`metadata.long_term_memories` remains the authoritative long-term memory store for this data-foundry system.

Long-term memory records must preserve data-foundry-specific governance fields:

- `scope`: `user` / `session` / `datasource`;
- `kind`: preference, constraint, dataset fact, analysis finding, decision, session state;
- `confidence`;
- `source_run_id`;
- optional `datasource_id`;
- source/provenance metadata.

Mastra Observational Memory overlaps with long-term memory conceptually, but it is not the authority for our LTM records.

### 3. Mastra Observational Memory and Semantic Recall

Mastra Observational Memory and Semantic Recall may be evaluated as candidate generators or retrieval mechanisms.

They must not directly inject model-visible context in production until their outputs pass through our governance path:

```text
Mastra OM / Semantic Recall
  -> candidate observations or source refs
  -> our normalizer/classifier
  -> authoritative logical source
  -> ContextPackage source inventory
  -> Source Policy
  -> ContextPromptView
  -> provider prompt
```

Rejected production path:

```text
Mastra OM / Semantic Recall
  -> direct provider prompt injection
```

### 4. Prompt Injection Ownership

The model-visible prompt must be decided by the data-foundry context compiler:

```text
logical sources
  -> ContextPackage
  -> ContextStepPlanner / Source Policy
  -> ContextPromptView
```

Runtime memories that are injected by framework processors must either be disabled, represented as controlled
projections, or made auditable as logical sources before they become production model-visible context.

## Rationale

### Why not hand compact memory authority to Mastra WorkingMemory now?

Mastra WorkingMemory is good runtime memory, but it does not by itself provide the full business audit contract we need:

- summary range (`from_position` / `to_position`);
- source run;
- content hash;
- replay linkage;
- ownership by user/session;
- prompt selection explanation.

We could encode this metadata inside WorkingMemory, but then we would be using a prompt memory field as a business
ledger. That would make querying, migration, replay, and testing harder. The cleaner boundary is to keep a logical
authority contract and use WorkingMemory as a projection.

### Why not hand LTM to Mastra Observational Memory?

Mastra Observational Memory can produce useful observations, but our LTM has stricter domain semantics:

- datasource-scoped facts must stay bound to a datasource;
- user preferences may cross sessions;
- session state should not become global;
- fresh SQL/tool evidence must outrank old memory;
- every memory must be explainable and auditable.

Mastra can help generate candidates, but the accepted authoritative LTM record must pass through our classifier,
repository, `RuntimeContextSource`, and prompt compiler.

### Why distinguish dedupe from authority?

Compact memory duplication is not a dedupe problem. It is an authority/projection problem: the same logical object must
not be represented as multiple independent prompt sources.

Dedupe is only appropriate for independent logical sources that may express overlapping facts, such as Knowledge
citations and LTM records. Even then, exact duplicates may be omitted, but semantic duplicates should first be flagged
instead of automatically removed.

## Consequences

Positive:

- prompt-visible memory has a single governance path;
- compact memory cannot silently duplicate through metadata and Mastra WorkingMemory;
- Mastra-native features can still be used without surrendering data-foundry audit boundaries;
- future Semantic Recall / OM can be evaluated safely in shadow mode.

Negative:

- we keep both metadata memory storage and Mastra runtime memory projection for now;
- additional adapter/policy code is required before enabling Mastra-native advanced memory features;
- some Mastra automation remains deliberately disabled until it can be audited.

Neutral:

- this decision does not forbid future Mastra-backed repositories. It requires that any backend implement the logical
  authority contract and feed `ContextPackage` before reaching the provider prompt.

## Implementation Rules

1. Do not enable Mastra MessageHistory as authoritative production conversation history.
2. Keep `lastMessages=false` unless a separate ADR replaces the conversation authority model.
3. Treat Mastra WorkingMemory as a projection of compact conversation memory, not as a second source.
4. Do not allow future OM / Semantic Recall outputs to bypass `ContextPackage`.
5. Keep `metadata.long_term_memories` as the accepted LTM authority until a replacement implements equivalent scope,
   provenance, confidence, and audit fields.
6. For compact memory, solve duplication through authority/projection ownership.
7. For independent sources like Knowledge and LTM, initially omit only exact duplicates and flag semantic overlap.
8. Do not persist hidden thoughts or full provider prompts as part of memory audit.

## Related Documents

- [mastra-memory-controlled-integration.html](./mastra-memory-controlled-integration.html)
- `docs/plans/2026-06-23-memory-context-source-unification.md`
- `docs/plans/2026-06-23-mastra-memory-controlled-integration.md`
