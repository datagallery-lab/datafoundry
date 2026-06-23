# AG-UI 协议使用现状修复清单

日期：2026-06-18
状态：Historical Review；清单已完成核对，当前事实以协议支持文档和 smoke tests 为准

> 本文用于保留当时的审查问题，不表示当前仍存在同名缺陷。

## 1. REASONING 事件需要透传

### 问题

当前代码完全没有处理 `REASONING_*` 事件。支持思考模式（extended thinking / reasoning）的模型（如 Qwen 的思考模式、DeepSeek-R1、Claude 的 extended thinking）会在流式输出中包含 reasoning part，MastraAgent 会自动将其映射为 `REASONING_*` 事件序列：

```
REASONING_START → REASONING_MESSAGE_START → REASONING_MESSAGE_CONTENT(多次) → REASONING_MESSAGE_END → REASONING_END
```

这些事件已经由 MastraAgent 自动发出并进入合流后的 Observable，**不需要后端额外发出**。但当前代码有一个问题：`emit()` 函数会把所有 AG-UI 事件同时写入 SQLite `run_events`，所以 REASONING 事件会被落库。然而前端是否能正确消费这些事件取决于 CopilotKit 前端是否渲染 `ReasoningMessage`。

### 这不是"引导隐藏思考"

REASONING 事件是模型**自己选择输出**的可见推理摘要，不是 hidden chain-of-thought。支持思考模式的模型在生成回答时会同时输出一个 reasoning 摘要和最终回答，这两者是分离的：

- `REASONING_*` 事件 → 模型的推理过程（"我需要先检查 schema，因为...")
- `TEXT_MESSAGE_*` 事件 → 模型的最终回答

前端应该把 reasoning 渲染为一个可展开/折叠的"思考过程"区域，让用户看到 agent 是如何推导出结论的。这正是设计方案中"ReAct trace 必须可见"的要求。

### 修复方向

1. **后端不需要额外发出 REASONING 事件** — MastraAgent 已经自动映射了，合流后的事件流已经包含 REASONING_* 事件
2. **后端需要确保 REASONING 事件被正确落库** — 当前 `emit()` 已经覆盖了所有 MastraAgent 自动发出的事件（包括 REASONING_*），所以落库没问题
3. **前端需要实现 ReasoningMessage 渲染** — CopilotKit 前端需要为 `role: "reasoning"` 的消息提供渲染器，展示可折叠的思考过程
4. **Prompt 可以鼓励模型使用思考模式** — 如果模型配置支持 extended thinking（如 Qwen 的思考模式），可以在 agent prompt 或 model config 中启用。这不等于引导 hidden chain-of-thought，而是让模型使用其内置的 visible reasoning 能力

### 具体修改

| 位置 | 当前状态 | 需要修改 |
|---|---|---|
| `agent-runtime/src/tools/data-tools.ts` | 无 REASONING 相关代码 | ❌ 不需要改 — REASONING 由 MastraAgent 自动映射 |
| `agent-runtime/src/events.ts` | 无 REASONING 相关代码 | ❌ 不需要改 — REASONING 不是后端主动发出的 |
| `server.ts` DataAgentAgUiAgent | `emit()` 覆盖所有 MastraAgent 事件 | ❌ 不需要改 — REASONING 已经自动进入合流并落库 |
| Mastra Agent 配置 | `defaultOptions` 无 thinking 配置 | 🟡 可选 — 如果 Qwen 模型支持思考模式，可以在 `providerOptions` 中启用 |
| 前端 | 未实现 | 🔴 需要 — 前端必须实现 ReasoningMessage 渲染器 |

### Mastra Agent 启用思考模式的方向

部分模型（如 Qwen3、DeepSeek-R1）支持在 API 请求中开启思考模式。Mastra Agent 的 `providerOptions` 可以传递模型特定参数：

```ts
// 方向设计 — 在 createDataAgent 中配置
const agent = new Agent({
  ...
  defaultOptions: {
    maxSteps: 6,
    providerOptions: {
      openai: {
        systemMessageMode: "system",
        // 如果模型支持思考模式，可以在这里启用
        // 具体参数取决于模型的 API 规范
      }
    }
  }
});
```

这不是引导 hidden thought，而是让模型使用其**内置的可见推理能力**。模型的思考内容是其 API 明确提供的输出，和最终回答一样是产品可见数据。

## 2. ACTIVITY_SNAPSHOT 的 `replace` 字段问题

### 问题

`events.ts:23` 中 `createActivitySnapshot` 固定设置 `replace: false`：

```ts
export const createActivitySnapshot = (
  context: AgentRunContext,
  activityType: string,
  content: Record<string, unknown>
): BaseEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: `${context.run_id}:activity:${activityType.toLowerCase()}`,
  activityType,
  content,
  replace: false,  // ← 固定 false
  timestamp: Date.now()
});
```

在 `data-tools.ts` 中，每次 inspect_schema 和 run_sql_readonly 都发两个 STEP snapshot（一个 running，一个 completed/failed），它们共享同一个 `messageId: "${run_id}:activity:step"`。

`replace: false` 的 AG-UI 语义：前端不替换之前的同 messageId 活动，保留多条独立记录。

**结果**：前端会看到同一 step 的多个独立活动条目（running + completed），而不是一个逐步更新的进度。

### 修复方向

改为 `replace: true`，让前端用一个更新的 STEP 活动替换之前的 running 状态：

```ts
// events.ts 修改方向
export const createActivitySnapshot = (
  context: AgentRunContext,
  activityType: string,
  content: Record<string, unknown>,
  replace: boolean = true  // ← 默认 true
): BaseEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: `${context.run_id}:activity:${activityType.toLowerCase()}`,
  activityType,
  content,
  replace,  // ← 可配置
  timestamp: Date.now()
});
```

PLAN 事件也应该用 `replace: true`，因为 PLAN 是一个持续更新的活动视图。

## 3. STEP 活动的 `messageId` 不区分步骤

### 问题

所有 STEP 活动的 `messageId` 都是 `"${run_id}:activity:step"`，不区分 inspect_schema vs run_sql_readonly。

在 `replace: true` 的情况下，后来的 run_sql_readonly STEP 会覆盖之前的 inspect_schema STEP，前端只能看到最后一个 step 的状态。

### 修复方向

STEP 的 `messageId` 应包含 step_id，区分不同步骤：

```ts
// data-tools.ts 修改方向
// inspect_schema
input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
  step_id: stepId,  // "schema"
  ...
}, true));  // replace=true

// run_sql_readonly (第1次)
input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
  step_id: stepId,  // "sql-1"
  ...
}, true));  // replace=true

// 修改 createActivitySnapshot 的 messageId 逻辑
// 如果 content 包含 step_id，则 messageId 应包含它
messageId: `${context.run_id}:activity:step:${content.step_id ?? activityType.toLowerCase()}`
```

这样前端可以同时看到两个 STEP 活动：一个 schema step 和一个 sql step，各自独立更新状态。

## 4. PLAN 中的 task status 不被更新

### 问题

`createPlanActivityEvent` 发出初始 PLAN 活动，所有 task 状态为 `pending`：

```ts
tasks: [
  { id: "schema", title: "检查数据源 schema", status: "pending" },
  { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
  { id: "final", title: "生成最终回答", status: "pending" }
]
```

但后续 step 开始/完成时，tool wrapper 发的是独立的 `ACTIVITY_SNAPSHOT(activityType: "STEP")`，**没有更新 PLAN 中的 task status**。

前端看到：一个 PLAN（3 个 pending task）+ 多个独立的 STEP 活动。PLAN 中 task 状态永远停留在 pending。

### 修复方向

在每个 step 开始时，发一条 `ACTIVITY_DELTA` 更新 PLAN 中对应 task 的 status：

```ts
// data-tools.ts 修改方向

// inspect_schema 开始时 — 更新 PLAN 中 schema task 为 running
input.emitter.emit({
  type: EventType.ACTIVITY_DELTA,
  messageId: `${input.runContext.run_id}:activity:plan`,
  activityType: "PLAN",
  patch: [
    { op: "replace", path: "/tasks/0/status", value: "running" }
  ],
  timestamp: Date.now()
});

// inspect_schema 完成时 — 更新 PLAN 中 schema task 为 completed
input.emitter.emit({
  type: EventType.ACTIVITY_DELTA,
  messageId: `${input.runContext.run_id}:activity:plan`,
  activityType: "PLAN",
  patch: [
    { op: "replace", path: "/tasks/0/status", value: "completed" },
    { op: "replace", path: "/tasks/1/status", value: "running" }  // 同时标记下一个 task 为 running
  ],
  timestamp: Date.now()
});
```

需要新增一个 `createActivityDelta` 辅助函数：

```ts
// events.ts 新增
export const createActivityDelta = (
  context: AgentRunContext,
  activityType: string,
  patch: Array<{ op: string; path: string; value: unknown }>
): BaseEvent => ({
  type: EventType.ACTIVITY_DELTA,
  messageId: `${context.run_id}:activity:${activityType.toLowerCase()}`,
  activityType,
  patch,
  timestamp: Date.now()
});
```

## 5. STATE_DELTA 在 RUN_FINISHED 时缺失

### 问题

`server.ts:221-228` 在 RUN_STARTED 后发了初始 `STATE_SNAPSHOT`：

```ts
snapshot: {
  selectedDatasourceId,
  runId,
  runStatus: "running",
  sessionId
}
```

但 RUN_FINISHED 时只更新了后端 `runs` 表的状态，**没有发 `STATE_DELTA` 通知前端**。前端拿到的 `runStatus` 永远是 `"running"`。

### 修复方向

在 RUN_FINISHED 时发一条 `STATE_DELTA`：

```ts
// server.ts 修改方向 — RUN_FINISHED 处理中增加
if (event.type === EventType.RUN_FINISHED) {
  this.input.metadataStore.runs.updateStatus({
    user_id: this.input.user.id,
    run_id: runId,
    status: "completed"
  });
  // 新增：通知前端状态变更
  emit({
    type: EventType.STATE_DELTA,
    delta: [
      { op: "replace", path: "/runStatus", value: "completed" }
    ],
    timestamp: Date.now()
  });
}
```

同理，RUN_ERROR 时也应发 `STATE_DELTA`：

```ts
if (event.type === EventType.RUN_ERROR) {
  this.input.metadataStore.runs.updateStatus({
    user_id: this.input.user.id,
    run_id: runId,
    status: "failed",
    error_message: "AG-UI run error"
  });
  // 新增
  emit({
    type: EventType.STATE_DELTA,
    delta: [
      { op: "replace", path: "/runStatus", value: "failed" },
      { op: "add", path: "/errorMessage", value: "AG-UI run error" }
    ],
    timestamp: Date.now()
  });
}
```

## 6. CORS Access-Control-Allow-Headers 缺少 AG-UI 相关头

### 问题

`server.ts:288-292` 的 CORS preflight 只允许：

```
Content-Type, Authorization
```

但之前版本允许的 `X-Session-ID` 和 `X-Datasource-ID` 被移除了。虽然当前已经改为从 `RunAgentInput` 提取上下文（不再依赖 HTTP header），但 CopilotKit 前端可能还会发一些自定义 header。

### 修复方向

检查 CopilotKit 前端是否会发其他 header（如 `X-CopilotKit-*`）。如果不需要自定义 header，当前 CORS 配置已够。如果前端有特定需求，补充对应的 header。

**这个修复是可选的，当前可能已经足够**。

## 7. 修复优先级排序

| 优先级 | 修复项 | 影响 |
|---|---|---|
| **P0** | #2 ACTIVITY_SNAPSHOT `replace: false` → `replace: true` | 🔴 前端会看到重复的 step 活动条目，核心交互体验问题 |
| **P0** | #3 STEP `messageId` 不区分步骤 | 🔴 `replace: true` 后所有 step 共享 messageId，后者覆盖前者，前端只看到最后一个 step |
| **P0** | #4 PLAN task status 不被更新 | 🔴 PLAN timeline 永远显示 pending，核心交互体验问题 |
| **P1** | #5 STATE_DELTA 在 RUN_FINISHED/ERROR 时缺失 | 🟡 前端无法获知 run 完成或失败，状态停留在 running |
| **P1** | #1 REASONING 前端渲染器 | 🟡 思考模式模型输出不可见，但后端透传已 OK。前端需要实现渲染 |
| **P2** | #1 Mastra Agent 启用思考模式配置 | 🟡 可选。取决于模型是否支持且用户是否需要 |
| **P2** | #6 CORS headers | 🟡 可选。当前可能已够 |

## 8. 所有修复涉及的文件

| 文件 | 修复项 |
|---|---|
| `packages/agent-runtime/src/events.ts` | #2 `replace` 参数化；#4 新增 `createActivityDelta` |
| `packages/agent-runtime/src/tools/data-tools.ts` | #2 调用 `createActivitySnapshot` 时传 `replace: true`；#3 修改 STEP 的 `messageId` 包含 `step_id`；#4 每个 step 开始/完成时发 `ACTIVITY_DELTA` 更新 PLAN |
| `apps/api/src/server.ts` | #5 RUN_FINISHED/ERROR 时发 `STATE_DELTA` |
| 前端 | #1 ReasoningMessage 渲染器（前端研发 A 负责） |
