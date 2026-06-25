# apps/api — Agent constraints

Backend Agent Runtime for the dataagent monorepo.

## External surface

Only expose:

- `GET /healthz`
- `POST /api/copilotkit` (+ CORS `OPTIONS`)

**Planned (not yet implemented)** — see
[`docs/engineering/2026-06-25-backend-requirements.md`](../../docs/engineering/2026-06-25-backend-requirements.md):

- R-004 — `GET /api/v1/artifacts/:id` (+ `/preview`, `/download`) — artifact metadata / inline preview / attachment download
- R-002 — AG-UI `CUSTOM(name="token_usage")` — LLM input/output token usage per run (no REST)
- R-007 — `POST /api/v1/chat/uploads` — chat file upload to session workspace

Do **not** add REST CRUD here unless documented in
[`docs/engineering/config-management-api.md`](../../docs/engineering/config-management-api.md).

## Architecture

- CopilotKit `@copilotkit/runtime` hosts `DataAgentAgUiAgent` (`AbstractAgent`).
- Agent orchestration: `@ag-ui/mastra` → `@open-data-agent/agent-runtime` → typed tools → Data Gateway.
- Data Gateway and Metadata are **internal**; not exposed to the frontend directly.

## Implementation docs (read in order)

1. [`docs/engineering/copilotkit-ag-ui-frontend-protocol.md`](../../docs/engineering/copilotkit-ag-ui-frontend-protocol.md)
2. [`docs/engineering/config-management-api.md`](../../docs/engineering/config-management-api.md)
3. [`docs/engineering/2026-06-25-backend-requirements.md`](../../docs/engineering/2026-06-25-backend-requirements.md)

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
