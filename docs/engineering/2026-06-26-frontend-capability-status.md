# 前端能力现状（2026-06-26 增量）

日期：2026-06-26  
归属方：`apps/web`（`@open-data-agent/web`）  
文档类型：**前端自述增量** —— 只记录 2026-06-26 本轮新增的前端能力。完整 2026-06-25 快照见
[前端能力现状（自述快照）](./2026-06-25-frontend-capability-status.md)。

## 一句话现状

前端已补齐后端已 emit 但此前未展示的运行诊断事件，把数据 agent 的结果展示从「SQL / dataset 为主」扩展到更完整的「诊断配置、技能选择、目标状态、上下文预算、图表、文件、SQL 结果表和 schema 字段类型」；并新增会话恢复、跨 session 工作区文件、产出 promote 与 `@file` 点名等「先接线、后翻位」能力。

## 本轮新增展示

| 区域 | 新增能力 | 后端依赖 |
| --- | --- | --- |
| 概览 Tab | 结论 → 进展 → 工作区信号 → 按工具分布的分区布局 | `workspace.metadata`、`sandbox.output`、工具 trace |
| Trace Tab | 「运行诊断」折叠区：生效资源、技能选择、目标与上下文预算 | `skill.selection`、`goal.updated`、`run.config.resolved`、`context.compiled`、`context.prompt-verified` |
| 对话步骤 | `type="reasoning"` content part 可进入「思考」折叠区 | `REASONING_*` 或 `role="reasoning"` 消息 |
| 产出 Tab | chart artifact 使用 Recharts 渲染 `bar` / `line` / `pie` | chart `preview_json.points` 或 `series` |
| 产出 Tab | 文件型 artifact：下载、`@ 引用`、「加入工作区」 | `artifact.export`、`artifact.promote`、`files` |
| Detail Tab | SQL 步骤展示关联 dataset artifact 的结果表 | SQL artifact 与 tool call 关联 |
| Detail Tab | inspect 字段 chip 拆分字段名和类型 | `inspect_schema` 返回列类型 |
| Detail Tab | Token 用量按 `token_usage.correlation` 关联 step | `token_usage` + `token_usage.correlation` |
| 左栏 | 「工作区文件」面板：跨 session 资产列表 / 上传 / 下载 / 删除 | `files`（过滤暂客户端兜底） |
| 对话框 | `@file` 点名：工作区文件 → `fileIds`；本对话产物 → `pinnedPaths`（标「后端未支持」） | `run_config.fileIds` / `pinnedPaths` |
| 会话 | 刷新后恢复服务端对话历史与产出列表 | `conversation.memory`、`artifact.list` |
| HITL | 协作回复展示 assistant 侧 recap + 用户侧选择气泡 | `interaction.requested` / `interaction.resolved` |

## 会话恢复

| 组件 | 能力位 | 行为 |
| --- | --- | --- |
| `SessionConversationRestore` | `conversation.memory` | 线程加载且 chat 为空时，`GET /api/v1/sessions/:sessionId/conversation` 映射为 AG-UI messages；404 视为空历史 |
| `SessionArtifactsRestore` | `artifact.list` | `GET /api/v1/artifacts?sessionId=` 重放 artifact 到 `liveRun` |
| `dedupeChatSessions` | — | localStorage 按 `id` / `threadId` 去重 |

能力位未翻 true 时组件 no-op，不 mock 数据。

## 工作区文件与 `@file`

- **左栏「工作区文件」**（`WorkspaceFileAssetsPanel`）：经 `GET/POST/DELETE /api/v1/files` 管理跨 session 资产；客户端过滤 `source=upload|workspace` 且无 `sessionId`（`filterWorkspaceAssetFiles`），待后端 `files.filter`（R-021）。
- **`@file` 菜单**（`chat-mentions.tsx`）：工作区文件写入 `run_config.fileIds`；本对话产物写入 `run_config.pinnedPaths` 并标「后端未支持」。
- **Promote**：产出卡片「加入工作区」门控于 `artifact.promote`，调用 `POST /api/v1/artifacts/:id/promote`。

## AG-UI / CUSTOM 事件消费现状

新增进入 `LiveRun` 的字段：

- `skillSelection`：来自 `CUSTOM(name="skill.selection")`，展示本轮模式、selected skills 和 tool policy 摘要。
- `goal`：来自 `CUSTOM(name="goal.updated")`，展示 objective、status、source。
- `resolvedRunConfig`：来自 `CUSTOM(name="run.config.resolved")`，展示 active datasource / model、启用 KB / MCP / files、selected skills。
- `contextReports`：来自 `CUSTOM(name="context.compiled")` 与 `CUSTOM(name="context.prompt-verified")`，保留最近 8 条，概览展示最近 3 条摘要。
- `workspaceSignals`：来自 `workspace.metadata` / `sandbox.output` 摘要。
- `tokenUsageRecords`：消费 `token_usage`；`token_usage.correlation` 补 `step_id` 用于 Detail 匹配。
- `interactionToolNames`：`interaction.requested` / `interaction.resolved` 在 `TOOL_CALL_START` 缺 name 时补工具名。

未知字段保留在 `raw` / `value` 中，UI 只展示稳定字段。缺事件时显示「待后端上报」，不臆造配置或 token 数字。

## 数据结果展示现状

- **Dataset：** 产出 Tab 仍展示完整可滚动表格；Detail query 分支现在会复用关联 dataset artifact 展示结果表。
- **Chart：** `ArtifactDetail(type="chart")` 支持 `chartType`、`unit`、`points`、`series`；目前渲染 `bar` / `line` / `pie`。缺少 `points` / `series` 时显示「暂无图表数据」。
- **File：** `ArtifactDetail(type="file")` 类型已补齐，路径、大小、修改时间、来源工具和可选文本内容可展示。
- **Schema：** inspect 详情将 `字段名 · 类型` 拆成两段 chip，和 Trace / 聊天区对齐。

## 新增 / 变更能力位

| 能力位 | 默认 | 解锁 |
| --- | --- | --- |
| `artifact.list` | false | `SessionArtifactsRestore` |
| `artifact.promote` | false | 产出「加入工作区」 |
| `files` | false | 工作区文件面板、`@file` 工作区项 |
| `artifact.export` | **true**（由 false 调整） | artifact 预览 / 下载 |

运行时能力位（`GET /capabilities`）：

- `conversation.memory` → 对话恢复
- `knowledge` / `mcp` / `skills` → 资源面板与 `@` 点名（经 `isResourcePanelSupported`）

`capabilitiesReady`：UI 在 `GET /capabilities` 返回前不启用上传、文件面板、恢复与附件能力位。

## 配置 UI 增量

- MCP stdio 字段（`command` / `args` / `cwd` / `env`）已补齐，门控于 pending `mcp.stdio`。
- 配置保存改为显式 `onSaveItem`，移除 debounced auto-save。

## 对后端的新要求

本轮新增后端需求见
[2026-06-26 后端需求增量](./2026-06-26-backend-requirements.md)，主要包括：

1. chart artifact 的真实 `preview_json` 数据结构（R-015）。
2. 诊断事件字段稳定契约（R-016）。
3. context 预算事件字段稳定契约（R-017）。
4. SQL 结果表与 dataset artifact 的稳定关联（R-018）。
5. per-run `@` mentions / pinnedPaths / 工作区文件生命周期（R-019–R-026）。
6. `token_usage.correlation` 与 HITL interaction 事件契约（R-027）。

## 验证记录

已新增 / 更新单测：

- `live-run-state`：诊断事件、chart/file artifact、`token_usage.correlation`、workspace 信号、interaction 工具名。
- `conversation-restore`：DTO 映射、404、恢复门控。
- `task-console-layout`：概览分区计划。
- `per-run-mentions`：`fileIds` / `pinnedPaths`、`filterWorkspaceAssetFiles`。
- `config-api-adapter`：MCP stdio 映射。
- `collaboration-responses`：HITL recap 布局。
- `chat-capabilities`：`files` 与 conversation restore 门控。
- `trace-timeline`：`run_suspended` / `run resumed`。
- `session-config`：`dedupeChatSessions`。

本地验证：

```bash
npm run test:web
npm run build:web
```
