# Data Task UI (`@open-data-agent/web`)

Next.js data-task workspace. Part of the dataagent monorepo npm workspaces.

The frontend connects to the backend Agent Runtime over CopilotKit / AG-UI. It uses
`@copilotkit/react-core/v2` only — **no** `@copilotkit/runtime` in this app. Agent orchestration
lives in `apps/api`.

## Setup

From the repository root:

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
```

Requires Node.js 22+ (same as the backend).

## Run

Start the backend first (`npm run dev:api` from repo root), then:

```bash
npm run dev:web
```

Open <http://localhost:3000/data-tasks>.

`NEXT_PUBLIC_AGENT_RUNTIME_URL` defaults to `http://127.0.0.1:8787/api/copilotkit`.

## Verify

From the repository root:

```bash
npm run test:web
npm run build:web
```

Design notes: [`src/app/data-tasks/DESIGN.md`](src/app/data-tasks/DESIGN.md).

AI / agent constraints: [`AGENTS.md`](AGENTS.md).
