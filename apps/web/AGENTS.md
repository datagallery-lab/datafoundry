# apps/web — Agent constraints

Next.js frontend (`@open-data-agent/web`) for the data-task workbench.

## Runtime boundary

- Uses `@copilotkit/react-core/v2` only — **no** `@copilotkit/runtime` in this app.
- Connects to backend via `NEXT_PUBLIC_AGENT_RUNTIME_URL` (default `http://127.0.0.1:8787/api/copilotkit`).
- Agent name: `dataAgent`. Do not embed LLM keys in the browser for production paths.

## Page scope

Primary UI: `/data-tasks` — design doc at
[`src/app/data-tasks/DESIGN.md`](src/app/data-tasks/DESIGN.md).

## Implementation docs (read in order)

1. [`copilotkit-ag-ui-frontend-protocol.md`](../../.docs-internal/engineering/copilotkit-ag-ui-frontend-protocol.md)
2. [`src/app/data-tasks/DESIGN.md`](src/app/data-tasks/DESIGN.md)
3. [`config-management-api.md`](../../.docs-internal/engineering/config-management-api.md) (when wiring config REST)
4. [`backend-rest-api-reference.md`](../../.docs-internal/engineering/backend-rest-api-reference.md) (when wiring REST endpoints)

## Code conventions

- Workspace config (DB/KB/MCP/LLM/Skill) state lives in `data-task-state.ts`; only expose fields the backend can actually consume.
- Render AG-UI events the backend streams; do not mock agent responses in production paths.
- Avoid SSR/client layout mismatch for localStorage-driven layout (hydration).

## Verify

From repo root:

```bash
npm run test:web
npm run build:web
```

Live check: start `npm run dev` (or `npm run dev:api` then `npm run dev:web`) → http://localhost:3000/data-tasks
