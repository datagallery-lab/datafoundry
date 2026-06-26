# TUI Implementation Plan for DataAgent

## 目标
实现一个终端用户界面(TUI)，对接现有的 `/api/copilotkit` 后端协议，提供与Web前端等效的数据代理交互能力。

## 对接dataagent后端：必须参考Web前端实现

### Web前端的CopilotKit对接方式（参考模板）

**关键文件**: `apps/web/src/app/data-tasks/page.tsx`

**1. CopilotKit初始化**
```typescript
// Line 220-242
<CopilotKit
  runtimeUrl={runtimeUrl}              // "http://127.0.0.1:8787/api/copilotkit"
  agent={agentId}                      // "dataAgent"
  useSingleEndpoint                    // 使用单一endpoint模式
  properties={{ datasourceId: defaultDatasourceId }}  // forwardedProps
  showDevConsole={false}
  onError={(event) => {
    // 错误处理
  }}
>
  <DataTaskWorkspace />
</CopilotKit>
```

**2. 使用useAgentContext传递运行时上下文**
```typescript
// Line 451-463: 传递datasource_id
useAgentContext({
  description: "datasource_id",
  value: defaultDatasourceId,
});

// Line 458: 传递run_config (forward-compatible payload)
useAgentContext({
  description: "run_config", 
  value: buildRunConfig(workspaceConfig, activeLlmId),
});

// Line 463: 传递工作区状态（调试用）
useAgentContext({
  description: "当前数据任务工作区状态",
  value: sanitizeWorkspaceConfig(workspaceConfig),
});
```

**3. 使用useDataAgentRun订阅事件流**
```typescript
// apps/web/src/app/data-tasks/use-data-agent-run.ts
const { agent } = useAgent({
  agentId,
  updates: [
    UseAgentUpdate.OnMessagesChanged,
    UseAgentUpdate.OnStateChanged,
    UseAgentUpdate.OnRunStatusChanged,
  ],
});

// 订阅AG-UI事件
const subscription = agent.subscribe({
  onEvent: ({ event }) => applyEvent(event as BaseEvent),
  onRunStartedEvent: ({ event }) => applyEvent(event),
  onRunFinishedEvent: ({ event }) => applyEvent(event),
  onRunErrorEvent: ({ event }) => applyEvent(event),
  onActivitySnapshotEvent: ({ event }) => applyEvent(event),
  onActivityDeltaEvent: ({ event }) => applyEvent(event),
  onStateSnapshotEvent: ({ event }) => applyEvent(event),
  onStateDeltaEvent: ({ event }) => applyEvent(event),
  onToolCallStartEvent: ({ event }) => applyEvent(event),
  onToolCallArgsEvent: ({ event }) => applyEvent(event),
  onToolCallEndEvent: ({ event }) => applyEvent(event),
  onToolCallResultEvent: ({ event }) => applyEvent(event),
  onCustomEvent: ({ event }) => applyEvent(event),
  onRunFailed: ({ error }) => { /* ... */ },
});
```

**4. 事件归约（State Reduction）**
```typescript
// apps/web/src/app/data-tasks/live-run-state.ts
const applyEvent = (event: BaseEvent) => {
  setLiveRun((current) => reduceLiveRunEvent(current, event));
};

// reduceLiveRunEvent处理所有AG-UI事件类型
export function reduceLiveRunEvent(state: LiveRun, event: AgUiLikeEvent): LiveRun
```

### TUI必须遵循的对接原则

1. **不能使用CopilotKit React组件** - TUI运行在Node.js环境，无法使用`@copilotkit/react-core`
2. **必须手动实现AG-UI协议客户端** - 直接HTTP POST到`/api/copilotkit`，解析SSE流
3. **复用Web端的状态管理逻辑** - 直接引用`reduceLiveRunEvent`和相关类型
4. **严格遵循Web端的请求格式** - `RunAgentInput`结构必须与Web端一致
5. **处理相同的事件类型** - RUN_*, TEXT_MESSAGE_*, TOOL_CALL_*, ACTIVITY_*, STATE_*, CUSTOM

### TUI与Web的架构对比

| 层级 | Web前端 | TUI实现 |
|------|---------|---------|
| **框架层** | `@copilotkit/react-core/v2` | 手动实现AG-UI协议客户端 |
| **UI层** | React + Next.js | ink (React for CLI) |
| **状态管理** | `reduceLiveRunEvent` | **复用相同的reducer** |
| **协议层** | CopilotKit封装 | 直接HTTP + SSE解析 |
| **传输层** | fetch/SSE (浏览器) | Node built-in fetch + SSE |

## 架构设计

### 技术栈选择
- **语言**: TypeScript (与现有monorepo一致)
- **运行时**: Node.js 22+
- **TUI框架**: `ink` (React-based CLI framework) - 可以复用Web端的状态管理逻辑
- **HTTP客户端**: Node built-in `fetch` - SSE流式响应
- **项目位置**: `apps/tui` (新workspace)

### 核心模块

#### 1. Protocol Client (`src/protocol/copilotkit-client.ts`)
- 实现 AG-UI `RunAgentInput` 请求构造
- SSE事件流解析和分发
- 事件类型映射: RUN_*, TEXT_MESSAGE_*, TOOL_CALL_*, ACTIVITY_*, STATE_*, CUSTOM
- 错误处理和重连机制

#### 2. State Management (`src/state/`)
- **复用Web端逻辑**: 
  - `live-run-state.ts` → `tui-run-state.ts` (适配非React环境)
  - `reduceLiveRunEvent` 核心reducer保持不变
  - `LiveRun`, `LiveToolCallRecord`, `SessionUsageStats` 类型直接引用
- **新增TUI状态**:
  - 当前输入模式 (chat/datasource-select)
  - 滚动位置/视图焦点
  - 消息历史缓冲

#### 3. TUI Components (`src/ui/`)
基于ink组件系统:

**布局结构**:
```
┌─ Header ──────────────────────────────────────┐
│ DataAgent TUI | Session: xxx | Status: ●     │
├─ ChatArea ────────────────────────────────────┤
│ User: 查询销售数据                             │
│ Assistant: [正在执行...                        │
│   └─ [inspect_schema] ✓ 检查schema (120ms)    │
│   └─ [run_sql_readonly] ⟳ 执行SQL...          │
├─ ActivityPanel ───────────────────────────────┤
│ ■ 检查数据源 schema    [✓] 120ms              │
│ ■ 生成并执行只读 SQL   [⟳] ...                │
│ ■ 生成最终回答         [ ] pending             │
├─ ArtifactPreview (conditional) ───────────────┤
│ 📊 Artifact: sales_summary                    │
│ Rows: 156 | Created: 2026-06-23 10:23        │
├─ Input ───────────────────────────────────────┤
│ > _                                            │
└───────────────────────────────────────────────┘
```

**组件清单**:
- `<App>`: 根组件，管理全局状态
- `<Header>`: 会话信息、连接状态
- `<ChatArea>`: 消息历史，流式文本渲染
- `<ActivityPanel>`: ACTIVITY plan/step进度可视化
- `<ToolTraceList>`: TOOL_CALL_* 事件展示
- `<ArtifactCard>`: CUSTOM(artifact) 渲染
- `<InputBox>`: 用户输入，支持多行
- `<DatasourceSelector>`: 数据源选择UI

#### 4. Entry Point (`src/index.ts`)
- CLI参数解析 (runtime URL, datasource, session恢复)
- 环境检查
- 启动ink应用

## 实现细节

### Protocol Client实现（参考CopilotKit内部实现）

TUI必须手动实现CopilotKit在浏览器中自动完成的工作。

```typescript
// src/protocol/copilotkit-client.ts
import type { BaseEvent, Context, Message, Tool } from "@ag-ui/core";

export class CopilotKitClient {
  constructor(
    private config: { runtimeUrl: string; agent: string }
  ) {}

  /**
   * 发送CopilotKit single-route envelope到/api/copilotkit，解析SSE事件流
   * 参考Web端CopilotKit useSingleEndpoint模式
   */
  async *runAgent(input: RunAgentInput): AsyncGenerator<BaseEvent> {
    const response = await fetch(this.config.runtimeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: this.config.agent },
        body: {
          threadId: input.threadId,
          runId: input.runId,
          state: input.state ?? {},
          messages: input.messages,
          tools: input.tools ?? [],
          context: input.context ?? [],
          forwardedProps: input.forwardedProps ?? {},
        },
      }),
    });

    // 解析SSE流: data: {...}\n\n
    // 实现需支持CRLF和多行data字段
  }
}

export interface RunAgentInput {
  threadId: string;           // session id
  runId: string;              // unique per run
  messages: Message[];        // AG-UI messages, must include id
  tools?: Tool[];
  context?: Context[];        // useAgentContext传递的内容
  state?: unknown;
  forwardedProps?: {          // 最高优先级的上下文（参考协议§2）
    datasourceId?: string;
  };
}
```

**关键点**:
1. **不需要特殊认证** - 后端当前固定使用`dev-user`
2. **forwardedProps.datasourceId优先级最高** - 参考协议文档§2
3. **SSE格式**: `data: {...}\n\n`，需要兼容`data: [DONE]\n\n`
4. **错误处理**: 503表示`PROVIDER_CONFIG_MISSING`，400表示validation error

### State Reducer适配

```typescript
// src/state/tui-run-state.ts
// 直接引用 @open-data-agent/web 中的 live-run-state.ts
import {
  createInitialLiveRun,
  reduceLiveRunEvent,
  type LiveRun
} from "@open-data-agent/web/src/app/data-tasks/live-run-state";

// TUI特定状态扩展
export interface TuiSessionState {
  liveRun: LiveRun;
  messages: DisplayMessage[];
  inputBuffer: string;
  viewMode: "chat" | "trace" | "artifacts";
}
```

### Ink UI实现要点

```typescript
// src/ui/App.tsx
import React, { useState, useEffect } from "react";
import { Box, Text, useInput, render } from "ink";
import { CopilotKitClient } from "../protocol/copilotkit-client";

export function App({ runtimeUrl, datasourceId }: AppProps) {
  const [state, setState] = useState<TuiSessionState>(createInitialState());
  
  useEffect(() => {
    // 启动AG-UI事件流订阅
    const client = new CopilotKitClient(runtimeUrl);
    // ... event handling
  }, []);
  
  useInput((input, key) => {
    // 处理用户输入
    if (key.return) {
      sendMessage(state.inputBuffer);
    }
  });
  
  return (
    <Box flexDirection="column" height="100%">
      <Header status={state.liveRun.runStatus} />
      <ChatArea messages={state.messages} liveRun={state.liveRun} />
      <ActivityPanel plan={state.liveRun.plan} />
      <InputBox value={state.inputBuffer} />
    </Box>
  );
}
```

## 协议对接关键点

### 1. RunAgentInput构造
```typescript
const input: RunAgentInput = {
  threadId: sessionId,
  runId: `run-${Date.now()}`,
  messages: [
    { id: `msg-${Date.now()}`, role: "user", content: userInput }
  ],
  tools: [],
  context: [
    { description: "datasource_id", value: selectedDatasource }
  ],
  state: selectedDatasource ? { datasourceId: selectedDatasource } : {},
  forwardedProps: {
    datasourceId: selectedDatasource // 最高优先级
  }
};
```

### 2. SSE流解析
```
data: {"type":"RUN_STARTED","runId":"run-123"}\n\n
data: {"type":"TEXT_MESSAGE_CHUNK","delta":"正在"}\n\n
data: {"type":"TOOL_CALL_START","id":"tool-1","name":"inspect_schema"}\n\n
```

### 3. 事件处理优先级
按照协议文档 §3:
- RUN_* → 更新全局状态
- TEXT_MESSAGE_CHUNK → 追加到当前assistant消息
- TOOL_CALL_* → 创建/更新toolCall记录
- ACTIVITY_* → 更新plan/step状态
- CUSTOM(sql_audit) → 记录审计信息
- CUSTOM(artifact) → 添加到artifacts列表

## 实施步骤

### Phase 1: 基础框架
- 创建 `apps/tui` workspace结构
- 配置 package.json, tsconfig.json
- 设置构建脚本

### Phase 2: 协议客户端
- 实现 `CopilotKitClient` 类
- SSE流解析器
- 事件类型定义和映射

### Phase 3: 状态管理
- 创建状态类型定义
- 实现事件reducer
- 消息历史管理

### Phase 4: UI组件
- 实现基础布局组件
- ChatArea消息渲染
- ActivityPanel进度显示
- 输入框交互

### Phase 5: 集成和测试
- CLI入口实现
- 端到端测试
- 错误处理完善

## 验证标准

- ✅ 能够连接到 `http://127.0.0.1:8787/api/copilotkit`
- ✅ 正确发送 RunAgentInput
- ✅ 实时显示 TEXT_MESSAGE_CHUNK
- ✅ 显示工具调用进度 (TOOL_CALL_*)
- ✅ 显示ACTIVITY plan/step状态
- ✅ 显示artifacts和SQL审计信息
- ✅ 支持多轮对话
- ✅ 优雅处理连接错误

## 依赖清单

```json
{
  "dependencies": {
    "ink": "^6.8.0",
    "react": "^19.1.0",
    "@ag-ui/core": "^0.0.57",
    "zod": "^4.4.3"
  }
}
```
