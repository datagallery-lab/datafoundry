# Semantic Trace Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn long task traces into durable, asynchronously generated semantic sections that can be collapsed in the embedded and full-screen Trace DAG views.

**Architecture:** Persist section jobs and completed sections next to the existing run events/checkpoints. A run-scoped coordinator observes the durable event stream, invokes the same resolved model provider used by the task outside the agent response path, and projects section metadata with the existing Trace DAG response. The web app shares one section-aware viewer between the Trace tab and full-screen overlay.

**Tech Stack:** TypeScript, SQLite metadata store, existing OpenAI-compatible model provider, Node API runtime, Next.js/React, SVG Trace DAG canvas.

---

### Task 1: Persist semantic section state

**Files:**
- Modify: `packages/metadata/src/index.ts`
- Test: `packages/metadata/src/index.test.ts` or focused metadata smoke coverage

1. Add section and job record/input types, repositories, `MetadataStore` accessors, SQLite schema, and one forward migration.
2. Scope every record by user, session, branch, and run; store start/end event sequences, title, summary, status, and timestamps.
3. Add de-duplicated pending-job creation and terminal job updates so restarts do not lose work.
4. Verify repository reads preserve branch isolation and event ordering.

### Task 2: Summarize trace ranges asynchronously

**Files:**
- Create: `apps/api/src/trace-section-coordinator.ts`
- Modify: `apps/api/src/run-event-pipeline.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/run-finalizer.ts`
- Test: `scripts/smoke-trace-sections.mjs`

1. Observe persisted envelopes after the existing checkpoint projection; schedule work after three eligible context/tool steps and force a final pass when a run terminates.
2. Build a bounded, redacted event representation for the model rather than forwarding raw tool payloads.
3. Invoke the run's resolved model provider with a structured JSON prompt that returns title, summary, covered range, and completion state.
4. Serialize jobs per run, retry failures, and ensure errors never delay streaming, persistence, or finalization.
5. Run a real DeepSeek end-to-end smoke test with the configured provider, not a fake LLM.

### Task 3: Extend the Trace DAG contract

**Files:**
- Modify: `apps/api/src/trace-dag.ts`
- Modify: `apps/api/src/config-api.ts`
- Modify: `apps/web/src/lib/config-api/types.ts`
- Modify: `apps/web/src/lib/config-api/client.ts`
- Test: `scripts/smoke-trace-sections.mjs`

1. Add `TraceDagSectionDto` to the response alongside untouched node/edge data.
2. Resolve visible sections through the same session lineage and map each section to the exact underlying node ids.
3. Preserve backwards-compatible behavior for sessions without sections.
4. Verify branch forks never expose sections from hidden future parent events.

### Task 4: Reuse the viewer in Trace and overlay

**Files:**
- Create: `apps/web/src/app/data-tasks/components/task-console/TraceDagViewer.tsx`
- Modify: `apps/web/src/app/data-tasks/components/task-console/TraceDagCanvas.tsx`
- Modify: `apps/web/src/app/data-tasks/components/task-console/TraceOverlay.tsx`
- Modify: `apps/web/src/app/data-tasks/components/task-console/TaskConsole.tsx`
- Modify: `apps/web/src/app/data-tasks/page.tsx`
- Test: `apps/web/src/app/data-tasks/__tests__/trace-dag*.test.tsx`

1. Move graph fetching, incremental refresh, selection, right-side detail rendering, and checkpoint branching into a reusable viewer.
2. Render the viewer directly at the top of the Trace tab; retain the full-screen button as an alternate layout using the same props and state model.
3. Make a completed section a compact graph group with title, summary signal, step count, and expand/collapse action; render underlying nodes only when expanded.
4. Keep tool labels below nodes, preserve node detail behavior, and avoid resetting the viewport on each live refresh.
5. Make the embedded layout dense and operational rather than a second modal-like surface.

### Task 5: Verify and ship in small commits

**Files:**
- Modify: relevant source and focused test files above

1. Run focused API and web tests after each layer.
2. Run `npm run build` and the real DeepSeek trace-section smoke test.
3. Inspect desktop and narrow-browser Trace tab plus full-screen overlay for section collapse, details, tool labels, branch action, and refresh stability.
4. Commit coherent backend and frontend units, then push only to `wis/feat/checkpoint-trace-dag-followup`.
