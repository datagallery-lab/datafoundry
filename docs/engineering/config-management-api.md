# 工作区配置管理 API 方案

日期：2026-06-25
受众：后端 / BFF 同学、前端（`apps/web`）同学
状态：已实现基础版（local-first REST API + run_config 生效链路）
关联：

- [copilotkit-ag-ui-frontend-protocol.md](./copilotkit-ag-ui-frontend-protocol.md)（AG-UI run 协议，配置 run 时如何透传）
- [apps/web/src/app/data-tasks/DESIGN.md](../../apps/web/src/app/data-tasks/DESIGN.md)（前端三层配置模型）

## 1. 背景与定位

前端左栏五类配置（DB / KB / MCP / LLM / Skill）已有本地 `localStorage`
实现；后端现已提供 local-first 配置管理 REST API。本文件同时作为接口契约和当前实现说明。

核心边界：**配置管理不走 AG-UI event stream，走独立 BFF REST API。**
`POST /api/copilotkit` 只负责 agent run；配置的创建/测试/启用/删除是
普通资源 CRUD，二者必须分离。

文件上传也走 REST：`POST /api/v1/files`。上传接口只创建 FileAssetRef；真正拉起
agent run 仍走 `/api/copilotkit`，并通过 AG-UI `RunAgentInput.forwardedProps.run_config.fileIds`
把文件引用传给本次 run。当前没有单独的 `/api/v1/runs`。

### 1.1 三层配置模型

```
effectiveRunConfig = merge(workspaceDefaults, perRunOverrides, serverPolicy)
```

| 层 | 归属 | 含义 | 载体 |
| --- | --- | --- | --- |
| workspace default | 左栏 | 工作区"装了什么、默认是否可用" | 本 REST API（落库） |
| per-run override | 对话框 | 本次任务临时开/关、换模型/数据源 | AG-UI `forwardedProps` / `context` |
| server policy | 后端 | 权限、安全策略、强制开关，最终裁决 | 后端 merge 逻辑 |

左栏不是"每轮选择器"，是"工作区默认配置中心"，默认全部可用、无 per-item
小开关。是否本轮关闭由对话框 override 决定，最终是否允许由 server policy 裁决。

### 1.2 凭据原则（强约束）

- 凭据（API Key / Token / DB password）**绝不进入 AG-UI 协议**，也不进入模型上下文。
- 前端只能传 `secretRef`（指向后端密钥）或 `hasApiKey` 布尔标记，不能传明文。
- 写接口可接收明文凭据（HTTPS body），后端立即落入密钥存储并返回 `secretRef`；
  读接口永不回传明文，只回 `secretRef` + `hasSecret`。
- 这与协议文档第 79 行"前端不能通过协议传入 credential"一致。

当前本地优先阶段使用 `SecretStore` 抽象，默认实现为 SQLite 加密存储：

- 主密钥只从服务端环境变量读取，不进入 SQLite、日志、事件或 API 响应。
- 资源写接口接受一次性的 `credentials` 写入块，事务内生成或替换 `secretRef`。
- 不提供通用的 secret 明文读取 API；资源读接口仅返回 `secretRef` 与 `hasSecret`。
- PATCH 未提供 `credentials` 时保留原 secret；显式 `clearCredentials: true` 才解除引用。
- 删除资源时仅删除该资源独占且无其他引用的 secret，并记录审计事件。
- `SecretStore` 后续可以替换为 Vault / KMS，而不改变资源 API 和 run 配置协议。

### 1.3 当前实现摘要

已在 `apps/api` 挂载 `/api/v1/*` REST 路由，配置数据落入 `packages/metadata`
的本地 SQLite store，密钥由 `EncryptedSecretStore` 使用 `SECRET_MASTER_KEY`
加密。run 入口通过 `resolveEffectiveRunConfig` 合并 workspace defaults、per-run
override 与 server policy，形成不可变资源 revision snapshot，并驱动 provider、tools、
Knowledge 与 MCP middleware。

已实现：

- Datasource CRUD / test / introspect / schema；支持 DuckDB demo、SQLite、CSV、XLSX、PostgreSQL、MySQL。
- Knowledge Base CRUD / 文件上传 / search / reindex；本地 FTS fallback，配置了 embedding key 时使用向量索引。
- MCP server CRUD / test / tools manifest；run 内使用官方 `@ag-ui/mcp-middleware` 挂载 streamable HTTP / SSE server。
- Model profile CRUD / test；run 内按 profile 切换 provider，并支持 fallback profile chain。
- Skill multipart 上传 / validate / replace / package 下载；按 active skill 注入指令并用 `allowedTools` 收窄工具集。
- Workspace config、run defaults、job 查询/取消、artifact detail / preview / content / download。
- FileAssetRef 批量上传 / 下载；run_config `fileIds` 注入 workspace `input/`。

仍未完成：

- 多用户认证仍是固定 `dev-user`，但 schema 已包含 `workspace_id` 与 `user_id`。
- PG/MySQL adapter 已实现类型与只读执行，缺少真实服务端集成环境 smoke。
- Artifact 北向 AG-UI 事件仍保留 preview JSON；workspace artifact 北向收敛留到下一阶段。

## 2. 通用约定

### 2.1 路径与版本

```text
/api/v1/datasources
/api/v1/knowledge-bases
/api/v1/mcp-servers
/api/v1/model-profiles
/api/v1/skills
/api/v1/files
/api/v1/workspace-config
/api/v1/run-defaults
```

### 2.2 响应包络

统一使用 contracts 中的 `ApiResult<T>` 包络，并在引入配置路由时一次性扩展结构化错误：

```jsonc
// 成功
{ "success": true, "data": { /* ... */ } }
// 失败
{
  "success": false,
  "error": {
    "code": "DATASOURCE_TEST_FAILED",
    "message": "...",
    "details": { }
  }
}
```

配置 REST 与 `/healthz` 已统一迁移到上述嵌套错误和 `success` envelope，不保留旧
`err_code` / `err_msg` 响应格式。HTTP status 表达传输层结果，`error.code`
表达稳定业务错误；不得把所有异常统一映射成 500。

### 2.3 通用字段

每个配置资源都包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定 id（内置项用语义 id，如 `api-duckdb-demo`） |
| `name` | string | 显示名 |
| `description` | string | 描述 |
| `defaultEnabled` | boolean | **workspace 默认是否可用**（对应前端 `enabled`，默认 `true`） |
| `builtin` | boolean | 是否内置（内置项核心字段只读、不可删除） |
| `createdAt` / `updatedAt` | ISO8601 | 审计时间 |
| `revision` | integer | 乐观并发版本，从 1 递增 |

> 命名说明：前端现有 `enabled` 字段语义即"工作区默认可用"，后端落库统一叫
> `defaultEnabled`，REST DTO mapper 负责字段映射，避免与 per-run override 的"本轮启用"混淆。
> 各资源生命周期不同，不设置含义模糊的通用 `status`；分别使用
> `connectionStatus`、`indexStatus`、`healthStatus`、`validationStatus`。

### 2.4 鉴权

当前后端固定 `user_id=dev-user`（见协议文档）。本方案接口先按单用户实现，但从第一版
开始所有配置表均保存 `workspace_id` 与 `user_id`，默认值分别为 `default` 与 `dev-user`。
当前 workspace 由可信服务端身份上下文解析，不接受客户端在 AG-UI body 中任意指定。
引入认证后替换身份解析器，资源 API 路径和数据模型无需迁移。

### 2.5 测试动作

每类资源提供 `POST /:id/test`（或创建前 `POST /test` dry-run），返回连通性结果，
不改变资源状态以外的数据：

```jsonc
{ "success": true, "data": { "status": "connected", "latencyMs": 42, "detail": { } } }
```

资源更新使用 `If-Match` 或请求体 `revision` 做乐观并发控制。创建、上传、reindex 等可重试
写操作接受 `Idempotency-Key`；列表接口统一支持 `cursor`、`limit` 和资源特定过滤条件。

## 3. 资源接口

### 3.1 DB 数据源 `/api/v1/datasources`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/datasources` | 列表 |
| POST | `/api/v1/datasources` | 新增 |
| GET | `/api/v1/datasources/:id` | 详情 |
| PATCH | `/api/v1/datasources/:id` | 更新 |
| DELETE | `/api/v1/datasources/:id` | 删除（内置项禁止） |
| POST | `/api/v1/datasources/:id/test` | 连接测试 |
| POST | `/api/v1/datasources/:id/introspect` | 触发 schema 抓取/刷新 |
| GET | `/api/v1/datasources/:id/schema` | 读取已缓存 schema |

资源模型：

```jsonc
{
  "id": "sales-prod-readonly",
  "name": "Sales Prod (RO)",
  "description": "销售只读库",
  "type": "duckdb | postgresql | mysql | sqlite | csv | xlsx",
  "mode": "readonly",                 // 默认且强制只读，对齐 run_sql_readonly
  "connection": {
    "host": "...", "port": 5432, "database": "...", "schema": "public",
    "username": "...", "secretRef": "secret://datasource/sales-prod-readonly"
  },
  "introspection": { "cache": true, "refreshIntervalSec": 3600, "tableAllowlist": [] },
  "queryPolicy": { "maxRows": 10000, "timeoutMs": 30000, "denyWrite": true, "maskFields": [] },
  "samplePolicy": { "allowSample": true, "maxSampleRows": 100 },
  "defaultEnabled": true,
  "builtin": false,
  "connectionStatus": "connected | failed | untested | disabled"
}
```

要点：

- `mode` 默认 `readonly` 且强制，写操作在 Data Gateway 层拒绝。
- 凭据走 `connection.secretRef`，不回传明文。
- wire type 使用与 Data Gateway 相同的稳定枚举；BigQuery / Snowflake 在 adapter 设计落地前
  不进入正式契约，避免无法兑现的类型长期固化。
- run 时前端只传 `forwardedProps.datasourceId`，后端凭 id 查 metadata store 后
  交给 Data Gateway tools（与现有 `extractDatasourceId` 衔接）。

`introspect` 生成带 revision、抓取时间和 adapter schema version 的持久化 schema snapshot；
`GET /schema` 返回最近成功快照。首次实现允许小型数据源同步执行，超过服务端阈值时返回
`202 + jobId`，由统一 Job API 查询进度。

#### 前端统一填写方案（类型驱动）

前端以扁平 `settings` 键值存储，按 `type` 条件显示对应字段；BFF 写入时映射为上述
嵌套模型。`*` 为必填。

**重要：UI 只暴露后端 Data Gateway 当前真正能 adapt 的类型。** 经核实后端
`createAdapter` 已实现 `duckdb`(demo) / `sqlite` / `csv` / `xlsx` /
`postgresql` / `mysql`；`bigquery` / `snowflake` 无实现代码。因此前端
当前可以恢复 PostgreSQL / MySQL 字段；云数仓字段为**路线图契约**，待对应 adapter 落地后
再从文档"提"回 UI。

| type | UI 当前显示字段 | 状态 |
| --- | --- | --- |
| `duckdb` | `datasourceId`* `type`* `mode`(只读) | ✅ 已实现（内置 demo） |
| `sqlite` / `csv` / `xlsx` | 上述 + `filePath`* | ✅ 已实现（文件） |
| `postgresql` / `mysql` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ adapter 已实现，需真实 DB 集成验证 |
| `bigquery` | `projectId`* `dataset`* `credentialsJson` | 🚧 无实现，UI 不显示 |
| `snowflake` | `account`* `warehouse`* `database`* `username`* `password` | 🚧 无实现，UI 不显示 |

其余四类同样按"后端已有能力"裁剪 UI 暴露面（完整契约仍保留在本文档各资源模型）：

| 配置 | UI 当前暴露 | 后端现状 | 文档保留的完整契约 |
| --- | --- | --- | --- |
| KB | `indexName`* `retrievalTopK` | REST + local FTS/vector retrieval 已实现 | §3.2 全字段 |
| MCP | `transport`* `serverUrl`* | REST + 官方 MCP middleware 已实现 | §3.3 全字段 |
| LLM | `provider`* `baseUrl`* `apiKey` `modelName`* | REST profile + 按 run 切换已实现 | §3.4 全字段 |
| Skill | 上传 `SKILL.md` / `.zip`（元数据只读预览） | REST multipart + skill policy 已实现 | §3.5 完整包模型 + validate |

> 原则：UI 只暴露"现在或近期能生效"的字段；其余字段在后端能力就绪后，再从本文档
> 对应资源模型恢复到 UI，避免"能填但一跑就失败/无效"的假象。

### 3.2 KB 知识库 `/api/v1/knowledge-bases`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/knowledge-bases` | 列表 |
| POST | `/api/v1/knowledge-bases` | 新增 |
| GET | `/api/v1/knowledge-bases/:id` | 详情 |
| PATCH | `/api/v1/knowledge-bases/:id` | 更新 |
| DELETE | `/api/v1/knowledge-bases/:id` | 删除 |
| POST | `/api/v1/knowledge-bases/:id/files` | 上传文档（multipart） |
| POST | `/api/v1/knowledge-bases/:id/files/import` | 从 FileAssetRef 导入文档 |
| POST | `/api/v1/knowledge-bases/:id/reindex` | 触发重建索引 |
| POST | `/api/v1/knowledge-bases/:id/search` | 检索调试 |

资源模型：

```jsonc
{
  "id": "metrics-docs",
  "name": "指标口径文档",
  "scope": "personal | workspace | project",
  "sources": [{ "type": "file | url | db-doc", "ref": "..." }],
  "embeddingProvider": "bailian",
  "embeddingModel": "text-embedding-v3",
  "retrievalTopK": 5,
  "scoreThreshold": 0.3,
  "rerankEnabled": false,
  "citationRequired": true,
  "defaultEnabled": true,
  "indexStatus": "ready | building | failed | empty"
}
```

> 现状：`packages/knowledge` 已有 `LocalKnowledgeService`，支持本地文档、chunk、
> FTS 检索和可选 embedding 向量索引；agent runtime 已注册 `retrieve_knowledge` 工具。

### 3.3 MCP `/api/v1/mcp-servers`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/mcp-servers` | 列表 |
| POST | `/api/v1/mcp-servers` | 新增 |
| PATCH | `/api/v1/mcp-servers/:id` | 更新 |
| DELETE | `/api/v1/mcp-servers/:id` | 删除 |
| POST | `/api/v1/mcp-servers/:id/test` | 连通性测试 |
| GET | `/api/v1/mcp-servers/:id/tools` | 拉取 tool manifest |

资源模型：

```jsonc
{
  "id": "notion",
  "name": "Notion MCP",
  "transport": "streamable-http | sse",
  "serverUrl": "https://host/mcp/sse",
  "authType": "none | bearer | custom-header",
  "secretRef": "secret://mcp/notion",
  "defaultEnabled": true,
  "healthStatus": "connected",
  "toolManifest": [{ "name": "search", "description": "..." }]
}
```

要点：MCP 是**外部工具边界**，与受控内部 Data Gateway tools 分离。北向优先使用
`@ag-ui/mcp-middleware`：它动态注入 `mcp__{serverId}__{tool}`、输出标准 AG-UI
`TOOL_CALL_*` 事件，并将多次 MCP continuation 表现为单个连续 run，因此 GUI / TUI
不需要适配私有 MCP 协议。

MCP middleware 不能成为模型上下文和安全策略的旁路：

1. 每个请求只根据 `effectiveRunConfig.enabledMcpServerIds` 创建 middleware，凭据由
   `SecretStore` 在服务端解析成 outbound headers。
2. manifest 进入模型前校验 JSON Schema、名称冲突和工具数量上限；只允许 server policy
   明确授权的 MCP server。
3. 根据已缓存 manifest 为每个解析后的 MCP tool 注册独立 `ToolObservationAdapter`；可以共享
   参数化 `McpToolObservationAdapter` 类，但 registry 中仍是一工具一 adapter 实例。
4. middleware 挂在 run 内创建的 `MastraAgent` 上，而不是包裹最外层
   `DataAgentAgUiAgent`。这样它生成的 continuation 不会重复进入 run claim，所有标准
   `TOOL_CALL_RESULT` 也继续经过现有 `emit -> RunEventWriter -> subscriber` 北向链路。
5. middleware 把 MCP observation 追加到下一轮 messages 后，现有 Mastra
   `MastraContextBudgetProcessor.processInputStep` 和 `MastraToolObservationRouter` 在每一步将结果路由到
   对应 adapter，再交给模型；不新增 MCP 专用 context pipeline。
6. 北向保持 middleware 原生 AG-UI 事件，不增加私有事件或私有结果 envelope；
   `maxIterations` 由 server policy 收紧。

当前 `@ag-ui/mcp-middleware@0.0.1` 固定依赖 `@ag-ui/client@0.0.54`，本项目当前为
`0.0.46`。接入前直接统一升级整套 AG-UI 依赖并跑协议回归，不保留双版本。该版本没有
tool-result hook，因此模型输入治理依赖已有 step processor；北向仍保留原生
`TOOL_CALL_RESULT`。不 fork middleware、不自建 MCP 执行器、不增加兼容层。

官方 `0.0.1` 仅支持 streamable HTTP / SSE，不支持 stdio；headers 对 SSE transport
也不能覆盖完整双向链路，因此带认证的服务首选 streamable HTTP。它目前不提供按 tool
allowlist、单次调用 timeout 或 result-size 的配置钩子。首版只允许接入可信且整服务器
授权的 MCP，不在 UI 暴露这些尚未生效的策略字段；后续仅在官方 middleware 提供相应
能力并完成升级后开放，不用本地兼容代码模拟。

### 3.4 LLM `/api/v1/model-profiles`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/model-profiles` | 列表 |
| POST | `/api/v1/model-profiles` | 新增 |
| PATCH | `/api/v1/model-profiles/:id` | 更新 |
| DELETE | `/api/v1/model-profiles/:id` | 删除 |
| POST | `/api/v1/model-profiles/:id/test` | 调用测试 |

资源模型：

```jsonc
{
  "id": "qwen-plus-default",
  "name": "Qwen Plus",
  "provider": "openai-compatible | bailian | deepseek | openai | anthropic | google",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "modelName": "qwen-plus",
  "secretRef": "secret://llm/qwen-plus-default",
  "temperature": 0.2,
  "maxTokens": 4096,
  "timeoutMs": 60000,
  "fallbackProfileId": "deepseek-default",
  "capabilities": { "reasoning": "verified", "toolCall": "verified" },
  "defaultEnabled": true,
  "builtin": false,
  "connectionStatus": "untested"
}
```

要点：

- 字段对齐服务端 env `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`。
- 内置 `server-default` 项映射当前进程 env，只读、`builtin: true`。
- `fallbackProfileId` 引用另一个 profile，不直接引用 provider model name，并禁止形成环。
- `capabilities` 由 test/探测结果生成，不能由客户端声明后直接信任。
- 真正调用由**后端 provider router/adapter** 执行，前端只选 active profile id；
  run 时经 `context.active_llm_config.profileId` 传，绝不传裸 key。

### 3.5 Skill `/api/v1/skills`

Skill 是 **Agent Skill 包**（对齐 DB-GPT / Cursor 生态），不是在线填表的 task
profile。用户上传含 `SKILL.md` 的目录或压缩包；后端解析 YAML frontmatter、落盘
附属文件（`scripts/`、`references/`、`assets/`），run 时按 `activeSkillId` 加载
包内容。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/skills` | 列表（元数据，不含包正文） |
| POST | `/api/v1/skills` | **上传导入**（multipart：`file` = `.md` / `.zip`） |
| GET | `/api/v1/skills/:id` | 详情（元数据 + manifest） |
| GET | `/api/v1/skills/:id/package` | 下载原始包或 `SKILL.md` 预览 |
| PATCH | `/api/v1/skills/:id` | 更新元数据（`name` / `description` / `defaultEnabled`） |
| DELETE | `/api/v1/skills/:id` | 删除（内置项禁止） |
| POST | `/api/v1/skills/:id/validate` | 校验包结构、frontmatter、大小上限 |
| POST | `/api/v1/skills/:id/replace` | **替换包**（multipart，同 POST 格式） |

#### 上传格式

| 格式 | Content-Type | 说明 |
| --- | --- | --- |
| 单文件 `.md` | `multipart/form-data` field `file` | 必须是合法 `SKILL.md`（含 YAML frontmatter） |
| 目录 `.zip` | 同上 | zip 根目录或唯一子目录下须含 `SKILL.md` |

`POST` 请求示例：

```http
POST /api/v1/skills HTTP/1.1
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="report-draft.zip"
Content-Type: application/zip

<binary>
--boundary--
```

成功响应从 frontmatter 解析出 `name` / `description` / `version` /
`allowed-tools`，并分配稳定 `id`（可由 `name` slug 化，冲突时后缀）。

#### 资源模型（列表 / GET 详情）

```jsonc
{
  "id": "report-draft",
  "name": "报告草稿",
  "description": "偏向结论整理与报告产出",
  "version": "1.0.0",
  "packageFormat": "skill-md | zip | builtin",
  "packageFileName": "SKILL.md",
  "allowedTools": ["inspect_schema", "run_sql_readonly"],
  "manifest": {
    "entry": "SKILL.md",
    "files": ["SKILL.md", "references/workflow.md"],
    "sizeBytes": 8192
  },
  "defaultDbIds": [],
  "defaultKbIds": [],
  "defaultMcpIds": [],
  "modelProfileId": "qwen-plus-default",
  "defaultEnabled": true,
  "builtin": false,
  "validationStatus": "valid | invalid | untested"
}
```

内置 Skill（如 `data-agent-default`）由服务端预置 `packageFormat: "builtin"`，
`GET .../package` 返回只读内容；不可 DELETE / replace。

#### 校验规则（`validate` / 导入时）

- 必须存在 `SKILL.md` 且含合法 YAML frontmatter（至少 `name`、`description`）。
- 单文件 ≤ 256 KiB；整包 ≤ 5 MiB（可配置）。
- `allowed-tools` 若声明，须为后端已知 tool 名的子集。
- 可选目录：`scripts/`、`references/`、`assets/`（zip 导入时保留相对路径）。
- 拒绝绝对路径、`..`、符号链接、硬链接、重复文件名、超限文件数和异常压缩比，防止
  Zip Slip 与解压炸弹；先解压到隔离临时目录，完整校验成功后再原子发布。
- 上传内容按不可信输入处理：Skill 指令不能扩大 server policy，脚本默认不可执行，
  `allowed-tools` 只能收窄工具集。每次替换生成不可变 package revision。
- run 使用的 package revision 写入 run fingerprint，运行期间不受并发替换影响。

#### 与 run 的衔接

- AG-UI `run_config` **只传** `enabledSkillIds` / `activeSkillId`，**不传**包正文。
- 后端 merge 后加载对应 Skill 包，将 `SKILL.md` 指令注入 system prompt / agent
  policy，并按 `allowedTools` 过滤工具面。

> 前端过渡期：自定义 Skill 可暂存 `packageContent` 于浏览器 localStorage；经
> `sanitizeWorkspaceConfig` 剥离正文，仅留 `hasPackageContent` 标记。后端 REST
> 落地后改为 `POST /api/v1/skills` 上传，不再本地存正文。

## 4. 聚合接口

### 4.1 工作区配置 `/api/v1/workspace-config`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/workspace-config` | 一次性返回五类的工作区默认配置（含 `defaultEnabled`），供左栏渲染 |
| PATCH | `/api/v1/workspace-config` | 批量更新默认启用项等工作区级设置 |

GET 响应：五类数组（结构同各资源列表，**不含明文凭据**），用于替换前端
`localStorage` 加载逻辑。

### 4.2 运行默认 `/api/v1/run-defaults`

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/run-defaults` | 返回本次 run 的"建议默认"——已默认启用且通过 policy 的资源 id 集合 |

用于初始化对话框 override 控件的默认勾选状态：

```jsonc
{
  "success": true,
  "data": {
    "enabledDatasourceIds": ["api-duckdb-demo"],
    "enabledKnowledgeIds": [],
    "enabledMcpServerIds": ["notion"],
    "activeLlmProfileId": "qwen-plus-default",
    "activeSkillId": "data-agent-default"
  }
}
```

## 5. 与 AG-UI run 的衔接

配置管理走 REST；run 时前端把"本次合并后的运行配置"经 AG-UI 透传：

```jsonc
{
  "forwardedProps": { "datasourceId": "sales-prod-readonly" },
  "context": [
    { "description": "datasource_id", "value": "sales-prod-readonly" },
    {
      "description": "run_config",
      "value": {
        "enabledDatasourceIds": ["sales-prod-readonly"],
        "enabledKnowledgeIds": [],
        "enabledMcpServerIds": ["notion"],
        "enabledSkillIds": ["data-agent-default", "schema-explore"],
        "fileIds": ["file-ref-1"],
        "activeDatasourceId": "sales-prod-readonly",
        "activeLlmProfileId": "qwen-plus-default",
        "activeSkillId": "report-draft"
      }
    }
  ]
}
```

> **当前实现**：后端已解析 `context.run_config` 并合并 workspace defaults、per-run
> override 与 server policy，形成 `effectiveRunConfig`。datasource、model profile、
> knowledge、MCP server、skill 和 fallback model chain 都会解析为带 revision 的资源快照。
> `fileIds` 会解析为本次 run 的 FileAssetRef 输入并物化到 workspace `input/` 目录。
> 凭据不在其中——只有 id 与选择。
>
> **能力开关联动**：前端字段按 `BACKEND_CAPABILITIES` 开关渐进暴露
> （`datasource.server` / `datasource.queryPolicy` / `llm.samplingParams` …）。
> 后端对应能力上线后，前端翻开关即可显示已沉淀好的 gated 字段（如 PG/MySQL 连接、
> 查询策略、采样参数），无需重新开发表单。

后端在 run 入口：

1. 读取 `forwardedProps` / `state` / `context.run_config`（per-run override）。
2. 加载 workspace defaults 与 server policy。
3. 对 enabled 集合执行 `override/default ∩ serverAllowed`；active id 必须存在、已启用、
   属于对应 enabled 集合且通过 policy，否则返回结构化错误，不静默忽略或回退。
4. 解析资源 revision 与 secretRef，生成不可变 `effectiveRunConfig` snapshot。
5. 将 snapshot hash、资源 revision 和 skill package revision 纳入 run fingerprint，再认领 run。
6. 把解析后的配置交给 provider、工具、MCP middleware、知识服务与 workspace file injection。

> 注意：`run_config` 里只有**资源 id 与选择**，没有任何凭据。`fileIds` 是
> `/api/v1/files` 返回的 FileAssetRef id，不是文件内容。这是与协议文档一致的硬约束。

## 6. 异步任务与上传边界

统一提供只读 Job API：

```text
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/cancel
```

`datasource introspect`、KB reindex 和较大文件处理可返回 `202 Accepted + jobId`。Job 至少
记录 `type/status/progress/resourceId/error/createdAt/startedAt/finishedAt`，按 workspace/user
隔离；相同资源同类任务默认串行，重复请求通过 Idempotency-Key 复用结果。服务重启后
`running` 任务恢复为 `queued` 或明确标记 `interrupted`，不得永久悬挂。

所有上传接口设置 request、单文件、总解压大小、文件数、处理时间限制；验证 MIME magic
而非只信任扩展名，使用隔离临时目录和原子发布，失败时清理临时内容。日志、错误 details、
run event 与审计 payload 均经过 secret/PII redaction。

## 7. 落地优先级

| 期 | 范围 | 说明 |
| --- | --- | --- |
| 基础期 | workspace identity、SecretStore、ApiResult、REST router、Job 基础模型 | ✅ 已实现 |
| 第一期 | Datasource REST + PostgreSQL adapter | ✅ 已实现；真实 PG 环境待集成验证 |
| 第二期 | effective run config + LLM profiles | ✅ 已实现 |
| 第三期 | Artifact 查询/预览/下载 + MySQL adapter | ✅ 已实现；真实 MySQL 环境待集成验证 |
| 第四期 | Skill 包导入、MCP registry + middleware | ✅ 已实现 |
| 第五期 | KB / RAG | ✅ local-first 已实现；生产级向量库/重排待后续 |

## 8. 当前与目标对照

| 配置 | 前端 UI | 持久化（现状） | run 透传（现状） | 后端生效（现状） | 本方案目标 |
| --- | --- | --- | --- | --- | --- |
| DB | 可增改 | REST + SQLite metadata | datasource + `run_config` | ✅ effective config + Data Gateway | 已实现 |
| KB | 可接后端 REST | REST + SQLite/FTS/vector | `run_config.enabledKnowledgeIds` | ✅ `retrieve_knowledge` | 已实现 local-first |
| MCP | 可接后端 REST | REST + encrypted secret | `run_config.enabledMcpServerIds` | ✅ 官方 middleware | 已实现 streamable HTTP / SSE |
| LLM | 可增改 + 选择器 | REST + encrypted secret | `activeLlmProfileId` | ✅ provider router / fallback chain | 已实现 |
| Skill | 上传 SKILL.md / zip | REST multipart + package metadata | `enabledSkillIds` / `activeSkillId` | ✅ prompt policy + tool allowlist | 已实现 |
