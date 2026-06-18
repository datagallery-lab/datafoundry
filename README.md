# Open Data Agent Workbench

TypeScript-first data-agent workbench MVP. This repository currently focuses on the R&D B scope:
Agent Runtime, Data Gateway, Knowledge contracts, metadata, artifacts, and provider adapters.

The current implementation has completed the Day 1 to Day 5 backend skeleton from
[R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md).

## Scope

R&D B owns:

- `packages/contracts`: DTOs, AG-UI-visible event contracts, tool inputs, env schema.
- `packages/agent-runtime`: Mastra-based ReAct data agent, tool registry, and runtime context.
- `packages/data-gateway`: datasource registry, schema inspection, preview, readonly SQL execution.
- `packages/knowledge`: knowledge service interfaces and data model contracts.
- `packages/artifacts`: artifact types and local artifact service.
- `packages/metadata`: local SQLite metadata store, runs, run events, datasource registry, SQL audit logs.
- `packages/providers`: LLM provider adapter with mock fallback.
- `apps/api`: single Agent Runtime HTTP service.

UI work is not part of the R&D B scope. The backend exposes one CopilotKit/AG-UI agent endpoint for frontend
integration; Data Gateway and Knowledge stay behind the agent tool boundary.

## Current Modules

Current active workspace modules:

| Module | Responsibility | Main implementation |
| --- | --- | --- |
| `apps/api` | Single backend runtime service. Exposes health check and CopilotKit/AG-UI agent endpoint. Creates per-request user/session/run context and wires the agent to tools. | Node `http` server, `@copilotkit/runtime`, `@ag-ui/mastra`, `@open-data-agent/agent-runtime`, `@open-data-agent/metadata`, `@open-data-agent/data-gateway`. |
| `packages/agent-runtime` | Mastra DataAgent factory, ReAct prompt, run context, tool registry, and tool-level policy. Keeps Data Gateway behind typed tools. | `@mastra/core/agent`, `@mastra/core/tools`, Zod tool schemas, `inspect_schema`, `run_sql_readonly`, inspect-before-SQL enforcement, selected datasource enforcement, max SQL call count. |
| `packages/data-gateway` | Datasource registry facade, schema inspection, preview, readonly SQL execution, SQL guard, audit log, and result artifact creation. | `LocalDataGateway`, `node:sqlite`, CSV parser, `read-excel-file`, internal datasource adapters for DuckDB demo, SQLite, CSV, XLSX. |
| `packages/metadata` | Local persistence for users, sessions, runs, run events, datasource registry, SQL audit logs, artifacts. | `node:sqlite` `DatabaseSync`, repository classes, migrations, `RunEventWriter`. |
| `packages/contracts` | Shared TypeScript contracts for API result, run events, tools, artifacts, env schema. | Type-only DTOs, `RUN_EVENT_TYPES`, `ENV_VARIABLE_SPECS`, `createEnvConfig`, API result helpers. |
| `packages/providers` | Model provider selection and env-driven model adapter creation. | `@ai-sdk/openai` for OpenAI-compatible `/chat/completions`; Mastra model router object for other providers; mock marker when no `LLM_API_KEY`. |
| `packages/artifacts` | Artifact creation service used by Data Gateway. | `LocalArtifactService`, metadata-backed artifact records and previews. |
| `packages/knowledge` | Knowledge service contracts and data model boundary for later RAG work. | TypeScript interfaces and model types; no network/runtime endpoint yet. |
| `scripts` | Backend verification scripts. | Smoke tests for metadata, gateway, readonly SQL, tool policy, and CopilotKit endpoint. |

## Requirements

- Node.js 22 or newer.
- npm.

Node's built-in `node:sqlite` is used by the local metadata store. On current Node versions it may print an
`ExperimentalWarning`; that is expected for local MVP development.

## Install

```bash
npm install
```

Optional local environment:

```bash
cp .env.example .env
```

The API entrypoint loads the repository root `.env`, so `npm run dev:api` will pick up local keys from the project root.
The CopilotKit runtime endpoint requires a real `LLM_API_KEY`.

## Verify

Run the full backend verification set:

```bash
npm run typecheck
npm run smoke:metadata
npm run smoke:data-gateway
npm run smoke:sql
npm run smoke:agent
npm run smoke:api
```

Expected coverage:

- `smoke:metadata`: metadata schema, repositories, run event persistence.
- `smoke:data-gateway`: datasource registration, support types, schema inspection, preview.
- `smoke:sql`: readonly SQL guard, limit, timeout, audit log, artifact creation.
- `smoke:agent`: Mastra tool registry policy, inspect-before-SQL enforcement, SQL audit.
- `smoke:api`: Agent Runtime startup, `/api/copilotkit` CORS, AG-UI request validation.
- `smoke:copilotkit`: alias-level check for the same single runtime endpoint.

## Run Agent Runtime

Start the backend:

```bash
npm run dev:api
```

Default base URL:

```text
http://127.0.0.1:8787
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Runtime API

The backend intentionally exposes a small surface:

- `GET /healthz`
- `POST /api/copilotkit`

## CopilotKit Runtime

The Agent Runtime exposes one CopilotKit/AG-UI runtime endpoint:

```text
http://127.0.0.1:8787/api/copilotkit
```

Frontend clients should use this as the CopilotKit runtime URL and select the backend agent named `dataAgent`.

```tsx
<CopilotKit runtimeUrl="http://127.0.0.1:8787/api/copilotkit" agent="dataAgent">
  <CopilotChat />
</CopilotKit>
```

Optional request headers:

```text
X-Session-ID: existing-session-id
X-Datasource-ID: api-duckdb-demo
```

CopilotKit handles the frontend interaction protocol. Backend tools still execute through the Mastra data agent,
Data Gateway, SQL guard, SQL audit log, artifact creation, and `run_events` persistence. Data Gateway is not exposed as
a frontend API in the target architecture; it is an internal tool boundary.

## Agent Runtime Boundary

The current Day 5 target runtime is:

```text
CopilotKit / AG-UI -> @ag-ui/mastra -> Mastra DataAgent -> typed tool registry -> Data Gateway
```

Important constraints:

- The agent must call `inspect_schema` before `run_sql_readonly`.
- SQL is generated by the Mastra agent, but execution permission is decided by Data Gateway.
- The model never receives datasource credentials.
- Tool wrapper events are the product event source, not raw Mastra internals.
- `run_events` records visible actions and observations, not hidden chain-of-thought.
- The package-level smoke tests exercise Data Gateway, audit logs, and artifacts without exposing a second network
  protocol.

## Environment

Main variables:

```text
API_HOST=127.0.0.1
API_PORT=8787
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=
STORAGE_ROOT_DIR=storage
METADATA_DB_PATH=storage/metadata/workbench.sqlite
SQL_DEFAULT_LIMIT=100
SQL_MAX_LIMIT=1000
SQL_TIMEOUT_MS=10000
```

Provider behavior:

- `LLM_PROVIDER=openai-compatible`: use `@ai-sdk/openai` chat model, which calls `/chat/completions`.
- Any other `LLM_PROVIDER`: use Mastra model router with `${LLM_PROVIDER}/${LLM_MODEL}` and pass `url/apiKey` directly.
- `LLM_PROVIDER=bailian`: treated as an alias for `openai-compatible`.
- Empty `LLM_API_KEY`: valid for package-level unit/smoke checks, not for the CopilotKit runtime endpoint.

Examples:

```text
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-v4-flash
LLM_BASE_URL=https://api.deepseek.com
```

```text
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

## npm Audit

`npm audit` checks dependency versions against the npm/GitHub advisory database. Current known state includes low,
moderate, and one high finding after adding CopilotKit/AG-UI. The high finding is from CopilotKit's transitive
LangChain/LangSmith dependency path, not from application code. Do not run `npm audit fix --force` without review
because npm currently suggests breaking changes.

## Documents

Start here:

- [Docs Index](docs/README.md)
- [R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md)
- [Final Engineering Design](docs/engineering/db-gpt-like-data-agent-final-design-zh.md)
- [Main PRD Chinese](docs/prd/db-gpt-like-data-agent-prd-plan-zh.md)
