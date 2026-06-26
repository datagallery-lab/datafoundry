# TUI State Management

This directory contains the state management implementation for the TUI application.

## Structure

### Symbolic Links (Reused from Web App)
- `live-run-state.ts` → `../../../web/src/app/data-tasks/live-run-state.ts`
  - Core LiveRun state types and reducer logic
  - Handles run status, plan tasks, events, artifacts, audits, tool calls
  - Event processing for AG-UI protocol (RUN_STARTED, RUN_FINISHED, TOOL_CALL_*, etc.)

- `data-task-state.ts` → `../../../web/src/app/data-tasks/data-task-state.ts`
  - Data task types (TimelineEvent, DataArtifact, SchemaTable, etc.)
  - Utility functions for data step kinds and labels

- `workspace-layout.ts` → `../../../web/src/app/data-tasks/workspace-layout.ts`
  - Layout constants and utilities (required by data-task-state.ts)

### TUI-Specific Files

#### `tui-state.ts`
Extends `LiveRun` with TUI-specific fields:
- `messages: DisplayMessage[]` - Chat message history for display
- `inputBuffer: string` - Current user input buffer
- `connectionStatus: 'connected' | 'disconnected' | 'error'` - WebSocket connection status
- `threadId?: string` - Current session thread ID
- `lastError?: string` - Last error message

Functions:
- `createInitialTuiState()` - Create initial state
- `updateConnectionStatus()` - Update connection status
- `updateInputBuffer()` / `clearInputBuffer()` - Manage input buffer
- `setThreadId()` - Set thread ID

#### `message-history.ts`
Message accumulation and display formatting:
- `addUserMessage()` - Add user message to history
- `addAssistantMessage()` - Add assistant message to history
- `addSystemMessage()` - Add system message to history
- `updateLastAssistantMessage()` - Update last assistant message (for streaming)
- `appendToLastAssistantMessage()` - Append delta to last assistant message
- `finalizeLastAssistantMessage()` - Mark streaming as complete
- `formatMessageForDisplay()` - Format message for terminal display
- `formatMessagesForDisplay()` - Format all messages
- `getRecentMessages()` - Get last N messages

#### `store.ts`
Central state store with observer pattern:
- Singleton `StateStore` class
- Subscribe to state changes
- Wrapper methods for all state operations
- Integrates `reduceLiveRunEvent` for AG-UI protocol events

#### `index.ts`
Re-exports all state types and functions for easy consumption.

## Usage

```typescript
import { store } from './state/store';
import { formatMessagesForDisplay } from './state';

// Subscribe to state changes
const unsubscribe = store.subscribe((state) => {
  console.log('State updated:', state);
});

// Add user message
store.addUserMessage('Query sales data');

// Handle protocol event
store.handleLiveRunEvent({ type: 'RUN_STARTED' });

// Update connection status
store.setConnectionStatus('connected');

// Stream assistant response
store.addAssistantMessage('', true); // Start streaming
store.appendToAssistantMessage('Analyzing ');
store.appendToAssistantMessage('data...');
store.finalizeAssistantMessage(); // Complete streaming

// Format messages for display
const state = store.getState();
const formatted = formatMessagesForDisplay(state.messages);
```

## Integration with Protocol

The state management integrates with the CopilotKit protocol through `reduceLiveRunEvent`:

1. **Run Lifecycle**: `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
2. **Tool Calls**: `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`
3. **Activity Events**: `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` (for plan updates)
4. **State Updates**: `STATE_SNAPSHOT`, `STATE_DELTA`
5. **Custom Events**: `sql_audit`, `artifact`, `token_usage`

All these events are processed by `reduceLiveRunEvent` and update the LiveRun portion of the state, while TUI-specific fields (messages, input, connection) are managed separately.
