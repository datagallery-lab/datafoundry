# apps/api — Agent constraints

Backend Agent Runtime for the datafoundry monorepo.

## External surface

Only expose:

- `GET /healthz`
- `POST /api/copilotkit` (+ CORS `OPTIONS`)

**Planned (not yet implemented)** — track against public REST docs and capability checks:

- R-004 — `GET /api/v1/artifacts/:id` (+ `/preview`, `/download`) — artifact metadata / inline preview / attachment download
- R-002 — AG-UI `CUSTOM(name="token_usage")` — LLM input/output token usage per run (no REST)
- R-007 — `POST /api/v1/chat/uploads` — chat file upload to session workspace

Do **not** add REST CRUD here unless documented in
[`docs/zh/reference/configuration-api.md`](../../docs/zh/reference/configuration-api.md).

## Architecture

- CopilotKit `@copilotkit/runtime` hosts `DataFoundryAgUiAgent` (`AbstractAgent`).
- Agent orchestration: `@ag-ui/mastra` → `@datafoundry/agent-runtime` → typed tools → Data Gateway.
- Data Gateway and Metadata are **internal**; not exposed to the frontend directly.

## Docs (read in order)

1. [`docs/zh/reference/agent-runtime.md`](../../docs/zh/reference/agent-runtime.md)
2. [`docs/zh/reference/configuration-api.md`](../../docs/zh/reference/configuration-api.md)
3. [`docs/zh/reference/rest-api.md`](../../docs/zh/reference/rest-api.md)
4. [`.docs-internal/engineering/copilotkit-ag-ui-frontend-protocol.md`](../../.docs-internal/engineering/copilotkit-ag-ui-frontend-protocol.md)
5. [`.docs-internal/engineering/config-management-api.md`](../../.docs-internal/engineering/config-management-api.md)

## Code conventions

- `DataFoundryAgUiAgent` must implement `clone()` and copy `input` deps (CopilotKit clones per run).
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
