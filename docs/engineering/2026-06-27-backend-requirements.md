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
| [R-028](#r-028-会话-llm-短标题) | 会话 LLM 短标题 | P1 | 已消费 `session.title` 事件，能力位默认 false | 未排期 |
| [R-029](#r-029-会话手动重命名持久化) | 会话手动重命名持久化 | P1 | 已有本地 inline 重命名 | 未排期 |
| [R-030](#r-030-服务端权威会话列表) | 服务端权威会话列表 | P2 | 当前仍 localStorage 管理会话列表 | 未排期 |
| [R-031](#r-031-数据结果服务端导出) | 数据结果服务端导出 | P2 | 已支持当前预览 CSV 前端导出 | 未排期 |
| [R-032](#r-032-schema-浏览器数据契约) | Schema 浏览器数据契约 | P2 | 待前端新增 schema 浏览器 | 未排期 |
| [R-033](#r-033-agent-run-取消信号) | Agent run 取消信号 | P1 | 前端缺停止按钮，需后端确认 abort 语义 | 未排期 |
| [R-034](#r-034-查询历史与-sql-收藏) | 查询历史与 SQL 收藏 | P3 | 待前端新增历史 / 收藏 UI | 未排期 |

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
