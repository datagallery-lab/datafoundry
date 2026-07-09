# Design: Backend contract hardening (HITL / artifact / checkpoint)

Date: 2026-07-09  
Status: Approved (user chose option A; implement now)  
Scope: Close three frontend-compensated backend gaps; keep frontend fallbacks as legacy only

## Goals

1. HITL suspend atomically persists `interactions` + `TOOL_CALL_START` (read-path synthesis as defense).
2. Artifact producers always write `metadata_json.tool_call_id` when a tool produced the artifact.
3. Conversation checkpoints cover all terminal / suspended runs referenced by messages, interactions, or tool calls.
4. Frontend orphan / e2e / replay / HITL bootstrap / artifact heuristic paths are marked legacy / dual-channel only.

## Non-goals

- Delete frontend fallbacks in this change
- DB schema migration
- Artifact preview `/preview` vs `/content` contract

## Design

### HITL atomic contract

**Write path (primary):** On `on_interrupt` capture in `server.ts`, before `finalizer.suspend()`:

- Emit a synthetic `TOOL_CALL_START` for the interrupt's `toolCallId` / `toolName` / args when the run event stream has not already persisted one for that id.
- Then emit `interaction.requested` and suspend as today.

**Read path (defense):** In `config-api.ts` `toolCallPairDtos` / session conversation assembly:

- For each pending interaction whose `tool_call_id` is missing from event-derived tool calls, synthesize a pending tool call DTO with `awaitingInteraction: true` and authoritative `toolName`.

Frontend `hydratePendingInteractionLiveRun` remains for old sessions; annotate as legacy.

### Artifact `tool_call_id`

- Audit `createChartArtifact` / report / remaining `ArtifactService.create*` call sites; pass `{ tool_call_id, step_id }` in `metadata_json`.
- Keep `createArtifactEvent` / session DTO origin extraction as-is.
- Frontend `findArtifactSourceTool` heuristics: comment as legacy fallback when authoritative id absent.

### Checkpoint coverage

- Expand `runIds` union in conversation assembly: messages + pendingInteractions + toolCalls + summary `source_run_id`.
- Keep `eventOnlyRunCheckpointDto` for runs with events but no `runs` row.
- Ensure early-fail / abort paths still `updateStatus(failed|canceled)`.
- Frontend `finalizeMessageOnlyHydratedRunSegment` user-only failed guess: annotate legacy; prefer checkpoint when present.

### Legacy annotations (frontend)

Add short comments on:

- `insertSyntheticToolParentMessages` / `syntheticToolParentMessageId`
- `shouldSkipAgUiReplayDuringRestore` / idempotent `finishedAtMs`
- `hydratePendingInteractionLiveRun`
- `findArtifactSourceTool` heuristic branch
- `finalizeMessageOnlyHydratedRunSegment` no-checkpoint guess

## Acceptance

1. New HITL suspend → conversation DTO has matching `toolCalls[]` entry without frontend bootstrap.
2. New SQL / publish / chart artifacts expose `toolCallId` on REST list.
3. User-only failed run with `runs.failed` (or event-only terminal) restores via checkpoint, not guess.
4. New tool-parent runs restore without `restored-tool-parent:*`.
5. Existing unit tests for restore / live-run / smoke-conversation-memory still pass.
