# 对后端的能力要求（2026-06-26 增量）

日期：2026-06-26  
提出方：`apps/web`（依据前端本轮对齐与数据展示补齐整理）  
受理方：`apps/api` / dataAgent 后端  
文档类型：**增量需求清单** —— 只记录 2026-06-26 新增或需要稳定的后端能力。历史主体见
[2026-06-25 后端需求快照](./2026-06-25-backend-requirements.md)。

## 状态枚举

`未排期` · `已排期` · `进行中` · `待验收` · `已完成` · `不做` · `阻塞`

## 总览

| ID | 需求 | 优先级 | 前端状态 | 状态 |
| --- | --- | --- | --- | --- |
| [R-015](#r-015-图表-artifact-真实数据) | 图表 artifact 真实数据 | P2 | 前端已可渲染 `bar` / `line` / `pie` | 未排期 |
| [R-016](#r-016-诊断事件字段稳定契约) | 诊断事件字段稳定契约 | P2 | 前端已展示 | 待验收 |
| [R-017](#r-017-context-预算契约) | Context 预算契约 | P3 | 前端已展示最近事件摘要 | 待验收 |
| [R-018](#r-018-sql-结果在-detail-复用) | SQL 结果在 Detail 复用 | P2 | 前端已复用 dataset artifact | 待验收 |
| [R-019](#r-019-消费-per-run--mentions点名) | 消费 per-run @ mentions（点名） | P1 | 前端已发送 `run_config.mentioned` + `active*` | 未排期 |
| [R-020](#r-020-资源启用校验与-session-默认集对齐) | 资源启用校验与 session 默认集对齐 | P2 | 前端 session 默认全量启用 | 未排期 |
| [R-021](#r-021-fileassetref-统一过滤与标签) | FileAssetRef 统一过滤与标签 | P1 | 前端已客户端过滤兜底 | 未排期 |
| [R-022](#r-022-artifact-加入工作区-promote) | artifact 加入工作区 promote | P1 | 前端已门控按钮 | 未排期 |
| [R-023](#r-023-session-artifact-列表恢复) | session artifact 列表恢复 | P1 | 前端已门控恢复组件 | 未排期 |
| [R-024](#r-024-run_configpinnedpaths-消费) | `run_config.pinnedPaths` 消费 | P2 | 前端已发送/标注未支持 | 未排期 |
| [R-025](#r-025-对话框上传登记-session-级-fileassetref可选) | 对话框上传登记 session 级 FileAssetRef（可选） | P3 | 前端暂保持附件 chips | 未排期 |
| [R-026](#r-026-agent-工作区资产工具与-promote-语义) | agent 工作区资产工具与 promote 语义 | P2 | 前端不阻塞 | 未排期 |
| [R-027](#r-027-token-usagecorrelation-与-interaction-事件) | `token_usage.correlation` 与 interaction 事件 | P2 | 前端已消费 | 待验收 |

---

## R-015 图表 artifact 真实数据

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | `ArtifactDetail(type="chart")` 已支持 `bar` / `line` / `pie` |

**问题：** 前端已有真实图表渲染能力，但后端目前只可能 emit `type="chart"` 的摘要，缺少稳定的 `preview_json` 数据结构。

**需求：**

1. 后端在 `CUSTOM(name="artifact")` 或 artifact preview REST 中，为 chart artifact 提供：

```json
{
  "type": "chart",
  "id": "artifact-chart-1",
  "title": "渠道订单量",
  "preview_json": {
    "chartType": "bar",
    "unit": "单",
    "points": [
      { "label": "search", "value": 42 },
      { "label": "direct", "value": 18 }
    ]
  }
}
```

2. `chartType` 支持 `bar` / `line` / `pie`。未知类型前端按 `bar` 兜底。
3. 多序列图表可选提供 `series[]`：

```json
{
  "chartType": "line",
  "unit": "元",
  "series": [
    {
      "name": "GMV",
      "points": [
        { "label": "2026-06-01", "value": 1200 }
      ]
    }
  ]
}
```

4. 后端如新增 `visualize` 类工具，应将该步骤映射为图表 artifact；大数据量仍走 REST preview，不塞入大事件。

**验收：** 一次数据分析 run 产生 chart artifact 后，前端「产出」Tab 能直接渲染图表；缺少 `points` / `series` 时显示「待后端上报图表数据」。

---

## R-016 诊断事件字段稳定契约

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | 概览 Tab 已展示 `skill.selection` / `goal.updated` / `run.config.resolved` |

**需求：** 稳定以下 `CUSTOM` 事件字段，避免前端展示依赖漂移。

### `skill.selection`

```json
{
  "mode": "auto",
  "selected": [
    { "id": "data-analysis", "name": "Data Analysis", "revision": 1, "tags": ["sql"] }
  ],
  "effective_tool_policy": {
    "allowedTools": ["inspect_schema", "run_sql_readonly"],
    "deniedTools": [],
    "mergeStrategy": "union"
  },
  "audit": [
    { "skillId": "data-analysis", "decision": "selected", "reasons": ["query:analysis"] }
  ]
}
```

### `goal.updated`

```json
{
  "objective": "分析订单渠道",
  "status": "running",
  "source": "user"
}
```

### `run.config.resolved`

```json
{
  "activeDatasourceId": "orders-db",
  "activeLlmProfileId": "default-model",
  "enabledDatasourceIds": ["orders-db"],
  "enabledKnowledgeIds": ["kb-orders"],
  "enabledMcpServerIds": ["mcp-local"],
  "enabledSkillIds": ["data-analysis"],
  "selectedSkills": [{ "id": "data-analysis", "name": "Data Analysis" }],
  "fileIds": ["file-ref-1"]
}
```

**验收：** 前端概览区能展示本轮生效资源、技能选择和目标状态；字段缺失时只显示「未指定」或「待后端上报」，不出现运行时错误。

---

## R-017 Context 预算契约

| 字段 | 内容 |
| --- | --- |
| 优先级 | P3 |
| 前端能力 | 概览 Tab 已展示最近 3 条 `context.*` 摘要 |

**需求：** 稳定 `context.compiled` 与 `context.prompt-verified` 的预算字段：

```json
{
  "step": "prepare",
  "model": "qwen-plus",
  "token_report": {
    "total_tokens": 1200,
    "budget_tokens": 8000
  },
  "prompt_tokens": 900,
  "remaining_tokens": 7100
}
```

字段可分散在不同事件中，但建议至少提供 `model`、`total_tokens` 或 `prompt_tokens`、`budget_tokens` 或 `remaining_tokens`。

**验收：** 前端能展示模型、已用 token、预算或剩余 token；缺失字段时显示「已上报」而不展示虚假数字。

---

## R-018 SQL 结果在 Detail 复用

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | Detail query 分支已从关联 dataset artifact 读取结果表 |

**需求：** 后端保持 SQL 工具结果与 dataset artifact 的稳定关联：

1. `run_sql_readonly` 成功后生成 `type="table"` / `dataset` artifact。
2. artifact 事件或 REST preview 提供 `columns` / `rows` / `row_count`。
3. artifact 能通过 `audit_log_id`、`tool_call_id`、`step_id` 或顺序规则与 SQL 工具调用关联。

**验收：** 点击控制台 Detail 中的 SQL 步骤时，前端能展示 SQL、扫描行数、耗时和结果表预览。

---

## R-019 消费 per-run @ mentions（点名）

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| 前端能力 | 对话框 `@` 可点名 `db` / `kb` / `mcp` / `skill`，已通过 `run_config` 结构化发送 |

**背景：** 对话框 `@` 的语义是「本次 run 指定/聚焦某资源」，**不是收窄可用集**（`enabled*Ids` 仍为 session 启用全集）。前端每次 run 已在 `run_config` 中发送以下字段（`apps/web/.../data-task-state.ts` 的 `buildRunConfig` → `RunConfigPayload`）：

```json
{
  "enabledDatasourceIds": ["orders-db", "events-db"],
  "enabledKnowledgeIds": ["kb-orders", "kb-faq"],
  "enabledMcpServerIds": ["mcp-local"],
  "enabledSkillIds": ["data-analysis"],
  "activeDatasourceId": "events-db",
  "activeSkillId": "data-analysis",
  "activeLlmProfileId": "default-model",
  "mentioned": {
    "db": ["events-db"],
    "kb": ["kb-faq"],
    "mcp": [],
    "skill": []
  }
}
```

**现状（gap）：** 后端 `apps/api/src/run-input.ts` 仅消费 `activeDatasourceId`、`activeSkillId` 与 `enabled*Ids`；`run_config.mentioned` 整包**不被读取**，且没有 `activeKnowledgeId` / `activeMcpServerId` 概念。结果：

- `@db` → 经 `activeDatasourceId` 生效 ✅
- `@skill` → 经 `activeSkillId` 加权生效 ✅
- `@kb` / `@mcp` 点名 → **完全无效**（被忽略），用户点名后行为与不点名一致 ❌

**需求：**

1. 后端在 `extractEffectiveRunConfig` 中解析 `run_config.mentioned`（蛇形/驼峰双别名），得到本次 run 的 per-kind 点名列表，存入 `EffectiveRunConfig`，并在 `run.config.resolved` 事件中回传，便于前端校对：

```json
{
  "mentioned": {
    "db": ["events-db"],
    "kb": ["kb-faq"],
    "mcp": [],
    "skill": []
  }
}
```

2. 点名生效语义（**聚焦而非收窄**，与前端一致）：
   - `@db` → 维持现有 `activeDatasourceId` 行为。
   - `@skill` → 维持现有 `activeSkillId` 加权行为；建议把 `mentioned.skill` 全部并入显式选择集，而非只取首个。
   - `@kb` → 将 `mentioned.kb` 作为本轮**优先检索集**：在系统提示中明确「用户本轮特别关注以下知识库：…」，并在 `retrieve_knowledge` 默认/排序上向这些集合倾斜；不在 `mentioned.kb` 中但仍 `enabled` 的 KB 依旧可检索。
   - `@mcp` → 将 `mentioned.mcp` 作为本轮**优先 MCP**：在提示中标注用户本轮意图使用的 server；可选地优先暴露其工具，但不得隐藏其他已启用 server 的工具。

3. 当 `mentioned` 为空或字段缺失时，行为与今日完全一致（向后兼容，不得回归）。

4. 校验：`mentioned.*` 中的 ID 必须落在对应的 `enabled*Ids` 子集内；越界 ID 应被忽略并在诊断中提示，而非使 run 失败。

**验收：**

- 用户对同一问题分别 `@kb-faq` 与不点名，run 行为可观测到差异（系统提示包含点名 KB / 检索优先级变化）。
- `run.config.resolved` 事件携带 `mentioned`，前端概览区可回显「本轮点名」。
- 不点名时与现有行为逐字节一致（回归测试通过）。

---

## R-020 资源启用校验与 session 默认集对齐

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | session 默认把 workspace 所有资源视为启用（按黑名单 `disabled` 收窄） |

**背景：** 前端 session 层默认「全量启用」——`enabled*Ids = workspace 全集 − session.disabled`，**不参考** workspace 的 `default_enabled`。后端 `run-config-resolver.ts` 对非 skill 资源有强校验：

```text
if (kind !== "skill" && !resource.default_enabled) {
  throw new Error(`CONFIG_RESOURCE_NOT_ENABLED:${kind}:${id}`);
}
```

**现状（gap）：** 当某资源在左侧被设为 `default_enabled = false`、但用户在 session 中未单独关闭它时，前端仍会把它放进 `enabled*Ids` 发送，后端校验抛错导致**整个 run 失败**，且错误信息对终端用户不友好。

**需求（二选一，倾向 1）：**

1. **降级而非失败**：对 `enabled*Ids` 中 `default_enabled = false` 的资源静默剔除，并在 `run.config.resolved` 或诊断事件中上报被剔除的 ID 与原因（`disabled_by_policy`），让 run 继续。
2. 若必须 fail-closed，则返回结构化、可本地化的错误（含 `kind` / `id` / `reason`），前端据此提示用户「该资源已在工作区停用，请重新启用或从 session 中移除」。

并请确认：`default_enabled` 是否应作为「资源能否被本次 run 使用」的硬开关——若是，建议在 `GET /api/v1/run-defaults` / `capabilities` 中向前端暴露该状态，使前端可在 SessionConfigBar 中对停用资源置灰，从源头避免越界。

**验收：**

- 左侧停用某 DB/KB/MCP 后，未在 session 关闭它的情况下发起 run 不再整体失败。
- 被剔除/拒绝的资源有结构化诊断或友好错误，前端可展示。

---

## R-021 FileAssetRef 统一过滤与标签

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| Capability | `files.filter`（建议新增） |
| 前端能力 | 前端已在左栏「工作区文件」用客户端过滤兜底 |

**背景：** 前端将文件产品形态拆为：右栏「产出」展示本对话生成物；左栏「工作区文件」展示跨 session 资产。当前 `GET /api/v1/files` 返回 user/workspace 下所有 `file_asset_refs`，会混入 `source=artifact` 的本对话产物底层 ref。

**需求：**

1. `GET /api/v1/files` 支持过滤：
   - `scope=session|workspace`
   - `sessionId=<threadId>`
   - `origin=uploaded|generated|saved`（可多选或逗号分隔）
2. DTO 返回推导标签：
   - `scope`: `session`（有 `session_id`）/ `workspace`（无 `session_id`）
   - `origin`: `uploaded`（`source=upload`）/ `generated`（`source=artifact`）/ `saved`（`source=workspace`）
3. 保持现有字段向后兼容（`id/filename/mimeType/sizeBytes/source/sessionId/runId`）。

**验收：** 前端请求 `scope=workspace&origin=uploaded,saved` 时只得到跨 session 资产；请求 `scope=session&sessionId=...` 时只得到该 session 文件。

---

## R-022 Artifact 加入工作区 promote

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| Capability | `artifact.promote` |
| 前端能力 | 产出文件型 artifact 已显示门控的「加入工作区」按钮 |

**需求：**

1. 新增 `POST /api/v1/artifacts/:id/promote`。
2. 仅支持有 `file_asset_ref_id` 的文件型 artifact；无底层文件的 table/chart preview 返回结构化错误。
3. 后端基于 artifact 当前 `file_asset_ref_id` 指向的 `file_asset_id`，创建或复用一条 `source=workspace`、`session_id IS NULL` 的 FileAssetRef。
4. 操作应幂等：同 user/workspace/asset/name 已存在 workspace ref 时返回既有 ref。
5. 返回 `FileAssetRefDto`。

**验收：** 前端点击「加入工作区」后，左栏「工作区文件」刷新即可看到该文件；重复点击不会生成重复资产。

---

## R-023 Session artifact 列表恢复

| 字段 | 内容 |
| --- | --- |
| 优先级 | P1 |
| Capability | `artifact.list` |
| 前端能力 | 已新增门控的 `SessionArtifactsRestore`，后端未支持时 no-op |

**需求：**

1. 新增 `GET /api/v1/artifacts?sessionId=<threadId>`。
2. 返回该 user/session 下 artifact 列表，按 `created_at ASC` 或稳定顺序。
3. DTO 至少包含：

```json
{
  "id": "artifact-1",
  "type": "file",
  "name": "output/report.html",
  "fileId": "file-ref-1",
  "downloadUrl": "/api/v1/artifacts/artifact-1/download",
  "preview_json": { "path": "output/report.html" },
  "createdAt": "2026-06-26T..."
}
```

`fileId` 可为空（纯 preview 的 table/chart），但字段名需稳定。

**验收：** 刷新同一 session 页面后，前端右栏「产出」可恢复历史 artifact；无 artifact 时返回空数组。

---

## R-024 `run_config.pinnedPaths` 消费

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| Capability | `runConfig.pinnedPaths`（建议新增） |
| 前端能力 | `@` 本对话产物已写入 `run_config.pinnedPaths` 并标「后端未支持」 |

**背景：** 同 session 的产物文件已经位于 session workspace，后续 run 不需要通过 `fileIds` 再物化一份副本。前端因此将本对话产物 `@` 转成轻量 pin。

**需求：**

1. `extractEffectiveRunConfig` 解析 `run_config.pinnedPaths`（数组，session 相对路径）。
2. 校验路径必须仍在 session workspace 内，禁止 `..` / 绝对路径逃逸。
3. `buildAgentInstructions` 增加说明，例如：「用户本轮重点指定以下现有工作区文件：output/report.html，请优先读取/参考」。
4. 不复制文件到 `input/`，与 `workspaceAttachments` 分开。
5. `run.config.resolved` 回传 `pinnedPaths`。

**验收：** `@` 本对话产物后，agent 提示中包含该路径；session workspace 内不产生重复 `input/` 副本。

---

## R-025 对话框上传登记 session 级 FileAssetRef（可选）

| 字段 | 内容 |
| --- | --- |
| 优先级 | P3 |
| Capability | `chat.uploadFileRef`（建议新增） |
| 前端能力 | 当前仍保持聊天附件 chips；本项不阻塞本轮前端 |

**需求：** `POST /api/v1/chat/uploads` 在写入 session workspace `uploads/` 的同时，可选创建一条 `source=upload` 且带 `session_id` 的 FileAssetRef，使未来「本对话文件」管理视图可以统一展示对话框上传文件。

**验收：** 上传文件仍可作为聊天附件进入 run；同时 `GET /api/v1/files?scope=session&sessionId=...&origin=uploaded` 能列出该文件。

---

## R-026 Agent 工作区资产工具与 promote 语义

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| Capability | `agent.workspaceAssets`（建议新增） |
| 前端能力 | 不阻塞；前端已支持用户侧工作区资产注入 |

**需求：**

1. 新增只读工具 `list_workspace_assets`：列出跨 session 工作区资产（`session_id IS NULL`, `source IN upload/workspace`）。
2. 新增工具 `attach_workspace_asset(file_id)`：把指定资产物化进当前 session workspace `input/`，再由 agent 使用 `read_file`。
3. 收窄 `promote_workspace_file` 描述：它的语义是「提升为跨 session 可复用工作区资产」，不是「同 session 后续 run 复用」（同 session 文件已天然保留）。

**验收：** agent 能主动查看/附加跨 session 工作区资产；`promote_workspace_file` 不再鼓励为同 session 复用而重复晋升。

---

## R-027 `token_usage.correlation` 与 interaction 事件

| 字段 | 内容 |
| --- | --- |
| 优先级 | P2 |
| 前端能力 | Detail Tab 按 step 展示 Token；HITL 工具名从 interaction 事件补全 |

**背景：** 前端 reducer 已消费 `CUSTOM(name="token_usage.correlation")` 将 `step_id` / `tool_call_id` 挂到用量记录；当 `TOOL_CALL_START` 缺 `toolName` 时，从 `interaction.requested` / `interaction.resolved` 的 `tool_name` 补全协作工具显示名。

**需求：**

1. **`token_usage.correlation`**：在 emit `token_usage` 后（或同时）发送关联事件：

```json
{
  "type": "CUSTOM",
  "name": "token_usage.correlation",
  "value": {
    "step_id": "step-3",
    "tool_call_id": "call-abc",
    "tool_name": "run_sql_readonly"
  }
}
```

2. **`token_usage` 本体**（R-002 延续）：优先 provider `usage`；可选 `tool_name` 便于无 correlation 时兜底匹配。

3. **`interaction.requested` / `interaction.resolved`**：保持 [CopilotKit / AG-UI 前端协议](./copilotkit-ag-ui-frontend-protocol.md) 中 `tool_name`、`interrupt_event`、`resume_schema` 字段稳定；HITL suspend/resume 路径必须 emit。

4. **`GET /api/v1/sessions/:sessionId/conversation`**（R-005 延续）：返回的 `toolCalls[]` 需含稳定 `id` / `name` / `args` / `result`，供 `conversation-restore.ts` 重挂历史步骤 UI。

**验收：**

- 含 LLM + 工具调用的 run，Detail 中对应 step 显示 Token 用量（非仅 run 级累加）。
- `ask_user` / `submit_plan` HITL 流程 Trace 显示正确工具名与 suspend/resume 时间线。
- 刷新 session 后历史 tool-call 步骤 UI 可恢复。

