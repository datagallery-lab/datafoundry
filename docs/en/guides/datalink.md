# DataLink semantic service

DataLink is DataFoundry's first-party semantic graph service. It connects physical schemas and profiles to business concepts, entities, join paths, and confidence-scored relationships. The source lives in `services/datalink` and remains Python-based.

## Runtime topology

When enabled, the existing DataFoundry deployment starts four local processes:

| Process | Default endpoint | Purpose |
| --- | --- | --- |
| Web | `http://127.0.0.1:3000` | Workbench UI |
| DataFoundry API | `http://127.0.0.1:8787` | Agent runtime and management API |
| DataLink MCP | `http://127.0.0.1:8080/mcp` | `datalink_explore` for agent grounding |
| DataLink REST | `http://127.0.0.1:8081` | Graph management and visualization API |

The API registers `builtin-datalink` once per user and workspace. The managed resource is preferred in the DataLink panel, cannot be deleted through the configuration API, and reports `unavailable` when its REST health probe fails. User-configured external DataLink servers remain supported.

## Enable the bundled service

Install Python 3.10+ and [uv](https://docs.astral.sh/uv/), then run:

```bash
npm run install:datalink
```

Set the root `.env`:

```bash
DATALINK_ENABLED=true
```

Use `npm run dev` for contributor hot reload or the formal deployment commands:

```bash
npm run build
npm run build:web
npm run start
```

`Ctrl+C` terminates all child processes. If `DATALINK_ENABLED=false` or is omitted, DataFoundry starts only Web and API and does not check for Python or uv.

## Configuration

Default managed paths and endpoints are:

```bash
DATALINK_CONFIG_PATH=services/datalink/datalink_config.json
DATALINK_GRAPH_DB_PATH=storage/datalink/datalink.db
DATALINK_API_HOST=127.0.0.1
DATALINK_API_PORT=8081
DATALINK_MCP_HOST=127.0.0.1
DATALINK_MCP_PORT=8080
```

DataLink reuses DataFoundry's `LLM_*` and `EMBEDDING_*` settings. Define `DATALINK_LLM_MODEL`, `DATALINK_LLM_BASE_URL`, `DATALINK_LLM_API_KEY`, or their `DATALINK_EMBEDDING_*` equivalents only when the semantic service needs a separate provider.

API keys do not need to be written to `datalink_config.json`. Keep them in environment variables or your deployment secret manager. The graph database is stored under the ignored `storage/` directory by default; include it in the deployment backup policy.

## Split processes

For an existing process supervisor, use the same deployment model with separate commands:

```bash
npm run start:api
npm run start:web
npm run start:datalink:mcp
npm run start:datalink:api
```

All four commands read the root `.env`. Disabling automatic startup does not remove support for external DataLink servers configured through MCP settings.

## Verification

```bash
curl http://127.0.0.1:8081/healthz
```

Expected response:

```json
{"status":"ok","service":"datalink"}
```

If startup reports that uv is missing, install uv and rerun `npm run install:datalink`. If the workbench shows the managed server as unavailable, verify ports `8080` and `8081`, inspect both DataLink process logs, and confirm the configured graph path is writable.
