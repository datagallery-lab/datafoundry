# TUI ReAct 流式显示功能实现总结

## ✅ 已完成

### 1. 数据结构扩展

**文件：`apps/tui/src/state/tui-state.ts`**

添加了 `MessageSegment` 类型和 `DisplayMessage.segments` 字段：

```typescript
export type MessageSegment =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_call'; toolCallId: string; timestamp: number };

export interface DisplayMessage {
  // ... 现有字段
  segments?: MessageSegment[] | undefined;  // 新增
}
```

### 2. 消息处理逻辑更新

**文件：`apps/tui/src/state/message-history.ts`**

- ✅ `appendToLastAssistantMessage` - 支持增量文本更新到 segments
- ✅ `updateLastAssistantMessage` - 支持全量文本更新到 segments
- ✅ `insertToolCallIntoLastMessage` - 新增函数，插入工具调用引用

### 3. 事件处理集成

**文件：`apps/tui/src/state/store.ts`**

在 `handleLiveRunEvent` 中：
- ✅ 导入 `insertToolCallIntoLastMessage` 函数
- ✅ 检测 `TOOL_CALL_START` 事件并插入工具调用 segment

```typescript
if (event.type === "TOOL_CALL_START") {
  const toolCallId = typeof event.toolCallId === 'string'
    ? event.toolCallId
    : `tool-${Date.now()}`;
  
  const stateWithToolCall = insertToolCallIntoLastMessage(this.state, toolCallId);
  // ... 合并状态
}
```

### 4. 渲染组件更新

**文件：`apps/tui/src/ui/StreamingMessage.tsx`**

- ✅ 支持按 segments 顺序渲染（ReAct 风格）
- ✅ 保留向后兼容的渲染逻辑（没有 segments 时）
- ✅ 正确显示流式光标位置

```typescript
if (message.segments && message.segments.length > 0) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {message.segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <MarkdownText content={segment.content} />;
        } else {
          const toolCall = allToolCalls.find(tc => tc.id === segment.toolCallId);
          return <InlineToolCall toolCall={toolCall} />;
        }
      })}
    </Box>
  );
}
```

### 5. 测试验证

**文件：`apps/tui/test-segments.ts`**

- ✅ 创建了完整的单元测试
- ✅ 测试通过，验证了所有功能正常工作

**测试结果：**
```
✅ All tests passed! ReAct streaming segments work correctly.
```

## 📊 工作原理

### 事件流示例

```
1. TEXT_MESSAGE_CHUNK: "Let me check..."
   → segments: [{ type: 'text', content: 'Let me check...' }]

2. TOOL_CALL_START: toolCallId='list-123'
   → segments: [{ type: 'text', ... }, { type: 'tool_call', toolCallId: 'list-123' }]

3. TEXT_MESSAGE_CHUNK: "Now inspecting..."
   → segments: [..., { type: 'tool_call', ... }, { type: 'text', content: 'Now inspecting...' }]

4. TOOL_CALL_START: toolCallId='inspect-456'
   → segments: [..., { type: 'text', ... }, { type: 'tool_call', toolCallId: 'inspect-456' }]
```

### 渲染结果

```
Agent • 12:34:56 • working...
  Let me check the datasources...
  ● List Datasources (1.2s) ✓
  Now inspecting the schema...
  ● Inspect Schema (0.8s) ●
  Found 5 tables.
  ▊
```

## 🎯 关键特性

1. **实时交替显示**：文本和工具调用按接收顺序立即显示
2. **保留时序信息**：每个 segment 都有 timestamp
3. **向后兼容**：没有 segments 的旧消息仍然正常显示
4. **类型安全**：完整的 TypeScript 类型定义
5. **测试覆盖**：单元测试验证核心功能

## 📝 文件修改清单

1. `apps/tui/src/state/tui-state.ts` - 添加 MessageSegment 类型
2. `apps/tui/src/state/message-history.ts` - 更新消息处理函数
3. `apps/tui/src/state/store.ts` - 集成工具调用事件处理
4. `apps/tui/src/ui/StreamingMessage.tsx` - 更新渲染逻辑
5. `apps/tui/test-segments.ts` - 新增测试脚本
6. `docs/tui-react-streaming-implementation.md` - 详细实现文档

## 🚀 如何测试

### 编译项目
```bash
npm run build
```

### 运行单元测试
```bash
npx tsx apps/tui/test-segments.ts
```

### 启动 TUI（Demo 模式）
```bash
cd apps/tui
npm start -- --demo
```

### 启动 TUI（连接后端）
```bash
cd apps/tui
npm start -- --runtime-url http://localhost:8787/api/copilotkit
```

### 测试查询
在 TUI 中输入以下问题来触发多个工具调用：
```
Show me all tables and their schemas
```

观察是否按 ReAct 顺序显示文本和工具调用。

## 🔧 后续优化建议

1. **性能优化**：如果 segments 过多，考虑虚拟滚动
2. **动画效果**：工具调用出现时可以添加淡入动画
3. **配置选项**：允许用户切换显示模式（交替 vs 底部汇总）
4. **错误处理**：如果 toolCallId 找不到对应的 toolCall，显示占位符
5. **持久化**：考虑在消息历史持久化时保存 segments

## 📚 相关文档

- [详细实现文档](./tui-react-streaming-implementation.md)
- [TUI 实现计划](../docs/planning/tui-implementation-plan.md)

## 💡 设计决策

### 为什么使用 segments 而不是解析文本？

**优势：**
- ✅ 简单可靠：不需要复杂的文本解析
- ✅ 精确时序：记录事件实际发生顺序
- ✅ 可扩展：未来可以添加其他类型的 segment（图片、表格等）

**劣势：**
- ❌ 依赖后端事件顺序：如果后端发送顺序不对，显示会有问题
- ❌ 增加状态复杂度：需要同时维护 content 和 segments

### 为什么保留 content 字段？

1. **向后兼容**：旧代码可能依赖 content 字段
2. **搜索功能**：可以直接搜索完整内容而不需要合并 segments
3. **降级渲染**：如果 segments 损坏，仍可显示完整文本

## ✅ 验收标准

- [x] 文本增量更新正确记录到 segments
- [x] 工具调用在正确位置插入 segments
- [x] 按 segments 顺序正确渲染
- [x] 向后兼容没有 segments 的消息
- [x] TypeScript 编译无错误
- [x] 单元测试全部通过
- [x] 流式光标显示在正确位置

## 🎉 结论

TUI ReAct 流式显示功能已完整实现并通过测试。现在可以正确展示 Agent 的推理和行动交替过程，提供更好的用户体验。
