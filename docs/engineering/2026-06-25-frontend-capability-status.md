# 前端能力现状（自述快照）

日期：2026-06-25
归属方：`apps/web`（`@open-data-agent/web`）
文档类型：**前端自述** —— 只记录「前端已经做了什么、当前如何对接后端、哪些字段以占位等后端」。
**对后端的要求**（需求原文 / 验收 / 排期 / 后端答复）见
[对后端的能力要求](./2026-06-25-backend-requirements.md)。

> 快照约定：本文件为 **2026-06-25 时点冻结快照**。下一轮评审请**另开新日期文件**，不要往本文件继续追加。
> 历史快照：[2026-06-23 能力交付状态（已归档）](./archive/2026-06-23-frontend-backend-capability-status.md)。

## 定位与读法

- 本文回答「前端**现在**长什么样、能消费什么」。
- 凡是「需要后端补什么」一律不在本文展开，只用能力位 ID 引到
  [对后端的能力要求](./2026-06-25-backend-requirements.md)。
- 关联活契约：[配置管理 REST 契约](./config-management-api.md)、
  [CopilotKit / AG-UI 前端协议](./copilotkit-ag-ui-frontend-protocol.md)、
  [Data Task 页面设计](../../apps/web/src/app/data-tasks/DESIGN.md)。

## 一句话现状

左栏五类配置（DB / KB / MCP / LLM / Skill）UI 已按 DB-GPT 完整字段面补齐。后端已能消费的字段
（**A 档**）已接 REST / adapter；后端尚未实现的字段以 **disabled +「待后端」徽标**占位
（`PENDING_CAPABILITIES`），后端交付后翻位即激活，**无需重做表单**。

## 五类配置 UI 现状

| 面板 | 已接线（A 档，后端可消费） | 占位等后端（pending / 能力位 false） |
| --- | --- | --- |
| DB | duckdb/sqlite/csv/xlsx 文件型；CRUD + `test` + `introspect` + `schema`；PG/MySQL（`datasource.server`）| 扩展类型 ClickHouse/Oracle/… `datasource.extendedTypes`；introspection/sample/mask 高级策略 |
| KB | embedding provider/model/baseUrl + key（secretRef）；`retrievalTopK` / `scoreThreshold` 写 REST | vectorStore / rerank / citation / chunking / graphRag / scope |
| MCP | `authType`（none/bearer）+ token；详情页 tools manifest | `transport=stdio`；`toolAllowlist`；单工具 timeout/result 上限 |
| LLM | model-profiles CRUD + `test`；`temperature`/`maxTokens`（`llm.samplingParams`）；`fallbackProfileId`/`timeoutMs` 写 REST | topP/frequency/presence penalty；reasoningModel；contextLength；run-level timeout |
| Skill | multipart 上传 / validate / replace；instructions + allowedTools | `defaultDbIds`/`defaultKbIds`/`defaultMcpIds`/`modelProfileId` 资源默认绑定 |

## 对话框（chat）侧前端现状

- **Session 配置胶囊**（`SessionConfigBar`）：按会话持久化启用集，写入
  `run_config.enabled*Ids`；默认全开，可逐项关闭某 db/kb/mcp/skill。
- **`@` 点名**（`chat-mentions.tsx`）：只能从 session 启用集里选；写入
  `run_config.mentioned` 与 `active*`；**不收窄** `enabled*Ids`；per-run，发送后即清。
- **附件 UI**（`useAttachments`）：选择 / 拖拽 / 粘贴 / 预览 / 移除 / 上传状态齐备。
  图片默认 base64 内联，数据文件走 `onUpload`。
- **生效边界**：目前只有 `@db` / session db 启用集经 `datasource_id` 真正生效；
  kb/mcp/skill 已带「后端未支持」标记，等运行时能力位翻 true 即自动生效。

## Token 用量 / Artifact 前端就绪情况

- **Token**：`live-run-state.ts` 已消费 `input_tokens`/`output_tokens`（兼容
  `prompt_tokens`/`completion_tokens`），并扩展消费 `step_number`/`step_id`/`tool_call_id`/
  `model`/`cost_usd`。`TaskConsole` 概览 / 详情用量面板已就绪。后端未 emit `token_usage`
  时展示「待后端上报」，**不臆造数字**。
- **Artifact**：`artifact-export-client` 已按 REST 契约实现，受 `artifact.export` 能力位 gate；
  产物卡片可展开预览，「查看 / 下载」按能力位启用。

## 能力位映射表（前端常量 ↔ 后端需求）

前端用两类开关控制字段：运行时能力位（`GET /api/v1/capabilities` 翻位）与静态占位
（DB-GPT 对齐字段，等后端再翻位）。源码见
[`data-task-state.ts`](../../apps/web/src/app/data-tasks/data-task-state.ts)、
[`capabilities.ts`](../../apps/web/src/lib/config-api/capabilities.ts)。

### 运行时能力位（`BackendCapability` / `RuntimeCapability`）

| 能力位常量 | 含义 | 默认 | 对应后端要求 |
| --- | --- | --- | --- |
| `datasource.server` | PostgreSQL / MySQL adapter | false | [R-003](./2026-06-25-backend-requirements.md#r-003-pg--mysql-真实环境验收) |
| `datasource.queryPolicy` | per-datasource maxRows/timeout 生效 | false | [R-009](./2026-06-25-backend-requirements.md#r-009-db-高级策略) |
| `llm.samplingParams` | temperature/maxTokens 被消费 | false | 已交付主体 / [R-011](./2026-06-25-backend-requirements.md#r-011-llm-高级采样) |
| `artifact.export` | artifact 预览/下载 API | true | [R-004](./2026-06-25-backend-requirements.md#r-004-artifact-北向协议收敛) |
| `chat.imageInput` | 多模态图片 part 消费 | false | [R-007](./2026-06-25-backend-requirements.md#r-007-对话框文件上传) |
| `chat.fileUpload` | 对话框文件上传端点 | false | [R-007](./2026-06-25-backend-requirements.md#r-007-对话框文件上传) |
| `knowledge` | KB / RAG 运行时挂载 | false | 已交付主体 / [R-010](./2026-06-25-backend-requirements.md#r-010-kb-高级-rag) |
| `mcp` | MCP 运行时挂载 | false | 已交付主体 / [R-012](./2026-06-25-backend-requirements.md#r-012-mcp-stdio--tool-policy) |
| `skills` | Skill 策略层运行时 | false | 已交付主体 / [R-013](./2026-06-25-backend-requirements.md#r-013-skill-资源默认绑定) |

### 静态占位（`PendingCapability`，全部默认 false）

| 占位常量 | 面板字段 | 对应后端要求 |
| --- | --- | --- |
| `datasource.extendedTypes` | ClickHouse/Oracle/SQL Server/… | [R-008](./2026-06-25-backend-requirements.md#r-008-db-扩展类型-adapter) |
| `datasource.introspectionPolicy` / `samplePolicy` / `fieldMasking` | 表白名单 / 采样 / 脱敏 | [R-009](./2026-06-25-backend-requirements.md#r-009-db-高级策略) |
| `kb.vectorStore` / `rerank` / `citationPolicy` / `chunking` / `graphRag` / `scope` | KB 高级 RAG | [R-010](./2026-06-25-backend-requirements.md#r-010-kb-高级-rag) |
| `llm.advancedSampling` | topP / penalties / reasoning / contextLength | [R-011](./2026-06-25-backend-requirements.md#r-011-llm-高级采样) |
| `mcp.stdio` / `mcp.toolPolicy` | stdio 传输 / allowlist | [R-012](./2026-06-25-backend-requirements.md#r-012-mcp-stdio--tool-policy) |
| `skill.resourceBinding` | Skill 默认资源绑定 | [R-013](./2026-06-25-backend-requirements.md#r-013-skill-资源默认绑定) |

## 前端接入顺序建议（后端每交付一项后）

1. 左栏配置源从 localStorage 迁到 `/api/v1/workspace-config` 与各资源 CRUD。
2. DB/LLM/KB/MCP/Skill 分别接 `test` / `validate` 状态；失败保留资源但标不可用。
3. run 时继续发送 `context.run_config`；不把 credential / Skill 包正文 / artifact 内容塞进 AG-UI context。
4. 后端翻对应能力位 / pending 位后，前端按 `config-management-api.md`「UI 当前暴露 vs 完整契约」恢复字段。
