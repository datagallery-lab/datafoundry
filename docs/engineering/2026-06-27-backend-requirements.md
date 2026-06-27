# 对后端的能力要求（2026-06-27 增量）

日期：2026-06-27  
提出方：`apps/web`（依据本轮会话命名与数据结果交互增强整理）  
受理方：`apps/api` / dataAgent 后端  
文档类型：**增量需求清单** —— 只记录 2026-06-27 新增或需要稳定的后端能力。历史主体见
[2026-06-25 后端需求快照](./2026-06-25-backend-requirements.md) 与
[2026-06-26 后端需求增量](./2026-06-26-backend-requirements.md)。

## 状态枚举

`未排期` · `已排期` · `进行中` · `待验收` · `已完成` · `不做` · `阻塞`

## 总览

| ID | 需求 | 优先级 | 前端状态 | 状态 |
| --- | --- | --- | --- | --- |
| [R-028](#r-028-会话-llm-短标题) | 会话 LLM 短标题 | P1 | 已消费 `session.title` 事件，能力位默认 false | 已完成 |
| [R-029](#r-029-会话手动重命名持久化) | 会话手动重命名持久化 | P1 | 已有本地 inline 重命名 | 已完成 |
| [R-030](#r-030-服务端权威会话列表) | 服务端权威会话列表 | P2 | 当前仍 localStorage 管理会话列表 | 已完成 |
| [R-031](#r-031-数据结果服务端导出) | 数据结果服务端导出 | P2 | 已支持当前预览 CSV 前端导出 | 已完成 |
| [R-032](#r-032-schema-浏览器数据契约) | Schema 浏览器数据契约 | P2 | 待前端新增 schema 浏览器 | 已完成 |
| [R-033](#r-033-agent-run-取消信号) | Agent run 取消信号 | P1 | 前端缺停止按钮，需后端确认 abort 语义 | 已完成 |
| [R-034](#r-034-查询历史与-sql-收藏) | 查询历史与 SQL 收藏 | P3 | 待前端新增历史 / 收藏 UI | 已完成 |

---

## R-028 会话 LLM 短标题

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| Capability | `conversation.title` |
| 前端能力 | 已在 reducer 消费 `CUSTOM(name="session.title")`，只覆盖非手动标题 |

**问题：** 当前后端 `sessions.title` 仅在首次 run 时用用户输入前 80 字规则截断写入，且不通过 API 返回给前端；前端会话标题默认「新数据任务」，与主流 Agent 的「首问后模型生成短标题」体验不一致。

**需求：**

1. 首次用户提问后，后端用轻量 LLM 生成 3-8 字中文短标题，避免泄露敏感值，避免末尾标点。
2. 通过 AG-UI 上报：

```json
{
  "type": "CUSTOM",
  "name": "session.title",
  "value": {
    "session_id": "thread-1",
    "title": "渠道订单分析",
    "source": "llm"
  }
}
```

3. 更新 `sessions.title`，并在 `GET /api/v1/sessions/:sessionId/conversation` 返回 `title`（可选同时返回 `titleSource` / `updatedAt`）。
4. `GET /api/v1/capabilities` 翻 `conversation.title: true` 后，前端才消费该事件。
5. 若 LLM 标题生成失败，保留现有规则截断标题或不 emit，不影响主 run。

**验收：** 新会话第一次提问后，左侧标题先显示前端占位，随后被后端短标题覆盖；用户手动改名后再次收到 `session.title` 不覆盖。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | `sessions.title` 不再在创建 session 时直接使用首问截断作为权威标题。新 run 的 `RUN_STARTED` 后异步启动 `startSessionTitleTask`，用当前模型生成 3-8 字短标题；失败时使用安全截断 fallback，不阻塞主 agent run。标题写入 `sessions.title`，`title_source` 为 `llm` 或 `fallback`。若用户已手动设置标题（`title_source=user`），自动标题不会覆盖。生成成功且 stream 仍活跃时 emit `CUSTOM(name="session.title")`，payload 包含 `session_id`、`title`、`source`。`GET /api/v1/capabilities` 已翻 `conversation.title: true`。 |
| 边界 | 标题生成是 best-effort 后台任务；run 已结束或用户手动改名后不会强行 emit/覆盖。 |
| 验证 | `npm run build` 通过；会话标题链路由 `session-title.ts`、`SessionRepository.updateAutoTitleIfAllowed` 与 `server.ts RUN_STARTED` 分支实现。 |

---

## R-029 会话手动重命名持久化

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| 前端能力 | 已支持本地 inline 重命名 |

**需求：**

1. 新增 `PATCH /api/v1/sessions/:sessionId`：

```json
{
  "title": "我的复盘"
}
```

2. `SessionRepository` 增加 update/patch 方法，写入 `sessions.title` 与 `updated_at`。
3. 标记用户手动标题优先级，避免后续自动标题覆盖。可用 `title_source = "user"` 字段，或在 metadata payload 中记录。
4. 返回稳定 DTO：

```json
{
  "id": "thread-1",
  "title": "我的复盘",
  "titleSource": "user",
  "updatedAt": "2026-06-27T..."
}
```

**验收：** 前端手动重命名后刷新页面 / 换设备加载同一用户会话列表时仍显示新标题。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | 新增 `PATCH /api/v1/sessions/:sessionId`，body `{ "title": "..." }`。后端写入 `sessions.title`、`updated_at`，并将 `title_source` 标记为 `user`，从而阻止后续自动标题覆盖。返回稳定 DTO：`id`、`title`、`titleSource`、`updatedAt`。标题会被 trim 并限制到 80 字。 |
| 验证 | `npm run build` 通过；API 实现在 `apps/api/src/config-api.ts#handleSessionRequest`，持久化实现在 `SessionRepository.updateTitle`。 |

---

## R-030 服务端权威会话列表

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | 当前会话列表仍由 `localStorage` 管理 |

**需求：**

1. 新增 `GET /api/v1/sessions?limit=&cursor=`，返回当前 user/workspace 下的 session 列表。
2. DTO 至少包含：

```json
{
  "sessions": [
    {
      "id": "thread-1",
      "threadId": "thread-1",
      "title": "渠道订单分析",
      "titleSource": "llm",
      "createdAt": "2026-06-27T...",
      "updatedAt": "2026-06-27T...",
      "lastMessageAt": "2026-06-27T..."
    }
  ],
  "nextCursor": null
}
```

3. 列表排序建议按 `updated_at DESC` 或 `lastMessageAt DESC`。
4. 前端可保留 localStorage 作为离线 / 未登录兜底，但服务端返回后应以服务端为准。

**验收：** 刷新页面后左栏恢复后端会话列表；跨设备同用户可看到同一组会话标题。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | 新增 `GET /api/v1/sessions?limit=&cursor=`。返回当前 `user_id` 下会话列表，DTO 包含 `id`、`threadId`、`title`、`titleSource`、`createdAt`、`updatedAt`、`lastMessageAt`，并支持基于 `last_message_at/updated_at + id` 的 cursor 分页。`run-memory-assembly` 在写入用户消息和 assistant flush 后更新 `sessions.last_message_at`，列表按最近消息时间倒序。 |
| 边界 | 当前列表按 user 维度查询；workspace 选择仍由现有 API context 承载，正式多 workspace 产品形态如需“按 workspace 列 session”可再细化过滤字段。 |
| 验证 | `npm run build` 通过；API 实现在 `apps/api/src/config-api.ts#handleSessionRequest`，Repository 实现在 `SessionRepository.list/touchLastMessage`。 |

---

## R-031 数据结果服务端导出

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | 当前仅能导出已加载预览行 |

**需求：**

1. 对 dataset artifact 提供服务端导出接口，例如 `GET /api/v1/artifacts/:id/download?format=csv|xlsx`。
2. 导出应覆盖完整结果集，而非仅当前 preview rows。
3. 大结果导出建议异步 job，返回 job id，并复用现有 jobs 轮询 / 取消能力。

**验收：** 大于 preview 行数的 SQL 结果可导出完整 CSV / XLSX，导出期间前端可显示进度。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | 同步导出：`GET /api/v1/artifacts/:id/download?format=csv|xlsx` 与 `/content?format=csv|xlsx` 已支持服务端 CSV/XLSX 导出。SQL result artifact 由 Data Gateway 写入完整执行结果 backing CSV，并同步保留 `preview_json`；下载优先基于 backing file，而不是前端已加载预览行。异步导出：新增 `POST /api/v1/artifacts/:id/export`，body `{format:"csv"|"xlsx", idempotencyKey?}`，创建 `type=artifact-export` 的 config job，后台生成导出文件并写入 FileAsset 去重层。前端通过 `GET /api/v1/jobs/:jobId` 轮询，完成后 `job.result` 返回 `fileId`、`downloadUrl`、`filename`、`format`、`mimeType`、`sizeBytes`；`POST /api/v1/jobs/:jobId/cancel` 可取消 queued/running job。 |
| 边界 | 异步导出物化的是 artifact 当前 backing file / preview 能代表的数据。当前 SQL artifact backing CSV 是该次 SQL 执行的完整返回结果；如果未来需要“不依赖已有 artifact、重新执行 SQL 导出超大结果”，应另建 datasource/sql export job。 |
| 验证 | `npm run build` 通过；导出实现位于 `apps/api/src/config-api.ts#handleArtifactRequest` 与 `queueArtifactExportJob`，XLSX 使用 `write-excel-file`。 |

---

## R-032 Schema 浏览器数据契约

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | 待新增左栏 / 对话框 schema 浏览器 |

**需求：**

1. 稳定 `GET /api/v1/datasources/:id/schema` 返回表、字段、类型、描述、样本可用性。
2. 支持 query：`q=` 搜索表/字段、`includeStats=true` 返回行数/大小等轻量统计。
3. 字段 DTO 建议包含：

```json
{
  "table": "orders",
  "columns": [
    { "name": "order_id", "type": "varchar", "nullable": false, "description": "订单 ID" }
  ]
}
```

**验收：** 前端无需发起 Agent run 即可浏览表字段，并把字段/表名插入对话框。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | `GET /api/v1/datasources/:id/schema` 返回 schema browser DTO。支持 `q=` 按表名/字段名过滤，支持 `includeStats=true` 返回轻量统计字段（如 `rowCount`、`sizeBytes`，取决于 adapter/schema payload 是否提供）。DTO 同时保留兼容字段：`datasourceId`/`datasource_id`、`tables[]`，表项包含 `name`、`table`、`description?`、`sampleAvailable`、`columns[]`，列项包含 `name`、`type`、`nullable?`、`description?`。schema 快照缺失或过期时会走 Data Gateway introspection 刷新。 |
| 边界 | 行数/大小统计不是所有 adapter 都能低成本提供；当前 `includeStats=true` 只在已有 payload 中存在统计时返回，不为统计额外执行昂贵查询。 |
| 验证 | `npm run build` 通过；DTO 实现在 `apps/api/src/config-api.ts#schemaBrowserDto`。 |

---

## R-033 Agent run 取消信号

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| 前端能力 | 待新增停止按钮 |

**需求：**

1. 明确 CopilotKit 客户端 abort 是否能可靠取消后端 Mastra stream、SQL/tool 调用和 workspace 命令。
2. 若不能，仅前端断开 SSE 不够，需要新增 run cancel 入口或在 `/api/copilotkit` request abort 时传播 `AbortSignal`。
3. 取消后应 emit 结构化终态（例如 `RUN_ERROR` code=`RUN_CANCELLED` 或 `RUN_FINISHED` status=`cancelled`），避免前端一直停留 running。

**验收：** 用户点击停止后，长 SQL / 长工具调用不会继续占用后端资源；前端状态进入「已取消」或「失败（已取消）」并可继续下一轮。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | 新增 `POST /api/v1/runs/:runId/cancel`，通过 process-local `RunCancelRegistry` 查找 active run。取消时标记 terminal、清 run timeout、unsubscribe Mastra AG-UI stream、调用 `RunFinalizer.cancelRun`，落库 `runs.status=canceled`，emit `runStatus=canceled` delta，并发送 `RUN_FINISHED status="cancelled"`。每个 run 创建 `AbortController`，signal 经 `createRunAgentAssembly -> createDataAgent -> data tools -> DataGateway -> adapter` 传递。`run_sql_readonly`/`inspect_schema`/`preview_table` 和自定义 artifact/workspace asset tools 均检查 signal；SQL audit 支持 `status=canceled`。Adapter 侧：ClickHouse 走 `fetch(signal)`；PostgreSQL abort 时 `client.release(true)` 销毁当前连接并保留 `statement_timeout`；MySQL abort 时 `connection.destroy()` 并保留 query timeout；CSV/XLSX/demo 在读取/解析阶段 cooperative cancel；SQLite `node:sqlite DatabaseSync` 只能执行前 cooperative cancel，hard cancel 需要 worker thread 隔离。 |
| 边界 | CopilotKit/`@ag-ui/mastra` wrapper 当前没有完整把 `abortSignal` 透传进 `agent.stream`，所以 LLM provider 层 hard cancel 仍依赖 unsubscribe/连接关闭语义；Mastra 原生 workspace `execute_command` 的终止能力依赖其 workspace/sandbox 实现与 timeout。 |
| 验证 | `npm run build` 通过；核心实现位于 `apps/api/src/run-cancel-registry.ts`、`server.ts`、`run-finalizer.ts`、`packages/agent-runtime/src/tools/data-tools.ts`、`packages/data-gateway/src/index.ts`。 |

---

## R-034 查询历史与 SQL 收藏

| 字段 | 内容 |
| --- | --- |
| 优先级 | P3 |
| 前端能力 | 待新增查询历史 / 收藏 UI |

**需求：**

1. 后端记录成功执行的 SQL：`session_id`、`datasource_id`、`sql`、`row_count`、`elapsed_ms`、`created_at`。
2. 新增查询历史端点，例如 `GET /api/v1/query-history?sessionId=&datasourceId=`。
3. 支持收藏 / 取消收藏 SQL，便于后续复用。

**验收：** 前端可在数据任务中复用历史 SQL，并把常用 SQL 收藏到工作区。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 方案摘要 | Data Gateway 在 `runSqlReadonly` 成功后写入 `query_history`：`session_id`、`run_id`、`datasource_id`、`sql_text`、`row_count`、`elapsed_ms`、`created_at/updated_at`。新增 REST：`GET /api/v1/query-history?sessionId=&datasourceId=&favorite=&limit=` 返回历史 SQL；`POST /api/v1/query-history/:id/favorite`、`POST /api/v1/query-history/:id/unfavorite`、`PATCH /api/v1/query-history/:id {favorite}` 支持收藏/取消收藏。记录按 `(user_id, workspace_id)` 隔离，重复 SQL 采用幂等 upsert，保留 favorite 状态。 |
| 边界 | 查询历史当前是独立历史/收藏能力，尚未接入 memory/context 作为模型可见上下文；后续如要让 agent 主动复用历史 SQL，应通过 ContextPackage source 接入，避免平行 prompt 通路。 |
| 验证 | `npm run build` 通过；Repository 位于 `QueryHistoryRepository`，REST 位于 `apps/api/src/config-api.ts#handleQueryHistoryRequest`。 |
