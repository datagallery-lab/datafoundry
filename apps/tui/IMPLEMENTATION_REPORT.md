# DataAgent TUI Implementation Report

## Status

The TUI now lives at:

```text
dataagent/apps/tui
```

It is registered as the `@dataagent/tui` npm workspace and is wired to the root scripts:

- `npm run build:tui`
- `npm run dev:tui`
- `npm run start:tui`

## Implemented

1. Protocol client
   - Posts the CopilotKit single-route envelope with `method: "agent/run"`.
   - Sends AG-UI `RunAgentInput` fields under `body`.
   - Includes `state`, `messages`, `tools`, `context`, and `forwardedProps`.
   - Parses SSE events with support for CRLF and multiline `data:` frames.
   - Maps backend validation/provider/network failures to explicit error codes.

2. State management
   - Reuses Web data-task reducers through symlinks.
   - Keeps TUI-specific message, connection, thread, and input state in `state-store.ts`.

3. Ink UI
   - Chat history and streaming assistant response rendering.
   - Activity panel, tool trace list, artifact card, header, and input box.
   - CLI bootstraps a connected thread before rendering so input is usable immediately.

4. Workspace integration
   - Package is inside `apps/tui`.
   - Uses Ink 6 with React 19 to match the monorepo's React runtime.
   - Uses Node built-in `fetch`; `undici` is not needed.

## Verified

```bash
npm ls @types/react --workspace @dataagent/tui
npm run build:tui
npm run start:tui -- --help
```

The TUI build currently succeeds. A real agent run still requires the API server and provider configuration to be available.

## Notes

- Datasource context is sent as both `context: [{ description: "datasource_id", value }]` and `forwardedProps.datasourceId`, matching the backend extraction priority.
- The UI handles current AG-UI text events: `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_CHUNK`, `TEXT_MESSAGE_END`, `RUN_FINISHED`, and `RUN_ERROR`.
- Build output under `dist/` is ignored and should be regenerated locally with `npm run build:tui`.
