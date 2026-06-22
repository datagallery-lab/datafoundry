# CopilotKit / AG-UI Frontend Protocol Support

日期：2026-06-22
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
| `parentRunId` | 支持 | `parent_run_id` | 必须属于同一 user/session；用于 retry、branch、派生 run。 |
| `messages` | 支持 | 提取最后一条 user text 作为 `user_input` | 支持 string content 和 text part array。 |
| `forwardedProps.datasourceId` | 支持 | selected datasource | 优先级最高。 |
| `forwardedProps.datasource_id` | 支持 | selected datasource | snake_case 兼容。 |
| `state.datasourceId` | 支持 | selected datasource | 优先级低于 `forwardedProps`。 |
| `state.datasource_id` | 支持 | selected datasource | snake_case 兼容。 |
| `context[].description === "datasource_id"` | 支持 | selected datasource | 优先级低于 `forwardedProps` 和 `state`。 |
| `context` 其他项 | 透传给 `@ag-ui/mastra` | 暂不进入后端业务策略 | 后续 collection/user context 会扩展。 |
| `tools` | 透传给 `@ag-ui/mastra` | client tools | 后端当前不依赖前端 tools。 |
| `forwardedProps.run_config.goal` | 支持 | native goal objective | 仅接受 `objective` 和 1-20 的 `maxRuns`。 |
| `forwardedProps.command` | 支持 | 恢复挂起 interaction | 见 3.8；必须继续使用同一 `threadId/runId`。 |

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

### 2.1 Run 幂等语义

- `(user_id, runId)` 是运行身份。
- 新 run 使用请求指纹原子 claim，避免并发重复执行。
- 相同终态 runId + 相同请求指纹：按原顺序回放持久化 AG-UI events。
- 相同 runId 仍处于 queued/running：返回 `RUN_ALREADY_ACTIVE`。
- runId 相同但 session 或请求指纹不同：fail closed，不创建第二次执行。
- suspended run 使用同一 runId 恢复；同一 response 幂等，不同 response 返回
  `INTERACTION_RESUME_MISMATCH`。

## 3. 当前支持的 AG-UI 事件

后端会把 `@ag-ui/mastra` 自动产生的 AG-UI events 和后端 tool wrapper 产生的 AG-UI events 合并成一条 stream。
同一条 stream 会原样写入 `run_events`。

### 3.1 Run Lifecycle

| EventType | 支持 | 来源 | 前端建议 |
| --- | --- | --- | --- |
| `RUN_STARTED` | 支持 | `@ag-ui/mastra` | 开始 run。 |
| `RUN_FINISHED` | 支持 | `@ag-ui/mastra` | 只在真实终态发送；挂起时抑制框架补发的伪终态。 |
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

当前后端工具组：

| Tool | 用途 | 前端可见性 |
| --- | --- | --- |
| `list_data_sources` / `inspect_schema` / `preview_table` / `run_sql_readonly` | 数据分析 | 可展示治理后的结果。 |
| `read_file` / `write_file` / `edit_file` / `list_files` / `grep` / `file_stat` / `mkdir` | Workspace | run 目录内文件能力。 |
| `execute_command` | 本地变换 | 仅隔离可用时暴露，无网络，不能绕过 Data Gateway。 |
| `task_write` / `task_update` / `task_complete` / `task_check` | 任务状态 | 结果同时投影 PLAN。 |
| `ask_user` / `submit_plan` | 用户协作 | 会挂起 run，按 3.8 恢复。 |

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
| `ACTIVITY_SNAPSHOT` | 支持 | task projector / tool wrapper | 替换 plan/step 当前状态。 |
| `ACTIVITY_DELTA` | 协议支持，当前未用于 PLAN | 后续增量 projector | 按 JSON patch 更新 activity。 |

当前 activity 类型：

| `activityType` | `messageId` 格式 | 内容 |
| --- | --- | --- |
| `PLAN` | `${runId}:activity:plan` | Mastra thread task state 的动态快照。 |
| `STEP` | `${runId}:activity:step:${step_id}` | 单个工具步骤状态。 |

PLAN 只在 `task_write/update/complete/check` 返回有效 task state 后出现，不再预置 schema/sql/final 三个固定任务：

```json
[
  {
    "id": "inspect-orders",
    "title": "检查 orders schema",
    "active_form": "正在检查 orders schema",
    "status": "running"
  }
]
```

状态映射为 `pending -> pending`、`in_progress -> running`、`completed -> completed`。run 终态不会伪造或
改写 task 状态；失败状态由 `RUN_ERROR` / state 表达。实时 PLAN snapshot 会作为普通 AG-UI 事件持久化，回放无需
重新读取 task SQLite。

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
| `STATE_DELTA` | 支持 | 后端 run suspend/finished/error | 更新 `runStatus` 和 `errorMessage`。 |

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
| `artifact` | 支持 | `id`、`type`、`name`、可选 `preview_json` | workspace 集成前直接使用事件内 preview。 |
| `context.compiled` | 支持 | step、package revision、group decisions、token report、budget | 内部可观测性；GUI/TUI 可忽略。 |
| `context.prompt-verified` | 支持 | step、model profile、prompt/input/remaining tokens | 内部可观测性；GUI/TUI 可忽略。 |
| `interaction.requested` | 支持 | interaction id、tool、payload、resume schema、`interrupt_event` | 渲染问题/计划审批并保存恢复参数。 |
| `interaction.resolved` | 支持 | interaction id、tool call id、response | 清除挂起交互。 |
| `goal.updated` | 支持 | 稳定 goal snapshot、来源 | 展示 objective 状态；可忽略。 |

### 3.8 ask_user / submit_plan 恢复

收到 `CUSTOM(name="interaction.requested")` 后，前端根据 `tool_name` 渲染：

- `ask_user`：free text、single select 或 multi select。
- `submit_plan`：approved/rejected；rejected 可附 `feedback`。

恢复时继续使用原 `threadId` 和 `runId`，并把事件中的 `interrupt_event` 原样回传：

```json
{
  "threadId": "thread-1",
  "runId": "run-1",
  "forwardedProps": {
    "command": {
      "resume": "orders",
      "interruptEvent": "<interaction.requested.value.interrupt_event>"
    }
  }
}
```

`submit_plan` 的 `resume` 为：

```json
{ "action": "approved" }
```

或：

```json
{ "action": "rejected", "feedback": "先补充回滚方案" }
```

挂起时会收到 `STATE_DELTA runStatus=suspended`，不会收到 `RUN_FINISHED`。恢复完成后才进入正常终态。

## 4. 当前不支持或不要依赖的内容

| 内容 | 状态 | 原因 / 替代方案 |
| --- | --- | --- |
| 旧自定义 SSE chat endpoint | 不支持 | 只保留 `/api/copilotkit`。 |
| 自定义事件名如 `plan.update`、`step.start`、`final`、`done` | 不支持 | 统一使用 AG-UI `EventType`。 |
| 前端直连 Data Gateway REST API | 不支持 | Data Gateway 是 agent tool 边界。 |
| 前端直连 Metadata / run_events 查询 API | 不支持 | 当前没有对外 replay/query endpoint。 |
| 前端直连 Artifact download/preview API | 不支持 | workspace 集成前，preview 只通过 AG-UI `CUSTOM(name="artifact")` 提供。 |
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
| 重复终态 run 且指纹一致 | 回放原 AG-UI event stream | 按普通 run 消费，不要重复创建本地 message。 |
| 重复 active run | `RUN_ALREADY_ACTIVE` error | 阻止重复提交并保留现有运行。 |
| run/session/request 不一致 | `RUN_*_MISMATCH` error | 视为身份冲突，不自动换 runId。 |

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
- 渲染 `CUSTOM(sql_audit)` 和 `CUSTOM(artifact)` 为审计/结果卡片；忽略未知 `CUSTOM` name。
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
| SQL audit / artifact | `CUSTOM(sql_audit)`、`CUSTOM(artifact)` |

可以后置：

| 能力 | 事件 |
| --- | --- |
| reasoning 折叠展示 | `REASONING_*` |
| encrypted reasoning | `REASONING_ENCRYPTED_VALUE` |
| message snapshot | `MESSAGES_SNAPSHOT` |
| raw debug event | `RAW` |
