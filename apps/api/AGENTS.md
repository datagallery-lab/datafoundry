# apps/api — Agent constraints

Backend Agent Runtime for the dataagent monorepo.

## External surface

Only expose:

- `GET /healthz`
- `POST /api/copilotkit` (+ CORS `OPTIONS`)

Do **not** add REST CRUD here unless documented in
[`docs/engineering/config-management-api.md`](../../docs/engineering/config-management-api.md).

## Architecture

- CopilotKit `@copilotkit/runtime` hosts `DataAgentAgUiAgent` (`AbstractAgent`).
- Agent orchestration: `@ag-ui/mastra` → `@open-data-agent/agent-runtime` → typed tools → Data Gateway.
- Data Gateway and Metadata are **internal**; not exposed to the frontend directly.

## Implementation docs (read in order)

1. [`docs/engineering/copilotkit-ag-ui-frontend-protocol.md`](../../docs/engineering/copilotkit-ag-ui-frontend-protocol.md)
2. [`docs/engineering/config-management-api.md`](../../docs/engineering/config-management-api.md)
3. [`docs/engineering/frontend-backend-capability-requests.md`](../../docs/engineering/frontend-backend-capability-requests.md)

## Code conventions

- `DataAgentAgUiAgent` must implement `clone()` and copy `input` deps (CopilotKit clones per run).
- AG-UI events persisted via `RunEventWriter`; same stream returned to the client.
- Env loaded from repository root `.env` (`LLM_API_KEY` required for live runs).

## Verify

From repo root:

```bash
npm run typecheck
npm run smoke:api
npm run smoke:agent
npm run smoke:api-context
```
