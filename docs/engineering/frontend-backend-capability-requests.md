# 前端 → 后端能力需求清单

日期：2026-06-24（#12 新增 session 级 workspace 隔离需求）
提出方：`apps/web`（`@open-data-agent/web`）
受理方：`apps/api` / dataAgent 后端
状态：**#1–#9 主体已交付**（见 [交付状态](./2026-06-23-frontend-backend-capability-status.md)）；**未实现项**见 [后端待实现需求清单](./backend-open-requirements-backlog.md)（含后端答复区）
关联：

- [config-management-api.md](./config-management-api.md)（配置管理 REST 契约，本清单的"接口"列均指向此文档）
- [copilotkit-ag-ui-frontend-protocol.md](./copilotkit-ag-ui-frontend-protocol.md)（AG-UI run 协议）

## 背景

前端左栏五类配置（DB / KB / MCP / LLM / Skill）目前已按"后端真实能力"裁剪，只暴露
现在能生效的字段。下列为前端需要、但后端尚未支持的能力。每项给出：现状、前端需求、
验收标准、依赖、优先级。

优先级口径：**P0 = 不做则核心配置全程无法生效**；P1 = 显著提升可用性；
P2 = 完整产品形态；P3 = 后置增强。

## 总览

| # | 能力 | 后端现状 | 优先级 | 依赖 | Open backlog |
| --- | --- | --- | --- | --- | --- |
| 1 | secretRef 密钥服务 | 无 | **P0** | — | 已交付 |
| 2 | Datasource REST + 真实 DB adapter | 仅 file 类型 + demo，无 REST | **P0** | 1 | 已交付（验收见 O-003） |
| 3 | run_config 上下文消费（超出 datasourceId） | 仅认 datasourceId | **P0** | — | 已交付 |
| 4 | LLM model-profiles + 按 run 切换 | env 驱动，进程级 | P1 | 1, 3 | 已交付 |
| 5 | 查询策略下沉 + 更多数据工具 | 硬编码 limit/timeout，仅 2 tool | P1 | 2 | 已交付 |
| 6 | KB / RAG 实现 + REST | 仅类型接口 | P2 | 1, 3 | 已交付 |
| 7 | MCP 挂载 + registry REST | 完全无 | P2 | 1, 3 | 已交付 |
| 8 | Skill / task profile 策略层 | 完全无 | P3 | 3 | 已交付 |
| 9 | Artifact 预览/下载 API | 仅 CUSTOM 摘要 | P3 | — | 部分 → [O-004](./backend-open-requirements-backlog.md#o-004-artifact-北向协议收敛) |
| 10 | 多用户认证 / workspace 隔离 | 固定 dev-user | P3 | — | [O-006](./backend-open-requirements-backlog.md#o-006-多用户认证--租户-workspace-隔离) |
| 11 | LLM Token 用量上报（AG-UI） | 未 emit `token_usage` | P1 | — | [O-002](./backend-open-requirements-backlog.md#o-002-llm-token-用量上报-ag-ui) |
| 12 | Session 级 Workspace 隔离（跨 run 文件持久） | 按 run 隔离，run 结束即销毁 | **P1** | — | [O-001](./backend-open-requirements-backlog.md#o-001-session-级-workspace-隔离跨-run-文件持久) |
| 13 | 对话框文件上传（图片多模态 + 数据文件落工作区） | 无 chat 上传端点；`extractLastUserText` 忽略非文本 part | P1 | 12 | [O-007](./backend-open-requirements-backlog.md#o-007-对话框文件上传图片多模态--数据文件落工作区) |

---

## 1. secretRef 密钥服务（P0，地基）

**现状**：无密钥存储。前端凭据只在 localStorage，且已被刻意从 AG-UI 协议剥离，
导致后端根本拿不到任何凭据。

**前端需求**：
- 写接口接收明文凭据（HTTPS body），落入服务端密钥库（加密/Vault），返回 `secretRef`。
- 读接口永不回传明文，只回 `secretRef` + `hasSecret`。
- run 时后端凭 `secretRef` 取真实凭据，前端不再持有。

**验收标准**：
- 任一资源（DB/LLM/MCP）创建后，GET 详情不含明文密钥。
- 删除资源时关联 secret 一并失效。

**依赖**：无（其他带凭据的能力都依赖它）。

## 2. Datasource 注册 REST + 真实 DB adapter（P0）

**现状**：`createAdapter` 仅实现 `duckdb(demo) / sqlite / csv / xlsx`；`postgresql` /
`mysql` 为 `enabled:false` 占位会直接 throw；`bigquery` / `snowflake` 无代码。
`server.ts` 只有 `/healthz` 和 `/api/copilotkit`，无 datasource REST；run 时对任意
datasourceId 自动兜底创建 duckdb demo。

**前端需求**：
- 实现 `config-management-api.md §3.1` 的 datasource CRUD + `test` + `introspect` + `schema`。
- 至少新增 **PostgreSQL / MySQL** 只读 adapter（最高频诉求）。
- 凭据走 secretRef（依赖 #1）。
- 取消"未知 datasourceId 静默兜底成 demo"，改为返回明确错误，避免假成功。

**验收标准**：
- 前端可 list/create/test 一个真实 PG 只读源并在该源上跑通 `inspect_schema` + `run_sql_readonly`。
- 测试连接失败返回结构化错误码。

**依赖**：#1。

## 3. run_config 上下文消费（P0）

**现状**：`extractDatasourceId` 只从 `forwardedProps/state/context` 提取
`datasourceId`，其余 `llm_config` / `mcp_config` / `enabled_skill_ids` 等只透传给
`@ag-ui/mastra`，不进入业务策略。

**前端需求**：
- 后端在 run 入口解析 `context.run_config`（结构见 `config-management-api.md §5`），
  得到本轮 `enabledDatasourceIds / activeLlmProfileId / activeSkillId / enabledMcpServerIds` 等。
- 与 workspace 默认 + server policy 合并为 `effectiveRunConfig`。
- 这是 #4/#6/#7/#8 真正生效的总开关。

**前端现状（已先行实现，等后端消费）**：
- 对话框底 **session 配置胶囊**（`SessionConfigBar`）：按会话持久化启用集，
  写入 `run_config.enabled*Ids`；默认全开，可逐项关闭某 db/kb/mcp/skill。
- 对话框 **`@` 点名**（`chat-mentions.tsx`）：只能从 session 启用集里选；
  写入 `run_config.mentioned` 与 `active*`；**不收窄** `enabled*Ids`（@ 是指定
  优先，不是限定可用）；per-run，发送后即清。
- 目前只有 `@db` / session db 启用集经 `datasource_id` 真正生效；kb/mcp/skill
  已带「后端未支持」标记，**等本能力（及 #6/#7/#8）落地即自动生效**。

**验收标准**：
- 前端在对话框切换 session 启用集 / `@` 点名 / 模型，后端 run 实际使用对应值
  （可在 `run_events` 验证）。
- 后端按 `enabled*Ids` 使用 session 启用集；按 `mentioned` / `active*` 理解用户
  显式点名；未被 @ 的 session 启用资源仍应可用。

**依赖**：无（但是 #4/#6/#7/#8 的前置）。

## 4. LLM model-profiles + 按 run 切换（P1）

**现状**：`createModelProviderFromEnv(process.env)` 进程级读取 `LLM_*`；
`runInput` 无 LLM profile 提取；非 openai-compatible 走 Mastra router 泛型路径
（anthropic/google 无专用 adapter，未验证）。

**前端需求**：
- 实现 `config-management-api.md §3.4` model-profiles CRUD + `test`。
- run 时按 `context.active_llm_config.profileId`（依赖 #3）选用对应 profile，
  凭 secretRef 取 key（依赖 #1）。
- 明确 anthropic / google 经 router 是否可用；不可用则前端从 provider 列表移除。

**验收标准**：
- 前端切换 active 模型后，该 run 实际由对应 provider/model 执行。
- 验证后回填 temperature / maxTokens 等字段是否被消费（决定前端是否恢复这些字段）。

**依赖**：#1, #3。

## 5. 查询策略下沉 + 更多数据工具（P1）

**现状**：Data Gateway 硬编码 `limit=min(?,1000)`、`timeout=10000`，未引用
`createEnvConfig().sql`（`SQL_DEFAULT_LIMIT/SQL_MAX_LIMIT/SQL_TIMEOUT_MS`）。
契约定义 9 个工具，仅 `inspect_schema` / `run_sql_readonly` 暴露。

**前端需求**：
- 把 env `SQL_*`（及未来 per-datasource `maxRows/timeoutMs`）真正接入 Gateway，
  使前端"查询策略"字段有意义（届时前端恢复这些 DB 字段）。
- 暴露已有能力的工具：至少 `preview_table`（Gateway 已有 `previewTable()` 未挂载）、
  `list_data_sources`，供前端做数据预览/数据源列举。

**验收标准**：
- 调整策略后，超限/超时按配置值触发，而非硬编码值。
- 前端能通过 agent 工具预览表数据。

**依赖**：#2。

## 6. KB / RAG 实现 + REST（P2）

**现状**：`packages/knowledge` 仅 `KnowledgeService` 接口，无实现、无向量库、无
embedding 调用；`retrieve_knowledge` 工具未注册；embedding env 仅声明未实现。

**前端需求**：
- 实现 `KnowledgeService` + 向量检索 + `retrieve_knowledge` 工具注册。
- 实现 `config-management-api.md §3.2` KB CRUD + 文件上传 + reindex + search。
- run 时按 `context.run_config.enabledKnowledgeIds` 注入检索（依赖 #3）。

**验收标准**：
- 前端上传文档、建索引，提问时 agent 召回并在回答中带引用。

**依赖**：#1, #3。前端在此之前 KB 卡片保持"后端未支持"。

## 7. MCP 挂载 + registry REST（P2）

**现状**：应用代码 0 处使用 MCP（仅传递依赖存在 `@modelcontextprotocol/sdk`）。

**前端需求**：
- 用 `@ag-ui/mcp-middleware`（或等价）按启用的 server 动态挂载外部 MCP 工具。
- 实现 `config-management-api.md §3.3` MCP CRUD + `test` + tools manifest。
- run 时按 `context.run_config.enabledMcpServerIds` + `toolAllowlist` 生效（依赖 #3）。
- 鉴权凭据走 secretRef（依赖 #1）。

**验收标准**：
- 前端注册一个 MCP server 后，其工具出现在 run 的 `TOOL_CALL_*` 轨迹中。

**依赖**：#1, #3。前端在此之前 MCP 卡片保持"后端未支持"。

## 8. Skill / task profile 策略层（P3）

**现状**：无 skill 概念，固定单一 `dataAgent`；`chat_mode` 只是 run context 字符串，
不驱动策略。

**前端需求**：
- Skill **上传导入**（`.md` / `.zip`），解析 `SKILL.md` frontmatter；对齐
  `config-management-api.md §3.5`（`POST` multipart + `validate` + `replace`）。
- 引入 skill loader：按 `activeSkillId`（依赖 #3）加载包内容、过滤
  `allowed-tools`、注入 agent 指令。

**验收标准**：
- 上传不同 Skill 包后，agent 行为（可用工具 / 提示）确有差异。
- 内置 Skill 只读；自定义 Skill 可替换包。

**依赖**：#3。前端在此之前 Skill 面板为**本地上传 + localStorage 暂存**（不经
AG-UI 传包正文）。

## 9. Artifact 预览 / 下载 API（P3）

**现状**：artifact 通过 AG-UI `CUSTOM(name="artifact")` 事件推送摘要；SQL 结果（`type=table`）与
工作区文件（`type=file`，来自 `write_file` / `edit_file` / `execute_command` 快照 diff）均可落库。
前端产物卡片可展开预览 metadata，但**完整内容查看与下载**仍依赖 REST。

**前端需求**（契约，前端 `artifact-export-client` 已按此实现，能力位 `artifact.export` gate）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/artifacts/:id` | 返回 artifact 元信息（id, type, name, preview_json, run_id, session_id） |
| `GET` | `/api/v1/artifacts/:id/preview` | 返回可查看内容：`type=table` 时为 `{ columns, rows, row_count }`；`type=file` 时为 `{ content, path, size, content_type }`（文本文件 inline，二进制返回 base64 或 signed URL） |
| `GET` | `/api/v1/artifacts/:id/download` | 以 `Content-Disposition: attachment` 返回原始字节；file 类型从 run 工作区 `{workspaceRoot}/{user_id}/{session_id}/{run_id}/{path}` 安全读取 |

**安全约束**：
- 校验 `(user_id, session_id, run_id)` 与 artifact 记录一致后再读文件。
- file 路径必须相对于 run 工作区，禁止 `..` 逃逸。
- 仅 `GET`，不暴露写接口。

**验收标准**：
- 前端产物卡片展开后可「查看」文本/SQL 预览、「下载」完整文件。
- `GET /api/v1/capabilities` 返回 `artifact.export: true` 后，前端按钮自动启用。

**依赖**：#10 多用户认证完善后可叠加 workspace 级隔离；MVP 可与现有 `dev-user` 固定身份共存。

## 11. LLM Token 用量上报（AG-UI `token_usage`）（P1）

**现状**：
- 前端 Task Console **概览** Tab 已预留整轮 Token 汇总行，**详情 → 用量** 面板亦已占位；
  仅当后端通过 AG-UI 推送 `token_usage` 事件时才会显示真实数字，否则展示
  「整轮 Token 用量待后端通过 token_usage 事件上报」。
- 前端 reducer（`live-run-state.ts`）已实现消费逻辑：累加 `input_tokens` /
  `output_tokens`（兼容别名 `prompt_tokens` / `completion_tokens`），并写入 run /
  session 级 `tokenUsage` 统计。
- 后端 **未** emit 名为 `token_usage` 的 `CUSTOM` 事件。现有与 token 相关的事件仅服务于
  上下文预算，**不是** LLM 真实计费用量：
  - `context.prompt-verified` — 本地估算 prompt token，用于 `ProviderPromptGuardProcessor` 预算校验；
  - `context.compiled` — 上下文编译计划中的 `token_report`，用于 step 级 context budget 决策。

**前端需求**（AG-UI 流契约，**无需 REST**）：

在每次 LLM 调用完成时（或 run 结束时汇总一次），经 AG-UI `CUSTOM` 事件上报：

```json
{
  "type": "CUSTOM",
  "name": "token_usage",
  "value": {
    "input_tokens": 1200,
    "output_tokens": 340
  }
}
```

字段约定：

| 字段 | 类型 | 说明 |
|------|------|------|
| `input_tokens` | number | 本轮/本步 LLM 输入 token（优先字段名） |
| `output_tokens` | number | 本轮/本步 LLM 输出 token（优先字段名） |
| `prompt_tokens` | number | 可选别名，前端与 `input_tokens` 等价处理 |
| `completion_tokens` | number | 可选别名，前端与 `output_tokens` 等价处理 |
| `step_number` | number | 可选，**最后兜底**：1-based **当前 run 段内**工具调用序号；仅当 `tool_call_id` / `step_id` 均缺失时前端才用此字段匹配，并在 UI 标注「近似匹配」。后端应优先 emit `tool_call_id` 或 `step_id` |
| `step_id` | string | 可选，后端 ACTIVITY STEP `step_id`；**优先**用于精确匹配步骤 |
| `tool_call_id` | string | 可选，AG-UI `toolCallId`；**优先**用于精确匹配步骤 |
| `model` | string | 可选，实际调用的 model id；前端在概览 / 详情以模型 chip 展示 |
| `cost_usd` | number | 可选，本次增量调用成本（美元）；前端累加到整轮成本并在步骤详情展示 |

**实现建议**（`packages/agent-runtime`）：
- 从 Mastra / LLM provider 响应的 `usage` 元数据读取真实用量（非 `PromptTokenCounter` 本地估算值）。
- 可在 `@ag-ui/mastra` stream 归一化层或 agent run 收尾处 emit；同一 run 内多次 LLM 调用应
  **分次 emit**（前端会累加），或在单次 emit 中给出增量值。
- 与现有 `context.prompt-verified` / `context.compiled` 并存，互不替代。

**前端现状（已先行实现，等后端上报）**：
- `live-run-state.ts` 已消费 `input_tokens/output_tokens/prompt_tokens/completion_tokens`，并扩展消费
  `step_number/step_id/tool_call_id/model/cost_usd`。
- `TaskConsole` 概览 Tab 会显示整轮 Token / 成本 KPI；详情 Tab「用量」面板会按步骤显示输入/输出
  Token 迷你条、模型 chip 与成本。
- 当没有 `token_usage` 事件或无法归属到步骤时，前端展示「后端未支持」提示，不臆造数字。
- 仅通过 `step_number` 匹配到的步骤用量会显示「近似匹配（仅 step_number）」提示。

**验收标准**：
- 完成一次含 LLM 推理的 agent run 后，前端概览 Tab 显示「整轮 Token：输入 N · 输出 M」
  （`tokenUsageReported === true`）。
- 若事件包含 `model/cost_usd`，前端概览显示模型名与成本；若事件包含 `step_number` / `step_id` /
  `tool_call_id`，详情 Tab 对应步骤显示按步骤 Token 迷你条。
- `run_events` / AG-UI 持久化流中可查到至少一条 `CUSTOM(name="token_usage")` 事件。
- 用量数字与 provider 返回的 `usage` 一致（允许 ±本地估算误差，但应优先 provider 实测值）。

**依赖**：无（与 #4 LLM profile 独立；profile 切换后仍应上报实际 model 的 usage）。

## 10. 多用户认证 / workspace 隔离（P3）

**现状**：固定 `user_id=dev-user`，无认证。

**前端需求**：用户认证 + 资源按 `(workspaceId, userId)` 隔离，支撑配置的 `scope` 与团队共享。

**验收标准**：不同用户看到各自的配置与会话。

---

## 12. Session 级 Workspace 隔离（跨 run 文件持久）（P1）

**提出背景**：前端同一聊天 session（AG-UI `threadId`）内连续提问时，CopilotKit 每次会发起
**新 run**（新 `runId`），这是 AG-UI 标准语义，**前端不会也不应**为复用文件而强行复用
`runId`。但后端当前把 Workspace 绑定在 **run** 粒度，并在 run 结束时销毁，导致：

1. 第一轮 `write_file` 落盘的文件，第二轮 `list_files` 只能看到**空目录**或仅有
   `mkdir` 的空文件夹；
2. 模型虽能从对话历史看到上一轮的文件路径，但当前 run 的文件系统不可访问，产生
   **历史与 filesystem 不一致**的幻觉；
3. Artifact 仅保存 metadata / 小文本 preview，run 结束后 workspace 文件已被
   `destroyWorkspace()` 删除，无法通过文件工具续读。

**现状（后端）**：

| 环节 | 当前行为 | 代码位置 |
| --- | --- | --- |
| 目录结构 | `{workspaceRoot}/{user_id}/{session_id}/{run_id}/` | `packages/agent-runtime/src/tools/workspace-factory.ts` |
| 绑定时机 | `createDataAgent` 每次 run 创建一次 Workspace | `packages/agent-runtime/src/index.ts` |
| 生命周期 | `RUN_FINISHED` / `RUN_ERROR` / cancel 时调用 `destroyWorkspace()` | `apps/api/src/server.ts` |
| 设计文档 | Phase 1 明确写「不实现跨 run 的持久项目工作区」 | `docs/plans/2026-06-22-general-data-agent-expansion.md` §2.2 |

**前端现状（无需改动即可受益）**：

- 每个聊天 session 对应稳定 `threadId`（= 后端 `session_id`），多轮提问已在同一 session 内；
- 每轮提问 CopilotKit 自动生成新 `runId`，符合 AG-UI 幂等与回放模型；
- 前端 **不** 持有 workspace 路径，也不决定隔离粒度——**隔离策略须由后端调整**。

### 需求目标

将 Agent 文件工作区从 **run 级** 调整为 **session 级**，使同一 `(user_id, session_id)` 下
的多次 run 共享同一 filesystem root，支撑「上一轮写文件、下一轮继续读/改/list」的多轮分析
工作流。

### 功能需求

#### F1. Session 级目录

- Workspace 根目录改为：`{workspaceRoot}/{user_id}/{session_id}/`。
- `run_id` **不再**参与 filesystem path segment（仍保留于 `AgentRunContext`、审计、artifact
  metadata，用于 run 级追溯）。
- 路径安全校验保持不变：`contained: true`、禁止 `..` 逃逸、`safePathSegment` 校验
  `user_id` / `session_id`。

#### F2. 生命周期：run 结束不删 session 工作区

- 单次 run 的 terminal 事件（completed / failed / canceled）**不再**调用
  `destroyWorkspace()` 删除 session 目录。
- 提供明确的 session workspace 回收策略（至少一种，可配置）：
  - **推荐 MVP**：session 目录随 session 长期保留，直到管理员清理或 TTL 任务回收；
  - **可选增强**：前端删除聊天 session 时，调用后端 `DELETE /api/v1/sessions/:threadId/workspace`
    （或等价 internal API）触发清理；
  - **可选增强**：`WORKSPACE_SESSION_TTL_DAYS` 环境变量 + 后台 sweep。
- `ask_user` / `submit_plan` **suspend → resume** 仍属同一 run，行为与现网一致。

#### F3. 并发与同 session 多 run

- 同一 session 内，客户端通常**串行**发起 run；后端仍须定义并发策略：
  - **MVP 建议**：同一 `(user_id, session_id)` 同时只允许一个 active run（与现有
    `RUN_ALREADY_ACTIVE` 冲突策略对齐）；后续 run 排队或拒绝并返回明确错误码。
  - 若允许并发，须文档化文件写冲突语义（后写覆盖 / 乐观锁），MVP 可不支持。
- `execute_command` sandbox 的 `workingDirectory` / `readWritePaths` 指向 session 目录。

#### F4. Artifact 与下载路径对齐

- `write_file` / `edit_file` / `execute_command` 触发的 file artifact，`preview_json.path`
  仍为 session workspace 内相对路径。
- #9 Artifact 下载 API 读取路径从
  `{root}/{user}/{session}/{run}/{path}` 改为
  `{root}/{user}/{session}/{path}`；校验 `(user_id, session_id)` 与 artifact 记录一致，
  `run_id` 仅作 provenance，不作 path segment。
- 已有 artifact 记录（旧 run 级路径）迁移策略：兼容读取或标记 legacy（实现方二选一并在
  PR 说明）。

#### F5. Agent 指令与观测

- System prompt 中 workspace 相关表述更新为「本 session 工作区在多次 run 间持久」；
  删除或改写「文件随 run 结束销毁」的隐含语义。
- `CUSTOM(name="workspace.metadata")`（若已 emit）payload 中 `scope: "session"` 或等价字段，
  便于前端/Task Console 展示「Session 工作区」而非「本 run 临时目录」（**可选**，非阻塞 MVP）。

### 非目标（本需求不包含）

- 跨 session / 跨用户共享工作区；
- 远程 sandbox provider（e2b / modal 等）；
- 完整 artifact 二进制归档（#9 仍可按需独立推进）；
- 修改 AG-UI `threadId` / `runId` 语义或前端 CopilotKit 发 run 的方式。

### 验收标准

1. **多轮文件持久（核心）**
   - 同一 `threadId` 下：Run A 执行 `write_file` 写入 `outputs/report.csv` 并成功结束；
   - Run B（新 `runId`）执行 `list_files` 可列出 `outputs/report.csv`；
   - Run B 执行 `read_file` 内容与 Run A 写入一致。

2. **Run 结束不丢文件**
   - Run A `RUN_FINISHED` 后，session 目录内文件仍存在（filesystem 抽查或 Run B 验证）。

3. **Session 间隔离**
   - Session S1 写入的文件，Session S2（不同 `threadId`）的 `list_files` / `read_file` 不可见。

4. **用户间隔离**
   - 不同 `user_id` 的 session 目录互不可见（现网 dev-user 固定身份下至少保证 path 隔离逻辑正确）。

5. **安全边界不退化**
   - 仍无法通过工具参数读取 `{workspaceRoot}` 外路径；`execute_command` 沙箱
     `readWritePaths` 不扩大。

6. **测试**
   - `packages/agent-runtime` 或 `apps/api` 增加集成测试覆盖「同 session 两 run 读写同一文件」；
   - 更新 `scripts/verify-tools/workspace-tools.mjs` 或等价脚本。

### 实现建议（供后端参考）

```typescript
// workspace-factory.ts — 由 run 级改为 session 级
const resolveSessionWorkspaceDir = (input: WorkspaceFactoryInput): string => {
  const root = resolveWorkspaceRoot(input.workspaceRoot);
  const segments = [
    safePathSegment(input.runContext.user_id, "user_id"),
    safePathSegment(input.runContext.session_id, "session_id"),
  ];
  return path.resolve(root, ...segments);
};

// server.ts — terminal path 不再 destroy session workspace
// 可选：仅清理 run 级临时子目录（若未来引入 run scratch）
```

- 函数命名：`createRunWorkspace` 可重命名为 `createSessionWorkspace` 或保留名但改 path 语义，
  并在注释 / ADR 中说明 breaking change。
- 修订 `docs/plans/2026-06-22-general-data-agent-expansion.md` §2.2 / §4.2 中与
  「不实现跨 run 持久工作区」冲突的表述。

### 优先级与依赖

- **优先级：P1** — 不阻塞配置 CRUD，但阻塞「多轮数据分析 + 文件产物」的核心体验；
  与 #11 同属第二波体验项。
- **依赖**：无硬依赖；与 #9 Artifact 下载、#10 多用户认证正交（认证落地后 path 隔离逻辑应仍成立）。

### 前端配合项（本需求落地后）

- 无需改 CopilotKit run 发起逻辑；
- 可选：Task Console / 产物区文案改为「Session 工作区文件」；
- 可选：删除 session 时调用 workspace 清理 API（待后端提供）。

---

## 13. 对话框文件上传（图片多模态 + 数据文件落工作区）（P1）

**提出背景**：`/data-tasks` 对话框需要支持上传文件，覆盖两类用途：图片喂多模态 LLM
直接"看"；数据/文本文件（csv/tsv/xlsx/json/parquet/txt/pdf）作为数据让 Agent 分析，
需落到后端 session 工作区供文件工具读取。设计规格见
[`docs/superpowers/specs/2026-06-24-chat-file-upload-design.md`](../superpowers/specs/2026-06-24-chat-file-upload-design.md)。

**现状（后端）**：

- `apps/api/src/upload-parser.ts` 仅服务 **Skill 配置** multipart 上传，与对话框无关。
- `run-input.ts:extractLastUserText` 只提取 `type:"text"` 的 message content part，
  **忽略**图片/文件 part；图片内联能否真正喂给模型未验证。
- 无任何"对话框文件上传"端点，数据文件无法落 session 工作区。

**前端需求**：

- **#13a 多模态图片消费**：后端 run 入口解析 user message `content` 中 `type:"image"`
  part，转交多模态 LLM；下发能力位 `chat.imageInput = true`。
- **#13b 对话框文件上传端点**：新增 `POST /api/v1/chat/uploads`（multipart，复用
  `upload-parser` 大小/类型限制思路），文件写入 session 工作区
  `{workspaceRoot}/{user_id}/{session_id}/uploads/`，返回 `{ path, mimeType, size }`；
  run 时 agent 文件工具可读；下发能力位 `chat.fileUpload = true`。

**前端现状（已先行实现，等后端消费）**：

- 对话框附件 UI 完整：选择 / 拖拽 / 粘贴 / 预览 / 移除 / 上传状态。
- 图片走 `useAttachments` 默认 base64 内联；数据文件走 `onUpload`。
- 能力位 `chat.imageInput` / `chat.fileUpload` 为 false 时，对应附件标「后端未支持」
  且**不进入** outgoing run（不假装能用），文本照常发送；能力位翻 true 后自动生效。

**验收标准**：

- 上传一张图片提问，run 中 LLM 能据图作答（`run_events` 可验证图片进入模型输入）。
- 上传一个 CSV，下一条消息 Agent 能 `read_file` 读到并分析。
- 安全：校验 `(user_id, session_id)`、禁 `..` 逃逸、限大小/类型；仅本 session 可见。

**依赖**：#13b 强依赖 #12（session 级工作区）；#12 落地前 `chat.fileUpload` 保持 false。

---

## 建议落地顺序

1. **第一波（解锁"配置能生效"）**：#1 secretRef → #2 Datasource REST + PG/MySQL → #3 run_config 消费。
   完成后 DB 选择/注册端到端可用，且为后续所有带凭据能力打好地基。
2. **第二波（模型与数据体验）**：#4 LLM profile 切换 → #5 查询策略 + 数据工具 → **#11 Token 用量上报** → **#12 Session 级 Workspace**。
3. **第三波（扩展能力）**：#6 KB、#7 MCP。
4. **第四波（产品化）**：#8 Skill 策略、#9 Artifact、#10 多用户。

每完成一项，前端按 `config-management-api.md` 的"UI 当前暴露 vs 文档完整契约"把对应
字段从文档恢复到 UI。
