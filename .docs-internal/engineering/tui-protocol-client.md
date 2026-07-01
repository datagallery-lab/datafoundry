# TUI Protocol Client

> **Code:** `apps/tui/src/protocol/`  
> **Maintenance:** Update when changing CopilotKit client request shape or SSE parsing.

## Request Shape

The backend endpoint is configured with `useSingleEndpoint`, so the client posts a single-route envelope:

```ts
{
  method: "agent/run",
  params: { agentId: "dataFoundry" },
  body: {
    threadId,
    runId,
    state: {},
    messages,
    tools: [],
    context: [{ description: "datasource_id", value: "api-duckdb-demo" }],
    forwardedProps: { datasourceId: "api-duckdb-demo" }
  }
}
```

`body` must satisfy AG-UI `RunAgentInput`.

## Basic Usage

```ts
const client = new CopilotKitClient({
  runtimeUrl: "http://localhost:3000/api/copilotkit",
  agent: "dataFoundry"
});

for await (const event of client.runAgent({
  threadId,
  runId,
  messages,
  tools: [],
  state: {},
  context: [],
  forwardedProps: {}
})) {
  // Handle AG-UI events.
}
```

## Events

The stream is SSE (`data: {...}\n\n`) containing AG-UI events such as:

- `RUN_STARTED`
- `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_END`
- `TOOL_CALL_START`
- `TOOL_CALL_ARGS`
- `TOOL_CALL_END`
- `TOOL_CALL_RESULT`
- `ACTIVITY_SNAPSHOT`
- `ACTIVITY_DELTA`
- `STATE_SNAPSHOT`
- `STATE_DELTA`
- `CUSTOM`
- `RUN_FINISHED`
- `RUN_ERROR`

## Error Codes

- `PROVIDER_CONFIG_MISSING`: backend returned 503 because the LLM provider is not configured.
- `VALIDATION_ERROR`: backend returned 400 for an invalid envelope or AG-UI input.
- `NETWORK_ERROR`: HTTP request failed before a response.
- `HTTP_ERROR`: any other non-2xx status.
- `INVALID_CONTENT_TYPE`: response was not SSE.
