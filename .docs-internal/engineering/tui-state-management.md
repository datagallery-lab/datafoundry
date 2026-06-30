# TUI State Management

> **Code:** `apps/tui/src/state/`  
> **Maintenance:** Update this document when changing TUI store shape, selectors, or session stats.

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

---

# Store API Reference

## 概述

TUI 状态管理层已完善，现在支持：

1. ✅ **配置管理** - datasources, models, skills, mcp, kb
2. ✅ **会话级统计** - 跨 run 的累积统计
3. ✅ **派生状态选择器** - 优化性能的 memoized selectors
4. ✅ **自动统计累积** - run 完成时自动更新会话统计

## 基本使用

### 订阅状态变化

```typescript
import { store } from './state/store.js';

// 订阅所有状态变化
const unsubscribe = store.subscribe((state) => {
  console.log('State updated:', state);
  // 更新 UI 组件
});

// 取消订阅
unsubscribe();
```

### 获取当前状态

```typescript
const currentState = store.getState();
console.log('Current run status:', currentState.runStatus);
console.log('Session stats:', currentState.sessionStats);
```

### 使用选择器（推荐）

选择器提供派生状态计算和性能优化：

```typescript
import {
  store,
  selectLiveSessionView,
  selectCurrentRunStats,
  selectIsRunning,
  selectEnabledDatasources,
} from './state/store.js';

// 获取实时会话视图（包含进行中的 run）
const liveView = store.select(selectLiveSessionView);
console.log('Total runs:', liveView.runCount);
console.log('Tool calls:', liveView.toolCalls);
console.log('Token usage:', liveView.tokens);

// 获取当前 run 的统计
const runStats = store.select(selectCurrentRunStats);
console.log('Current run duration:', runStats.durationMs);

// 检查运行状态
const isRunning = store.select(selectIsRunning);
if (isRunning) {
  console.log('Agent is running...');
}

// 获取启用的数据源
const datasources = store.select(selectEnabledDatasources);
console.log('Available datasources:', datasources);
```

## 配置管理

### 读取配置

```typescript
const state = store.getState();

// 获取所有数据源配置
const datasources = state.workspaceConfig.db;

// 获取所有 LLM 配置
const llms = state.workspaceConfig.llm;

// 获取所有技能
const skills = state.workspaceConfig.skill;

// 使用选择器（推荐）
import { selectEnabledDatasources, selectEnabledLlms, selectEnabledSkills } from './state/store.js';

const enabledDatasources = store.select(selectEnabledDatasources);
const enabledLlms = store.select(selectEnabledLlms);
const enabledSkills = store.select(selectEnabledSkills);
```

### 更新配置

```typescript
import type { WorkspaceConfigStore } from './state/data-task-state.js';

// 更新整个配置
const newConfig: WorkspaceConfigStore = {
  db: [...],
  llm: [...],
  skill: [...],
  kb: [],
  mcp: [],
};
store.setWorkspaceConfig(newConfig);

// 更新特定类型的配置
store.updateConfigKind('db', [
  {
    id: 'custom-sqlite',
    name: 'my-database',
    description: 'Custom SQLite database',
    enabled: true,
    settings: {
      datasourceId: 'my-db',
      type: 'sqlite',
      mode: 'readonly',
      filePath: '/path/to/db.sqlite',
    },
  },
]);

// 添加新的 LLM 配置
const currentLlms = store.getState().workspaceConfig.llm;
store.updateConfigKind('llm', [
  ...currentLlms,
  {
    id: 'custom-llm',
    name: 'Custom OpenAI',
    description: 'Custom OpenAI endpoint',
    enabled: true,
    settings: {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-...',
      modelName: 'gpt-4',
    },
  },
]);
```

## 会话统计

### 读取统计数据

```typescript
import { store, selectLiveSessionView } from './state/store.js';

// 获取实时会话视图（包含进行中的 run）
const sessionView = store.select(selectLiveSessionView);

console.log('会话统计:');
console.log('- 总运行次数:', sessionView.runCount);
console.log('- 成功运行:', sessionView.completedRuns);
console.log('- 失败运行:', sessionView.failedRuns);
console.log('- 工具调用总数:', sessionView.toolCalls.total);
console.log('- 工具调用成功率:', sessionView.toolCalls.success / sessionView.toolCalls.total);
console.log('- SQL 查询总数:', sessionView.sql.total);
console.log('- SQL 扫描行数:', sessionView.sql.rowsScanned);
console.log('- SQL 总耗时:', sessionView.sql.elapsedMs, 'ms');
console.log('- Token 使用:', sessionView.tokens);
console.log('- 产出物数量:', sessionView.artifactCount);

// 仅获取已完成 run 的累积统计（不含进行中）
const sessionStats = store.getState().sessionStats;
console.log('已完成的会话统计:', sessionStats);
```

### 统计数据自动累积

统计数据会在每次 run 完成时自动累积：

```typescript
// Store 内部逻辑（无需手动调用）：
// 1. 检测到 runStatus 从 "running" 变为 "completed" 或 "failed"
// 2. 调用 deriveRunUsage() 计算本次 run 的统计
// 3. 调用 accumulateSessionUsage() 累积到会话统计
// 4. 更新 state.sessionStats
```

### 使用统计数据优化 UI

```typescript
import {
  store,
  selectToolCallSuccessRate,
  selectSqlSuccessRate,
} from './state/store.js';

// 显示工具调用成功率
const toolSuccessRate = store.select(selectToolCallSuccessRate);
console.log(`工具调用成功率: ${(toolSuccessRate * 100).toFixed(1)}%`);

// 显示 SQL 查询成功率
const sqlSuccessRate = store.select(selectSqlSuccessRate);
console.log(`SQL 查询成功率: ${(sqlSuccessRate * 100).toFixed(1)}%`);

// 根据成功率调整 UI 颜色
const getStatusColor = (rate: number) => {
  if (rate >= 0.9) return 'green';
  if (rate >= 0.7) return 'yellow';
  return 'red';
};
```

## 性能优化

### 选择器缓存

选择器结果会自动缓存，直到状态变化：

```typescript
// 第一次调用 - 计算并缓存
const view1 = store.select(selectLiveSessionView);

// 第二次调用 - 直接返回缓存（状态未变化）
const view2 = store.select(selectLiveSessionView);

// 状态变化后 - 缓存失效，重新计算
store.handleLiveRunEvent({ type: 'RUN_STARTED' });
const view3 = store.select(selectLiveSessionView); // 重新计算
```

### 自定义选择器

创建自定义选择器以优化特定场景：

```typescript
import type { TuiAppState, Selector } from './state/store.js';

// 创建自定义选择器
const selectLastMessage: Selector<string> = (state: TuiAppState) => {
  const lastMsg = state.messages[state.messages.length - 1];
  return lastMsg?.content ?? '';
};

// 使用自定义选择器
const lastMessage = store.select(selectLastMessage);
console.log('Last message:', lastMessage);

// 参数化选择器
const selectMessageById = (id: string): Selector<string | undefined> => {
  return (state: TuiAppState) => {
    const msg = state.messages.find(m => m.id === id);
    return msg?.content;
  };
};

const message = store.select(selectMessageById('msg-123'));
```

### 避免不必要的重渲染

在组件中使用选择器避免全量重渲染：

```typescript
// ❌ 不推荐 - 订阅整个状态，任何变化都触发更新
store.subscribe((state) => {
  updateUI(state); // 即使只需要 runStatus，其他字段变化也会触发
});

// ✅ 推荐 - 使用选择器，只在需要的数据变化时更新
let prevRunning = store.select(selectIsRunning);
store.subscribe((state) => {
  const nowRunning = selectIsRunning(state);
  if (nowRunning !== prevRunning) {
    updateRunningIndicator(nowRunning);
    prevRunning = nowRunning;
  }
});
```

## 重置和清理

### 重置整个会话

```typescript
// 重置所有状态（保留配置）
store.reset();
// 结果：
// - 清空消息历史
// - 重置运行状态
// - 清空统计数据
// - 保留 workspaceConfig
```

### 重置当前 run

```typescript
// 仅重置当前 run（保留会话统计和配置）
store.resetRun();
// 结果：
// - 清空 plan, events, artifacts, audits
// - 重置 runStatus 为 "idle"
// - 保留 sessionStats 和 workspaceConfig
```

## 完整示例

### TUI 主循环集成

```typescript
import {
  store,
  selectIsRunning,
  selectLiveSessionView,
  selectCurrentRunStats,
} from './state/store.js';

// 初始化
store.setConnectionStatus('connected');
store.setThreadId('thread-123');

// 订阅状态变化并更新 UI
store.subscribe((state) => {
  // 更新连接状态指示器
  updateConnectionIndicator(state.connectionStatus);

  // 更新运行状态
  const isRunning = selectIsRunning(state);
  updateRunningIndicator(isRunning);

  // 更新统计面板
  const sessionView = selectLiveSessionView(state);
  updateStatsPanel({
    runs: `${sessionView.completedRuns}/${sessionView.runCount}`,
    toolCalls: sessionView.toolCalls.total,
    sqlQueries: sessionView.sql.total,
    tokens: sessionView.tokens.inputTokens + sessionView.tokens.outputTokens,
  });

  // 更新消息列表
  updateMessageList(state.messages);
});

// 处理用户输入
function onUserInput(input: string) {
  store.addUserMessage(input);
  store.clearInputBuffer();
  
  // 发送到后端...
  sendToBackend({ type: 'USER_MESSAGE', content: input });
}

// 处理后端事件
function onBackendEvent(event: any) {
  if (event.type === 'ASSISTANT_MESSAGE_DELTA') {
    store.appendToAssistantMessage(event.delta);
  } else if (event.type === 'ASSISTANT_MESSAGE_COMPLETE') {
    store.finalizeAssistantMessage();
  } else {
    // 其他 LiveRun 事件
    store.handleLiveRunEvent(event);
  }
}

// 定期显示统计摘要
setInterval(() => {
  const stats = store.select(selectLiveSessionView);
  console.log(`会话统计: ${stats.runCount} runs, ${stats.toolCalls.total} tool calls`);
}, 60000); // 每分钟
```

## 最佳实践

1. **优先使用选择器** - 使用预定义或自定义选择器获取派生状态
2. **避免直接修改状态** - 始终通过 store 方法更新状态
3. **细粒度订阅** - 在订阅中使用选择器，只在需要的数据变化时更新 UI
4. **配置持久化** - 考虑将 workspaceConfig 持久化到文件/localStorage
5. **错误处理** - 处理连接错误和运行失败，提供友好的错误提示
6. **统计展示** - 定期展示会话统计，帮助用户了解使用情况

## 类型定义参考

```typescript
interface TuiAppState extends TuiSessionState {
  workspaceConfig: WorkspaceConfigStore;
  sessionStats: SessionUsageStats;
}

interface SessionUsageStats {
  runCount: number;
  completedRuns: number;
  failedRuns: number;
  toolCalls: ToolCallStats;
  sql: SqlUsageStats;
  artifactCount: number;
  tokens: TokenUsageStats;
  tokenUsageReported: boolean;
}

interface WorkspaceConfigStore {
  db: WorkspaceConfigItem[];
  kb: WorkspaceConfigItem[];
  mcp: WorkspaceConfigItem[];
  llm: WorkspaceConfigItem[];
  skill: WorkspaceConfigItem[];
}
```
