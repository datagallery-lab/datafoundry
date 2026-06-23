# 前端 → 后端能力需求清单

日期：2026-06-22
提出方：`apps/web`（`@open-data-agent/web`）
受理方：`apps/api` / dataAgent 后端
状态：需求待评审 / 排期
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

| # | 能力 | 后端现状 | 优先级 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | secretRef 密钥服务 | 无 | **P0** | — |
| 2 | Datasource REST + 真实 DB adapter | 仅 file 类型 + demo，无 REST | **P0** | 1 |
| 3 | run_config 上下文消费（超出 datasourceId） | 仅认 datasourceId | **P0** | — |
| 4 | LLM model-profiles + 按 run 切换 | env 驱动，进程级 | P1 | 1, 3 |
| 5 | 查询策略下沉 + 更多数据工具 | 硬编码 limit/timeout，仅 2 tool | P1 | 2 |
| 6 | KB / RAG 实现 + REST | 仅类型接口 | P2 | 1, 3 |
| 7 | MCP 挂载 + registry REST | 完全无 | P2 | 1, 3 |
| 8 | Skill / task profile 策略层 | 完全无 | P3 | 3 |
| 9 | Artifact 预览/下载 API | 仅 CUSTOM 摘要 | P3 | — |
| 10 | 多用户认证 / workspace 隔离 | 固定 dev-user | P3 | — |

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

**现状**：artifact 仅通过 AG-UI `CUSTOM(name="artifact")` 摘要可见，无预览/下载。

**前端需求**：按 artifact id 拉取明细 / 下载（表格预览、CSV 下载等）。

**验收标准**：前端产物卡片可展开预览并下载。

## 10. 多用户认证 / workspace 隔离（P3）

**现状**：固定 `user_id=dev-user`，无认证。

**前端需求**：用户认证 + 资源按 `(workspaceId, userId)` 隔离，支撑配置的 `scope` 与团队共享。

**验收标准**：不同用户看到各自的配置与会话。

---

## 建议落地顺序

1. **第一波（解锁"配置能生效"）**：#1 secretRef → #2 Datasource REST + PG/MySQL → #3 run_config 消费。
   完成后 DB 选择/注册端到端可用，且为后续所有带凭据能力打好地基。
2. **第二波（模型与数据体验）**：#4 LLM profile 切换 → #5 查询策略 + 数据工具。
3. **第三波（扩展能力）**：#6 KB、#7 MCP。
4. **第四波（产品化）**：#8 Skill 策略、#9 Artifact、#10 多用户。

每完成一项，前端按 `config-management-api.md` 的"UI 当前暴露 vs 文档完整契约"把对应
字段从文档恢复到 UI。
