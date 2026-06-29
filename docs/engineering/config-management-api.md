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

文件上传也走 REST，但分两类：

- `POST /api/v1/files`：创建可复用 FileAssetRef；真正拉起 agent run 仍走
  `/api/copilotkit`，并通过 AG-UI `RunAgentInput.forwardedProps.run_config.fileIds`
  把文件引用传给本次 run。
- `POST /api/v1/chat/uploads`：对话框临时附件上传到当前 session workspace 的
  `uploads/`，返回 `{ path, mimeType, size }`，run 入口会把该 path 投影为模型可见的
  `read_file` 提示。

当前没有单独的 `/api/v1/runs`。

对话历史读取走 `GET /api/v1/sessions/:sessionId/conversation`。该接口返回服务端
metadata 中的权威 user / assistant history、latest summary、run event refs 和
tool-call/result 配对；它是 GUI / TUI 的回放与恢复入口，不要求前端把全量历史重新塞回
下一次 AG-UI run。

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
- MCP server CRUD / test / tools manifest；run 内使用 AG-UI MCP loop 挂载 streamable HTTP / SSE / stdio server，
  并执行 server 级 tool allowlist 与 timeout 策略。
- Model profile CRUD / test；run 内按 profile 切换 provider，并支持 fallback profile chain。
- Skill multipart 上传 / validate / replace / package 下载；上传包进入 FileAssetRef，run 内按
  `skill_mode` 自动筛选并物化为 Mastra workspace skills，`skill / skill_search / skill_read`
  结果走 ToolObservationAdapter 和 ContextPackage。
- Workspace config、run defaults、job 查询/取消、artifact detail / preview / content / download。
- FileAssetRef 批量上传 / 下载；run_config `fileIds` 注入 workspace `input/`。

仍未完成：

- 产品化认证网关未接入；当前为 local-first token 方案，schema 和运行链路已携带
  `workspace_id` 与 `user_id`。
- PG/MySQL / ClickHouse adapter 已实现类型与只读执行；`npm run smoke:server-datasources`
  已提供真实服务端验收入口，缺少真实实例与凭据执行结果。
- Artifact 北向 AG-UI 事件已收敛为 id + 摘要引用；完整 preview / content / download 走 REST。

## 2. 通用约定

### 2.1 路径与版本

```text
/api/v1/datasources
/api/v1/datasource-types
/api/v1/knowledge-bases
/api/v1/mcp-servers
/api/v1/model-profiles
/api/v1/skills
/api/v1/files
/api/v1/chat/uploads
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

当前后端使用 local-first 身份解析：

- 无认证头：默认 `user_id=dev-user`、`workspace_id=default`。
- `Authorization: Bearer <dev_token>` 或 `X-Dev-Token: <dev_token>`：按 metadata `users.dev_token`
  解析用户；无效 token 返回 401。
- `X-Workspace-Id: <workspace_id>`：选择当前 workspace，缺省为 `default`。

配置 API、CopilotKit run、workspace 物理目录、FileAssetRef / Artifact、Knowledge policy 与
Skill package materialization 均使用同一 `(user_id, workspace_id)`。产品化认证接入时只需替换
入口身份解析器，资源 API 路径和数据模型不迁移。

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
  "type": "duckdb | postgresql | mysql | clickhouse | sqlite | csv | xlsx | ...",
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
- `introspection.tableAllowlist` 会限制 schema 输出，并阻止 preview / SQL 访问 allowlist 外的表。
- `introspection.refreshIntervalSec` 会驱动 `GET /datasources/:id/schema` 在快照过期后自动刷新。
- `maskFields` 会对 preview / SQL 结果中同名列输出 `"[MASKED]"`。
- `samplePolicy.allowSample=false` 会阻止预览采样；`maxSampleRows` 会压低 preview 行数上限。
- `queryPolicy.denyWrite` 可保存用于策略表达；`run_sql_readonly` 始终强制只读，不会因为关闭该字段放开写 SQL。
- 凭据走 `connection.secretRef`，不回传明文。
- wire type 使用与 Data Gateway 相同的稳定枚举；客户端应以 `/api/v1/datasource-types`
  返回为准，不静态翻开未启用类型。
- run 时前端只传 `forwardedProps.datasourceId`，后端凭 id 查 metadata store 后
  交给 Data Gateway tools（与现有 `extractDatasourceId` 衔接）。

`introspect` 生成带 revision、抓取时间和 adapter schema version 的持久化 schema snapshot；
`GET /schema` 返回最近成功快照。首次实现允许小型数据源同步执行，超过服务端阈值时返回
`202 + jobId`，由统一 Job API 查询进度。

#### 前端统一填写方案（类型驱动）

前端以扁平 `settings` 键值存储，按 `type` 条件显示对应字段；BFF 写入时映射为上述
嵌套模型。`*` 为必填。

**重要：UI 只暴露后端 Data Gateway 当前真正能 adapt 的类型。** 当前后端
`createAdapter` 已实现 `duckdb`(demo + 文件) / `sqlite` / `csv` / `xlsx` /
`postgresql` / `mysql` / `clickhouse` / `snowflake` / `bigquery` / `sqlserver` /
`oracle` / `mongodb` / `gaussdb` / `access` / `redis` / `starrocks` / `trino` /
`presto` / `spark` / `databricks` / `redshift` / `elasticsearch` / `opensearch` /
`doris` / `mariadb` / `tidb` / `oceanbase` / `greenplum`。其他扩展类型仍以
`/api/v1/datasource-types` 的 `enabled` 为准，不应被客户端静态翻开。完整字段、示例和使用流程见
[Supported Databases](./supported-databases.md)。

| type | UI 当前显示字段 | 状态 |
| --- | --- | --- |
| `duckdb` | `datasourceId`* `type`* `mode`(只读) `path`/`filePath` | ✅ 已实现（内置 demo + 真实 DuckDB 文件） |
| `sqlite` / `csv` / `xlsx` | 上述 + `filePath`* | ✅ 已实现（文件） |
| `postgresql` / `mysql` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ adapter 已实现，需真实 DB 集成验证 |
| `clickhouse` | `host`* `port`* `database`* `username` `password` `secure` | ✅ adapter 已实现，需真实 ClickHouse 集成验证 |
| `snowflake` | `account`* `warehouse`* `database`* `schema` `role` `username`* `password` | ✅ adapter 已实现，需真实 Snowflake 验证 |
| `bigquery` | `projectId`* `dataset`* `location` `credentialsJson`/`keyFilename` | ✅ adapter 已实现，需真实 BigQuery 验证 |
| `sqlserver` | `host`* `port`* `database`* `schema` `username`* `password` `encrypt` `trustServerCertificate` | ✅ adapter 已实现，需真实 SQL Server 验证 |
| `oracle` | `connectString`* `schema` `username`* `password` | ✅ adapter 已实现，需真实 Oracle 验证 |
| `mongodb` | `uri`* `database`* `sampleSize` | ✅ adapter 已实现；`run_sql_readonly` 支持简单 `SELECT ... FROM collection [LIMIT n]` |
| `gaussdb` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ PostgreSQL 协议兼容 adapter |
| `access` | `connectionString` 或 `path`/`filePath` | ✅ ODBC adapter；运行环境需要 Access ODBC driver |
| `redis` | `url`* `database` `keyPattern` | ✅ adapter 已实现；暴露 `redis_keys` 伪表 |
| `starrocks` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ MySQL 协议兼容 adapter |
| `trino` / `presto` | `host`* `port`* `catalog`* `schema` `username` `password` `secure` | ✅ REST 协议 adapter |
| `spark` | `host`* `port`* `catalog` `schema` `transport` `auth` `username` `password` | ✅ Spark Thrift Server / HiveServer2 协议 adapter |
| `databricks` | `host`* `path`* 或 `warehouseId`，`token`* `catalog` `schema` | ✅ Databricks SQL Warehouse REST adapter |
| `redshift` / `greenplum` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ PostgreSQL 协议兼容 adapter |
| `doris` / `mariadb` / `tidb` / `oceanbase` | `host`* `port`* `database`* `schema` `username`* `password` | ✅ MySQL 协议兼容 adapter |
| `elasticsearch` / `opensearch` | `node`/`url` 或 `host`+`port`，`indexPattern` `username` `password`/`apiKey` | ✅ index-as-table read-only adapter |

`GET /api/v1/datasource-types` 返回后端当前 Data Gateway 类型 schema：

```jsonc
{
  "success": true,
  "data": [
    {
      "name": "sqlite",
      "label": "SQLite",
      "enabled": true,
      "parameters": [
        { "name": "path", "label": "Database Path", "type": "file", "required": true }
      ]
    }
  ]
}
```

前端应以 `enabled` 作为动态展示/占位依据；未落地的扩展 adapter 不得由后端标成 enabled。
当前已启用类型的完整清单以 [Supported Databases](./supported-databases.md) 和
`GET /api/v1/datasource-types` 的实时响应为准。

其余四类同样按"后端已有能力"裁剪 UI 暴露面（完整契约仍保留在本文档各资源模型）：

| 配置 | UI 当前暴露 | 后端现状 | 文档保留的完整契约 |
| --- | --- | --- | --- |
| KB | `indexName`* `retrievalTopK` `scoreThreshold` `chunkSize` `chunkOverlap` `citationRequired` `scope` | REST + local FTS/vector retrieval + chunk policy 已实现；外部 vector/rerank/graphRAG 待后续 | §3.2 全字段 |
| MCP | `transport`* `serverUrl`* `authType` `toolAllowlist` `timeoutMs` | REST + AG-UI MCP loop + policy middleware 已实现 | §3.3 全字段 |
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
  "chunkSize": 1600,
  "chunkOverlap": 200,
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
> `chunkSize` / `chunkOverlap` 对后续 ingest 生效；`citationRequired` / `scope`
> 已保存回显并翻 capability；外部 vectorStore、rerank、graphRAG 仍未启用。

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
  "transport": "streamable-http | sse | stdio",
  "serverUrl": "https://host/mcp/sse",
  "authType": "none | bearer | custom-header",
  "toolAllowlist": ["search"],
  "timeoutMs": 30000,
  "secretRef": "secret://mcp/notion",
  "defaultEnabled": true,
  "healthStatus": "connected",
  "toolManifest": [{ "name": "search", "description": "..." }]
}
```

要点：MCP 是**外部工具边界**，与受控内部 Data Gateway tools 分离。北向保持 AG-UI
MCP loop 语义：动态注入 `mcp__{serverId}__{tool}`、输出标准 AG-UI `TOOL_CALL_*`
事件，并将多次 MCP continuation 表现为单个连续 run，因此 GUI / TUI 不需要适配私有
MCP 协议。

MCP middleware 不能成为模型上下文和安全策略的旁路：

1. 每个请求只根据 `effectiveRunConfig.enabledMcpServerIds` 创建 middleware，凭据由
   `SecretStore` 在服务端解析成 outbound headers。
2. manifest 进入模型前校验 JSON Schema、名称冲突和工具数量上限；`toolAllowlist`
   可按 raw tool name（如 `search`）或 namespaced name（如 `mcp__notion__search`）
   过滤 `/test`、`/tools`、run-time tool injection 与 observation adapter 注册。
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
7. MCP observation 进入模型前使用 `McpToolObservationAdapter` 和 ContextPackage 预算治理，
   默认模型可见内容约 12k chars；超限结果会生成结构化 truncation 记录，供审计和调试使用。

当前 `@ag-ui/mcp-middleware@0.0.1` 仍只支持 streamable HTTP / SSE，且没有 allowlist /
timeout / stdio 配置钩子。因此生产路径使用本地 `PolicyMcpMiddleware` 复用 AG-UI
middleware 形态和 MCP SDK transport，补齐策略能力；北向事件仍是标准 AG-UI
`TOOL_CALL_RESULT`，不新增私有 MCP envelope。result-size 治理只作用于下一轮模型可见
context，不改变前端收到的原始 MCP tool result。

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
  "topP": 0.9,
  "frequencyPenalty": 0,
  "presencePenalty": 0,
  "maxTokens": 4096,
  "contextLength": 128000,
  "reasoningModel": false,
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
- `temperature` / `topP` / `frequencyPenalty` / `presencePenalty` / `maxTokens` 在 run 阶段透传给
  Mastra/AI SDK；`contextLength` 进入现有 ContextPackage / planner / prompt guard 预算通路；
  `reasoningModel` 是 profile 标记与 resolved metadata，不单独切换 provider；`timeoutMs`
  同时用于 `/test` 和 run 级超时。
- 真正调用由**后端 provider router/adapter** 执行，前端只选 active profile id；
  run 时经 `context.active_llm_config.profileId` 传，绝不传裸 key。

### 3.5 Skill `/api/v1/skills`

Skill 是 **Agent Skill 包**（对齐 Mastra workspace skills），不是在线填表的 task
profile。用户上传单个 `SKILL.md` 或包含唯一 `SKILL.md` 的 zip；后端解析 YAML
frontmatter，并把原始包作为 FileAssetRef 保存。run 时后端先做 skill selection，
只把 selected skill package 物化到本次 isolated workspace 的 `skills/` 目录，再交给
Mastra 原生 `skill` / `skill_search` / `skill_read` 工具读取。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/skills` | 列表（元数据，不含包正文） |
| POST | `/api/v1/skills` | **上传导入**（multipart：`file` = `.md` / `.zip`） |
| POST | `/api/v1/skills/select` | 预览本次 run 的 auto/selected skill 筛选结果 |
| GET | `/api/v1/skills/:id` | 详情（元数据 + manifest） |
| GET | `/api/v1/skills/:id/package` | 读取 package file ref 元数据 |
| GET | `/api/v1/skills/:id/download` | 下载原始包或 `SKILL.md` |
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
`allowed-tools`，并分配稳定 `id`（可显式传入；否则由 `name` slug 化，冲突时后缀）。
读接口只返回 package 元数据和 `packageFileRefId`，不返回包正文。

#### 资源模型（列表 / GET 详情）

```jsonc
{
  "id": "report-draft",
  "name": "报告草稿",
  "description": "偏向结论整理与报告产出",
  "version": "1.0.0",
  "packageFormat": "skill-md | zip",
  "packageFileRefId": "file_ref_skill_package",
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

第一阶段暂不启用 builtin skill。selector 会拒绝 builtin skill，避免内置指令绕过
package、selection、审计和 workspace materialization 边界。

资源默认绑定在 run 阶段消费：selected skill 的 `defaultDbIds` / `defaultKbIds` /
`defaultMcpIds` 会与前端传入的 enabled 资源取并集。若本次 run 未显式指定 active
datasource / active LLM，则使用 skill 的第一个 `defaultDbIds` / `modelProfileId` 作为
active 项；显式 run 选择优先。绑定到 MCP 的 skill 仍必须通过 allowed-tools 明确允许对应
`mcp__...` tool name，不能通过资源绑定绕开 tool policy。

#### 校验规则（`validate` / 导入时）

- 必须存在 `SKILL.md` 且含合法 YAML frontmatter（至少 `name`、`description`）。
- 单文件 `SKILL.md` ≤ 256 KiB；整包解压后 ≤ 20 MiB，最多 100 个 entry。
- `allowed-tools` 若声明，须为后端已知 tool 名的子集。
- 可选目录：`scripts/`、`references/`、`assets/`（zip 导入时保留相对路径）。
- 拒绝绝对路径、`..`、符号链接、硬链接、重复文件名、超限文件数和异常压缩比，防止
  Zip Slip 与解压炸弹；先解压到隔离临时目录，完整校验成功后再原子发布。
- 上传内容按不可信输入处理：Skill 指令不能扩大 server policy，脚本不能由 skill 系统
  直接执行；需要先通过 `skill_read` 读取，再在策略允许时调用已有 workspace/sandbox
  tool。`allowed-tools` 只能收敛 action tool 集合。每次替换生成新的 package revision。
- run 使用的 package revision 写入 run fingerprint，运行期间不受并发替换影响。

#### 与 run 的衔接

- AG-UI `run_config` 传 skill id / tag / policy，**不传**包正文。
- 当前支持 `skill_mode` / `skill_ids` / `skill_tags` / `skill_policy`，兼容旧
  `enabledSkillIds` / `activeSkillId`。
- 默认 `skill_mode=auto`；workspace `defaultEnabled=true` 的 skill 会进入候选集合。
- 本次 run 只把筛选后的 skill package 物化到 isolated workspace `skills/` 目录，再交给
  Mastra workspace skill 机制。
- `allowed-tools` 只收敛 action tool 集合，不给 skill 放权；多个 skill 默认取并集，
  再受 run/global/datasource/MCP 策略收敛。
- `skill` / `skill_search` / `skill_read` 是 meta tools，默认保留，除非被显式 deny。
- 后端不会把 `SKILL.md` 直接塞进 run_config 或北向消息；Mastra workspace skill
  tools 在 selected skill 范围内按需读取。

> 前端不再存 skill package 正文；上传后只保存 skill id、revision 和
> `packageFileRefId` 等服务端元数据。

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
> （`datasource.server` / `datasource.queryPolicy` / `datasource.introspectionPolicy` /
> `datasource.samplePolicy` / `datasource.fieldMasking` / `llm.samplingParams` / `llm.advancedSampling` /
> `chat.fileUpload` / `chat.imageInput` / `mcp.stdio` / `mcp.toolPolicy` /
> `skill.resourceBinding` / `conversation.memory` / `kb.chunking` / `kb.citationPolicy` / `kb.scope` …）。
> 后端对应能力上线后，前端翻开关即可显示已沉淀好的 gated 字段（如 PG/MySQL 连接、
> 查询策略、采样参数、MCP stdio/tool policy、对话框附件上传、Skill 资源绑定），无需重新开发表单。

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
| MCP | 可接后端 REST | REST + encrypted secret | `run_config.enabledMcpServerIds` | ✅ AG-UI MCP loop + allowlist / timeout | 已实现 streamable HTTP / SSE / stdio |
| LLM | 可增改 + 选择器 | REST + encrypted secret | `activeLlmProfileId` | ✅ provider router / fallback chain | 已实现 |
| Skill | 上传 SKILL.md / zip | REST multipart + package metadata | `enabledSkillIds` / `activeSkillId` | ✅ prompt policy + tool allowlist | 已实现 |
