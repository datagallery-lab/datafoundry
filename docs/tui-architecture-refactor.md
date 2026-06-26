# TUI 消息架构重构设计

## 问题分析

### 当前架构的根本缺陷

```typescript
interface DisplayMessage {
  content: string;  // ← 累积的完整文本（主要数据）
  segments?: MessageSegment[];  // ← 辅助数据，需要从 content 反推
}
```

**问题：**
1. `content` 是累积的，segments 需要通过 insertIndex 来分割
2. 两份数据需要保持同步（content 和 segments）
3. 每次更新都要重建 segments
4. 复杂、容易出错

### 正确的架构

```typescript
interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  timestamp: number;
  isStreaming?: boolean;
  elements: MessageElement[];  // ← 唯一的数据源
}

type MessageElement =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_call'; toolCallId: string; timestamp: number }
  | { type: 'artifact'; artifactId: string; timestamp: number };  // 未来扩展
```

**优势：**
1. **事件流的直接表示**：每个事件产生一个 element
2. **单一数据源**：不需要同步 content 和 segments
3. **简单直观**：追加新元素即可，不需要分割文本
4. **易于扩展**：可以轻松添加新类型（图片、表格等）

## 重构方案

### 1. 数据结构

```typescript
// apps/tui/src/state/tui-state.ts

export type MessageElement =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_call'; toolCallId: string; timestamp: number };

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  timestamp: number;
  isStreaming?: boolean;
  elements: MessageElement[];  // 替代 content 和 segments
}
```

### 2. 消息处理

```typescript
// apps/tui/src/state/message-history.ts

// 追加文本增量
export function appendTextToMessage(
  state: TuiSessionState,
  textDelta: string,
): TuiSessionState {
  const lastMsg = getLastAssistantMessage(state);
  const elements = [...lastMsg.elements];
  
  // 追加到最后一个 text element，或创建新的
  if (elements.length > 0 && elements[elements.length - 1].type === 'text') {
    elements[elements.length - 1] = {
      ...elements[elements.length - 1],
      content: elements[elements.length - 1].content + textDelta,
    };
  } else {
    elements.push({
      type: 'text',
      content: textDelta,
      timestamp: Date.now(),
    });
  }
  
  return updateMessage(state, { ...lastMsg, elements, isStreaming: true });
}

// 插入工具调用
export function insertToolCallElement(
  state: TuiSessionState,
  toolCallId: string,
): TuiSessionState {
  const lastMsg = getLastAssistantMessage(state);
  
  // 直接追加 tool_call element
  const elements = [
    ...lastMsg.elements,
    {
      type: 'tool_call',
      toolCallId,
      timestamp: Date.now(),
    },
  ];
  
  return updateMessage(state, { ...lastMsg, elements });
}
```

### 3. 事件处理

```typescript
// apps/tui/src/ui/App.tsx

for await (const event of client.runAgent(runInput)) {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    const delta = event.delta;
    store.appendTextToMessage(delta);  // ← 增量追加
  }
  else if (event.type === 'TOOL_CALL_START') {
    store.insertToolCallElement(event.toolCallId);  // ← 直接插入
  }
  else {
    store.handleLiveRunEvent(event);
  }
}
```

### 4. 渲染组件

```typescript
// apps/tui/src/ui/StreamingMessage.tsx

export const StreamingMessage: React.FC<Props> = ({ message, allToolCalls }) => {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {message.elements.map((element, index) => {
        if (element.type === 'text') {
          return (
            <Box key={`element-${index}`}>
              <MarkdownText content={element.content} />
            </Box>
          );
        }
        else if (element.type === 'tool_call') {
          const toolCall = allToolCalls.find(tc => tc.id === element.toolCallId);
          return (
            <Box key={`element-${index}`} marginY={1}>
              <InlineToolCall toolCall={toolCall} showName={true} />
            </Box>
          );
        }
      })}
      
      {message.isStreaming && <Text dimColor> ▊</Text>}
    </Box>
  );
};
```

## 实现步骤

1. ✅ 修改 `tui-state.ts` - 定义新的 MessageElement 类型
2. ✅ 修改 `message-history.ts` - 实现基于 elements 的消息处理
3. ✅ 修改 `App.tsx` - 改用增量文本追加
4. ✅ 修改 `StreamingMessage.tsx` - 按 elements 渲染
5. ✅ 移除旧的 content 和 segments 字段
6. ✅ 更新测试

## 优势对比

### 旧架构（insertIndex 方案）
```typescript
// 文本更新：需要重建所有 segments
updateMessage(fullContent) {
  const toolCalls = segments.filter(s => s.type === 'tool_call');
  const newSegments = [];
  for (const tc of toolCalls) {
    newSegments.push(text before tc);
    newSegments.push(tc);
  }
  newSegments.push(remaining text);
}
```

### 新架构（elements 方案）
```typescript
// 文本更新：直接追加到最后一个 text element
appendText(delta) {
  elements[elements.length - 1].content += delta;
}

// 工具调用：直接追加新 element
insertToolCall(id) {
  elements.push({ type: 'tool_call', toolCallId: id });
}
```

**简单 10 倍！**
