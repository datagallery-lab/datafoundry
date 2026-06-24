# Open Data Agent Workbench

TypeScript-first data-agent workbench MVP. This repository currently focuses on the R&D B scope:
Agent Runtime, Data Gateway, Knowledge contracts, metadata, artifacts, and provider adapters.

The current implementation has completed the backend skeleton plus local-first config management, effective run
configuration, context governance, Skill policy, MCP middleware integration, local Knowledge retrieval, the first
service database adapters, and server-authoritative Conversation Memory with read-only Mastra WorkingMemory from
[R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md).

## Scope

R&D B owns:

- `packages/contracts`: DTOs, AG-UI-visible event contracts, tool inputs, env schema.
- `packages/agent-runtime`: Mastra-based ReAct data agent, tool registry, and runtime context.
- `packages/data-gateway`: datasource registry, schema inspection, preview, readonly SQL execution.
- `packages/knowledge`: knowledge service interfaces and data model contracts.
- `packages/artifacts`: artifact types and local artifact service.
- `packages/metadata`: local SQLite metadata store, runs, run events, conversation messages and summaries,
  datasource registry, SQL audit logs.
- `packages/providers`: LLM provider adapter with mock fallback.
- `apps/api`: single Agent Runtime HTTP service.
- `apps/web`: Next.js data-task workspace frontend.

The backend exposes one CopilotKit/AG-UI agent endpoint for frontend integration; Data Gateway and Knowledge
stay behind the agent tool boundary. The frontend connects directly to that endpoint via
`NEXT_PUBLIC_AGENT_RUNTIME_URL` and does **not** run its own `@copilotkit/runtime`. See [`apps/web/README.md`](apps/web/README.md).

## Current Modules

Current active workspace modules:

| Module | Responsibility | Main implementation |
| --- | --- | --- |
| `apps/api` | Single backend runtime service. Exposes health check, CopilotKit/AG-UI agent endpoint, and `/api/v1` config management API. Creates per-request user/session/run context from AG-UI `RunAgentInput`, persists the same AG-UI event stream it returns to the frontend, and assembles server-authoritative conversation history before Mastra runs. | Node `http` server, `@copilotkit/runtime`, `@ag-ui/client` `AbstractAgent`, `@ag-ui/mastra`, `@ag-ui/mcp-middleware`, `@open-data-agent/agent-runtime`, `@open-data-agent/metadata`, `@open-data-agent/data-gateway`. |
| `apps/web` | Frontend data-task workspace. Connects to the backend CopilotKit/AG-UI endpoint via `NEXT_PUBLIC_AGENT_RUNTIME_URL`. Part of root npm workspaces (`@open-data-agent/web`). | Next.js 15 (App Router), React 19, `@copilotkit/react-core/v2`, Tailwind 4, Vitest. |
| `packages/agent-runtime` | Mastra DataAgent factory, ReAct prompt, run context, tool registry, tool-level policy, context governance, collaboration/workspace tools, Knowledge tool, and Skill policy. Keeps Data Gateway behind typed tools. | `@mastra/core/agent`, `@mastra/core/tools`, Zod tool schemas, `inspect_schema`, `run_sql_readonly`, `retrieve_knowledge`, AG-UI `ACTIVITY_SNAPSHOT` / `CUSTOM`, inspect-before-SQL enforcement, selected datasource enforcement, max SQL call count, ToolObservationAdapter registry. |
| `packages/data-gateway` | Datasource registry facade, schema inspection, preview, readonly SQL execution, SQL guard, audit log, and result artifact creation. | `LocalDataGateway`, `node:sqlite`, CSV parser, `read-excel-file`, internal datasource adapters for DuckDB demo, SQLite, CSV, XLSX, PostgreSQL, MySQL. |
| `packages/metadata` | Local persistence for users, sessions, runs, run events, conversation messages/summaries, config resources, encrypted secrets, jobs, datasource registry, SQL audit logs, artifacts. | `node:sqlite` `DatabaseSync`, repository classes, migrations, `RunEventWriter`, conversation repositories, `EncryptedSecretStore`. |
| `packages/contracts` | Shared TypeScript contracts for API result, persisted AG-UI run events, tools, artifacts, env schema. | Type-only DTOs, AG-UI `BaseEvent`-backed `RunEventEnvelope`, `ENV_VARIABLE_SPECS`, `createEnvConfig`, API result helpers. |
| `packages/providers` | Model provider selection and env-driven model adapter creation. | `@ai-sdk/openai` for OpenAI-compatible `/chat/completions`; Mastra model router object for other providers; mock marker when no `LLM_API_KEY`. |
| `packages/artifacts` | Artifact creation service used by Data Gateway. | `LocalArtifactService`, metadata-backed artifact records and previews. |
| `packages/knowledge` | Local-first Knowledge service and RAG boundary. | SQLite document/chunk storage, FTS5 fallback retrieval, optional embedding vector index, `retrieve`/`reindex`. |
| `scripts` | Backend verification scripts. | Smoke tests for metadata, gateway, readonly SQL, tool policy, CopilotKit endpoint, context governance, config API, collaboration tools, workspace tools, and tool isolation. |

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

For the frontend, copy the web env example after install:

```bash
cp apps/web/.env.example apps/web/.env.local
```

## Verify

Run the full backend verification set:

```bash
npm run typecheck
npm run smoke:metadata
npm run smoke:run-identity
npm run smoke:data-gateway
npm run smoke:sql
npm run smoke:agent
npm run smoke:task-state
npm run smoke:context-architecture
npm run smoke:context-compilation
npm run smoke:docs
npm run smoke:conversation-memory
npm run smoke:long-term-memory
npm run smoke:memory-recall-shadow
npm run smoke:config-api
npm run smoke:collaboration
npm run smoke:workspace
npm run smoke:tool-state
npm run smoke:api-context
npm run smoke:copilotkit-run
npm run smoke:api
npm run test:web
npm run build:web
```

Expected coverage:

- `smoke:metadata`: metadata schema, repositories, run event persistence.
- `smoke:run-identity`: AG-UI thread/run identity, idempotent replay, parent run persistence.
- `smoke:data-gateway`: datasource registration, support types, schema inspection, preview.
- `smoke:sql`: readonly SQL guard, limit, timeout, audit log, artifact creation.
- `smoke:agent`: Mastra tool registry policy, inspect-before-SQL enforcement, SQL audit.
- `smoke:task-state`: Mastra task tools persist through the application-level LibSQL runtime.
- `smoke:context-architecture`: context layer directories, removed legacy paths, and naming/import guardrails.
- `smoke:context-compilation`: ContextPackage inventory, source policy, projection, protocol conversion, runtime source
  refresh, and provider prompt budget enforcement.
- `smoke:docs`: local Markdown/HTML documentation links.
- `smoke:conversation-memory`: server-authoritative user/assistant history, spoofed client history rejection,
  message-level idempotency, summary replacement, pluggable summarizer persistence, and read-only Mastra WorkingMemory
  consumption without duplicate tagged summaries.
- `smoke:long-term-memory`: durable long-term memory records, local relevance retrieval, governed context injection,
  automatic extraction, sensitive candidate filtering, and ContextPackage source attribution.
- `smoke:memory-recall-shadow`: compares local long-term memory retrieval with Knowledge retrieval and records the
  Mastra Semantic Recall gate as not configured until vector/embedder policy is approved.
- `smoke:config-api`: config resources, encrypted secrets, revision conflicts, KB, MCP, model profile test,
  Skill, jobs, artifacts, tombstone delete.
- `smoke:collaboration`: ask-user/submit-plan suspend-resume and plan approval.
- `smoke:workspace`: Mastra workspace tools and local sandbox integration.
- `smoke:tool-state`: concurrent tool state isolation.
- `smoke:api-context`: CopilotKit/AG-UI request context extraction for datasource and user input.
- `smoke:copilotkit-run`: `/api/copilotkit` end-to-end run, event ordering, persistence, replay, and suspended state.
- `smoke:api` / `smoke:copilotkit`: Agent Runtime startup, `/api/copilotkit` CORS, and AG-UI request validation.

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

## Run Web Frontend

Start the data-task workspace (requires backend running for live agent chat):

```bash
npm run dev:web
```

Default URL:

```text
http://127.0.0.1:3000/data-tasks
```

Set `NEXT_PUBLIC_AGENT_RUNTIME_URL` in `apps/web/.env.local` (see `apps/web/.env.example`).

## Runtime API

The backend intentionally exposes a small surface:

- `GET /healthz`
- `POST /api/copilotkit`
- `/api/v1/datasources`
- `/api/v1/knowledge-bases`
- `/api/v1/mcp-servers`
- `/api/v1/model-profiles`
- `/api/v1/skills`
- `/api/v1/workspace-config`
- `/api/v1/run-defaults`
- `/api/v1/jobs/:id`
- `/api/v1/artifacts/:id`

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
- Tool wrapper activity is emitted as AG-UI `ACTIVITY_SNAPSHOT` / `CUSTOM`, not custom event types.
- `run_events` persists the same AG-UI `BaseEvent` stream returned to CopilotKit, ordered by backend `seq`.
- The package-level smoke tests exercise Data Gateway, audit logs, and artifacts without exposing a second network
  protocol.
- Tool implementations live under `packages/agent-runtime/src/tools/`; the package root stays limited to agent assembly,
  prompt, provider wiring, and public exports.

## Persistence Grain

The default local metadata store is one SQLite database per configured backend storage path:

```text
METADATA_DB_PATH=storage/metadata/workbench.sqlite
```

It is not one SQLite database per run. `users`, `sessions`, `runs`, `run_events`, `conversation_messages`,
`conversation_summaries`, `data_sources`, `sql_audit_logs`, and `artifacts` all share that database and are isolated by
`user_id`, `session_id`, and `run_id`. Smoke tests create temporary SQLite files only so verification runs are
disposable and do not mutate the development database.

## Environment

Main variables:

```text
API_HOST=127.0.0.1
API_PORT=8787
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=
SECRET_MASTER_KEY=replace-with-a-long-random-local-key
STORAGE_ROOT_DIR=storage
METADATA_DB_PATH=storage/metadata/workbench.sqlite
MASTRA_CONVERSATION_MEMORY_MODE=working-memory-readonly
MEMORY_EXTRACTION_TIMEOUT_MS=2000
SQL_DEFAULT_LIMIT=100
SQL_MAX_LIMIT=1000
SQL_TIMEOUT_MS=10000
```

`MASTRA_CONVERSATION_MEMORY_MODE` supports `off`, `shadow`, and `working-memory-readonly`. The backend default is
`working-memory-readonly`: metadata remains the source of truth, while Mastra's native WorkingMemory input processor
consumes the latest trusted conversation summary as read-only context.
`MEMORY_EXTRACTION_TIMEOUT_MS` bounds post-run summary and long-term memory extraction before `RUN_FINISHED`; online
context compaction remains synchronous.

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

`npm audit` checks dependency versions against the npm/GitHub advisory database. Current known state has no high or
critical findings after upgrading Next/Vitest and overriding `@ag-ui/langgraph` to `0.0.42` within CopilotKit runtime's
declared semver range. Remaining findings are low/moderate transitive dependency issues. Do not run
`npm audit fix --force` without review because npm currently suggests breaking changes.

## Documents

Start here:

- [Docs Index](docs/README.md) — includes **source-of-truth priority** for AI implementation
- [CopilotKit / AG-UI Frontend Protocol Support](docs/engineering/copilotkit-ag-ui-frontend-protocol.md)
- [Config Management REST API](docs/engineering/config-management-api.md)
- [Context Layering ADR](docs/engineering/adr-0003-context-layering-and-naming.md)
- [Frontend → Backend Capability Status](docs/engineering/frontend-backend-capability-requests.md)
- [Data Task Page Design](apps/web/src/app/data-tasks/DESIGN.md)
- [R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md) (historical)
- [Final Engineering Design](docs/engineering/db-gpt-like-data-agent-final-design-zh.md) (historical)
- [Main PRD Chinese](docs/prd/db-gpt-like-data-agent-prd-plan-zh.md)
