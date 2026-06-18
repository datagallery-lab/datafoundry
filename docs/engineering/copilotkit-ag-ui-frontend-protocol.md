# CopilotKit / AG-UI Frontend Protocol Support

日期：2026-06-18
受众：GUI / TUI 前端同学
状态：当前后端实际支持面

## 1. 接入结论

前端只接入 CopilotKit / AG-UI 协议，不接入后端内部 Data Gateway、Metadata、Artifact、Knowledge 模块。

当前唯一对外 Agent Runtime 入口：

```text
GET  /healthz
POST /api/copilotkit
```

当前唯一后端 agent：

```text
dataAgent
```

推荐 GUI 使用 CopilotKit runtime：

```tsx
<CopilotKit runtimeUrl="http://127.0.0.1:8787/api/copilotkit" agent="dataAgent">
  <CopilotChat />
</CopilotKit>
```

TUI 如果不使用 CopilotKit React 组件，也应按 AG-UI `RunAgentInput` / event stream 语义接入
`POST /api/copilotkit`，不要自定义一套 SSE/chat 协议。

## 2. 请求上下文

后端从 AG-UI `RunAgentInput` 中提取运行上下文。

| 字段 | 当前支持 | 后端用途 | 说明 |
| --- | --- | --- | --- |
| `threadId` | 支持 | `session_id` | 会话维度。 |
| `runId` | 支持 | `run_id` | 单次运行维度。 |
| `messages` | 支持 | 提取最后一条 user text 作为 `user_input` | 支持 string content 和 text part array。 |
| `forwardedProps.datasourceId` | 支持 | selected datasource | 优先级最高。 |
| `forwardedProps.datasource_id` | 支持 | selected datasource | snake_case 兼容。 |
| `state.datasourceId` | 支持 | selected datasource | 优先级低于 `forwardedProps`。 |
| `state.datasource_id` | 支持 | selected datasource | snake_case 兼容。 |
| `context[].description === "datasource_id"` | 支持 | selected datasource | 优先级低于 `forwardedProps` 和 `state`。 |
| `context` 其他项 | 透传给 `@ag-ui/mastra` | 暂不进入后端业务策略 | 后续 collection/user context 会扩展。 |
| `tools` | 透传给 `@ag-ui/mastra` | client tools | 后端当前不依赖前端 tools。 |

Datasource 选择优先级：

```text
forwardedProps.datasourceId
-> forwardedProps.datasource_id
-> state.datasourceId
-> state.datasource_id
-> context item where description = "datasource_id"
-> default "api-duckdb-demo"
```

推荐前端传法：

```json
{
  "forwardedProps": {
    "datasourceId": "api-duckdb-demo"
  }
}
```

当前用户身份是后端固定 dev user：

```text
user_id=dev-user
```

前端现在不需要，也不能通过协议传入 credential。

## 3. 当前支持的 AG-UI 事件

后端会把 `@ag-ui/mastra` 自动产生的 AG-UI events 和后端 tool wrapper 产生的 AG-UI events 合并成一条 stream。
同一条 stream 会原样写入 `run_events`。

### 3.1 Run Lifecycle

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `RUN_STARTED` | 支持 | `@ag-ui/mastra` | 开始 run。 |
| `RUN_FINISHED` | 支持 | `@ag-ui/mastra` | 结束 run。 |
| `RUN_ERROR` | 支持 | `@ag-ui/mastra` / 后端异常兜底 | 展示错误状态。 |

### 3.2 Assistant Text

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `TEXT_MESSAGE_CHUNK` | 支持 | `@ag-ui/mastra` | 当前主要文本流事件。 |
| `TEXT_MESSAGE_START` | AG-UI 类型支持，但当前不主动发 | 上游可能产生 | 前端可兼容。 |
| `TEXT_MESSAGE_CONTENT` | AG-UI 类型支持，但当前不主动发 | 上游可能产生 | 前端可兼容。 |
| `TEXT_MESSAGE_END` | AG-UI 类型支持，但当前不主动发 | 上游可能产生 | 前端可兼容。 |

### 3.3 Tool Call Trace

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `TOOL_CALL_START` | 支持 | `@ag-ui/mastra` | 展示工具调用开始。 |
| `TOOL_CALL_ARGS` | 支持 | `@ag-ui/mastra` | 可展示工具参数，注意 SQL 可见。 |
| `TOOL_CALL_END` | 支持 | `@ag-ui/mastra` | 展示工具调用结束。 |
| `TOOL_CALL_RESULT` | 支持 | `@ag-ui/mastra` | 展示工具 observation。 |
| `TOOL_CALL_CHUNK` | AG-UI 类型支持，但当前不主动发 | 上游可能产生 | 前端可兼容。 |

当前后端工具：

| Tool | 用途 | 前端可见性 |
| --- | --- | --- |
| `inspect_schema` | 检查 selected datasource schema | 可作为 trace 展示。 |
| `run_sql_readonly` | 执行只读 SQL | 可展示 SQL、audit id、row count、artifact id。 |

### 3.4 Reasoning

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `REASONING_START` | 支持透传 | `@ag-ui/mastra` | 如果模型输出 reasoning，可渲染为可折叠区域。 |
| `REASONING_MESSAGE_START` | 支持透传 | `@ag-ui/mastra` | `role` 为 `reasoning`。 |
| `REASONING_MESSAGE_CONTENT` | 支持透传 | `@ag-ui/mastra` | 使用 `delta` 拼接。 |
| `REASONING_MESSAGE_END` | 支持透传 | `@ag-ui/mastra` | 结束 reasoning message。 |
| `REASONING_MESSAGE_CHUNK` | AG-UI 类型支持，当前不主动发 | 上游可能产生 | 前端可兼容。 |
| `REASONING_END` | 支持透传 | `@ag-ui/mastra` | 结束 reasoning。 |
| `REASONING_ENCRYPTED_VALUE` | AG-UI 类型支持，当前不主动发 | 上游可能产生 | 前端可忽略或隐藏。 |

注意：这是模型 API 可见输出的 reasoning summary，不是 hidden chain-of-thought。后端不会主动伪造 reasoning。

### 3.5 Activity

后端使用 AG-UI activity 表达 plan 和 tool progress。

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `ACTIVITY_SNAPSHOT` | 支持 | 后端 tool wrapper | 渲染 plan/step 当前状态。 |
| `ACTIVITY_DELTA` | 支持 | 后端 tool wrapper / run lifecycle | 按 JSON patch 更新 activity。 |

当前 activity 类型：

| `activityType` | `messageId` 格式 | 内容 |
| --- | --- | --- |
| `PLAN` | `${runId}:activity:plan` | 三个 task：schema、sql、final。 |
| `STEP` | `${runId}:activity:step:${step_id}` | 单个工具步骤状态。 |

当前 PLAN tasks：

```json
[
  { "id": "schema", "title": "检查数据源 schema", "status": "pending" },
  { "id": "sql", "title": "生成并执行只读 SQL", "status": "pending" },
  { "id": "final", "title": "生成最终回答", "status": "pending" }
]
```

`ACTIVITY_DELTA.patch` 示例：

```json
[
  { "op": "replace", "path": "/tasks/0/status", "value": "running" }
]
```

STEP snapshot 示例结构：

```json
{
  "type": "ACTIVITY_SNAPSHOT",
  "messageId": "run-1:activity:step:schema",
  "activityType": "STEP",
  "replace": true,
  "content": {
    "step_id": "schema",
    "title": "检查数据源 schema",
    "kind": "schema",
    "tool_name": "inspect_schema",
    "status": "running"
  }
}
```

### 3.6 State

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `STATE_SNAPSHOT` | 支持 | 后端 run start / `@ag-ui/mastra` memory snapshot | 初始化或替换 state。 |
| `STATE_DELTA` | 支持 | 后端 run finished/error | 更新 `runStatus` 和 `errorMessage`。 |

后端 run start state：

```json
{
  "selectedDatasourceId": "api-duckdb-demo",
  "runId": "run-1",
  "runStatus": "running",
  "sessionId": "thread-1"
}
```

run 完成 delta：

```json
[
  { "op": "replace", "path": "/runStatus", "value": "completed" }
]
```

run 失败 delta：

```json
[
  { "op": "replace", "path": "/runStatus", "value": "failed" },
  { "op": "add", "path": "/errorMessage", "value": "..." }
]
```

### 3.7 Custom Events

后端只使用 AG-UI `CUSTOM`，不新增自定义 EventType。

| `name` | 支持 | `value` 内容 | 前端建议 |
| --- | --- | --- | --- |
| `sql_audit` | 支持 | `audit_log_id`、`datasource_id`、`status`、`row_count`、`elapsed_ms` | 可展示审计摘要。 |
| `artifact` | 支持 | artifact summary | 可展示 artifact card / table preview 入口。 |
| `on_interrupt` | 透传可能出现 | `@ag-ui/mastra` tool suspension | 当前后端业务未使用，前端可忽略。 |

## 4. 当前不支持或不要依赖的内容

| 内容 | 状态 | 原因 / 替代方案 |
| --- | --- | --- |
| 旧自定义 SSE chat endpoint | 不支持 | 只保留 `/api/copilotkit`。 |
| 自定义事件名如 `plan.update`、`step.start`、`final`、`done` | 不支持 | 统一使用 AG-UI `EventType`。 |
| 前端直连 Data Gateway REST API | 不支持 | Data Gateway 是 agent tool 边界。 |
| 前端直连 Metadata / run_events 查询 API | 不支持 | 当前没有对外 replay/query endpoint。 |
| 前端直连 Artifact download/preview API | 不支持 | 当前 artifact 只通过 AG-UI `CUSTOM(name="artifact")` 摘要可见。 |
| 前端注册/编辑 datasource 的 REST API | 不支持 | 当前 datasource 管理仍在后端内部/测试路径。 |
| 多用户认证 | 不支持 | 当前固定 `dev-user`。 |
| HTTP header 注入 session/datasource | 不支持 | 不使用 `X-Session-ID` / `X-Datasource-ID`，改用 AG-UI body。 |
| 前端传 datasource credential | 不支持 | credential 不进入模型和前端协议。 |
| Knowledge/RAG tool | 暂不支持 | `packages/knowledge` 目前只有接口和模型。 |
| PostgreSQL / MySQL 实际连接 | 暂不支持 | 类型保留，adapter 未实现。 |
| SQL 写操作 | 不支持 | `run_sql_readonly` + SQL guard 只允许只读查询。 |
| 模型绕过工具直接拿数据 | 不支持 | 数据访问必须经过 Data Gateway tools。 |
| client tools 替代后端数据工具 | 不支持 | 后端数据安全和审计边界不能交给前端工具。 |
| hidden chain-of-thought 展示 | 不支持 | 只透传模型显式输出的 `REASONING_*`。 |
| AG-UI deprecated `THINKING_*` | 不主动支持 | 前端可兼容，但后端使用 `REASONING_*`。 |
| `RAW` event | 不主动支持 | 当前后端不发。 |
| `MESSAGES_SNAPSHOT` | 不主动支持 | 当前后端不发。 |
| `STEP_STARTED` / `STEP_FINISHED` | 不主动支持 | 当前进度使用 `ACTIVITY_*` 和 `TOOL_CALL_*`。 |

## 5. Error / HTTP 行为

| 场景 | HTTP / Event | 前端建议 |
| --- | --- | --- |
| `GET /healthz` | `200` JSON `{ ok: true, data: { status: "ok" } }` | 健康检查。 |
| `OPTIONS /api/copilotkit` | `204` | CORS preflight。 |
| 未配置 `LLM_API_KEY` | `503` JSON `err_code=PROVIDER_CONFIG_MISSING` | 提示后端模型配置缺失。 |
| AG-UI request 缺 method 等必要字段 | CopilotKit runtime 返回 validation error | 按 CopilotKit 客户端默认处理。 |
| Agent 运行错误 | `RUN_ERROR` + `STATE_DELTA(runStatus=failed)` | 展示失败状态和错误信息。 |

CORS 当前允许：

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## 6. 前端实现建议

GUI：

- 优先使用 CopilotKit 官方 runtime 接入方式。
- 选择 agent：`dataAgent`。
- datasource 通过 `forwardedProps.datasourceId` 传。
- 渲染 `TEXT_MESSAGE_CHUNK` 为主回答。
- 渲染 `TOOL_CALL_*` 或 `ACTIVITY_*` 为执行轨迹。
- 渲染 `CUSTOM(sql_audit)` 和 `CUSTOM(artifact)` 为审计/结果卡片。
- 可选渲染 `REASONING_*` 为折叠区域。

TUI：

- 可以不使用 React 组件，但仍应按 AG-UI events 实现消费端。
- 至少处理：`RUN_*`、`TEXT_MESSAGE_CHUNK`、`TOOL_CALL_*`、`ACTIVITY_*`、`STATE_*`、`CUSTOM`。
- 不要解析后端 SQLite，也不要请求内部 Data Gateway。

## 7. 最小前端消费清单

前端第一版至少支持：

| 能力 | 必须处理的事件 |
| --- | --- |
| run 开始/结束/失败 | `RUN_STARTED`、`RUN_FINISHED`、`RUN_ERROR` |
| assistant 文本输出 | `TEXT_MESSAGE_CHUNK` |
| 工具轨迹 | `TOOL_CALL_START`、`TOOL_CALL_ARGS`、`TOOL_CALL_END`、`TOOL_CALL_RESULT` |
| plan/step 进度 | `ACTIVITY_SNAPSHOT`、`ACTIVITY_DELTA` |
| run state | `STATE_SNAPSHOT`、`STATE_DELTA` |
| SQL audit / artifact | `CUSTOM` |

可以后置：

| 能力 | 事件 |
| --- | --- |
| reasoning 折叠展示 | `REASONING_*` |
| encrypted reasoning | `REASONING_ENCRYPTED_VALUE` |
| message snapshot | `MESSAGES_SNAPSHOT` |
| raw debug event | `RAW` |
