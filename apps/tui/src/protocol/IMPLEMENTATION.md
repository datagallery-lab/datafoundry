# Protocol Implementation

## Files

- `types.ts` - AG-UI-compatible input and event type aliases.
- `copilotkit-client.ts` - CopilotKit single-route HTTP client and SSE parser.
- `index.ts` / `client.ts` - Protocol module exports.
- `example.ts` - Minimal usage example.
- `README.md` - Request shape, event list, and error code reference.

## Request Format

The runtime uses `useSingleEndpoint`, so requests are posted as a single-route envelope:

```ts
{
  method: "agent/run",
  params: { agentId: "dataAgent" },
  body: {
    threadId: "thread-123",
    runId: "run-456",
    state: {},
    messages: [{ id: "msg-1", role: "user", content: "Show sales data" }],
    tools: [],
    context: [{ description: "datasource_id", value: "api-duckdb-demo" }],
    forwardedProps: { datasourceId: "api-duckdb-demo" }
  }
}
```

The `body` object must satisfy AG-UI `RunAgentInput`.

## SSE Events

The client accepts `text/event-stream` responses and yields parsed AG-UI events. Important event names include:

- `RUN_STARTED`
- `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_CHUNK`
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

- `PROVIDER_CONFIG_MISSING` - Backend returned 503.
- `VALIDATION_ERROR` - Backend returned 400.
- `NETWORK_ERROR` - Request failed before an HTTP response.
- `HTTP_ERROR` - Other non-2xx status.
- `INVALID_CONTENT_TYPE` - Response was not SSE.

## Dependencies

The implementation uses Node's built-in `fetch` and `ReadableStream` APIs. No `undici` dependency is required.
