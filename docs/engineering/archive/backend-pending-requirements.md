# 后端待实现需求清单（已冻结归档）

> **本文件已冻结（2026-06-25）。** 后端排期/答复请改用
> [对后端的能力要求](../2026-06-25-backend-requirements.md)（O-00x 已重编为 R-00x）。
> 本文仅供历史追溯。

日期：2026-06-25
维护方：`apps/api` / 研发 B（各条「后端答复区」由后端填写）
提出方：`apps/web`（依据前端 UI、`PENDING_CAPABILITIES` 与联调反馈整理）

## 文档定位

本文件是**当前后端尚未实现或仅部分实现**需求的**唯一排期清单**。

| 文档 | 用途 |
| --- | --- |
| **本文件** | 后端待办、排期、答复 |
| [2026-06-23-frontend-backend-capability-status.md](./2026-06-23-frontend-backend-capability-status.md) | 已实现能力对照（#1–#9 主体） |
| [frontend-backend-capability-requests.md](./frontend-backend-capability-requests.md) | 需求原文与详细验收（#1–#20 全文） |

**不在本清单重复收录**：secretRef、datasource REST（主体）、run_config、LLM profile、queryPolicy（maxRows/timeout）、KB/MCP/Skill 主体、Artifact REST 等——见 [交付状态](./2026-06-23-frontend-backend-capability-status.md)。

**状态枚举**（后端答复区统一使用）：

`未排期` · `已排期` · `进行中` · `待验收` · `已完成` · `不做` · `阻塞`

---

## 总览

| ID | 对应能力清单 | 需求 | 优先级 | 前端现状 | 状态 |
| --- | --- | --- | --- | --- | --- |
| [O-001](#o-001-session-级-workspace-隔离) | #12 | Session 级 Workspace 隔离 | **P1** | 多轮 `list_files` 为空 | 未实现 |
| [O-002](#o-002-llm-token-用量上报) | #11 | LLM Token 用量上报（AG-UI） | **P1** | Task Console 无真实用量 | 待确认 |
| [O-003](#o-003-pg--mysql-真实环境验收) | #2 残余 | PG / MySQL 真实环境 E2E 验收 | P1 | PG/MySQL 仅能标 beta | 部分完成 |
| [O-004](#o-004-artifact-北向协议收敛) | #9 残余 | Artifact 北向协议收敛 | P2 | REST 可用；事件仍偏大 | 部分完成 |
| [O-005](#o-005-conversation-memory) | — | Conversation Memory 服务端权威历史 | P2 | 仍依赖客户端回传 messages | 未实现 |
| [O-006](#o-006-多用户认证) | #10 | 多用户认证 / 租户隔离 | P3 | 固定 `dev-user` | 未实现 |
| [O-007](#o-007-对话框文件上传) | #13 | 对话框文件上传 + 多模态图片 | **P1** | 附件 UI 就绪，标「后端未支持」 | 未实现 |
| [O-008](#o-008-db-扩展类型-adapter) | #14 | DB 扩展类型 adapter（DB-GPT） | P1 | 扩展类型 disabled「待后端」 | 未实现 |
| [O-009](#o-009-db-高级策略) | #15 | DB 高级策略（introspection / sample / mask） | P2 | 字段可见，改配置无 run 效果 | 未实现 |
| [O-010](#o-010-kb-高级-rag) | #16 | KB 高级 RAG + 半生效字段补齐 | P2 | B 档 pending；TopK/阈值未全生效 | 部分完成 |
| [O-011](#o-011-llm-高级采样) | #17 | LLM 高级采样 + run timeout | P2 | B 档 pending；timeout 仅 test | 部分完成 |
| [O-012](#o-012-mcp-stdio--tool-policy) | #18 | MCP stdio + tool policy | P2 | stdio / allowlist pending | 未实现 |
| [O-013](#o-013-skill-资源绑定) | #19 | Skill 资源默认绑定 | P3 | 四字段 disabled「待后端」 | 未实现 |
| [O-014](#o-014-动态-schema-api) | #20 | 动态 datasource-types schema API | P2 | 前端静态枚举 + pending | 未实现 |

---

## O-001 Session 级 Workspace 隔离

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §12](./frontend-backend-capability-requests.md#12-session-级-workspace-隔离跨-run-文件持久p1) |
| 优先级 | **P1** |
| 依赖 | 无；落地后需联动 O-004、O-007 |

### 问题

Workspace 当前为 `{user}/{session}/{run}/`，run 结束 `destroyWorkspace()`，同 session 下一轮无法 `list_files` / `read_file` 上一轮产物。

### 需求摘要

1. 目录改为 `{workspaceRoot}/{user_id}/{session_id}/`；`run_id` 不参与 path。
2. run terminal 不再删除 session 工作区；定义回收策略（MVP 长期保留 + 可选 TTL）。
3. Artifact download 路径与 session 级对齐；旧 run 级记录需兼容策略。
4. 集成测试：同 session 两 run 读写同一文件。

### 验收标准（摘要）

Run A 写入文件并结束 → Run B（新 `runId`）可 `list_files` / `read_file`；跨 session / 跨 user 隔离不变。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 后端填写 --> |
| **负责人** | <!-- 后端填写 --> |
| **方案摘要** | <!-- 后端填写 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |

---

## O-002 LLM Token 用量上报

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §11](./frontend-backend-capability-requests.md#11-llm-token-用量上报agui-token_usagep1) |
| 优先级 | **P1** |
| 依赖 | 无 |

### 问题

前端已消费 `CUSTOM(name="token_usage")`；后端未 emit。`context.prompt-verified` / `context.compiled` 仅为上下文预算。

### 需求摘要

LLM 调用完成后 emit `token_usage`（`input_tokens` / `output_tokens`，可选 `tool_call_id` / `model` / `cost_usd`）。优先 provider 实测 `usage`。

### 验收标准（摘要）

含 LLM 的 run 结束后，前端概览显示真实 Token；`run_events` 可查到事件。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 后端填写 --> |
| **负责人** | <!-- 后端填写 --> |
| **方案摘要** | <!-- emit 位置 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |

---

## O-003 PG / MySQL 真实环境验收

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 #2](./frontend-backend-capability-requests.md#2-datasource-注册-rest--真实-db-adapterp0)；[交付报告 §5](../2026-06-23-backend-config-runtime-delivery-report.md) |
| 优先级 | P1 |
| 依赖 | 用户侧只读 PG/MySQL 实例 |

### 问题

REST 与 adapter 代码已有（`postgresql` / `mysql` `enabled: true`），缺真实库 E2E smoke。

### 需求摘要

真实实例跑通：`create → test → introspect → inspect_schema → run_sql_readonly`；失败返回结构化错误码；记录验收日期与环境。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 部分完成（代码已有，缺真实环境） |
| **验收环境** | <!-- 后端填写 --> |
| **验收日期** | <!-- 后端填写 --> |

---

## O-004 Artifact 北向协议收敛

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 #9](./frontend-backend-capability-requests.md#9-artifact-预览--下载-apip3)；[交付报告 §5–§6](../2026-06-23-backend-config-runtime-delivery-report.md) |
| 优先级 | P2 |
| 依赖 | O-001（file 下载路径） |

### 问题

REST preview/download 已实现；AG-UI `artifact` 事件仍偏大；file download 仍按 run 级 workspace 路径。

### 需求摘要

1. 北向事件改为 id + 摘要引用，大内容走 REST。
2. O-001 后 download 改 session 级路径；legacy 记录兼容。
3. （可选）完整文件 copy + hash 落库。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 部分完成 |
| **分阶段计划** | <!-- 后端填写 --> |

---

## O-005 Conversation Memory

| 字段 | 内容 |
| --- | --- |
| 来源 | [交付报告 §6](../2026-06-23-backend-config-runtime-delivery-report.md) |
| 优先级 | P2 |
| 依赖 | CopilotKit / Mastra 历史所有权方案 |

### 问题

Run 仍信任客户端回传全量 `messages`；conversation Memory 未作为服务端权威。

### 需求摘要

按 `user_id + threadId` 管理权威历史；tool-call/result 配对与稳定 message ID；与 Knowledge 职责边界文档化。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **方案摘要** | <!-- 后端填写 --> |

---

## O-006 多用户认证

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §10](./frontend-backend-capability-requests.md#10-多用户认证--workspace-隔离p3) |
| 优先级 | P3 |
| 依赖 | 认证方案选型 |

### 需求摘要

用户认证 + 配置 / run / artifact / workspace 按 `(workspaceId, userId)` 隔离。

### 验收标准（摘要）

不同用户互不可见配置与会话；跨用户访问 403。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **认证方案** | <!-- 后端填写 --> |

---

## O-007 对话框文件上传

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §13](./frontend-backend-capability-requests.md#13-对话框文件上传图片多模态--数据文件落工作区p1)；[设计规格](../../superpowers/specs/2026-06-24-chat-file-upload-design.md) |
| 优先级 | **P1** |
| 依赖 | O-001（#13b 强依赖 session 工作区） |

### 问题

无 chat 上传端点；`extractLastUserText` 忽略非文本 part；`GET /capabilities` 未返回 `chat.imageInput` / `chat.fileUpload`。

### 需求摘要

1. **#13a**：run 入口消费 message `type:"image"`；capabilities `chat.imageInput = true`。
2. **#13b**：`POST /api/v1/chat/uploads` → session 工作区 `uploads/`；capabilities `chat.fileUpload = true`。
3. 安全：session 隔离、禁路径逃逸、限大小/类型。

### 验收标准（摘要）

图片提问 LLM 能据图作答；CSV 上传后 Agent 可 `read_file` 分析。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **与 O-001 联动** | <!-- 后端填写 --> |

---

## O-008 DB 扩展类型 adapter

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §14](./frontend-backend-capability-requests.md#14-db-扩展类型-adapterdb-gpt-对齐p1) |
| 优先级 | P1 |
| 依赖 | `packages/data-gateway` |
| 前端 pending | `datasource.extendedTypes` |

### 需求摘要

实现只读 adapter：ClickHouse → Oracle → SQL Server → Hive / Spark / Vertica；BigQuery / Snowflake 可第二批。

类型启用后：`supportTypes()` / capabilities / `datasource-types` 返回 `enabled: true`，前端关闭「待后端」占位。

### 验收标准（摘要）

ClickHouse 源 test → introspect → `run_sql_readonly` 跑通；选扩展类型 run 时不再 throw。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **分批计划** | <!-- 后端填写 --> |

---

## O-009 DB 高级策略

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §15](./frontend-backend-capability-requests.md#15-db-高级策略introspection--sample--maskp2) |
| 优先级 | P2 |
| 前端 pending | `datasource.introspectionPolicy` · `datasource.samplePolicy` · `datasource.fieldMasking` |

### 待消费字段（REST 已可写入）

| 字段 | 期望行为 |
| --- | --- |
| `introspection.tableAllowlist` | 限制 schema 抓取表范围 |
| `introspection.refreshIntervalSec` | schema 快照自动刷新 |
| `queryPolicy.denyWrite` | 从 per-datasource 读取（当前 Gateway 仅读 maxRows/timeout） |
| `maskFields` | SQL 结果字段脱敏 |
| `samplePolicy.allowSample` / `maxSampleRows` | 采样预览策略 |

### 验收标准（摘要）

改配置后 introspect / preview / SQL 结果与策略一致。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **实现入口** | <!-- data-gateway / config-api job --> |

---

## O-010 KB 高级 RAG

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §16](./frontend-backend-capability-requests.md#16-kb-高级-rag向量库--rerank--graphrag--分块p2) |
| 优先级 | P2 |
| 前端 pending | `kb.vectorStore` · `kb.rerank` · `kb.citationPolicy` · `kb.chunking` · `kb.graphRag` · `kb.scope` |

### B 档（全新能力）

| 字段 | 说明 |
| --- | --- |
| `vectorStore` | chroma / milvus / pgvector / elasticsearch |
| `rerankEnabled` + `rerankModel` | 检索后 rerank |
| `citationRequired` | 回答强制 KB 引用 |
| `chunkSize` / `chunkOverlap` | ingest 分块（当前硬编码） |
| `graphRagEnabled` | GraphRAG 链路 |
| `scope` | personal / workspace / project 隔离 |

### 半生效缺口（已落库，run 未完整消费）

| 字段 | 现状 | 后端待补 |
| --- | --- | --- |
| `retrievalTopK` | payload 可存 | `retrieve_knowledge` / search 应默认读 KB 配置，而非固定 5 |
| `scoreThreshold` | payload 可存 | retrieve 结果按阈值过滤 |

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 部分完成（embedding 已 per-KB；上表字段未全生效） |
| **分批计划** | <!-- 后端填写 --> |

---

## O-011 LLM 高级采样

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §17](./frontend-backend-capability-requests.md#17-llm-高级采样--run-timeoutp2) |
| 优先级 | P2 |
| 前端 pending | `llm.advancedSampling` |

### 待消费字段

| 字段 | 说明 |
| --- | --- |
| `topP` / `frequencyPenalty` / `presencePenalty` | 传入 run `modelSettings` |
| `reasoningModel` | reasoning 模型标记 |
| `contextLength` | 上下文窗口 / 预算提示 |
| `timeoutMs` | **当前仅 profile `/test` 使用**；run 阶段需 abort |

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 部分完成（temperature/maxTokens/fallback 已生效） |
| **方案摘要** | <!-- run-config-resolver / agent-runtime --> |

---

## O-012 MCP stdio + tool policy

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §18](./frontend-backend-capability-requests.md#18-mcp-stdio--tool-policy-p2) |
| 优先级 | P2 |
| 前端 pending | `mcp.stdio` · `mcp.toolPolicy` |

### 待实现

| 项 | 现状 |
| --- | --- |
| `transport=stdio` | `MCP_TRANSPORT_UNSUPPORTED` |
| `toolAllowlist` | 未按 server 配置过滤 manifest |
| 单工具 `timeoutMs` / result-size 上限 | 无 |

**已交付（不在此条重复）**：sse / streamable-http、`authType=bearer` + token、tools manifest REST。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **方案摘要** | <!-- 后端填写 --> |

---

## O-013 Skill 资源默认绑定

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §19](./frontend-backend-capability-requests.md#19-skill-资源默认绑定p3) |
| 优先级 | P3 |
| 前端 pending | `skill.resourceBinding` |

### 待消费字段

`defaultDbIds` / `defaultKbIds` / `defaultMcpIds` / `modelProfileId` — Skill 激活时注入 `effectiveRunConfig` 默认启用集，无需用户手动 session 配置。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **实现入口** | <!-- run-config-resolver / selectSkillsForRun --> |

---

## O-014 动态 schema API

| 字段 | 内容 |
| --- | --- |
| 来源 | [能力清单 §20](./frontend-backend-capability-requests.md#20-动态-datasource-types-schema-apip2) |
| 优先级 | P2 |
| 依赖 | O-008 类型扩展 |

### 需求摘要

新增 `GET /api/v1/datasource-types`（或等价 REST），返回：

- `name`、`label`、`enabled`、`parameters[]`（name / label / type / required / options）
- 与 `SUPPORTED_DATA_SOURCE_TYPES` 对齐

可选：`GET /api/v1/knowledge-base-types`；capabilities 扩展 `chat.*` 与各 pending 位（或由此 API 的 `enabled` 驱动前端自动关闭占位）。

### 验收标准（摘要）

后端新增 adapter 后，前端无需发版即可在下拉出现或自动取消「待后端」。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | 未实现 |
| **API 草案链接** | [config-management-api.md](../config-management-api.md) |

---

## 建议排期顺序

### 第一波（体验阻塞）

1. **O-001** Session Workspace
2. **O-007** 对话框文件上传（依赖 O-001）
3. **O-002** Token 用量

### 第二波（配置可信度）

4. **O-003** PG/MySQL 真实验收
5. **O-010** KB 半生效字段（TopK / scoreThreshold）— 小改动、高感知
6. **O-011** LLM run timeout

### 第三波（DB-GPT 扩展）

7. **O-008** 扩展 DB 类型
8. **O-014** 动态 schema API
9. **O-009** DB 高级策略
10. **O-010** KB 高级 RAG（B 档）
11. **O-011** LLM 高级采样（B 档）
12. **O-012** MCP stdio / tool policy
13. **O-013** Skill 资源绑定

### 第四波（产品化）

14. **O-004** Artifact 北向收敛（与 O-001 联动）
15. **O-005** Conversation Memory
16. **O-006** 多用户认证

---

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-06-25 | 初版：合并原 open backlog（O-001–O-007）与能力清单 #14–#20、配置半生效缺口 |
