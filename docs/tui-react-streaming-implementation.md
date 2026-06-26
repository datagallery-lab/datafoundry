# TUI ReAct 流式显示实现

## 问题描述

在 ReAct（Reasoning and Acting）模式下，Agent 应该交替显示推理文本和工具调用：

**期望的显示顺序：**
1. Agent 输出文本："let me list datasources..."
2. 立即显示工具调用 ● List Datasources
3. Agent 继续输出："now let me inspect..."
4. 立即显示工具调用 ● Inspect Schema
5. Agent 输出结果："I found..."

**之前的问题：**
- 文本流式输出和工具调用事件是异步的
- 无法知道工具调用在文本中的哪个位置发生
- 所有工具调用都显示在消息底部，而不是穿插在文本中

## 解决方案

### 核心思想

在消息中记录**文本片段**和**工具调用引用**的交替序列（segments），然后在渲染时按时序显示。

### 实现细节

#### 1. 扩展 DisplayMessage 结构

在 `apps/tui/src/state/tui-state.ts` 中添加 `segments` 字段：

```typescript
export type MessageSegment =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_call'; toolCallId: string; timestamp: number };

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // 保留用于向后兼容
  timestamp: number;
  isStreaming?: boolean | undefined;
  segments?: MessageSegment[] | undefined;  // 新增：交替序列
}
```

#### 2. 更新消息处理逻辑

在 `apps/tui/src/state/message-history.ts` 中：

**a) 修改 `appendToLastAssistantMessage`** - 用于增量文本更新：
```typescript
export function appendToLastAssistantMessage(
  state: TuiSessionState,
  delta: string,
): TuiSessionState {
  // 追加到最后一个 text segment，或创建新的
  if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
    // 更新最后的文本片段
    segments[segments.length - 1].content += delta;
  } else {
    // 创建新的文本片段
    segments.push({ type: 'text', content: delta, timestamp: now });
  }
}
```

**b) 修改 `updateLastAssistantMessage`** - 用于全量文本更新：
```typescript
export function updateLastAssistantMessage(
  state: TuiSessionState,
  content: string,
  isStreaming = false,
): TuiSessionState {
  // 更新或创建最后一个 text segment
  if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
    segments[segments.length - 1].content = content;  // 全量替换
  } else {
    segments.push({ type: 'text', content, timestamp: now });
  }
}
```

**c) 新增 `insertToolCallIntoLastMessage`** - 插入工具调用引用：
```typescript
export function insertToolCallIntoLastMessage(
  state: TuiSessionState,
  toolCallId: string,
): TuiSessionState {
  // 在最后一条 assistant 消息的 segments 中追加 tool_call segment
  segments.push({ type: 'tool_call', toolCallId, timestamp: now });
}
```

#### 3. 在事件处理中插入工具调用

在 `apps/tui/src/state/store.ts` 的 `handleLiveRunEvent` 中：

```typescript
handleLiveRunEvent(event: { type?: string; [key: string]: unknown }): void {
  // ... 现有逻辑 ...

  // 当收到 TOOL_CALL_START 事件时，立即插入到当前消息的 segments 中
  if (event.type === "TOOL_CALL_START") {
    const toolCallId = typeof event.toolCallId === 'string'
      ? event.toolCallId
      : `tool-${Date.now()}`;

    // 插入工具调用引用到最后一条 assistant 消息
    const stateWithToolCall = insertToolCallIntoLastMessage(this.state, toolCallId);

    // 合并 LiveRun 更新
    const newState: TuiAppState = {
      ...stateWithToolCall,
      ...newLiveRun,
      sessionStats: this.state.sessionStats,
    };

    this.setState(newState);
    return;
  }

  // ... 其他事件处理 ...
}
```

#### 4. 按 segments 顺序渲染

在 `apps/tui/src/ui/StreamingMessage.tsx` 中：

```typescript
export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  message,
  allToolCalls,
  maxContentLength,
}) => {
  // 如果消息有 segments，按顺序渲染（ReAct 风格）
  if (message.segments && message.segments.length > 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {message.segments.map((segment, index) => {
          if (segment.type === 'text') {
            // 渲染文本片段
            return (
              <Box key={`segment-${index}`} flexDirection="column">
                <MarkdownText content={segment.content} />
                {/* 在最后一个文本片段显示光标 */}
                {message.isStreaming && isLastSegment && (
                  <Text dimColor> ▊</Text>
                )}
              </Box>
            );
          } else {
            // 渲染工具调用
            const toolCall = allToolCalls.find(tc => tc.id === segment.toolCallId);
            if (!toolCall) return null;

            return (
              <Box key={`segment-${index}`} marginTop={1} marginBottom={1}>
                <InlineToolCall toolCall={toolCall} showName={true} />
              </Box>
            );
          }
        })}
      </Box>
    );
  }

  // 向后兼容：没有 segments 时使用旧的渲染逻辑
  // ...
};
```

## 事件流示例

假设 Agent 执行以下操作：

1. **事件：TEXT_MESSAGE_CHUNK** `delta: "Let me check the datasources..."`
   - 调用 `appendToLastAssistantMessage`
   - segments: `[{ type: 'text', content: 'Let me check the datasources...' }]`

2. **事件：TOOL_CALL_START** `toolCallId: 'list-ds-123', name: 'list_data_sources'`
   - 调用 `insertToolCallIntoLastMessage`
   - segments: `[{ type: 'text', ... }, { type: 'tool_call', toolCallId: 'list-ds-123' }]`

3. **事件：TOOL_CALL_RESULT**
   - 更新 `toolCalls` 状态（已有逻辑）

4. **事件：TEXT_MESSAGE_CHUNK** `delta: "Now inspecting the schema..."`
   - 调用 `appendToLastAssistantMessage`
   - segments: `[..., { type: 'tool_call', ... }, { type: 'text', content: 'Now inspecting...' }]`

5. **事件：TOOL_CALL_START** `toolCallId: 'inspect-456', name: 'inspect_schema'`
   - 调用 `insertToolCallIntoLastMessage`
   - segments: `[..., { type: 'text', ... }, { type: 'tool_call', toolCallId: 'inspect-456' }]`

## 渲染结果

```
Agent • 12:34:56 • working...
  Let me check the datasources...
  ● List Datasources (1.2s) ✓
  Now inspecting the schema...
  ● Inspect Schema (0.8s) ●
  ▊
```

## 优势

1. **实时显示**：工具调用一旦开始就立即显示在当前位置
2. **保留时序**：完整记录 Agent 的思考和行动顺序
3. **向后兼容**：没有 segments 的消息仍使用旧的渲染逻辑
4. **简单实现**：不需要解析文本或猜测工具调用位置

## 限制

- 依赖后端正确发送 `TOOL_CALL_START` 事件的时序
- 如果后端在文本之前发送工具调用事件，显示顺序可能不符合直觉
- 对于非 ReAct 模式的 Agent（一次性规划所有工具调用），可能不适用

## 测试

运行 TUI 应用并提问触发多个工具调用：

```bash
npm run build
cd apps/tui
npm start -- --demo
```

在输入框中输入：
```
Show me all tables and their schemas
```

观察是否按 ReAct 顺序显示文本和工具调用。
