# 工作区配置管理 API 方案

日期：2026-06-22
受众：后端 / BFF 同学、前端（`apps/web`）同学
状态：方案（待评审，尚未实现）
关联：

- [copilotkit-ag-ui-frontend-protocol.md](./copilotkit-ag-ui-frontend-protocol.md)（AG-UI run 协议，配置 run 时如何透传）
- [apps/web/src/app/data-tasks/DESIGN.md](../../apps/web/src/app/data-tasks/DESIGN.md)（前端三层配置模型）

## 1. 背景与定位

前端左栏五类配置（DB / KB / MCP / LLM / Skill）当前只存在于浏览器
`localStorage`，没有任何后端配置 API。本方案定义这些配置的后端管理接口。

核心边界：**配置管理不走 AG-UI event stream，走独立 BFF REST API。**
`POST /api/copilotkit` 只负责 agent run；配置的创建/测试/启用/删除是
普通资源 CRUD，二者必须分离。

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

## 2. 通用约定

### 2.1 路径与版本

```text
/api/v1/datasources
/api/v1/knowledge-bases
/api/v1/mcp-servers
/api/v1/model-profiles
/api/v1/skills
/api/v1/workspace-config
/api/v1/run-defaults
```

### 2.2 响应包络

沿用现有 `/healthz` 的 `{ ok, data }` 风格：

```jsonc
// 成功
{ "ok": true, "data": { /* ... */ } }
// 失败
{ "ok": false, "error": { "code": "DATASOURCE_TEST_FAILED", "message": "..." } }
```

### 2.3 通用字段

每个配置资源都包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定 id（内置项用语义 id，如 `api-duckdb-demo`） |
| `name` | string | 显示名 |
| `description` | string | 描述 |
| `defaultEnabled` | boolean | **workspace 默认是否可用**（对应前端 `enabled`，默认 `true`） |
| `builtin` | boolean | 是否内置（内置项核心字段只读、不可删除） |
| `status` | enum | `connected` / `failed` / `untested` / `disabled` |
| `createdAt` / `updatedAt` | ISO8601 | 审计时间 |

> 命名说明：前端现有 `enabled` 字段语义即"工作区默认可用"，后端落库统一叫
> `defaultEnabled`，BFF 负责字段映射，避免与 per-run override 的"本轮启用"混淆。

### 2.4 鉴权

当前后端固定 `user_id=dev-user`（见协议文档）。本方案接口先按单用户实现，
路径预留 workspace 维度；引入多用户后所有资源按 `(workspaceId, userId)` 隔离。

### 2.5 测试动作

每类资源提供 `POST /:id/test`（或创建前 `POST /test` dry-run），返回连通性结果，
不改变资源状态以外的数据：

```jsonc
{ "ok": true, "data": { "status": "connected", "latencyMs": 42, "detail": { } } }
```

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
  "type": "duckdb | postgres | mysql | sqlite | bigquery | snowflake | file",
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
  "status": "connected"
}
```

要点：

- `mode` 默认 `readonly` 且强制，写操作在 Data Gateway 层拒绝。
- 凭据走 `connection.secretRef`，不回传明文。
- run 时前端只传 `forwardedProps.datasourceId`，后端凭 id 查 metadata store 后
  交给 Data Gateway tools（与现有 `extractDatasourceId` 衔接）。

#### 前端统一填写方案（类型驱动）

前端以扁平 `settings` 键值存储，按 `type` 条件显示对应字段；BFF 写入时映射为上述
嵌套模型。`*` 为必填。

**重要：UI 只暴露后端 Data Gateway 当前真正能 adapt 的类型。** 经核实后端
`createAdapter` 仅实现 `duckdb`(demo) / `sqlite` / `csv` / `xlsx`；`postgresql` /
`mysql` 为 `enabled:false` 占位，`bigquery` / `snowflake` 无任何实现代码。因此前端
当前只渲染下表前两行；服务型 / 云数仓字段为**路线图契约**，待对应 adapter 落地后
再从文档"提"回 UI。

| type | UI 当前显示字段 | 状态 |
| --- | --- | --- |
| `duckdb` | `datasourceId`* `type`* `mode`(只读) | ✅ 已实现（内置 demo） |
| `sqlite` / `csv` / `xlsx` | 上述 + `filePath`* | ✅ 已实现（文件） |
| `postgresql` / `mysql` | `host`* `port`* `database`* `schema` `username`* `password` | 🚧 adapter 未实现，UI 不显示 |
| `bigquery` | `projectId`* `dataset`* `credentialsJson` | 🚧 无实现，UI 不显示 |
| `snowflake` | `account`* `warehouse`* `database`* `username`* `password` | 🚧 无实现，UI 不显示 |

其余四类同样按"后端已有能力"裁剪 UI 暴露面（完整契约仍保留在本文档各资源模型）：

| 配置 | UI 当前暴露 | 后端现状 | 文档保留的完整契约 |
| --- | --- | --- | --- |
| KB | `indexName`* `retrievalTopK` | 仅类型、无实现 | §3.2 全字段 |
| MCP | `transport`* `serverUrl`* | 无实现 | §3.3 全字段 |
| LLM | `provider`* `baseUrl`* `apiKey` `modelName`* | env 驱动、无按 run 切换 | §3.4 全字段（temperature/maxTokens 等待 profile 落地） |
| Skill | 上传 `SKILL.md` / `.zip`（元数据只读预览） | 无 skill 概念 | §3.5 完整包模型 + validate |

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
  "status": "untested"     // index ready / building / failed
}
```

> 现状：`packages/knowledge` 只有接口与模型（协议文档第 244 行）。本接口先定形，
> 后端实现 RAG tool 后再接通；前端 KB 卡片在此之前保持"后端未支持"标记。

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
  "transport": "sse | streamable-http | stdio",
  "serverUrl": "https://host/mcp/sse",
  "authType": "none | bearer | oauth | custom-header",
  "secretRef": "secret://mcp/notion",
  "toolAllowlist": ["search", "read_page"],
  "toolDenylist": [],
  "timeoutMs": 30000,
  "defaultEnabled": true,
  "healthStatus": "connected",
  "toolManifest": [{ "name": "search", "description": "..." }]
}
```

要点：MCP 是**外部工具边界**，与受控内部 Data Gateway tools 分离。后端经
`@ag-ui/mcp-middleware` 动态挂载启用的 MCP server。

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
  "fallbackModelId": "deepseek-chat",
  "supportsReasoning": true,
  "supportsToolCall": true,
  "defaultEnabled": true,
  "builtin": false,
  "status": "untested"
}
```

要点：

- 字段对齐服务端 env `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`。
- 内置 `server-default` 项映射当前进程 env，只读、`builtin: true`。
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
  "status": "valid | invalid | untested"
}
```

内置 Skill（如 `data-agent-default`）由服务端预置 `packageFormat: "builtin"`，
`GET .../package` 返回只读内容；不可 DELETE / replace。

#### 校验规则（`validate` / 导入时）

- 必须存在 `SKILL.md` 且含合法 YAML frontmatter（至少 `name`、`description`）。
- 单文件 ≤ 256 KiB；整包 ≤ 5 MiB（可配置）。
- `allowed-tools` 若声明，须为后端已知 tool 名的子集。
- 可选目录：`scripts/`、`references/`、`assets/`（zip 导入时保留相对路径）。

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
  "ok": true,
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
        "activeDatasourceId": "sales-prod-readonly",
        "activeLlmProfileId": "qwen-plus-default",
        "activeSkillId": "report-draft"
      }
    }
  ]
}
```

> **前端现状**：data-task-ui **已经在发送上面的 `context.run_config`**（形状即
> `buildRunConfig`），只是后端当前仍只读 `datasource_id`。后端实现"§3 run_config
> 消费"后即可直接读取，无需前端再改协议。凭据不在其中——只有 id 与选择。
>
> **能力开关联动**：前端字段按 `BACKEND_CAPABILITIES` 开关渐进暴露
> （`datasource.server` / `datasource.queryPolicy` / `llm.samplingParams` …）。
> 后端对应能力上线后，前端翻开关即可显示已沉淀好的 gated 字段（如 PG/MySQL 连接、
> 查询策略、采样参数），无需重新开发表单。

后端在 run 入口：

1. 读取 `forwardedProps` / `context.run_config`（per-run override）。
2. 加载 workspace defaults 与 server policy。
3. `effectiveRunConfig = merge(defaults, override, policy)`。
4. 凭 id 解析各资源（含 `secretRef` → 真实凭据），交给对应工具/适配器。

> 注意：`run_config` 里只有**资源 id 与选择**，没有任何凭据。这是与协议文档
> 一致的硬约束。

## 6. 落地优先级

| 期 | 范围 | 说明 |
| --- | --- | --- |
| 第一期 | DB、LLM、`workspace-config`、`run-defaults` | DB 真正可配置（list/create/test/select/schema）；LLM profile 后端化（脱离 localStorage）；Skill 列表 + activeSkillId 选择 |
| 第二期 | Skill 包导入 + MCP 接入 | multipart 上传 / validate；MCP middleware；skill loader |
| 第三期 | KB / RAG | 依赖 `packages/knowledge` 落地 |

KB、MCP 在各自后端能力就绪前，前端保留 UI 但标"后端未支持"，接口契约先按本文档固定。

## 7. 当前与目标对照

| 配置 | 前端 UI | 持久化（现状） | run 透传（现状） | 后端生效（现状） | 本方案目标 |
| --- | --- | --- | --- | --- | --- |
| DB | 可增改 | localStorage | `forwardedProps.datasourceId` | ✅ datasource 选择 | REST CRUD + test + schema |
| KB | 有但标未支持 | localStorage | context（无密钥） | ❌ | REST + RAG tool |
| MCP | 可增改 | localStorage | `context.mcp_config`（无密钥） | ❌ | REST + middleware 挂载 |
| LLM | 可增改 + 选择器 | localStorage | `context.llm_config`（无密钥） | ❌ 读 .env | REST profile + provider router |
| Skill | 上传 SKILL.md / zip | localStorage（含包正文，待 REST） | `context.enabled_skill_ids` | ❌ | REST multipart + skill loader |
