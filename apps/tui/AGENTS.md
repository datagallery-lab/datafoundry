# apps/tui — Agent constraints

Terminal UI (`@datafoundry/tui`) for the datafoundry monorepo.

## Runtime boundary

- Connects to backend via CopilotKit single-route `/api/copilotkit`.
- Reuses Web data-task reducers through symlinks under `src/state/`.
- Default agent: `dataFoundry`.

## Docs (read in order)

1. [`docs/zh/guides/tui.md`](../../docs/zh/guides/tui.md)
2. [`docs/zh/reference/agent-runtime.md`](../../docs/zh/reference/agent-runtime.md)
3. [`.docs-internal/engineering/tui-protocol-client.md`](../../.docs-internal/engineering/tui-protocol-client.md)
4. [`.docs-internal/engineering/tui-state-management.md`](../../.docs-internal/engineering/tui-state-management.md)

## Code conventions

- Slash commands live in `src/commands/`; keep command registry and handlers in sync.
- Do not embed credentials in AG-UI payloads; use config REST on the backend.
- When changing store shape, selectors, or protocol client behavior, update the matching `.docs-internal/engineering/tui-*.md` doc in the same change.

## Verify

From repo root:

```bash
npm run build:tui
npm run start:tui -- --help
```
