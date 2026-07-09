# Plan: Tool e2e idempotency + Thinking fold persistence

Spec: `docs/superpowers/specs/2026-07-09-tool-e2e-and-thinking-persistence-design.md`

## Files

| File | Change |
|------|--------|
| `apps/web/.../live-run-state.ts` | Idempotent `finishedAtMs` on RESULT/END |
| `apps/web/.../use-data-foundry-run.tsx` | Skip completed-tool replay while restoring |
| `apps/web/.../__tests__/live-run-state.test.ts` | Duration replay regression |
| `apps/api/src/conversation-memory.ts` | Observe REASONING_MESSAGE_*; persist parts |
| `apps/api/src/config-api.ts` | Expose `contentParts` on message DTO |
| `apps/web/.../config-api/types.ts` | `contentParts` on ConversationMessageDto |
| `apps/web/.../conversation-restore.ts` | Restore parts into message content |
| `apps/web/.../agent-message-render-sync.ts` | Fingerprint reasoning length |
| Tests for memory / restore / fingerprint | As needed |
| `packages/agent-runtime` stream (if needed) | Emit REASONING_MESSAGE_* |

## Tasks

1. Part A — failing tests for RESULT replay preserving duration; implement idempotency + restore guard.
2. Probe whether REASONING events reach API; bridge if missing.
3. Part B — observer persists parts; DTO + restore + fingerprint; tests.
4. Run targeted web/api tests.

No auto-commit unless user asks.
