# Quick start

This guide is for first-time DataFoundry deployers. After reading it, you can start the Web workbench in the **formal** stack (`build` + `start`, `password` auth), configure a model service, and run a data analysis task against the built-in DuckDB demo data source.

Formal mode has two environments. **Startup commands are the same**; the main differences are email delivery and the public base URL:

| Environment | Use for | `AUTH_EMAIL_DELIVERY` | `AUTH_PUBLIC_BASE_URL` |
| --- | --- | --- | --- |
| **Formal test** | Local / private acceptance | `test` (verification links go to the API console) | e.g. `http://127.0.0.1:3000` |
| **Real production** | Public service | `smtp` (real email) | Public HTTPS origin |

Do **not** run `npm run dev` / `dev:api` / `dev:web` in either formal environment. Contributor hot-reload is in the appendix.

You do not need a business database for the first run. You only need Node.js, npm, and a model API key compatible with the OpenAI `/chat/completions` interface.

## Requirements

- Node.js >= 22
- npm
- Linux, macOS, or Windows
- A model API key—for example Qwen, DeepSeek, or another OpenAI-compatible service

On Windows, install and run the project in the same environment. Do not share `node_modules` between Windows and WSL.

## 1. Install dependencies

From the repository root:

```bash
node -v
npm install
```

`node -v` must report 22 or higher. The first install compiles workspace dependencies; time depends on your machine and network.

## 2. Configure environment variables

Copy the environment templates:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

### 2.1 Model (required for both formal environments)

Edit the root `.env` and set model configuration:

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your-api-key
```

DeepSeek example:

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your-api-key
```

### 2.2 Formal test (recommended for first acceptance)

Root `.env`:

```bash
DATAFOUNDRY_AUTH_MODE=password
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_EMAIL_DELIVERY=test
AUTH_EMAIL_FROM=DataFoundry <no-reply@example.com>
# SMTP settings can stay empty for now
```

`apps/web/.env.local` (baked in at `next build`):

```bash
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE=password
# Leave empty so the browser uses the same-origin BFF (Cookie + CSRF)
NEXT_PUBLIC_AGENT_RUNTIME_URL=
NEXT_PUBLIC_CONFIG_API_URL=
API_PROXY_TARGET=http://127.0.0.1:8787
```

On register / password reset, copy the verification link from the **API process console**.

### 2.3 Real production

Start from the formal-test settings, then change to:

```bash
DATAFOUNDRY_AUTH_MODE=password
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=https://datafoundry.example.com
AUTH_EMAIL_DELIVERY=smtp
AUTH_EMAIL_FROM=DataFoundry <no-reply@example.com>
AUTH_SMTP_HOST=smtp.example.com
AUTH_SMTP_PORT=587
AUTH_SMTP_SECURE=false
AUTH_SMTP_USER=
AUTH_SMTP_PASSWORD=
```

Keep the frontend on `password`, empty public API URLs, and `API_PROXY_TARGET`. Put a reverse proxy in front; see [`deploy/nginx.datafoundry.conf.example`](https://github.com/datagallery-lab/datafoundry/blob/main/deploy/nginx.datafoundry.conf.example) — compress static assets; keep `/api/copilotkit` uncompressed and unbuffered for SSE.

## 3. Build and start (same for formal test and real production)

```bash
npm run build
npm run build:web
npm run start:api    # :8787
npm run start:web    # :3000
```

Checks:

```bash
curl http://127.0.0.1:8787/healthz   # process up
curl http://127.0.0.1:8787/ready     # Mastra / builtins ready (includes startup_ms)
```

Open [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login) (or your public origin in real production), register or sign in, then go to `/data-tasks`.

After changing any `NEXT_PUBLIC_*` value in `apps/web/.env.local`, run `npm run build:web` again.

## 4. Run your first question

On `/data-tasks`:

1. Click **New data task**.
2. Select the built-in **DTC Growth Review** data source (or keep the DuckDB demo for a minimal smoke test).
3. Select **Server default** or your configured model next to the input box.
4. Send your first question.

Suggested prompt:

```text
Show me the tables in this datasource and explain the main fields of each.
```

Aggregation prompt:

```text
Compare GMV, gross margin, ad spend, and refunds by channel. Explain which channel should receive the next budget increment.
```

When you see schema inspection, SQL execution, and result output, the path is working.

## 5. Start the TUI

With the backend running:

```bash
npm run start:tui
```

Demo mode without a backend:

```bash
npm run start:tui -- --demo
```

Resume the latest server session:

```bash
npm run start:tui -- --resume
```

More commands: [TUI guide](guides/tui.md).

## 6. Troubleshooting

### Wrong Node version

Symptom: `npm install` or build fails on Node version.

Fix:

```bash
node -v
```

Upgrade to Node.js 22 or higher, then run `npm install` again.

### Page does not load

Symptom: Browser cannot open the workbench URL.

Fix:

- Confirm `npm run start:web` is still running (do not use `dev` in formal mode).
- Check whether port 3000 is in use.
- If 3000 is taken, use the frontend port shown in terminal output.

### Backend not running

Symptom: Page loads but questions get no response, or the resource panel fails to load.

Fix:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/ready
```

If the health check fails:

```bash
npm run start:api
```

### No verification email

- **Formal test** (`AUTH_EMAIL_DELIVERY=test`): copy the link from the `start:api` terminal.
- **Real production** (`smtp`): check `AUTH_SMTP_*` and that `AUTH_PUBLIC_BASE_URL` matches the public origin.

### Model unavailable

Symptom: Agent run reports provider, 401, rate limit, or model not found errors.

Fix:

- Check `LLM_API_KEY` in `.env`.
- Confirm `LLM_BASE_URL` matches your provider's compatible endpoint.
- Confirm `LLM_MODEL` is available on your account.
- Run the test action in the Web workbench model configuration.

### Port conflict

Default ports:

| Service | Port |
| --- | --- |
| Web | 3000 |
| API | 8787 |

Stop the conflicting process, or use the port shown in the terminal. After changing the API port, update `API_PROXY_TARGET`.

### Database connection failed

- Server databases such as PostgreSQL / MySQL must be reachable.
- SQLite, CSV, Excel, and DuckDB files must use paths the API process can read.
- Prefer a read-only account or a test database for the first connection.
- Credentials are submitted only on create/update; read APIs do not return plaintext secrets.

## Appendix: contributor hot-reload (not formal mode)

For local code changes with hot reload only — **not** formal test or real production. Pick one stack; never mix with `start:*`.

```bash
# Root .env
DATAFOUNDRY_AUTH_MODE=dev

# apps/web/.env.local
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE=dev
NEXT_PUBLIC_AGENT_RUNTIME_URL=http://127.0.0.1:8787/api/copilotkit

npm run dev
# or: npm run dev:api && npm run dev:web
```

## Next steps

- Use the Web UI: [Web workbench guide](guides/web-workbench.md)
- Use the terminal UI: [TUI guide](guides/tui.md)
- Connect your own data: [Data sources guide](guides/data-sources.md)
- Review capability boundaries: [Capabilities](capabilities.md)
