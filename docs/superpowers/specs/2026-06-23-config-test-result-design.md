# Configuration Test Result Design

## Goal

Make the result of a workspace configuration connection test visible directly below the action buttons in the configuration detail view.

## Interaction

- While a test request is pending, the test button indicates that testing is in progress.
- On success, an inline result card remains visible until the next test or the detail view closes.
- For LLM profiles, the card shows the resolved model, latency, and the provider's short response.
- On failure, the card shows the structured API error message.
- Other configuration types show a concise response summary without exposing credentials.

## Data Flow

`WorkspaceConfigPanel` invokes the existing `onTestItem` callback. Its returned API payload is stored as local panel state and passed to `ConfigItemDetailView`, which renders the inline result card immediately beneath the action group. The existing refresh after a test remains responsible for updating persisted resource status.

## Testing

- Unit-test the formatting function for successful LLM responses and failures.
- Unit-test that the result card renders only after a test result exists.
