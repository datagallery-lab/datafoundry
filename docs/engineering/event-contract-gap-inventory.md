# Event Contract Gap Inventory

Diagnosis for the dataagent contract-governance plan (phase 0). Maps observed gaps between Mastra agent loop output and what the frontend needs for pure rendering.

## Loop termination

| Observation | Location | Gap |
|-------------|----------|-----|
| Agent uses `maxSteps: AGENT_MAX_STEPS` | `packages/agent-runtime/src/index.ts` | Model may end immediately after a tool call without a closing user-facing text message. |
| `finish-step` chunks are dropped | `packages/agent-runtime/src/stream/mastra-stream-normalizer.ts` | No structured "run closing summary" event when the model skips final text. |
| Prior fix: `RunCompletionAnswerTracker` | removed from `apps/api/src/server.ts` | Was injecting hard-coded Chinese/English closing text. Replaced by prompt policy requiring a natural-language closing message. |

**Stop reasons (Mastra / AG-UI):** `RUN_FINISHED` and `RUN_ERROR` are the terminal AG-UI events. Mastra may finish a step without streaming assistant text when the last model action is a tool call. No distinct "max steps" event is surfaced to the client today.

**Remediation (phase 1):** Prompt policy in `buildAgentInstructions` requires a closing summary. Fallback: structured completion event from `RunFinalizer.complete()` if model silence persists.

## TOOL_CALL_RESULT delivery

| Tool family | TOOL_CALL_END | TOOL_CALL_RESULT (raw Mastra stream) | ACTIVITY STEP snapshot | Bridge backfill |
|-------------|---------------|--------------------------------------|------------------------|-----------------|
| Data tools (`inspect_schema`, `run_sql_readonly`, …) | Yes | **Missing** | Yes (`data-tools.ts`) | Yes (`tool-call-result-bridge.ts`) |
| Workspace tools (`write_file`, `execute_command`, …) | Yes | Usually yes (Mastra `tool-result` chunk) | Via `data-workspace-metadata` CUSTOM | Rarely needed |
| Collaboration (`ask_user`, `submit_plan`) | Yes | Yes when suspended/completed | No | No |
| `publish_artifact` | Yes | Yes | Artifact CUSTOM event | No |

**Root cause:** `@ag-ui/mastra` maps Mastra `tool-result` chunks to `TOOL_CALL_RESULT`. Data tools emit governed observations through `ACTIVITY_SNAPSHOT` only; the stream never carries `tool-result` for them.

**Remediation (phase 2):** Emit `TOOL_CALL_RESULT` at the governed tool execution boundary (`GovernedToolFactory`). Keep `ToolCallResultBridge` with warn-only logging during transition.

## Artifact dual path (resolved in phase 3)

| Path | Before | After |
|------|--------|-------|
| Write file → auto artifact | `workspace-artifact-recorder.ts` + `artifact-publish-policy.ts` | **Removed** |
| Write file → session file ref | `RunFinalizer.syncSessionOutputs` | Unchanged |
| Client-visible artifact | `publish_artifact` tool only | **Single authority** |

## Checkpoint / restore heuristics (phase 4 targets)

Frontend `conversation-restore.ts` still infers when backend DTO fields are incomplete:

| Heuristic | Trigger | Authoritative backend field needed |
|-----------|---------|-----------------------------------|
| `hydratedSegmentStatus` without checkpoint | Guesses from tools / hasAssistant | `checkpoints[].status` for every run |
| `inferCollaborationToolNameFromToolCall` | `toolName` missing or `ask_user` with plan args | `toolCalls[].toolName` resolved server-side |
| `workspacePathFromToolResult` | Regex on tool result text | `restorableCustomEvents` (`workspace.metadata`) |
| `deriveWorkspaceSignalsFromToolCalls` | Missing CUSTOM events on restore | Persisted `workspace.metadata` / `sandbox.output` |
| `reconcileLiveRunArtifacts` | Artifact missing `createdByEventId` | Still needed for SQL table artifacts from `publish_artifact` / gateway |

## Custom event persistence

Restorable CUSTOM event names (`config-api.ts`): `token_usage`, `token_usage.correlation`, `workspace.metadata`, `sandbox.output`, `goal.updated`, `sql_audit`.

Workspace `data-*` stream chunks are mapped in `mastra-stream-hooks.ts` → CUSTOM events → persisted → replayed by `replayRestorableCustomEvents`.

## Verification commands

```bash
npm run build
npm run test:web
node scripts/diagnose-tool-result-events.mjs   # needs LLM_API_KEY
node scripts/smoke-conversation-memory.mjs
```
