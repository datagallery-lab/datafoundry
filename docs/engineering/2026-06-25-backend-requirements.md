# 对后端的能力要求（排期 + 答复）

日期：2026-06-25
提出方：`apps/web`（依据前端 UI、能力位与联调反馈整理）
受理方：`apps/api` / dataAgent 后端 / 研发 B
文档类型：**纯需求清单** —— 给后端排期与答复。**前端自己的现状**见
[前端能力现状（自述快照）](./2026-06-25-frontend-capability-status.md)。

> 快照约定：本文件为 **2026-06-25 时点冻结快照**。下一轮评审请**另开新日期文件**，不要往本文件继续追加。
> 历史合并文档（已冻结）：[能力需求清单 #1–#20](./archive/frontend-backend-capability-requests.md)、
> [后端待实现清单 O-001–O-014](./archive/backend-pending-requirements.md)。

> 本轮后端验收口径：不要求连接真实外部 PostgreSQL / MySQL / ClickHouse 服务做 E2E；以代码实现、
> 本地 fake/smoke、配置 API 与前端 adapter/reducer 测试为准。真实外部库 smoke 保留为可选验收入口。

## 状态枚举

`未排期` · `已排期` · `进行中` · `待验收` · `已完成` · `不做` · `阻塞`

## 已交付主体（不在本清单展开，仅备查）

secretRef 密钥服务、Datasource REST（含 PG/MySQL adapter 代码）、effective run_config 执行、
LLM model-profiles CRUD/test/切换、env+per-datasource 查询策略、KB local-first FTS/vector +
`retrieve_knowledge`、MCP（streamable-http/sse）挂载、Skill upload/validate/replace、
Artifact preview/download REST —— 详见
[2026-06-23 能力交付状态（已归档）](./archive/2026-06-23-frontend-backend-capability-status.md)。

## 总览

| ID | 需求 | 优先级 | 前端能力位 | 状态 |
| --- | --- | --- | --- | --- |
| [R-001](#r-001-session-级-workspace-隔离) | Session 级 Workspace 隔离 | **P1** | （无需翻位，后端调整） | 待验收 |
| [R-002](#r-002-llm-token-用量上报) | LLM Token 用量上报（AG-UI） | **P1** | 前端 reducer 已就绪 | 待验收 |
| [R-003](#r-003-pg--mysql-真实环境验收) | PG / MySQL 真实环境 E2E 验收 | P1 | `datasource.server` | 本轮完成 |
| [R-004](#r-004-artifact-北向协议收敛) | Artifact 北向协议收敛 | P2 | `artifact.export` | 待验收 |
| [R-005](#r-005-conversation-memory) | Conversation Memory 服务端权威历史 | P2 | — | 待验收 |
| [R-006](#r-006-多用户认证) | 多用户认证 / 租户隔离 | P3 | — | 待验收 |
| [R-007](#r-007-对话框文件上传) | 对话框文件上传 + 多模态图片 | **P1** | `chat.imageInput` / `chat.fileUpload` | 待验收 |
| [R-008](#r-008-db-扩展类型-adapter) | DB 扩展类型 adapter（DB-GPT） | P1 | `datasource.extendedTypes` | 部分完成 |
| [R-009](#r-009-db-高级策略) | DB 高级策略（introspection/sample/mask） | P2 | `datasource.queryPolicy` 等 | 待验收 |
| [R-010](#r-010-kb-高级-rag) | KB 高级 RAG + 半生效字段补齐 | P2 | `kb.*` | 部分完成 |
| [R-011](#r-011-llm-高级采样) | LLM 高级采样 + run timeout | P2 | `llm.advancedSampling` | 待验收 |
| [R-012](#r-012-mcp-stdio--tool-policy) | MCP stdio + tool policy | P2 | `mcp.stdio` / `mcp.toolPolicy` | 待验收 |
| [R-013](#r-013-skill-资源默认绑定) | Skill 资源默认绑定 | P3 | `skill.resourceBinding` | 待验收 |
| [R-014](#r-014-动态-schema-api) | 动态 datasource-types schema API | P2 | （由 API `enabled` 驱动占位） | 待验收 |

---

## R-001 Session 级 Workspace 隔离

| 字段 | 内容 |
| --- | --- |
| 优先级 | **P1** |
| 依赖 | 无；落地后联动 R-004、R-007 |

**问题**：Workspace 当前为 `{user}/{session}/{run}/`，run 结束 `destroyWorkspace()`，同 session
下一轮无法 `list_files` / `read_file` 上一轮产物。

**需求**：

1. 目录改为 `{workspaceRoot}/{user_id}/{session_id}/`；`run_id` 不参与 path（仍保留于
   context / 审计 / artifact metadata）。
2. run terminal 事件不再删除 session 工作区；定义回收策略（MVP 长期保留 + 可选
   `WORKSPACE_SESSION_TTL_DAYS` / 删除 session 时 `DELETE .../workspace`）。
3. 同 `(user_id, session_id)` 并发策略：MVP 建议同时仅一个 active run（与 `RUN_ALREADY_ACTIVE` 对齐）。
4. Artifact download 路径改 session 级；旧 run 级记录需兼容策略。
5. system prompt 改为「本 session 工作区跨多次 run 持久」。
6. 安全边界不退化：禁 `..` 逃逸，`execute_command` `readWritePaths` 不扩大。

**验收**：同 `threadId` 下 Run A 写入 `outputs/report.csv` 并结束 → Run B（新 `runId`）可
`list_files` / `read_file` 内容一致；跨 session / 跨 user 隔离不变；增集成测试。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 负责人 | 研发 B |
| 方案摘要 | Workspace path 已改为 `{workspaceRoot}/{user_id}/{workspace_id}/{session_id}`；`run_id` 保留在 run context / audit / artifact metadata，不参与物理目录；system prompt 改为 session 持久语义。`createRunWorkspace` 仍负责 Mastra Workspace 生命周期，但目录不随 terminal run 删除；同 `(user_id, session_id)` 仅允许一个 queued/running active run，completed run replay 不受影响；workspace smoke 覆盖同 session 跨 run 可读、跨 session / 跨 workspace 目录隔离，run identity smoke 覆盖 session active-run 互斥。 |
| 验证 | `npm run smoke:workspace`、`npm run smoke:run-identity` 通过。 |
| 关联 PR / Issue | 本轮后端提交 |

---

## R-002 LLM Token 用量上报

| 字段 | 内容 |
| --- | --- |
| 优先级 | **P1** |
| 依赖 | 无 |

**问题**：前端已消费 `CUSTOM(name="token_usage")`，后端未 emit。`context.prompt-verified` /
`context.compiled` 仅为上下文预算，**不是** LLM 真实计费用量。

**需求**：LLM 调用完成（或 run 收尾）经 AG-UI `CUSTOM` 上报：

```json
{ "type": "CUSTOM", "name": "token_usage", "value": { "input_tokens": 1200, "output_tokens": 340 } }
```

字段：`input_tokens` / `output_tokens`（优先），别名 `prompt_tokens` / `completion_tokens`；可选
`tool_call_id` / `step_id`（优先精确匹配）/ `step_number`（兜底近似）/ `model` / `cost_usd`。
应优先取 provider 响应 `usage`，非本地估算；同 run 多次调用分次 emit（前端累加）。

**验收**：含 LLM 的 run 结束后前端概览显示真实 Token；`run_events` 可查到至少一条事件；数字与
provider `usage` 一致。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 负责人 | 研发 B |
| 方案摘要（emit 位置） | 在 Mastra fullStream normalizer hook 中捕获 provider `usage`，投影为 AG-UI `CUSTOM(name="token_usage")`；字段包含 `input_tokens` / `output_tokens` 及 `prompt_tokens` / `completion_tokens` 别名。只使用 provider usage，不使用 context budget，也不把累计 `totalUsage` 当增量上报。 |
| 验证 | `npm run smoke:agui-stream` 覆盖 provider usage chunk 到 `token_usage` custom event；`npm --workspace @open-data-agent/web run test -- live-run-state` 覆盖前端 reducer 消费。 |
| 关联 PR / Issue | 本轮后端提交 |

---

## R-003 PG / MySQL 真实环境验收

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| 依赖 | 用户侧只读 PG/MySQL 实例 |

**问题**：REST 与 adapter 代码已有（`postgresql` / `mysql` `enabled: true`），缺真实库 E2E smoke。

**需求**：真实实例跑通 `create → test → introspect → inspect_schema → run_sql_readonly`；失败返回
结构化错误码；记录验收日期与环境。验收通过后翻 `datasource.server`。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 本轮完成（真实外部库 E2E 不纳入本轮验收） |
| 已完成 | REST 创建/测试入口、`postgresql` / `mysql` datasource type、Data Gateway adapter 代码和 `datasource.server` capability 已存在；配置面已可保存连接参数与 secretRef。 |
| 本轮边界 | 真实 PG / MySQL 实例 smoke 保留为可选入口：配置 `ODA_E2E_PG_*` / `ODA_E2E_MYSQL_*` 后，`npm run smoke:server-datasources` 会执行 `create → test → introspect → schema → inspectSchema → runSqlReadonly`。本轮交付不要求真实外部库 E2E。 |
| 验证 | `npm run smoke:config-api` 覆盖 REST / capability / secretRef 配置面；`npm run smoke:data-gateway` 覆盖本地 adapter 基础链路。 |
| 验收日期 | 2026-06-25（按本轮验收口径） |

---

## R-004 Artifact 北向协议收敛

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 依赖 | R-001（file 下载路径） |

**问题**：REST preview/download 已实现；AG-UI `artifact` 事件仍偏大；file download 仍按 run 级路径。

**需求**：

1. 北向事件改为 id + 摘要引用，大内容走 REST。
2. R-001 后 download 改 session 级路径；legacy 记录兼容。
3. （可选）完整文件 copy + hash 落库。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 已完成 | `LocalArtifactService` 已支持 artifact preview / content / download REST；agent `publish_artifact`、SQL result artifact 与 workspace artifact recorder 都统一 emit 瘦身后的 AG-UI `CUSTOM(name="artifact")`。事件只携带 `id`、`type`、`name`、`title`、`summary`、`preview_available`，以及可选 `download_url` / `file_id`，不再携带 `preview_json` 大字段；GUI/TUI 需要展示完整 preview 时调用 `/api/v1/artifacts/:id/preview`，下载调用 `/api/v1/artifacts/:id/download`。物理 workspace 已随 R-001 改为 session 级，文件资产继续由 FileAssetRef 统一去重/引用。 |
| 兼容边界 | REST `GET /api/v1/artifacts/:id` 仍返回 artifact summary 与可选 `preview_json`，用于详情页和调试；北向实时 AG-UI event 已收敛为 id + 摘要引用。前端 reducer 可继续兼容历史 run events 中带 `preview_json` 的旧事件。 |
| 后续事项 | Phase 2 只剩 legacy run 级 `storage_path` artifact 的迁移/兼容清理；完整文件 copy + hash 已由 FileAsset / FileAssetRef 底座承担，后续如需强制所有 artifact 都关联 FileAssetRef，可另开迁移任务。 |
| 验证 | `npm run smoke:agent` 覆盖 artifact event 不带 `preview_json`；`npm run smoke:files` 覆盖 FileAssetRef / artifact download 底座；`npm --workspace @open-data-agent/web run test -- live-run-state` 覆盖瘦身 artifact event 解析。 |

---

## R-005 Conversation Memory

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 依赖 | CopilotKit / Mastra 历史所有权方案 |

**问题**：Run 仍信任客户端回传全量 `messages`；conversation Memory 未作为服务端权威。

**需求**：按 `user_id + threadId` 管理权威历史；tool-call/result 配对与稳定 message ID；与
Knowledge 职责边界文档化。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 方案摘要 | 普通新 run 不再把客户端回传的全量 `messages` 当权威历史；`run-memory-assembly` 会先持久化当前 user message，再从 metadata `conversation_messages` / `conversation_summaries` 构建本轮模型输入窗口。assistant 文本在 completed flush 时写回 metadata，summary 与 Mastra WorkingMemory 采用 one-source-only 策略。新增 `GET /api/v1/sessions/:sessionId/conversation`，前端可读取服务端权威 messages、latest summary、run event refs，以及从持久化 AG-UI `TOOL_CALL_*` 事件配对出的 tool-call/result 列表。 |
| 验证 | `npm run smoke:config-api` 覆盖 conversation REST；conversation memory 纯服务逻辑由 `npm run smoke:conversation-memory` 覆盖。 |

---

## R-006 多用户认证

| 字段 | 内容 |
| --- | --- |
| 优先级 | P3 |
| 依赖 | 认证方案选型 |

**需求**：用户认证 + 配置 / run / artifact / workspace 按 `(workspaceId, userId)` 隔离。

**验收**：不同用户互不可见配置与会话；跨用户访问 403。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 当前实现 | local-first 认证已接入：无认证头默认 `dev-user/default`；`Authorization: Bearer <dev_token>` 或 `X-Dev-Token` 按 metadata `users.dev_token` 解析用户；`X-Workspace-Id` 选择 workspace。配置 API、CopilotKit run、run-config-resolver、AgentRunContext、workspace 物理目录、FileAssetRef、Artifact、Skill package materialization、Knowledge policy/retrieval 均显式携带 `workspaceId`。`data_sources` 已迁移为 `(user_id,id)` 复合主键，同名 datasource id 可跨用户复用且互不可见。无效 token 返回 401。 |
| 认证方案 | 当前为本地优先方案，不绑定第三方 auth。产品化时可由上层 BFF/session auth 解析用户，再把 `(workspaceId, userId)` 注入同一 API context；后端内部隔离边界已按该模型贯穿。 |
| 验收覆盖 | `smoke-config-api` 覆盖无效 token 401、tenant token 创建 datasource、dev-user 不可见 tenant datasource、同 user 不同 workspace 不可见 KB；`smoke-workspace-tools` 覆盖同 user 跨 workspace 物理目录隔离。真实 403/401 语义后续可随正式 auth 网关调整。 |
| 验证 | `npm run smoke:config-api`、`npm run smoke:workspace` 通过。 |

---

## R-007 对话框文件上传

| 字段 | 内容 |
| --- | --- |
| 优先级 | **P1** |
| 依赖 | R-001（#13b 强依赖 session 工作区） |
| 设计规格 | [chat-file-upload-design](../superpowers/specs/2026-06-24-chat-file-upload-design.md) |

**问题**：无 chat 上传端点；`extractLastUserText` 忽略非文本 part；`GET /capabilities` 未返回
`chat.imageInput` / `chat.fileUpload`。

**需求**：

1. **图片多模态**：run 入口消费 message `type:"image"` part，转交多模态 LLM；翻 `chat.imageInput`。
2. **文件上传端点**：`POST /api/v1/chat/uploads`（multipart），写入 session 工作区
   `uploads/`，返回 `{ path, mimeType, size }`；翻 `chat.fileUpload`。
3. 安全：session 隔离、禁路径逃逸、限大小/类型。

**验收**：图片提问 LLM 能据图作答；CSV 上传后 Agent 可 `read_file` 分析。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 与 R-001 联动 | `POST /api/v1/chat/uploads` 写入同一 session workspace 的 `uploads/`；前端上传请求带 `sessionId/threadId`，返回 `{ path, mimeType, size }` 后 agent 可通过 workspace `read_file` 读取。Ingress message normalization 会把 `uploads/...` 的 AG-UI document/url part 投影为模型可见的 read_file path 提示，同时保留原始 part。Capabilities 已翻 `chat.fileUpload` / `chat.imageInput`。图片 part 继续按 AG-UI multimodal content 透传给 Mastra/model。 |
| 验证 | `npm run smoke:config-api` 覆盖 chat upload；`npm run test:ingress-messages` 覆盖 ingress part normalization。 |

---

## R-008 DB 扩展类型 adapter

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| 依赖 | `packages/data-gateway` |
| 前端占位 | `datasource.extendedTypes` |

**需求**：实现只读 adapter：ClickHouse → Oracle → SQL Server → Hive / Spark / Vertica；
BigQuery / Snowflake 可第二批。类型启用后 `supportTypes()` / capabilities / `datasource-types`
返回 `enabled: true`，前端关闭「待后端」占位。

**验收**：ClickHouse 源 test → introspect → `run_sql_readonly` 跑通；选扩展类型 run 时不再 throw。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 部分完成 |
| 当前边界 | ClickHouse 第一批 adapter 已实现：HTTP JSON 只读连接、`testConnect`、`inspectSchema`、`previewTable`、`run_sql_readonly` 统一走 Data Gateway SQL guard / limit / timeout / mask / allowlist 策略；`/api/v1/datasource-types` 对 ClickHouse 返回 `enabled: true`，capabilities 返回 `datasource.extendedTypes: true`。Oracle / SQL Server / Hive / Spark / Vertica / BigQuery / Snowflake 仍未实现，前端应继续显示“待后端”或不展示为可用。 |
| 分批计划 | 第二批建议做 Oracle / SQL Server；第三批做 Hive / Spark / Vertica。BigQuery / Snowflake 需要云凭据与成本策略，放第二阶段之后。 |
| 本轮边界 | 已用本地 fake ClickHouse HTTP server 覆盖 schema / preview / readonly SQL smoke；真实 ClickHouse 实例 E2E 保留为可选入口：配置 `ODA_E2E_CLICKHOUSE_*` 后，`npm run smoke:server-datasources` 会执行真实 ClickHouse `create → test → introspect → schema → inspectSchema → runSqlReadonly`。 |
| 验证 | `npm run smoke:data-gateway` 覆盖 fake ClickHouse adapter；`npm run smoke:config-api` 覆盖 `/api/v1/datasource-types` 与 capability 暴露。 |

---

## R-009 DB 高级策略

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `datasource.queryPolicy` · `datasource.introspectionPolicy` · `datasource.samplePolicy` · `datasource.fieldMasking` |

**待消费字段**（REST 已可写入）：

| 字段 | 期望行为 |
| --- | --- |
| `introspection.tableAllowlist` | 限制 schema 抓取表范围；preview / SQL 也会阻止越界表 |
| `introspection.refreshIntervalSec` | schema 快照自动刷新 |
| `queryPolicy.denyWrite` | 从 per-datasource 读取；`run_sql_readonly` 仍强制只读，不因关闭该字段放开写 SQL |
| `maskFields` | preview / SQL 结果字段脱敏 |
| `samplePolicy.allowSample` / `maxSampleRows` | 采样预览策略 |

**验收**：改配置后 introspect / preview / SQL 结果与策略一致。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 实现入口 | `config-api` 同时接受 datasource 策略字段位于 `config` 内或 PATCH 顶层，并对策略对象做浅合并，避免局部更新误删其他策略字段；`LocalDataGateway` 在 `inspectSchema` / `previewTable` / `runSqlReadonly` 统一读取并执行 table allowlist、sample policy、maskFields。`GET /datasources/:id/schema` 在快照不存在或超过 `introspection.refreshIntervalSec` 时自动刷新。Capabilities 已翻 `datasource.introspectionPolicy` / `datasource.samplePolicy` / `datasource.fieldMasking`。 |
| 验证 | `npm run smoke:config-api` 覆盖配置 API 字段保存/回显；`npm run smoke:data-gateway` 覆盖 Gateway 策略执行。 |

---

## R-010 KB 高级 RAG

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `kb.vectorStore` · `kb.rerank` · `kb.citationPolicy` · `kb.chunking` · `kb.graphRag` · `kb.scope` |

**B 档（全新能力）**：`vectorStore`（chroma/milvus/pgvector/elasticsearch）、`rerankEnabled` +
`rerankModel`、`citationRequired`、`chunkSize`/`chunkOverlap`（当前硬编码）、`graphRagEnabled`、
`scope`（personal/workspace/project）。

**半生效缺口**（已落库，run 未完整消费）：

| 字段 | 现状 | 后端待补 |
| --- | --- | --- |
| `retrievalTopK` | payload 可存 | `retrieve_knowledge` / search 默认读 KB 配置，而非固定 5 |
| `scoreThreshold` | payload 可存 | retrieve 结果按阈值过滤 |

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 部分完成（embedding 已 per-KB；`retrievalTopK` / `scoreThreshold` 已由 `retrieve_knowledge` / search 消费；`chunkSize` / `chunkOverlap` / `citationRequired` / `scope` 已可写入、回显并翻能力；外部 vectorStore、rerank、graphRag 未实现） |
| 分批计划 | 已补齐半生效字段：检索默认 topK 从 KB 配置读取，run / API 显式 `top_k` 仍可覆盖；结果按 `scoreThreshold` 过滤。新增 chunk policy 消费：`LocalKnowledgeService.ingestText` 按当前 workspace KB payload 的 `chunkSize` / `chunkOverlap` 分块，search / reindex / run-time `retrieve_knowledge` 均传入 `workspace_id`。Capabilities 已翻 `kb.chunking` / `kb.citationPolicy` / `kb.scope`。后续再分批处理外部 vectorStore、rerank、graphRag。 |
| 验证 | `npm run smoke:knowledge-policy` 覆盖 topK / score threshold / chunk policy；`npm run smoke:config-api` 覆盖 KB REST 字段。 |

---

## R-011 LLM 高级采样

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `llm.advancedSampling` |

**待消费字段**：

| 字段 | 说明 |
| --- | --- |
| `topP` / `frequencyPenalty` / `presencePenalty` | 传入 run `modelSettings` |
| `reasoningModel` | reasoning 模型标记 |
| `contextLength` | 上下文窗口 / 预算提示 |
| `timeoutMs` | profile `/test` 与 run 阶段均消费；run 超时后进入 failed / `RUN_ERROR` |

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 方案摘要 | `run-config-resolver` 从 model-profile payload 读取采样字段并夹取到 Mastra/AI SDK 合法区间，`agent-runtime` 通过 `defaultOptions.modelSettings` 透传。`timeoutMs` 解析为 run 级超时，超时后取消 Mastra stream 并发 `runStatus=failed` / `RUN_ERROR`。`contextLength` 转成 run-scoped `ModelContextProfile` 注入现有 ContextPackage / planner / prompt guard 通路，`context.compiled` 预算使用该窗口。`reasoningModel` 作为 profile 标记保存、回显，并进入 `run.config.resolved` 诊断元数据；当前不切换独立 reasoning provider。Capabilities 已翻 `llm.samplingParams` / `llm.advancedSampling`。 |
| 验证 | `npm run smoke:config-api` 覆盖 model profile 字段、effective run config 与 run timeout；`npm run smoke:copilotkit-run` 覆盖 run timeout AG-UI 终态。 |

---

## R-012 MCP stdio + tool policy

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `mcp.stdio` · `mcp.toolPolicy` |

**已交付**：

| 项 | 现状 |
| --- | --- |
| `transport=stdio` | 支持 SDK `StdioClientTransport`；`serverUrl` 可填启动命令，也可用 payload `command/args/cwd/env`。 |
| `toolAllowlist` | 保存为 MCP server payload；`/test`、`/tools`、run-time tool 注入和 `mcpRuntime.toolNames` 都按 raw tool name 或 `mcp__server__tool` 过滤。 |
| 单工具 `timeoutMs` | 保存并用于 listTools / callTool timeout，范围 1s 到 10min。 |
| result-size 上限 | MCP observation 进入下一轮模型上下文时经 `McpToolObservationAdapter` 和 ContextPackage 预算治理；默认模型可见内容约 12k chars，超限生成结构化 truncation 记录。 |

**已交付（不重复）**：sse / streamable-http、`authType=bearer` + token、tools manifest REST。
**北向边界**：AG-UI `TOOL_CALL_*` / continuation 事件仍保持 middleware 原生语义，不包私有
MCP envelope；result-size 治理只作用于下一轮模型可见 context，不修改前端收到的原始
`TOOL_CALL_RESULT`。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 方案摘要 | 新增 `PolicyMcpMiddleware`，保持北向 AG-UI `TOOL_CALL_*` / continuation 语义不变，补齐当前 `@ag-ui/mcp-middleware@0.0.1` 缺失的 stdio、tool allowlist、单调用 timeout。MCP tool observation 统一走 ContextPackage/tool observation 预算治理。配置 API capabilities 已翻开 `mcp.stdio` / `mcp.toolPolicy`。 |
| 验证 | `npm run smoke:config-api` 覆盖 MCP 配置/test/tools allowlist；MCP observation 预算由 `npm run smoke:context-compilation` 覆盖。 |

---

## R-013 Skill 资源默认绑定

| 字段 | 内容 |
| --- | --- |
| 优先级 | P3 |
| 前端占位 | `skill.resourceBinding` |

**待消费字段**：`defaultDbIds` / `defaultKbIds` / `defaultMcpIds` / `modelProfileId` —— Skill 激活时
注入 `effectiveRunConfig` 默认启用集，无需用户手动 session 配置。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| 实现入口 | Skill DTO payload 保留 `defaultDbIds` / `defaultKbIds` / `defaultMcpIds` / `modelProfileId`；选中 skill 后 `run-config-resolver` 将默认资源并入 effective run config。未显式指定 active datasource / LLM 时，skill 的第一个 `defaultDbIds` / `modelProfileId` 成为 active 项；显式 run 选择优先。Capabilities 已翻 `skill.resourceBinding`。 |
| 验证 | `npm run smoke:config-api` 覆盖 skill 默认资源绑定、显式 run 选择优先和 resource revision。 |

---

## R-014 动态 schema API

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 依赖 | R-008 类型扩展 |

**需求**：新增 `GET /api/v1/datasource-types`（或等价 REST），返回 `name` / `label` / `enabled` /
`parameters[]`（name/label/type/required/options），与 `SUPPORTED_DATA_SOURCE_TYPES` 对齐。
可选 `GET /api/v1/knowledge-base-types`；前端占位由该 API 的 `enabled` 驱动自动关闭。

**验收**：后端新增 adapter 后，前端无需发版即可在下拉出现或自动取消「待后端」。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 待验收 |
| API 草案链接 | `GET /api/v1/datasource-types` 已实现，返回 Data Gateway `supportTypes()` 的 `name` / `label` / `enabled` / `description` / `parameters[]`。当前已实现 adapter 才标 enabled：DuckDB / SQLite / CSV / XLSX / PostgreSQL / MySQL / ClickHouse；其他扩展类型不标 enabled。详见 [config-management-api.md](./config-management-api.md)。 |
| 验证 | `npm run smoke:config-api` 覆盖 `/api/v1/datasource-types`；`npm --workspace @open-data-agent/web run test -- config-api-adapter chat-capabilities` 覆盖前端 adapter / capability 映射。 |

---

## 建议排期顺序

1. **第一波（体验阻塞）**：R-001 Session Workspace → R-007 对话框上传（依赖 R-001）→ R-002 Token 用量。
2. **第二波（配置可信度）**：R-003 PG/MySQL 真实验收 → R-010 KB 半生效字段 → R-011 run timeout。
3. **第三波（DB-GPT 扩展）**：R-008 扩展 DB 类型 → R-014 动态 schema → R-009 DB 高级策略 →
   R-010 KB B 档 → R-011 LLM B 档 → R-012 MCP stdio → R-013 Skill 绑定。
4. **第四波（产品化）**：R-004 Artifact 北向收敛 → R-005 Conversation Memory → R-006 多用户认证。

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-06-25 | 从原 `frontend-backend-capability-requests.md` / `backend-pending-requirements.md` 拆出「对后端的要求」独立快照；O-00x 重编为 R-00x；前端现状移入前端自述文档 |
