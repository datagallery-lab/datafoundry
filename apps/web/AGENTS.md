# apps/web — Agent constraints

Next.js frontend (`@datafoundry/web`) for the data-task workbench.

## Runtime boundary

- Uses `@copilotkit/react-core/v2` only — **no** `@copilotkit/runtime` in this app.
- Connects to backend via `NEXT_PUBLIC_AGENT_RUNTIME_URL` (default `http://127.0.0.1:8787/api/copilotkit`).
- Agent name: `dataFoundry`. Do not embed LLM keys in the browser for production paths.

## Page scope

Primary UI: `/data-tasks`.

## Docs (read in order)

1. [`docs/zh/reference/agent-runtime.md`](../../docs/zh/reference/agent-runtime.md)
2. [`.docs-internal/engineering/data-tasks-workbench-design.md`](../../.docs-internal/engineering/data-tasks-workbench-design.md)
3. [`docs/zh/reference/configuration-api.md`](../../docs/zh/reference/configuration-api.md) (when wiring config REST)
4. [`docs/zh/reference/rest-api.md`](../../docs/zh/reference/rest-api.md) (when wiring REST endpoints)

## Code conventions

- Workspace config (DB/KB/MCP/LLM/Skill) state lives in `data-task-state.ts`; only expose fields the backend can actually consume.
- Render AG-UI events the backend streams; do not mock agent responses in production paths.
- Avoid SSR/client layout mismatch for localStorage-driven layout (hydration).
- When changing workbench layout, config REST integration, or design tokens, update `.docs-internal/engineering/data-tasks-workbench-design.md` in the same change.

## Verify

From repo root:

```bash
npm run test:web
npm run build:web
```

Live check: start `npm run dev` (or `npm run dev:api` then `npm run dev:web`) → http://localhost:3000/data-tasks
