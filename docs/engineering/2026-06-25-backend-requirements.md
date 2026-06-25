# 对后端的能力要求（排期 + 答复）

日期：2026-06-25
提出方：`apps/web`（依据前端 UI、能力位与联调反馈整理）
受理方：`apps/api` / dataAgent 后端 / 研发 B
文档类型：**纯需求清单** —— 给后端排期与答复。**前端自己的现状**见
[前端能力现状（自述快照）](./2026-06-25-frontend-capability-status.md)。

> 快照约定：本文件为 **2026-06-25 时点冻结快照**。下一轮评审请**另开新日期文件**，不要往本文件继续追加。
> 历史合并文档（已冻结）：[能力需求清单 #1–#20](./archive/frontend-backend-capability-requests.md)、
> [后端待实现清单 O-001–O-014](./archive/backend-pending-requirements.md)。

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
| [R-001](#r-001-session-级-workspace-隔离) | Session 级 Workspace 隔离 | **P1** | （无需翻位，后端调整） | 未实现 |
| [R-002](#r-002-llm-token-用量上报) | LLM Token 用量上报（AG-UI） | **P1** | 前端 reducer 已就绪 | 待确认 |
| [R-003](#r-003-pg--mysql-真实环境验收) | PG / MySQL 真实环境 E2E 验收 | P1 | `datasource.server` | 部分完成 |
| [R-004](#r-004-artifact-北向协议收敛) | Artifact 北向协议收敛 | P2 | `artifact.export` | 部分完成 |
| [R-005](#r-005-conversation-memory) | Conversation Memory 服务端权威历史 | P2 | — | 未实现 |
| [R-006](#r-006-多用户认证) | 多用户认证 / 租户隔离 | P3 | — | 未实现 |
| [R-007](#r-007-对话框文件上传) | 对话框文件上传 + 多模态图片 | **P1** | `chat.imageInput` / `chat.fileUpload` | 未实现 |
| [R-008](#r-008-db-扩展类型-adapter) | DB 扩展类型 adapter（DB-GPT） | P1 | `datasource.extendedTypes` | 未实现 |
| [R-009](#r-009-db-高级策略) | DB 高级策略（introspection/sample/mask） | P2 | `datasource.queryPolicy` 等 | 未实现 |
| [R-010](#r-010-kb-高级-rag) | KB 高级 RAG + 半生效字段补齐 | P2 | `kb.*` | 部分完成 |
| [R-011](#r-011-llm-高级采样) | LLM 高级采样 + run timeout | P2 | `llm.advancedSampling` | 部分完成 |
| [R-012](#r-012-mcp-stdio--tool-policy) | MCP stdio + tool policy | P2 | `mcp.stdio` / `mcp.toolPolicy` | 未实现 |
| [R-013](#r-013-skill-资源默认绑定) | Skill 资源默认绑定 | P3 | `skill.resourceBinding` | 未实现 |
| [R-014](#r-014-动态-schema-api) | 动态 datasource-types schema API | P2 | （由 API `enabled` 驱动占位） | 未实现 |

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
| 状态 | <!-- 后端填写 --> |
| 负责人 | <!-- 后端填写 --> |
| 方案摘要 | <!-- 后端填写 --> |
| 关联 PR / Issue | <!-- 后端填写 --> |

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
| 状态 | <!-- 后端填写 --> |
| 负责人 | <!-- 后端填写 --> |
| 方案摘要（emit 位置） | <!-- 后端填写 --> |
| 关联 PR / Issue | <!-- 后端填写 --> |

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
| 状态 | 部分完成（代码已有，缺真实环境） |
| 验收环境 | <!-- 后端填写 --> |
| 验收日期 | <!-- 后端填写 --> |

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
| 状态 | 部分完成 |
| 分阶段计划 | <!-- 后端填写 --> |

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
| 状态 | 未实现 |
| 方案摘要 | <!-- 后端填写 --> |

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
| 状态 | 未实现 |
| 认证方案 | <!-- 后端填写 --> |

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
| 状态 | 未实现 |
| 与 R-001 联动 | <!-- 后端填写 --> |

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
| 状态 | 未实现 |
| 分批计划 | <!-- 后端填写 --> |

---

## R-009 DB 高级策略

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `datasource.queryPolicy` · `datasource.introspectionPolicy` · `datasource.samplePolicy` · `datasource.fieldMasking` |

**待消费字段**（REST 已可写入）：

| 字段 | 期望行为 |
| --- | --- |
| `introspection.tableAllowlist` | 限制 schema 抓取表范围 |
| `introspection.refreshIntervalSec` | schema 快照自动刷新 |
| `queryPolicy.denyWrite` | 从 per-datasource 读取（当前 Gateway 仅读 maxRows/timeout） |
| `maskFields` | SQL 结果字段脱敏 |
| `samplePolicy.allowSample` / `maxSampleRows` | 采样预览策略 |

**验收**：改配置后 introspect / preview / SQL 结果与策略一致。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 未实现 |
| 实现入口 | <!-- data-gateway / config-api job --> |

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
| 状态 | 部分完成（embedding 已 per-KB；上表字段未全生效） |
| 分批计划 | <!-- 后端填写 --> |

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
| `timeoutMs` | 当前仅 profile `/test` 使用；run 阶段需 abort |

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 部分完成（temperature/maxTokens/fallback 已生效） |
| 方案摘要 | <!-- run-config-resolver / agent-runtime --> |

---

## R-012 MCP stdio + tool policy

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端占位 | `mcp.stdio` · `mcp.toolPolicy` |

**待实现**：

| 项 | 现状 |
| --- | --- |
| `transport=stdio` | `MCP_TRANSPORT_UNSUPPORTED` |
| `toolAllowlist` | 未按 server 配置过滤 manifest |
| 单工具 `timeoutMs` / result-size 上限 | 无 |

**已交付（不重复）**：sse / streamable-http、`authType=bearer` + token、tools manifest REST。

**后端答复区**

| 项 | 内容 |
| --- | --- |
| 状态 | 未实现 |
| 方案摘要 | <!-- 后端填写 --> |

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
| 状态 | 未实现 |
| 实现入口 | <!-- run-config-resolver / selectSkillsForRun --> |

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
| 状态 | 未实现 |
| API 草案链接 | [config-management-api.md](./config-management-api.md) |

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
