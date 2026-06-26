# TUI ReAct 流式显示修复 - insertIndex 方案

## 问题回顾

### 原始问题
之前的实现中，工具调用仍然显示在消息底部，而不是穿插在文本中间。

**期望效果：**
```
Agent • 20:38:50
  Let me check the datasources...
  ● List Datasources (1.2s) ✓
  Now inspecting the schema...
  ● Inspect Schema (0.8s) ✓
  I found 5 tables.
```

**实际效果：**
```
Agent • 20:38:50
  I'll help you explore... First, let me list...
  Now let me inspect the schema...
  I've found that the "api-duckdb-demo" datasource...
  
  ✓ tool (5ms)
  ✓ tool (2ms)
```

### 根本原因分析

**问题 1：文本是累积的完整文本，不是增量**

在 `App.tsx` 中：
```typescript
let visibleText = '';  // 累积的完整文本

for await (const event of client.runAgent(runInput)) {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    rawText = mergeStreamText(rawText, delta);
    visibleText = stripInternalContextBlocks(rawText);
    store.updateAssistantMessage(visibleText, true);  // ← 全量更新
  }
  else {
    store.handleLiveRunEvent(event);  // ← 工具调用事件
  }
}
```

**问题 2：无法区分新旧文本**

之前的 `updateLastAssistantMessage` 实现：
```typescript
// 用完整 content 替换最后一个 text segment
segments[segments.length - 1] = {
  type: 'text',
  content,  // ← 这是完整文本！包含工具调用前后的所有内容
  timestamp: now,
};
```

当工具调用插入后：
- segments: `[{ type: 'text', content: 'A' }, { type: 'tool_call' }]`
- 下一次文本更新：content = 'A + B'（完整文本）
- 最后一个 segment 是 tool_call，所以创建新 text segment
- segments: `[{ type: 'text', content: 'A' }, { type: 'tool_call' }, { type: 'text', content: 'A + B' }]`
- **结果：文本 'A' 在两个地方都出现了！**

## 解决方案：insertIndex

### 核心思想

**记录工具调用在完整文本中的插入位置（insertIndex），然后用它来分割文本。**

### 数据结构

```typescript
export type MessageSegment =
  | { 
      type: 'text'; 
      content: string; 
      timestamp: number; 
      startIndex?: number;   // 在完整 content 中的起始位置
      endIndex?: number;     // 在完整 content 中的结束位置
    }
  | { 
      type: 'tool_call'; 
      toolCallId: string; 
      timestamp: number; 
      insertIndex: number;   // 在完整 content 中的插入位置
    };
```

### 工作流程

#### 1. 插入工具调用时记录位置

```typescript
export function insertToolCallIntoLastMessage(
  state: TuiSessionState,
  toolCallId: string,
): TuiSessionState {
  const lastMsg = state.messages[state.messages.length - 1];
  
  // 记录当前 content 长度作为插入点
  const insertIndex = lastMsg.content.length;
  
  segments.push({
    type: 'tool_call',
    toolCallId,
    timestamp: now,
    insertIndex,  // ← 关键：记录插入位置
  });
}
```

**示例：**
- 当前 content: `"Let me check the datasources..."`（31 个字符）
- 插入工具调用 → `insertIndex: 31`
- segments: `[..., { type: 'tool_call', toolCallId: 'list-123', insertIndex: 31 }]`

#### 2. 更新文本时按 insertIndex 分割

```typescript
export function updateLastAssistantMessage(
  state: TuiSessionState,
  content: string,  // ← 完整文本
  isStreaming = false,
): TuiSessionState {
  // 获取所有工具调用及其插入位置
  const toolCalls = segments
    .filter(s => s.type === 'tool_call')
    .sort((a, b) => a.insertIndex - b.insertIndex);
  
  const newSegments: MessageSegment[] = [];
  let lastIndex = 0;
  
  for (const toolCall of toolCalls) {
    // 添加工具调用前的文本
    if (toolCall.insertIndex > lastIndex) {
      newSegments.push({
        type: 'text',
        content: content.substring(lastIndex, toolCall.insertIndex),
        startIndex: lastIndex,
        endIndex: toolCall.insertIndex,
      });
    }
    
    // 添加工具调用
    newSegments.push(toolCall);
    lastIndex = toolCall.insertIndex;
  }
  
  // 添加最后一个工具调用后的文本
  if (lastIndex < content.length) {
    newSegments.push({
      type: 'text',
      content: content.substring(lastIndex),
      startIndex: lastIndex,
      endIndex: content.length,
    });
  }
}
```

**示例：**

第一次更新：
- content: `"Let me check the datasources..."`
- toolCalls: `[{ insertIndex: 31 }]`
- 结果：
  - segment[0]: `{ type: 'text', content: 'Let me check...', startIndex: 0, endIndex: 31 }`
  - segment[1]: `{ type: 'tool_call', insertIndex: 31 }`

第二次更新：
- content: `"Let me check the datasources...\n\nNow inspecting the schema..."`
- toolCalls: `[{ insertIndex: 31 }, { insertIndex: 61 }]`
- 结果：
  - segment[0]: `{ type: 'text', content: 'Let me check...', startIndex: 0, endIndex: 31 }`
  - segment[1]: `{ type: 'tool_call', insertIndex: 31 }`
  - segment[2]: `{ type: 'text', content: '\n\nNow inspecting...', startIndex: 31, endIndex: 61 }`
  - segment[3]: `{ type: 'tool_call', insertIndex: 61 }`

第三次更新：
- content: `"Let me check...\n\nNow inspecting...\n\nI found 5 tables."`
- toolCalls: `[{ insertIndex: 31 }, { insertIndex: 61 }]`
- 结果：
  - segment[0]: `{ type: 'text', content: 'Let me check...', startIndex: 0, endIndex: 31 }`
  - segment[1]: `{ type: 'tool_call', insertIndex: 31 }`
  - segment[2]: `{ type: 'text', content: '\n\nNow inspecting...', startIndex: 31, endIndex: 61 }`
  - segment[3]: `{ type: 'tool_call', insertIndex: 61 }`
  - segment[4]: `{ type: 'text', content: '\n\nI found 5 tables.', startIndex: 61, endIndex: 80 }`

### 渲染逻辑

`StreamingMessage.tsx` 保持不变，按 segments 顺序渲染：

```typescript
{message.segments.map((segment, index) => {
  if (segment.type === 'text') {
    return <MarkdownText content={segment.content} />;
  } else {
    const toolCall = allToolCalls.find(tc => tc.id === segment.toolCallId);
    return <InlineToolCall toolCall={toolCall} />;
  }
})}
```

## 测试验证

运行测试脚本：
```bash
npx tsx apps/tui/test-segments.ts
```

**测试结果：**
```
✅ All tests passed! ReAct streaming segments with insertIndex work correctly.

Final segment breakdown:
  [0] text: "Let me check the datasources......" (31 chars)
  [1] tool_call: tool-list-ds-123 @ index 31
  [2] text: "\n\nNow inspecting the schema......" (30 chars)
  [3] tool_call: tool-inspect-456 @ index 61
  [4] text: "\n\nI found 5 tables...." (19 chars)
```

## 优势

1. **精确分割**：基于插入位置精确分割文本，不会重复或丢失
2. **适配现有流程**：不需要修改 App.tsx 的事件处理逻辑
3. **简单可靠**：只需要记录一个数字（insertIndex）
4. **支持多次更新**：每次全量更新都能正确重建 segments

## 限制与注意事项

1. **依赖文本累积顺序**：假设文本是单调增长的（只追加，不修改前面的内容）
2. **insertIndex 不可变**：工具调用的 insertIndex 一旦记录就不会改变
3. **需要完整 content**：`updateLastAssistantMessage` 需要完整的累积文本

## 文件修改清单

1. ✅ `apps/tui/src/state/tui-state.ts` - 添加 insertIndex 到 MessageSegment
2. ✅ `apps/tui/src/state/message-history.ts` - 实现 insertIndex 逻辑
3. ✅ `apps/tui/test-segments.ts` - 更新测试脚本
4. ✅ 编译通过，测试通过

## 下一步

重新运行 TUI 应用，验证实际效果：

```bash
cd apps/tui
npm start
```

输入问题触发多个工具调用：
```
有哪些表格？
```

**预期效果：**
工具调用应该穿插在文本推理过程中，而不是都显示在底部。
