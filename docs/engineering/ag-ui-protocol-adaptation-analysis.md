# AG-UI 协议适配与事件体系重构分析

日期：2026-06-18
状态：Historical Review；决策已落地，当前协议以 `copilotkit-ag-ui-frontend-protocol.md` 为准

> 本文保留协议重构背景，不再作为当前实现清单。当前实现已统一到 `/api/copilotkit` 和 AG-UI BaseEvent。

## 1. 决策结论

**前端交互协议统一使用 AG-UI；后端保留审计/领域事件持久化，但事件来源从 AG-UI 流捕获。**

```
前端交互层：
  → 唯一协议是 AG-UI（ACTIVITY_SNAPSHOT / CUSTOM / STATE_SNAPSHOT 等）
  → 不自建前端 SSE 事件协议（plan.update / step.start 等自定义 payload 全部废弃）

后端持久化层：
  → 审计/领域事件仍然存在（SQL audit、run_events、artifact trace）
  → 但事件来源改为从 AG-UI 事件流捕获写入，而非 RunEventEmitter 手动写入
  → tool wrapper 仍需要一个通道报告 plan/step/artifact/citation
  → 这个通道产出的事件最终变为 AG-UI ACTIVITY_* / CUSTOM，不是自定义 SSE payload

实现方式：
  → 自定义 AG-UI Agent wrapper（DataAgentAgUiAgent extends AbstractAgent）
  → 内部委托 @ag-ui/mastra MastraAgent.run(input)
  → 同时 merge 一个自定义 activity/custom event stream
  → 全部 AG-UI event 统一落 run_events
```

## 2. 评审确认的结论

以下结论经评审后确认正确：

| 结论 | 说明 |
|---|---|
| 对齐 AG-UI 作为唯一前端交互协议 | 当前对外入口已是 `/api/copilotkit`，前端协议必须是 AG-UI，不能继续维护自定义 SSE |
| threadId → session_id | 当前 `server.ts` 还是自己生成 `sessionId/runId`，没有用 `RunAgentInput.threadId/runId`，影响 session resume |
| context / forwardedProps / state 应接入 | 当前只读 HTTP header `X-Session-ID` / `X-Datasource-ID`，不够 AG-UI 原生 |
| MastraAgent 不自动发 ACTIVITY_SNAPSHOT / CUSTOM | 本地源码确认：`MastraAgent` 自动发的是 `RUN_STARTED` / `RUN_FINISHED` / `TEXT_MESSAGE_*` / `TOOL_CALL_*` / `TOOL_CALL_RESULT` / `REASONING_*` / `STATE_SNAPSHOT`；`CUSTOM` 只在 interrupt 场景用了 `on_interrupt` |

## 3. 评审修正的结论

以下结论经评审后需要调整：

| 原结论 | 修正 |
|---|---|
| "不自建事件系统" | → **不自建前端交互协议事件系统；后端仍保留审计/领域事件持久化**。SQL audit、run_events、artifact trace 是后端安全和复盘边界，不能因为 AG-UI 就不要了。只是事件来源应从 AG-UI 流或 tool activity sink 捕获，而非 RunEventEmitter 手动写入 |
| "CopilotRuntime 事件拦截器推荐（方案 A）" | → **推荐方案改为 C：双 Observable 合流**。本地 `@copilotkit/runtime` 有 `beforeRequestMiddleware` / `afterRequestMiddleware`，但没看到清晰的"事件流 transform/insert hook"。更稳的方向是自己实现 AG-UI `AbstractAgent` wrapper，内部委托 `MastraAgent.run()`，同时 merge 自定义事件流 |
| "删除 RunEventEmitter" | → **不能马上删除，应重命名/替换为更准确的抽象**。当前 tool wrapper 还需要一个通道报告 plan/step/artifact/citation，只是这些事件最终应变成 AG-UI ACTIVITY_* / CUSTOM，而非自定义 SSE payload。建议命名为 `AgUiActivitySink` / `RunAuditSink` / `ToolActivityEmitter` |
| "ReasoningMessage 可见推理引导" | → **REASONING_* 要谨慎**。不能引导模型输出 hidden chain-of-thought，只能消费 provider/agent 明确提供的 visible reasoning summary，不能把内部 thought 当产品事件记录 |
| "MESSAGES_SNAPSHOT 放 P1" | → **降为 P2/P3**。先把 raw AG-UI event 落库做稳，再谈从历史事件恢复 messages。否则 resume 会建在不稳定的数据结构上 |

## 4. 当前问题诊断

### 4.1 两套事件体系完全割裂

当前代码同时维护两套事件系统，互不通信：

| 体系 | 产出方 | 消费方 | 是否到达前端 |
|---|---|---|---|
| AG-UI 事件流 | `MastraAgent.run()` 自动映射 | CopilotKit 前端 | ✅ 到达 |
| 自建 RunEventEmitter | `server.ts` + `agent-runtime` tool wrapper 手动调用 | SQLite `run_events` 表 | ❌ 不到达 |

当前 `RunEventEmitter.create()` 写入 SQLite 的事件：

```ts
emitter.create("plan.update", { tasks: [...] });
emitter.create("step.start", { step_id, title, kind, tool_name });
emitter.create("step.meta", { step_id, status, datasource_id, sql });
emitter.create("step.output", { step_id, output_type, content });
emitter.create("step.done", { step_id, status, artifact_ids });
```

这些事件只写入数据库，前端**看不到**。前端只能看到 `MastraAgent` 自动发出的标准 AG-UI 事件。

### 4.2 设计方案 SSE 事件协议与 AG-UI 不对齐

最终设计文档定义了 11 种 SSE 事件（plan.update / step.start / step.meta / step.output / step.chunk / step.done / final / done / error / cancel + Citation），其中大部分在 AG-UI 协议中没有直接对应物。

### 4.3 RunAgentInput 的 context / forwardedProps / state 未使用

AG-UI 协议定义的 `RunAgentInput` 包含前端可传的关键字段：

```ts
RunAgentInput {
  threadId: string;        // conversation thread — 应映射到 session_id
  runId: string;           // run 标识
  parentRunId?: string;    // 子 run（如 agent handoff）
  state?: any;             // 双向共享状态
  messages: Message[];     // 前端对话历史
  tools: Tool[];           // 前端定义的工具（可选）
  context: Context[];      // 上下文数据 [{ description, value }]
  forwardedProps?: any;    // 前端透传属性
}
```

当前 `server.ts` 只从 HTTP header 读取 `X-Session-ID` 和 `X-Datasource-ID`，没有从 `RunAgentInput` 的 `context` 和 `forwardedProps` 中提取信息。

### 4.4 threadId 与 session_id 未映射

CopilotKit 前端自动生成 `threadId` 管理对话 thread。当前后端自己生成 `session_id`（从 header 或 `randomUUID()`），与前端的 thread 完全脱节。session resume 时无法匹配历史。

### 4.5 状态同步完全缺失

AG-UI 协议支持双向状态同步（STATE_SNAPSHOT / STATE_DELTA / MESSAGES_SNAPSHOT），当前实现完全没有使用。前端无法获知后端的 session 状态（selected datasource、collection 等）。

## 5. AG-UI 协议全景

### 5.1 AG-UI 事件类型完整列表

AG-UI 协议定义 25 种事件类型（排除 deprecated 别名）：

**生命周期事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `RUN_STARTED` | `threadId`, `runId`, `parentRunId?`, `input?` | Run 开始边界，协议要求**必须发出** |
| `RUN_FINISHED` | `outcome?` (`success` / `interrupt`), `result?` | Run 结束边界，协议要求**必须发出** |
| `RUN_ERROR` | `message`, `code?` | Run 错误边界 |
| `STEP_STARTED` | `stepName` | Step 开始（可选） |
| `STEP_FINISHED` | `stepName` | Step 结束（可选） |

**文本消息事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `TEXT_MESSAGE_START` | `messageId`, `role` | 文本消息开始 |
| `TEXT_MESSAGE_CONTENT` | `messageId`, `delta` | 流式文本增量（delta 必须非空） |
| `TEXT_MESSAGE_END` | `messageId` | 文本消息结束 |
| `TEXT_MESSAGE_CHUNK` | `messageId?`, `role?`, `delta?` | 便捷事件，自动展开为 Start→Content→End |

**工具调用事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `TOOL_CALL_START` | `toolCallId`, `toolCallName`, `parentMessageId?` | 工具调用开始 |
| `TOOL_CALL_ARGS` | `toolCallId`, `delta` | 流式参数增量 |
| `TOOL_CALL_END` | `toolCallId` | 工具调用结束 |
| `TOOL_CALL_CHUNK` | `toolCallId?`, `toolCallName?`, `parentMessageId?`, `delta?` | 便捷事件 |
| `TOOL_CALL_RESULT` | `messageId`, `toolCallId`, `content`, `role?` | 工具执行结果 |

**状态管理事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `STATE_SNAPSHOT` | `snapshot` (any) | 完整状态替换，前端应整体替换而非合并 |
| `STATE_DELTA` | `delta` (RFC 6902 JSON Patch array) | 增量状态更新 |
| `MESSAGES_SNAPSHOT` | `messages` (Message[]) | 完整消息历史 |

**Activity 事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `ACTIVITY_SNAPSHOT` | `messageId`, `activityType`, `content`, `replace?` | 活动/进度完整快照 |
| `ACTIVITY_DELTA` | `messageId`, `activityType`, `patch` (JSON Patch) | 活动/进度增量更新 |

**Reasoning 事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `REASONING_START` | `messageId` | 推理开始 |
| `REASONING_MESSAGE_START` | `messageId`, `role` | 推理消息开始 |
| `REASONING_MESSAGE_CONTENT` | `messageId`, `delta` | 推理文本增量 |
| `REASONING_MESSAGE_END` | `messageId` | 推理消息结束 |
| `REASONING_MESSAGE_CHUNK` | `messageId`, `delta` | 便捷推理事件 |
| `REASONING_END` | `messageId` | 推理结束 |
| `REASONING_ENCRYPTED_VALUE` | `subtype`, `entityId`, `encryptedValue` | 加密推理值 |

**特殊事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `RAW` | `event`, `source?` | 原始事件透传 |
| `CUSTOM` | `name`, `value` | 自定义事件 — 承载方案中 artifact / citation 等非标准数据 |

**Draft 事件：**

| 事件 | 字段 | 说明 |
|---|---|---|
| `META_EVENT` | `metaType`, `payload` | 应用定义的元事件 |

### 5.2 Message 角色

AG-UI 协议支持 7 种消息角色：

```ts
role: "developer" | "system" | "assistant" | "user" | "tool" | "activity" | "reasoning"
```

关键新增角色：
- **`activity`** — 承载进度/计划/步骤等非对话型信息。`ActivityMessage = { id, role: "activity", activityType, content }`
- **`reasoning`** — 承载可见推理过程。`ReasoningMessage = { id, role: "reasoning", content }`

⚠️ **对 reasoning 角色的安全约束**：只能消费 provider/agent 明确提供的 visible reasoning summary，不能引导模型输出 hidden chain-of-thought，不能把内部 thought 当产品事件记录到 `run_events`。

### 5.3 RunAgentInput 结构

前端 CopilotKit 向后端发送的完整请求结构：

```ts
RunAgentInput {
  threadId: string;          // CopilotKit 自动管理的 conversation thread ID
  runId: string;             // 本次 run ID
  parentRunId?: string;      // 子 run（如 agent handoff）
  state?: any;               // 双向共享状态 — 前端可写入，后端可更新
  messages: Message[];       // 完整对话历史（含 user/assistant/tool/activity/reasoning）
  tools: Tool[];             // 前端定义的工具（CopilotKit 组件级工具）
  context: Context[];        // 上下文数据 [{ description, value }]
  forwardedProps?: any;      // 前端透传属性 — 可携带 datasource_id、collection_id 等
}
```

### 5.4 CopilotKit 前端协议

前端使用 `<CopilotKit runtimeUrl="..." agent="dataAgent">` 消费 AG-UI 事件流：

- CopilotKit 自动将 `threadId`、`messages`、`state` 等打包为 `RunAgentInput`
- 前端组件（`CopilotChat` 等）订阅 AG-UI 事件流并渲染
- `ActivityMessage` 可通过自定义渲染器展示进度/计划
- `STATE_SNAPSHOT` / `STATE_DELTA` 触发前端 React 状态更新
- `CUSTOM` 事件可通过 CopilotKit 的自定义 handler 处理

## 6. @ag-ui/mastra 自动映射行为

`MastraAgent.run()` 返回 `Observable<BaseEvent>`。其 `processFullStream` 方法自动将 Mastra Agent 的流式输出映射到 AG-UI 事件：

| Mastra 流式 chunk 类型 | → 自动映射的 AG-UI 事件序列 |
|---|---|
| text part | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT`(多次 delta) → `TEXT_MESSAGE_END` |
| tool-call part | `TOOL_CALL_START` → `TOOL_CALL_ARGS`(多次 JSON fragment delta) → `TOOL_CALL_END` |
| tool-result part | `TOOL_CALL_RESULT` |
| reasoning part | `REASONING_START` → `REASONING_MESSAGE_START` → `REASONING_MESSAGE_CONTENT`(多次) → `REASONING_MESSAGE_END` → `REASONING_END` |
| error chunk | `RUN_ERROR` |
| finish | `RUN_FINISHED` |
| start | `RUN_STARTED` |

**关键：`MastraAgent` 不自动发出 `ACTIVITY_SNAPSHOT`、`CUSTOM`、`STATE_*`（除 working memory）、`MESSAGES_SNAPSHOT`、`STEP_*` 事件。** 这些需要后端主动注入到 AG-UI 事件流中。

本地源码确认：
- `CUSTOM` 事件只在 interrupt 场景通过 `on_interrupt` 使用
- `STATE_SNAPSHOT` 只在配置了 working memory 时通过 `emitWorkingMemorySnapshot` 自动发出
- `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` / `MESSAGES_SNAPSHOT` / `STEP_*` 完全不会自动发出

## 7. 重构方向：设计方案 SSE 事件 → AG-UI 映射

### 7.1 映射表

设计方案定义的 11 种 SSE 事件应映射到以下 AG-UI 事件：

| 设计方案 SSE 事件 | → AG-UI 映射 | 映射理由 |
|---|---|---|
| `plan.update` | `ACTIVITY_SNAPSHOT` | `{ activityType: "PLAN", content: { tasks: [...] } }` — ActivityMessage 的天然用途 |
| `step.start` | `ACTIVITY_SNAPSHOT` | `{ activityType: "STEP_START", content: { step_id, title, kind, tool_name } }` |
| `step.meta` | `ACTIVITY_DELTA` | `{ activityType: "STEP_META", patch: [{ op: "add", path: "/status", value: "running" }] }` — 增量更新 |
| `step.output` | `ACTIVITY_SNAPSHOT` 或 `TOOL_CALL_RESULT` | tool 输出如果是标准结果则由 `TOOL_CALL_RESULT` 自动覆盖；自定义输出（如 schema summary）用 `ACTIVITY_SNAPSHOT` |
| `step.chunk` | `TEXT_MESSAGE_CONTENT` | 流式文本增量 — 已由 MastraAgent 自动处理 |
| `step.done` | `ACTIVITY_SNAPSHOT` 或 `ACTIVITY_DELTA` | `{ activityType: "STEP_DONE", content: { step_id, status, artifact_ids } }` |
| `final` | 自动 | MastraAgent 的 `TEXT_MESSAGE_END` + 后续 `RUN_FINISHED` 即是 final 的表达 |
| `done` | `RUN_FINISHED` | 已由 MastraAgent 自动发出 |
| `error` | `RUN_ERROR` | 已由 MastraAgent 在出错时自动发出 |
| `cancel` | `RUN_FINISHED(outcome: interrupt)` | AG-UI 定义了 interrupt outcome 用于暂停/取消 |
| `Citation` | `CUSTOM` | `{ name: "citation", value: { document_id, chunk_id, filename, quote, ... } }` |

### 7.2 自定义数据承载策略

对于 AG-UI 标准事件无法覆盖的数据，采用以下承载策略：

**进度 / 计划 / 步骤状态 → `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`**

```ts
// 代理执行计划时发 ACTIVITY_SNAPSHOT
{
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: "plan-msg-1",
  activityType: "PLAN",
  content: {
    tasks: [
      { id: "schema", title: "检查数据源 schema", status: "pending" },
      { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
      { id: "final", title: "生成最终回答", status: "pending" }
    ]
  },
  replace: true
}

// 步骤状态更新时发 ACTIVITY_DELTA（JSON Patch）
{
  type: EventType.ACTIVITY_DELTA,
  messageId: "plan-msg-1",
  activityType: "PLAN",
  patch: [
    { op: "replace", path: "/tasks/0/status", value: "running" }
  ]
}
```

**Artifact / Citation → `CUSTOM` 事件**

```ts
// artifact 创建通知
{
  type: EventType.CUSTOM,
  name: "artifact",
  value: {
    id: "art_123",
    type: "table",
    name: "SQL result",
    preview_json: { columns, rows, row_count }
  }
}

// 知识检索引用通知
{
  type: EventType.CUSTOM,
  name: "citation",
  value: {
    document_id: "doc_1",
    chunk_id: "chunk_3",
    filename: "metrics.pdf",
    quote: "GMV 定义为...",
    page_number: 5,
    score: 0.87
  }
}
```

**Session 状态 → `STATE_SNAPSHOT` / `STATE_DELTA`**

```ts
// 推送当前 session 状态给前端
{
  type: EventType.STATE_SNAPSHOT,
  snapshot: {
    selectedDatasourceId: "api-duckdb-demo",
    selectedCollectionId: "col_metrics",
    runStatus: "running",
    artifactIds: ["art_123"]
  }
}

// 增量更新
{
  type: EventType.STATE_DELTA,
  delta: [
    { op: "replace", path: "/runStatus", value: "completed" },
    { op: "add", path: "/artifactIds/-", value: "art_456" }
  ]
}
```

**Session 恢复 → `MESSAGES_SNAPSHOT`（后续项）**

```ts
// 前端恢复历史 session 时，发完整消息历史
// ⚠️ 这是 P2/P3 后续项，需要先把 raw AG-UI event 落库做稳再实现
{
  type: EventType.MESSAGES_SNAPSHOT,
  messages: [/* 从 run_events + AG-UI replay 重建的完整历史 */]
}
```

## 8. 重构后的架构

### 8.1 事件流架构

```
前端 CopilotKit
  → POST /api/copilotkit (RunAgentInput)
  → CopilotRuntime
  → DataAgentAgUiAgent.run(input)      ← 自定义 AbstractAgent wrapper
      → 内部委托 MastraAgent.run(input) ← 标准 AG-UI 事件流（TEXT_MESSAGE_* / TOOL_CALL_* / REASONING_* / RUN_*）
      → 同时 merge ToolActivityEmitter 的自定义事件流
          → ACTIVITY_SNAPSHOT(activityType: "PLAN" / "STEP_START" / "STEP_DONE")
          → ACTIVITY_DELTA(activityType: "PLAN" / "STEP_META")
          → CUSTOM(name: "artifact" / "citation")
          → STATE_SNAPSHOT(session 状态)
      → RxJS merge() 合流后返回统一 Observable<BaseEvent>
  → CopilotRuntime 消费合流后的事件流 → SSE 推送到前端

合流后的事件流同时被 RunAuditSink 拦截：
  → 每个 AG-UI event → 写入 SQLite run_events（审计日志）
  → SQL audit → 写入 sql_audit_logs（安全审计）
  → artifact trace → 写入 artifacts（产物追踪）
```

### 8.2 数据流架构

```
用户问题
  → CopilotKit 前端打包 RunAgentInput (threadId + messages + context + forwardedProps)
  → POST /api/copilotkit
  → 后端从 RunAgentInput 提取：
     - threadId → 映射到 session_id（替代后端自己生成）
     - runId → 映射到 run_id（替代后端自己生成）
     - context / forwardedProps → 提取 datasource_id、collection_id 等（替代 HTTP header）
     - messages → 传递给 Mastra Agent 作为对话历史
  → 创建 run record
  → DataAgentAgUiAgent.run() 启动
      → MastraAgent.run() 启动 Mastra Agent ReAct 循环
      → ToolActivityEmitter 启动自定义事件流
  → Mastra Agent ReAct 循环：
     - 调用 inspect_schema tool → TOOL_CALL_* 事件自动发出
     - 调用 run_sql_readonly tool → TOOL_CALL_* + TOOL_CALL_RESULT 事件自动发出
     - 生成文本回答 → TEXT_MESSAGE_* 事件自动发出
     - visible reasoning summary → REASONING_* 事件自动发出（如有 reasoning part）
  → ToolActivityEmitter 在关键节点注入自定义事件：
     - inspect_schema 开始 → ACTIVITY_SNAPSHOT(activityType: "STEP_START", ...)
     - inspect_schema 完成 → ACTIVITY_DELTA(activityType: "PLAN", patch: [...])
     - artifact 创建 → CUSTOM(name: "artifact", ...)
     - citation 出现 → CUSTOM(name: "citation", ...)
  → RunAuditSink：
     - 每个 AG-UI event → 写入 SQLite run_events
     - SQL audit → sql_audit_logs
     - artifact → artifacts 表
  → RUN_FINISHED → 更新 run 状态
```

### 8.3 DataAgentAgUiAgent — 自定义 AG-UI Agent Wrapper

这是重构的核心组件，替代当前 `server.ts` 中直接使用 `MastraAgent` 的方式：

```ts
// 方向设计（不写代码）
class DataAgentAgUiAgent extends AbstractAgent {
  // 配置：包含 MastraAgent + ToolActivityEmitter + RunAuditSink

  run(input: RunAgentInput): Observable<BaseEvent> {
    // 1. 从 RunAgentInput 提取上下文
    const { threadId, runId, context, forwardedProps, state } = input;

    // 2. 创建/恢复 session、run
    const sessionId = threadId;  // 替代 randomUUID()
    const datasourceId = resolveDatasourceId(context, forwardedProps, state);
    // ...

    // 3. 委托 MastraAgent.run(input)
    const mastraStream = this.mastraAgent.run(input);

    // 4. 创建自定义事件流
    const activityStream = this.toolActivityEmitter.observable();

    // 5. 合流
    const merged = merge(mastraStream, activityStream);

    // 6. 审计拦截
    merged.subscribe(event => this.runAuditSink.capture(event));

    // 7. 返回合流后的 Observable
    return merged;
  }
}
```

**为什么选 AbstractAgent wrapper + RxJS merge 而不选 CopilotRuntime interceptor：**

- 本地 `@copilotkit/runtime` 源码只有 `beforeRequestMiddleware` / `afterRequestMiddleware`，没有事件流 transform/insert hook
- `CopilotRuntime` 的 agents 字典期望 `AbstractAgent` 实例，自定义 wrapper 可以直接注册
- RxJS `merge()` 是 AG-UI SDK 的标准组合方式，`@ag-ui/client` 已大量使用 Observable
- 这种方式不依赖 CopilotKit 内部 API，只依赖 AG-UI 公共协议，更稳定

### 8.4 ToolActivityEmitter — 替代 RunEventEmitter

当前 `RunEventEmitter` 的接口：

```ts
interface RunEventEmitter {
  create<TPayload>(type: string, payload: TPayload): RunEventEnvelope;
}
```

重构后改为 `ToolActivityEmitter`（或 `AgUiActivitySink` / `RunAuditSink`）：

```ts
// 方向设计（不写代码）
// ToolActivityEmitter 负责：
// 1. 在 tool wrapper 关键节点发出 AG-UI 自定义事件
// 2. 同时写入后端审计日志（SQL audit、artifact trace 等）
// 3. 提供 Observable 供 DataAgentAgUiAgent 合流

interface ToolActivityEmitter {
  // 发出 ACTIVITY_SNAPSHOT 事件（plan/step 等）
  emitActivitySnapshot(activityType: string, content: Record<string, any>): void;

  // 发出 ACTIVITY_DELTA 事件（增量更新）
  emitActivityDelta(activityType: string, patch: JsonPatch[]): void;

  // 发出 CUSTOM 事件（artifact/citation 等）
  emitCustomEvent(name: string, value: unknown): void;

  // 写入 SQL audit log（独立于 AG-UI 事件流）
  writeSqlAuditLog(input: CreateSqlAuditLogInput): SqlAuditLogRecord;

  // 写入 artifact record（独立于 AG-UI 事件流）
  writeArtifact(input: CreateArtifactInput): ArtifactRecord;

  // 供 DataAgentAgUiAgent 合流用
  observable(): Observable<BaseEvent>;
}
```

**与当前 RunEventEmitter 的区别：**

| 维度 | RunEventEmitter | ToolActivityEmitter |
|---|---|---|
| 事件格式 | 自定义 SSE payload | AG-UI 标准事件（ACTIVITY_SNAPSHOT / CUSTOM 等） |
| 事件消费方 | 只写入 SQLite | 写入 SQLite + 同时进入 AG-UI 事件流（前端可见） |
| 是否删除 | ❌ 不删除，重命名/替换 | — |
| 审计职责 | 混在一起 | SQL audit / artifact trace 独立保留 |

### 8.5 RunAuditSink — 事件流审计拦截

从 AG-UI 事件流捕获写入 SQLite `run_events`：

```ts
// 方向设计（不写代码）
// RunAuditSink 在 DataAgentAgUiAgent.run() 中订阅合流后的 Observable
// 每个 AG-UI event 写入 run_events 表

class RunAuditSink {
  constructor(private readonly repository: RunEventRepository) {}

  capture(event: BaseEvent, context: { user_id, run_id, session_id }): void {
    this.repository.append({
      user_id: context.user_id,
      run_id: context.run_id,
      session_id: context.session_id,
      event_type: event.type,  // AG-UI EventType 枚举值
      payload_json: JSON.stringify(extractPayload(event))
    });
  }
}
```

**run_events 表结构调整：**

| 字段 | 当前 | 重构后 | 说明 |
|---|---|---|---|
| `event_type` | 自定义字符串（plan.update, step.start 等） | AG-UI EventType 枚举值 | 对齐 AG-UI 协议 |
| `payload_json` | 自定义 payload 结构 | AG-UI 事件原生 payload | 保持协议格式 |
| 其余字段 | 不变 | 不变 | seq、user_id、run_id、session_id 不变 |

### 8.6 SQLite 审计体系完整保留

以下后端审计/领域持久化**不删除**，只是事件来源从 RunEventEmitter 手动写入改为 RunAuditSink 从 AG-UI 流捕获 + ToolActivityEmitter 独立写入：

| 持久化 | 保留 | 事件来源 |
|---|---|---|
| `run_events` 表 | ✅ 保留 | RunAuditSink 从 AG-UI 流捕获写入 |
| `sql_audit_logs` 表 | ✅ 保留 | ToolActivityEmitter.writeSqlAuditLog() 独立写入（Data Gateway 仍然负责） |
| `artifacts` 表 | ✅ 保留 | ToolActivityEmitter.writeArtifact() 独立写入 |
| `runs` 表 | ✅ 保留 | DataAgentAgUiAgent 在 RUN_STARTED / RUN_FINISHED 时更新 |
| `sessions` 表 | ✅ 保留 | DataAgentAgUiAgent 根据 threadId 创建/恢复 |
| `data_sources` 表 | ✅ 保留 | Data Gateway 仍然负责 |
| `users` 表 | ✅ 保留 | 不变 |

## 9. RunAgentInput 上下文提取

### 9.1 当前上下文提取方式

```ts
// 当前 — 从 HTTP header 读取
const sessionId = getHeaderValue(request.headers["x-session-id"]) ?? randomUUID();
const selectedDatasourceId = getHeaderValue(request.headers["x-datasource-id"]) ?? "api-duckdb-demo";
```

### 9.2 重构后的上下文提取

```ts
// 重构后 — 从 AG-UI RunAgentInput 中提取
// CopilotKit 前端会将上下文信息打包到 context 和 forwardedProps 中

// 方案 1：通过 context 数组
// 前端代码：
// <CopilotKit context={[{ description: "datasource_id", value: "api-duckdb-demo" }]} />
// 后端提取：
const datasourceId = input.context.find(c => c.description === "datasource_id")?.value;

// 方案 2：通过 forwardedProps
// 前端代码：
// <CopilotKit forwardedProps={{ datasourceId: "api-duckdb-demo", collectionId: "col_1" }} />
// 后端提取：
const datasourceId = input.forwardedProps?.datasourceId;
const collectionId = input.forwardedProps?.collectionId;

// 方案 3：通过 state
// 前端写入 state.datasourceId，后端从 input.state.datasourceId 读取
```

### 9.3 threadId → session_id 映射

```ts
// 重构后
// 前端 CopilotKit 自动管理 threadId
// 后端应将 threadId 映射为 session_id，不再自己生成

const sessionId = input.threadId;  // 直接使用前端 threadId
// 如果 threadId 对应的 session 不存在，创建新 session
// 如果存在，恢复历史 session
```

## 10. 前端适配

### 10.1 ActivityMessage 渲染

CopilotKit 前端需要为 `ActivityMessage` 提供自定义渲染器：

```tsx
// ActivityMessage 渲染器示例
function ActivityRenderer({ message }) {
  if (message.activityType === "PLAN") {
    return <PlanTimeline tasks={message.content.tasks} />;
  }
  if (message.activityType === "STEP_START") {
    return <StepIndicator step={message.content} />;
  }
  // ... 其他 activityType
}
```

### 10.2 CUSTOM 事件处理

```tsx
// CopilotKit 自定义事件 handler
function handleCustomEvent(event) {
  if (event.name === "artifact") {
    addArtifactToPanel(event.value);
  }
  if (event.name === "citation") {
    addCitationToAnswer(event.value);
  }
}
```

### 10.3 STATE_SNAPSHOT 消费

```tsx
// CopilotKit 状态同步
<CopilotKit
  runtimeUrl="http://localhost:8787/api/copilotkit"
  agent="dataAgent"
  // state 变更时触发 React 重新渲染
/>
// 前端可以从 CopilotKit 的 state 中读取：
// state.selectedDatasourceId
// state.selectedCollectionId
// state.runStatus
```

## 11. 代码调整方向

### 11.1 重命名/替换而非删除

| 当前代码 | 方向 | 说明 |
|---|---|---|
| `RunEventEmitter` | → 重命名为 `ToolActivityEmitter` 或 `AgUiActivitySink` | 通道仍在，只是产出格式从自定义 SSE 改为 AG-UI ACTIVITY/CUSTOM |
| `RunEventEmitter.create()` | → 替换为 `emitActivitySnapshot()` / `emitActivityDelta()` / `emitCustomEvent()` | 事件格式对齐 AG-UI |
| `RunEventEmitter` 在 `CreateDataAgentInput` 中的字段 | → 替换为 `ToolActivityEmitter` | tool wrapper 仍需要活动通知通道 |
| `emitter.create("plan.update", ...)` 在 `server.ts` 中 | → 由 `DataAgentAgUiAgent` 在 run 启动时通过 `emitActivitySnapshot()` 发出 | 不再在 server.ts 手动调用 |
| `RunEventWriter` | → 拆分为 `RunAuditSink`（从 AG-UI 流捕获） + `ToolActivityEmitter`（独立写 SQL audit / artifact） | 审计职责独立保留 |

### 11.2 contracts 包调整

**保留：**

- `ApiResult<T>` / `createSuccessResult` / `createErrorResult` — HTTP JSON 响应
- `AppErrorCode` — 错误码
- `EnvConfig` / `ENV_VARIABLE_SPECS` / `createEnvConfig` — 配置
- `MeResponse` — 用户信息
- Tool Input/Output 类型 — Mastra tool schema
- `ArtifactSummary` / `ArtifactType` — artifact 元数据
- `Citation` — 知识引用

**删除自定义前端 SSE 协议类型：**

- `RUN_EVENT_TYPES` → 替换为引用 `@ag-ui/core` 的 `EventType`
- `RunEventType` → 替换为 `EventType`
- `RunEventPayloadMap` → 删除（AG-UI 已有标准 payload schema）
- `TypedRunEventEnvelope` → 删除
- `PlanUpdatePayload` → 转为 `ACTIVITY_SNAPSHOT` content 定义（新类型 `ActivityPlanContent`）
- `StepStartPayload` → 转为 `ACTIVITY_SNAPSHOT` content 定义（新类型 `ActivityStepContent`）
- `StepMetaPayload` → 转为 `ACTIVITY_DELTA` patch 定义
- `StepOutputPayload` → 转为 `ACTIVITY_SNAPSHOT` content 或依赖 `TOOL_CALL_RESULT`
- `StepChunkPayload` → 删除，直接用 `TEXT_MESSAGE_CONTENT`
- `StepDonePayload` → 转为 `ACTIVITY_SNAPSHOT` content 定义
- `FinalPayload` / `DonePayload` / `ErrorPayload` / `CancelPayload` → 删除，由 AG-UI 标准事件表达

**保留但调整：**

- `RunEventEnvelope` → 保留为 run_events 表的存储格式，但 `type` 改为 AG-UI `EventType`，`payload` 改为 AG-UI 标准 payload

**新增：**

- `ActivityPlanContent` — 定义 `activityType: "PLAN"` 的 content 结构
- `ActivityStepContent` — 定义 `activityType: "STEP_START"` / `"STEP_DONE"` 的 content 结构
- `CustomArtifactPayload` — 定义 `name: "artifact"` 的 value 结构
- `CustomCitationPayload` — 定义 `name: "citation"` 的 value 结构
- `SessionState` — 定义 `STATE_SNAPSHOT` 的 snapshot 结构

## 12. 需要研究的技术问题

| 问题 | 优先级 | 说明 |
|---|---|---|
| **Spike：实现 DataAgentAgUiAgent extends AbstractAgent** | **P0** | 这是最关键的验证。需确认 `MastraAgent.run(input)` 的 Observable + 自定义 ACTIVITY_SNAPSHOT Observable 合流后，CopilotKit 能正常消费 |
| **Spike：验证 RxJS merge() 后 CopilotRuntime 是否能注册自定义 AbstractAgent** | **P0** | 需确认 `CopilotRuntime({ agents: { dataAgent: new DataAgentAgUiAgent(...) } })` 是否能正常工作 |
| **ToolActivityEmitter 如何在 tool execute 回调中触发？** | **P1** | Mastra `createTool` 的 `execute` 回调中如何访问 ToolActivityEmitter？需要设计共享 state / context 传递机制 |
| **CopilotKit 前端如何渲染 ActivityMessage？** | **P1** | 需研究 CopilotKit React 组件是否支持 `activity` role 的自定义渲染 |
| **CopilotKit 前端如何消费 CUSTOM 事件？** | **P1** | 需研究 CopilotKit 是否有 `onCustomEvent` handler 或需要自定义 |
| **STATE_SNAPSHOT / STATE_DELTA 在 CopilotKit 中如何触发 React 状态更新？** | **P1** | 需研究 CopilotKit 的状态同步机制 |
| **forwardedProps 如何从前端传递到后端 RunAgentInput？** | **P1** | 需研究 CopilotKit `<CopilotKit forwardedProps={...}>` 的传递链路 |
| **Session resume（threadId 映射）** | **P2** | 需研究 CopilotKit `threadId` 如何映射到后端 session |
| **MESSAGES_SNAPSHOT 实现** | **P2/P3 延后** | 先把 raw AG-UI event 落库做稳，再谈从历史事件恢复 messages |
| **Tool Call Interrupt（人类确认）** | **P3 延后** | 需研究 `RUN_FINISHED(outcome: interrupt)` 的前端交互模式 |
| **Agent Handoff 多 agent** | **P3 延后** | 需研究多 agent 场景下的 `parentRunId` 和 thread 传递 |

## 13. 实施优先级

### 13.1 Spike 验证（必须先做）

| 步骤 | 预估 | 说明 |
|---|---|---|
| **Spike: DataAgentAgUiAgent extends AbstractAgent** | 1-2 天 | 最关键验证。实现最小 wrapper，内部委托 `MastraAgent.run(input)` + merge 自定义 ACTIVITY_SNAPSHOT 流，确认 CopilotKit 正常消费 |

### 13.2 P0 — 核心重构（Spike 通过后）

| 步骤 | 预估 | 说明 |
|---|---|---|
| 替换 RunEventEmitter 为 ToolActivityEmitter | 1 天 | 重命名 + 改接口，不改职责 |
| 实现 ToolActivityEmitter.emitActivitySnapshot / emitCustomEvent | 1 天 | 在 tool wrapper 中注入 ACTIVITY_SNAPSHOT / CUSTOM |
| 实现 RunAuditSink 从 AG-UI 流捕获写入 run_events | 1 天 | 替代 RunEventWriter 手动写入 |
| 从 RunAgentInput 提取 threadId → session_id / runId | 0.5 天 | 替代随机生成 |
| 从 RunAgentInput 提取 context / forwardedProps → datasource_id 等 | 0.5 天 | 替代 HTTP header |

### 13.3 P1 — 状态同步和类型重构

| 步骤 | 预估 | 说明 |
|---|---|---|
| STATE_SNAPSHOT 推送 session 状态 | 1 天 | 通过 ToolActivityEmitter 或 DataAgentAgUiAgent 发出 |
| contracts 包类型重构 | 1 天 | 删除自定义 SSE 类型，新增 ActivityContent / CustomEventPayload 定义 |

### 13.4 P2/P3 延后项

| 步骤 | 预估 | 说明 |
|---|---|---|
| MESSAGES_SNAPSHOT 实现 session resume | P2/P3 延后 | 先把 raw AG-UI event 落库做稳再实现 |
| ReasoningMessage 可见推理 | P2 延后 | 只消费 provider 明确提供的 visible reasoning summary，不引导 hidden thought |
| 前端 ActivityMessage 自定义渲染器 | P2 | 前端研发 A 负责 |
| Tool Call Interrupt 人类确认 | P3 延后 | SQL 执行前 interrupt 等确认 |
| Agent Handoff 多 agent | P3 延后 | 后续扩展 |

## 14. 与最终设计文档的对齐

最终设计文档（`docs/engineering/db-gpt-like-data-agent-final-design-zh.md`）中的 SSE 事件协议（第 8 章）需要更新为 AG-UI 协议适配版：

| 章节 | 原内容 | 重构后 |
|---|---|---|
| §8 SSE 事件协议 | 11 种自定义 SSE 事件 | 映射到 AG-UI 标准事件 + ACTIVITY_SNAPSHOT/CUSTOM 补充 |
| §8.1 plan.update | 自定义 payload | `ACTIVITY_SNAPSHOT(activityType: "PLAN")` |
| §8.2 step.start | 自定义 payload | `ACTIVITY_SNAPSHOT(activityType: "STEP_START")` |
| §8.3 step.meta | 自定义 payload | `ACTIVITY_DELTA(activityType: "STEP_META")` |
| §8.4 step.output | 自定义 payload | `ACTIVITY_SNAPSHOT(activityType: "STEP_OUTPUT")` 或依赖 `TOOL_CALL_RESULT` |
| §8.5 step.chunk | 自定义 payload | `TEXT_MESSAGE_CONTENT`（自动） |
| §8.6 step.done | 自定义 payload | `ACTIVITY_SNAPSHOT(activityType: "STEP_DONE")` |
| §8.7 final | 自定义 payload | `TEXT_MESSAGE_END` + `RUN_FINISHED`（自动） |
| §8.8 done | 自定义 payload | `RUN_FINISHED`（自动） |
| §8.9 error | 自定义 payload | `RUN_ERROR`（自动） |
| §8.10 cancel | 自定义 payload | `RUN_FINISHED(outcome: interrupt)` |
| §8.11 Citation | 自定义 payload | `CUSTOM(name: "citation")` |
| §7 API 合约 | `/api/v1/chat/react-agent` SSE | `POST /api/copilotkit` AG-UI 流（已实现） |

R&D B 架构文档（`docs/engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md`）需要更新：

| 章节 | 更新内容 |
|---|---|
| §5.2 Tool schema | RunEventEmitter → ToolActivityEmitter，自定义事件通过 ACTIVITY_SNAPSHOT/CUSTOM 注入 |
| §4 运行时流程 | 更新序列图，标注 DataAgentAgUiAgent wrapper + RxJS merge 合流 |
| §7 Metadata / Artifacts / Knowledge | 说明 run_events 从 AG-UI 流通过 RunAuditSink 捕获写入；SQL audit / artifact trace 独立保留 |

## 15. 下一步行动

评审确认的下一步：

> 先做一个最小 Spike：实现 DataAgentAgUiAgent extends AbstractAgent，验证能不能把 MastraAgent.run(input) 和我们自己的 ACTIVITY_SNAPSHOT 合流后仍被 CopilotKit 正常消费。

Spike 的最小范围：

1. 创建 `DataAgentAgUiAgent extends AbstractAgent`
2. `run()` 内部委托 `MastraAgent.run(input)`
3. 同时 merge 一个 Observable 发出一条 `ACTIVITY_SNAPSHOT(activityType: "PLAN", content: { tasks: [...] })`
4. 注册到 `CopilotRuntime({ agents: { dataAgent: new DataAgentAgUiAgent(...) } })`
5. 前端 CopilotKit 连接，验证：
   - 标准事件（TEXT_MESSAGE / TOOL_CALL）正常渲染
   - ACTIVITY_SNAPSHOT 事件被前端接收并可见
   - 整体不报错或崩溃
