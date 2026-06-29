# Open Data Agent Workbench

TypeScript-first data-agent workbench MVP. This repository currently focuses on the R&D B scope:
Agent Runtime, Data Gateway, Knowledge contracts, metadata, artifacts, and provider adapters.

The current implementation has completed the backend skeleton plus local-first config management, effective run
configuration, context governance, Mastra workspace Skill system, MCP middleware integration, local Knowledge retrieval, the first
service database adapters, and server-authoritative Conversation Memory with read-only Mastra WorkingMemory from
[R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md).

## Scope

R&D B owns:

- `packages/contracts`: DTOs, AG-UI-visible event contracts, tool inputs, env schema.
- `packages/agent-runtime`: Mastra-based ReAct data agent, tool registry, and runtime context.
- `packages/data-gateway`: datasource registry, schema inspection, preview, readonly SQL execution.
- `packages/knowledge`: knowledge service interfaces and data model contracts.
- `packages/files`: unified file asset storage and file reference lifecycle.
- `packages/skills`: skill package parsing, registry payloads, run-time selection, and workspace materialization.
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
| `packages/agent-runtime` | Mastra DataAgent factory, ReAct prompt, run context, tool registry, tool-level policy, context governance, collaboration/workspace tools, Knowledge tool, and Mastra Skill tools. Keeps Data Gateway behind typed tools. | `@mastra/core/agent`, `@mastra/core/tools`, `@mastra/core/workspace` skills, Zod tool schemas, `inspect_schema`, `run_sql_readonly`, `retrieve_knowledge`, `skill` / `skill_search` / `skill_read`, AG-UI `ACTIVITY_SNAPSHOT` / `CUSTOM`, inspect-before-SQL enforcement, selected datasource enforcement, max SQL call count, ToolObservationAdapter registry. |
| `packages/data-gateway` | Datasource registry facade, schema inspection, preview, readonly SQL execution, SQL guard, audit log, and result artifact creation. | `LocalDataGateway`, `node:sqlite`, CSV/XLSX readers, DuckDB, PostgreSQL/MySQL-compatible adapters, ClickHouse, Snowflake, BigQuery, SQL Server, Oracle, MongoDB, Redis, Trino/Presto, Spark, Databricks, Elasticsearch/OpenSearch, and related datasource adapters. |
| `packages/metadata` | Local persistence for users, sessions, runs, run events, conversation messages/summaries, config resources, encrypted secrets, jobs, datasource registry, SQL audit logs, file assets, file refs, artifacts. | `node:sqlite` `DatabaseSync`, repository classes, migrations, `RunEventWriter`, conversation repositories, `EncryptedSecretStore`. |
| `packages/contracts` | Shared TypeScript contracts for API result, persisted AG-UI run events, tools, artifacts, env schema. | Type-only DTOs, AG-UI `BaseEvent`-backed `RunEventEnvelope`, `ENV_VARIABLE_SPECS`, `createEnvConfig`, API result helpers. |
| `packages/providers` | Model provider selection and env-driven model adapter creation. | `@ai-sdk/openai` for OpenAI-compatible `/chat/completions`; Mastra model router object for other providers; mock marker when no `LLM_API_KEY`. |
| `packages/files` | Unified file asset service. Stores physical content once by sha256 and exposes user/workspace/run scoped FileAssetRef records. | `LocalFileAssetService`, `file_assets`, `file_asset_refs`, batch upload/download support, workspace materialization helpers. |
| `packages/skills` | Backend skill system. Parses `SKILL.md` / zip packages, stores package content through FileAssetRef, selects skills for each run, and materializes selected packages into the run workspace. | `parseSkillPackage`, `selectSkillsForRun`, `materializeSkillPackages`, deterministic auto selector, tool policy merge. |
| `packages/artifacts` | Artifact creation service used by Data Gateway and agent workspace publishing. | `LocalArtifactService`, preview artifacts, file-backed artifacts via FileAssetRef. |
| `packages/knowledge` | Local-first Knowledge service and RAG boundary. | SQLite document/chunk storage, FTS5 fallback retrieval, optional embedding vector index, `retrieve`/`reindex`, FileAssetRef-backed imports. |
| `scripts` | Backend verification scripts. | Smoke tests for metadata, gateway, readonly SQL, tool policy, CopilotKit endpoint, context governance, config API, collaboration tools, workspace tools, and tool isolation. |

## Requirements

- Node.js 22 or newer.
- npm.

Supported on **Linux**, **Windows**, and **macOS**. Run `npm install` on the **same OS** you use for
development — do not share `node_modules` between Windows and WSL against the same project directory.

Node's built-in `node:sqlite` is used by the local metadata store. On current Node versions it may print an
`ExperimentalWarning`; that is expected for local MVP development.

### Install (all platforms)

```bash
# Linux / macOS / WSL
node -v   # should be 22+
npm install          # .npmrc enables legacy-peer-deps; postinstall runs tsc -b
npm run dev          # builds packages, starts API + web
```

```powershell
# Windows (PowerShell or CMD — native Node, not WSL path)
node -v   # should be 22+
npm install
npm run dev
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| `tsx` / `next` not found | `node_modules` missing or incomplete install | Run `npm install` on your current OS |
| Mixed native module warnings | Windows and WSL shared one `node_modules` | Delete `node_modules` and `npm install` once on the OS you dev on |
| `resolveSessionWorkspaceDir` export missing | `packages/*/dist` stale after pull/rebase | `npm run build` (automatic via `predev:api` / `npm run dev`) |
| Turbopack font module error | Monorepo + `next dev --turbopack` | Default `dev:web` uses webpack; optional `npm run dev:turbo -w @open-data-agent/web` |
| Tailwind / lightningcss native error | Wrong OS binaries in `node_modules` | Remove `node_modules` and reinstall on your current platform |
| npm peer dependency ERESOLVE | CopilotKit pre-release peers | `.npmrc` sets `legacy-peer-deps=true` |

**WSL tip:** clone or keep the repo under the Linux filesystem (e.g. `~/project/dataagent`), not only under
`/mnt/c/...`. Avoid running `npm install` from Windows against `\\wsl$\\...\\dataagent` — that installs
Windows native modules into a tree you later use from Linux.

## Install

```bash
npm install
```

`postinstall` compiles workspace TypeScript packages into `dist/` so `npm run dev:api` can import them immediately
after clone or rebase.

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
npm run smoke:files
npm run smoke:skills
npm run smoke:run-identity
npm run smoke:data-gateway
npm run smoke:server-datasources
npm run smoke:sql
npm run smoke:agent
npm run smoke:task-state
npm run smoke:context-architecture
npm run smoke:context-compilation
npm run smoke:docs
npm run smoke:conversation-memory
npm run smoke:knowledge-policy
npm run smoke:long-term-memory
npm run smoke:memory-recall-shadow
npm run smoke:config-api
npm run smoke:collaboration
npm run smoke:workspace
npm run smoke:tool-state
npm run smoke:api-context
npm run smoke:agui-stream
npm run smoke:copilotkit-run
npm run smoke:api
npm run test:ingress-messages
npm run test:web
npm run build:web
```

Expected coverage:

- `smoke:metadata`: metadata schema, repositories, run event persistence.
- `smoke:files`: FileAsset sha256 dedupe, FileAssetRef download/materialization, artifact file publishing,
  and KB document import attribution.
- `smoke:skills`: Skill package parsing, FileAssetRef-backed storage, auto selection, workspace materialization,
  and skill ToolObservationAdapter coverage.
- `smoke:run-identity`: AG-UI thread/run identity, idempotent replay, parent run persistence.
- `smoke:data-gateway`: datasource registration, support types, schema inspection, preview.
- `smoke:server-datasources`: optional real PostgreSQL/MySQL/ClickHouse E2E via `ODA_E2E_*` env vars.
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
- `smoke:knowledge-policy`: KB `retrievalTopK`, `scoreThreshold`, and chunk policy consumption.
- `smoke:long-term-memory`: durable long-term memory records, local relevance retrieval, governed context injection,
  automatic extraction, sensitive candidate filtering, and ContextPackage source attribution.
- `smoke:memory-recall-shadow`: compares local long-term memory retrieval with Knowledge retrieval and records the
  Mastra Semantic Recall gate as not configured until vector/embedder policy is approved.
- `smoke:config-api`: config resources, encrypted secrets, revision conflicts, KB, MCP, model profile test,
  Skill, jobs, files, artifacts, tombstone delete.
- `smoke:collaboration`: ask-user/submit-plan suspend-resume and plan approval.
- `smoke:workspace`: Mastra workspace tools and local sandbox integration.
- `smoke:tool-state`: concurrent tool state isolation.
- `smoke:api-context`: CopilotKit/AG-UI request context extraction for datasource and user input.
- `smoke:agui-stream`: Mastra stream normalization, custom token usage, and workspace custom event projection.
- `smoke:copilotkit-run`: `/api/copilotkit` end-to-end run, event ordering, persistence, replay, and suspended state.
- `smoke:api` / `smoke:copilotkit`: Agent Runtime startup, `/api/copilotkit` CORS, and AG-UI request validation.
- `test:ingress-messages`: AG-UI multimodal ingress normalization for chat uploads and image/document parts.

## Run Agent Runtime

Start the backend:

```bash
npm run dev:api
```

Or start **both** API and web (recommended for local work):

```bash
npm run dev
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
- `/api/v1/datasource-types`
- `/api/v1/knowledge-bases`
- `/api/v1/files`
- `/api/v1/mcp-servers`
- `/api/v1/model-profiles`
- `/api/v1/skills`
- `/api/v1/workspace-config`
- `/api/v1/run-defaults`
- `/api/v1/jobs/:id`
- `/api/v1/artifacts/:id`

File lifecycle:

- Upload reusable files with `POST /api/v1/files`; returned `id` is a FileAssetRef id.
- Agent runs are still started through `/api/copilotkit`, not `/api/v1/runs`.
- Pass uploaded files into a run through AG-UI `RunAgentInput.forwardedProps.run_config.fileIds`.
- The backend materializes run files under the isolated workspace `input/` directory.
- Agent-generated deliverables should call `publish_artifact`; reusable non-deliverable workspace files should call
  `promote_workspace_file`.
- Download user-visible files through `/api/v1/files/:id/download` or artifact deliverables through
  `/api/v1/artifacts/:id/download`.

Skill lifecycle:

- Upload skill packages with `POST /api/v1/skills` using multipart `file=SKILL.md` or `file=skill.zip`.
- The package body is stored once through FileAssetRef; Skill metadata stores `packageFileRefId`.
- Preview run-time selection with `POST /api/v1/skills/select`.
- Agent runs use `run_config.skill_mode`, `skill_ids`, `skill_tags`, and `skill_policy`; legacy
  `activeSkillId` / `enabledSkillIds` are still accepted.
- Each run materializes only selected skills into its isolated workspace and exposes Mastra
  `skill`, `skill_search`, and `skill_read` tools through context governance.

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

Supported databases:

- Use `GET /api/v1/datasource-types` to discover currently enabled datasource adapters and required fields.
- See [Supported Databases](docs/engineering/supported-databases.md) for the full list, registration examples, and
  agent run selection flow.

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

- [Quick Start (中文)](docs/quick-start.md) — install, configure LLM API key, and run your first data task
- [Docs Index](docs/README.md) — includes **source-of-truth priority** for AI implementation
- [CopilotKit / AG-UI Frontend Protocol Support](docs/engineering/copilotkit-ag-ui-frontend-protocol.md)
- [Config Management REST API](docs/engineering/config-management-api.md)
- [Context Layering ADR](docs/engineering/adr-0003-context-layering-and-naming.md)
- [Frontend Capability Status](docs/engineering/2026-06-25-frontend-capability-status.md) · [Backend Requirements](docs/engineering/2026-06-25-backend-requirements.md)
- [Data Task Page Design](apps/web/src/app/data-tasks/DESIGN.md)
- [R&D B Architecture Plan](docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md) (historical)
- [Final Engineering Design](docs/engineering/db-gpt-like-data-agent-final-design-zh.md) (historical)
- [Main PRD Chinese](docs/prd/db-gpt-like-data-agent-prd-plan-zh.md)
