# Backend REST API Reference

日期：2026-06-24
范围：`apps/api` 当前实现的 HTTP JSON REST API
实现入口：`apps/api/src/server.ts`、`apps/api/src/config-api.ts`

## 1. 通用约定

默认地址：

```text
http://127.0.0.1:8787
```

配置管理接口统一挂在 `/api/v1/*`。`POST /api/copilotkit` 是 CopilotKit / AG-UI
agent runtime 入口，不属于配置 REST API；协议见
[CopilotKit / AG-UI Frontend Protocol Support](./copilotkit-ag-ui-frontend-protocol.md)。

当前开发阶段固定身份：

```json
{
  "workspace_id": "default",
  "user_id": "dev-user"
}
```

### 1.1 响应 envelope

除 file / artifact `download`、artifact `content` 这类文件响应外，REST API 都使用统一 envelope。

成功：

```json
{
  "success": true,
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "JSON_OBJECT_REQUIRED"
  }
}
```

当前稳定错误码包括：

```text
BAD_REQUEST, CONFLICT, DATASOURCE_TEST_FAILED, INTERNAL_ERROR, JOB_NOT_FOUND,
PROVIDER_TEST_FAILED, REVISION_CONFLICT, SECRET_MASTER_KEY_REQUIRED, UNAUTHORIZED,
RESOURCE_NOT_FOUND, NOT_ENABLED, UNSUPPORTED_FILE_TYPE, PARSE_FAILED, REINDEX_REQUIRED,
SQL_BLOCKED, SQL_TIMEOUT, PROVIDER_CONFIG_MISSING, PROVIDER_RATE_LIMITED
```

### 1.2 写入约定

- JSON 请求体上限：1 MiB。
- `POST /api/v1/datasources/:id/introspect` 和
  `POST /api/v1/knowledge-bases/:id/reindex` 支持 `Idempotency-Key` header。
- `PATCH` 和覆盖写支持在 body 里传 `revision` 做乐观并发控制；冲突返回
  `REVISION_CONFLICT`。
- 凭据只在写接口一次性提交，读接口只返回 `secretRef` 和 `hasSecret`，不会返回明文。
- `clearCredentials: true` 会删除当前资源的 secret 引用。

## 2. 端点总览

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查 |
| GET | `/api/v1/capabilities` | 后端能力开关 |
| GET | `/api/v1/workspace-config` | 工作区配置全集 |
| PATCH | `/api/v1/workspace-config` | 批量更新工作区默认启用状态 |
| GET | `/api/v1/run-defaults` | 当前 run 默认配置 |
| GET | `/api/v1/jobs/:id` | 查询配置任务 |
| POST | `/api/v1/jobs/:id/cancel` | 取消配置任务 |
| GET/POST | `/api/v1/datasources` | Datasource 列表 / 创建 |
| GET/PATCH/DELETE | `/api/v1/datasources/:id` | Datasource 详情 / 更新 / 删除 |
| POST | `/api/v1/datasources/:id/test` | Datasource 连接测试 |
| POST | `/api/v1/datasources/:id/introspect` | Datasource schema 抓取 |
| GET | `/api/v1/datasources/:id/schema` | Datasource schema 快照 |
| GET/POST | `/api/v1/knowledge-bases` | Knowledge Base 列表 / 创建 |
| GET/PATCH/DELETE | `/api/v1/knowledge-bases/:id` | Knowledge Base 详情 / 更新 / 删除 |
| POST | `/api/v1/knowledge-bases/:id/test` | Knowledge Base 通用验证 |
| POST | `/api/v1/knowledge-bases/:id/files` | 上传或写入文档 |
| POST | `/api/v1/knowledge-bases/:id/files/import` | 从 FileAssetRef 导入文档 |
| POST | `/api/v1/knowledge-bases/:id/search` | 检索调试 |
| POST | `/api/v1/knowledge-bases/:id/reindex` | 重建索引 |
| GET/POST | `/api/v1/files` | 文件引用列表 / 批量上传 |
| GET/DELETE | `/api/v1/files/:id` | 文件引用详情 / 删除引用 |
| GET | `/api/v1/files/:id/download` | 下载文件资产内容 |
| GET/POST | `/api/v1/mcp-servers` | MCP Server 列表 / 创建 |
| GET/PATCH/DELETE | `/api/v1/mcp-servers/:id` | MCP Server 详情 / 更新 / 删除 |
| POST | `/api/v1/mcp-servers/:id/test` | MCP Server 连通性与 tools manifest |
| GET | `/api/v1/mcp-servers/:id/tools` | 拉取 MCP tools |
| GET/POST | `/api/v1/model-profiles` | Model Profile 列表 / 创建 |
| GET/PATCH/DELETE | `/api/v1/model-profiles/:id` | Model Profile 详情 / 更新 / 删除 |
| POST | `/api/v1/model-profiles/:id/test` | Model Provider 探测 |
| GET/POST | `/api/v1/skills` | Skill 列表 / 上传创建 |
| GET/PATCH/DELETE | `/api/v1/skills/:id` | Skill 详情 / 更新 / 删除 |
| POST | `/api/v1/skills/:id/test` | Skill 通用验证 |
| POST | `/api/v1/skills/:id/validate` | Skill 语义验证 |
| POST | `/api/v1/skills/:id/replace` | 替换 Skill package |
| GET | `/api/v1/skills/:id/package` | 读取 Skill package |
| GET | `/api/v1/artifacts/:id` | Artifact 详情 |
| GET | `/api/v1/artifacts/:id/preview` | Artifact preview JSON |
| GET | `/api/v1/artifacts/:id/content` | Artifact inline 内容 |
| GET | `/api/v1/artifacts/:id/download` | Artifact 下载 |

## 3. 健康与能力

### GET `/healthz`

响应：

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

### GET `/api/v1/capabilities`

响应：

```json
{
  "success": true,
  "data": {
    "artifact.export": true,
    "files": true,
    "datasource.queryPolicy": true,
    "datasource.server": true,
    "llm.samplingParams": true,
    "knowledge": true,
    "mcp": true,
    "skills": true
  }
}
```

## 4. Workspace 与 Run Defaults

### GET `/api/v1/workspace-config`

响应：

```json
{
  "success": true,
  "data": {
    "datasources": [
      {
        "id": "api-duckdb-demo",
        "name": "API DuckDB Demo",
        "description": "Demo datasource",
        "type": "duckdb",
        "mode": "readonly",
        "config": {
          "defaultEnabled": true,
          "builtin": true,
          "mode": "readonly"
        },
        "secretRef": null,
        "hasSecret": false,
        "defaultEnabled": true,
        "builtin": true,
        "connectionStatus": "connected",
        "revision": 1,
        "createdAt": "2026-06-23T00:00:00.000Z",
        "updatedAt": "2026-06-23T00:00:00.000Z"
      }
    ],
    "knowledgeBases": [],
    "mcpServers": [],
    "modelProfiles": [],
    "skills": []
  }
}
```

### PATCH `/api/v1/workspace-config`

只批量更新各资源的 `defaultEnabled`，可附带 `revision`。

请求：

```json
{
  "datasources": [
    {
      "id": "api-duckdb-demo",
      "defaultEnabled": true,
      "revision": 1
    }
  ],
  "knowledgeBases": [
    {
      "id": "metrics-docs",
      "defaultEnabled": true,
      "revision": 3
    }
  ],
  "mcpServers": [],
  "modelProfiles": [],
  "skills": []
}
```

响应：同 `GET /api/v1/workspace-config`。

### GET `/api/v1/run-defaults`

响应：

```json
{
  "success": true,
  "data": {
    "enabledDatasourceIds": ["api-duckdb-demo"],
    "enabledKnowledgeIds": ["metrics-docs"],
    "enabledMcpServerIds": ["local-mcp"],
    "enabledSkillIds": ["data-analysis"],
    "activeDatasourceId": "api-duckdb-demo",
    "activeLlmProfileId": "server-default",
    "activeSkillId": "data-analysis"
  }
}
```

## 5. Jobs

Job 由 datasource introspect 和 knowledge reindex 创建。

Job DTO：

```json
{
  "id": "6b4d0a38-68f0-47dc-b445-a4475f3237cb",
  "workspace_id": "default",
  "user_id": "dev-user",
  "type": "datasource-introspect",
  "resource_id": "api-duckdb-demo",
  "status": "completed",
  "progress": 100,
  "result": {},
  "created_at": "2026-06-23T00:00:00.000Z",
  "started_at": "2026-06-23T00:00:00.000Z",
  "finished_at": "2026-06-23T00:00:01.000Z"
}
```

### GET `/api/v1/jobs/:id`

响应：

```json
{
  "success": true,
  "data": {
    "id": "6b4d0a38-68f0-47dc-b445-a4475f3237cb",
    "workspace_id": "default",
    "user_id": "dev-user",
    "type": "knowledge-reindex",
    "resource_id": "metrics-docs",
    "status": "running",
    "progress": 10,
    "created_at": "2026-06-23T00:00:00.000Z",
    "started_at": "2026-06-23T00:00:00.000Z"
  }
}
```

### POST `/api/v1/jobs/:id/cancel`

响应：

```json
{
  "success": true,
  "data": {
    "id": "6b4d0a38-68f0-47dc-b445-a4475f3237cb",
    "status": "canceled",
    "progress": 10,
    "finished_at": "2026-06-23T00:00:02.000Z"
  }
}
```

## 6. Datasources

Datasource DTO：

```json
{
  "id": "sales-pg",
  "name": "Sales PostgreSQL",
  "description": "Sales readonly database",
  "type": "postgresql",
  "mode": "readonly",
  "config": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "sales",
    "schema": "public",
    "username": "readonly",
    "queryPolicy": {
      "maxRows": 500,
      "timeoutMs": 5000
    },
    "defaultEnabled": true,
    "builtin": false,
    "mode": "readonly"
  },
  "secretRef": "secret://datasource/sales-pg",
  "hasSecret": true,
  "defaultEnabled": true,
  "builtin": false,
  "connectionStatus": "connected",
  "revision": 2,
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z"
}
```

### GET `/api/v1/datasources`

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "api-duckdb-demo",
      "name": "API DuckDB Demo",
      "type": "duckdb",
      "mode": "readonly",
      "config": {
        "defaultEnabled": true,
        "builtin": true,
        "mode": "readonly"
      },
      "hasSecret": false,
      "defaultEnabled": true,
      "builtin": true,
      "connectionStatus": "connected",
      "revision": 1,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/datasources`

支持 `config`、`connection` 或 `settings` 作为连接配置输入。`password` 或
`credentials` 会写入 secret store，不会出现在后续响应里。

请求：

```json
{
  "id": "sales-pg",
  "name": "Sales PostgreSQL",
  "description": "Sales readonly database",
  "type": "postgresql",
  "config": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "sales",
    "schema": "public",
    "username": "readonly"
  },
  "credentials": {
    "password": "secret-password"
  },
  "queryPolicy": {
    "maxRows": 500,
    "timeoutMs": 5000
  },
  "defaultEnabled": true
}
```

响应：`201 Created`，data 为 Datasource DTO。

### GET `/api/v1/datasources/:id`

响应：data 为 Datasource DTO。

### PATCH `/api/v1/datasources/:id`

请求：

```json
{
  "name": "Sales PostgreSQL RO",
  "config": {
    "schema": "analytics"
  },
  "queryPolicy": {
    "maxRows": 1000
  },
  "revision": 2
}
```

响应：data 为更新后的 Datasource DTO。

### DELETE `/api/v1/datasources/:id`

内置 datasource 不能删除。删除普通 datasource 时会同时删除其 secret 引用。

响应：

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "id": "sales-pg"
  }
}
```

### POST `/api/v1/datasources/:id/test`

响应：

```json
{
  "success": true,
  "data": {
    "datasource_id": "sales-pg",
    "status": "connected",
    "latencyMs": 38
  }
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "DATASOURCE_TEST_FAILED",
    "message": "DATASOURCE_TEST_FAILED:connection refused"
  }
}
```

### POST `/api/v1/datasources/:id/introspect`

可带 `Idempotency-Key` header。当前小型数据源同步完成，但 HTTP status 仍为 `202`。

响应：

```json
{
  "success": true,
  "data": {
    "id": "6b4d0a38-68f0-47dc-b445-a4475f3237cb",
    "type": "datasource-introspect",
    "resource_id": "sales-pg",
    "status": "completed",
    "progress": 100,
    "result": {
      "datasource_id": "sales-pg",
      "tables": [
        {
          "name": "orders",
          "columns": [
            {
              "name": "id",
              "type": "INTEGER",
              "nullable": false
            }
          ]
        }
      ]
    }
  }
}
```

### GET `/api/v1/datasources/:id/schema`

读取最近一次成功 introspect 的 schema snapshot。

响应：

```json
{
  "success": true,
  "data": {
    "schema": {
      "datasource_id": "sales-pg",
      "tables": []
    },
    "adapterSchemaVersion": 1,
    "inspectedAt": "2026-06-23T00:00:00.000Z"
  }
}
```

## 6. File Assets

文件接口暴露的是 `FileAssetRef`，即“当前用户/工作区可见的文件引用”。物理内容由
`FileAsset` 按 `sha256` 去重保存，前端通常只需要使用 `id` 作为 `file_id`。

### GET `/api/v1/files`

响应：

```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": "file-ref-1",
        "assetId": "file-asset-1",
        "filename": "orders.csv",
        "mimeType": "text/csv; charset=utf-8",
        "sizeBytes": 12345,
        "sha256": "2cf24dba5...",
        "source": "upload",
        "status": "ready",
        "createdAt": "2026-06-24T00:00:00.000Z"
      }
    ]
  }
}
```

### POST `/api/v1/files`

批量上传文件。请求必须是 `multipart/form-data`，文件字段名可为 `files` 或任意 file
field，后端按 multipart 中所有 file parts 处理。

限制由环境变量控制：

```text
FILE_UPLOAD_MAX_FILES        默认 20
FILE_UPLOAD_MAX_BYTES        默认 25 MiB
FILE_UPLOAD_MAX_TOTAL_BYTES  默认 100 MiB
FILE_ASSET_STORAGE_ROOT      默认 storage/files
```

请求示例：

```bash
curl -F "files=@orders.csv" -F "files=@metrics.md" \
  http://127.0.0.1:8787/api/v1/files
```

响应：

```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": "file-ref-1",
        "assetId": "file-asset-1",
        "filename": "orders.csv",
        "mimeType": "text/csv",
        "sizeBytes": 12345,
        "sha256": "2cf24dba5...",
        "source": "upload",
        "status": "ready"
      }
    ]
  }
}
```

同一内容重复上传会复用同一个 `assetId`，但会创建不同的 `id` 引用。

### GET `/api/v1/files/:id`

读取一个文件引用的 metadata。

### GET `/api/v1/files/:id/download`

下载真实文件内容，不使用 `ApiResult` envelope。

示例响应 header：

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="orders.csv"
```

### DELETE `/api/v1/files/:id`

软删除当前文件引用，不会直接删除仍被其他 ref、artifact 或 KB document 引用的物理文件。

## 7. Knowledge Bases

Knowledge Base 是通用 config resource，读响应会展开 payload，并用 `indexStatus` 表示状态。

### GET `/api/v1/knowledge-bases`

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "metrics-docs",
      "name": "Metrics Docs",
      "description": "Business metric definitions",
      "retrievalTopK": 5,
      "scoreThreshold": 0.3,
      "secretRef": null,
      "hasSecret": false,
      "defaultEnabled": true,
      "builtin": false,
      "indexStatus": "ready",
      "revision": 2,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/knowledge-bases`

请求：

```json
{
  "id": "metrics-docs",
  "name": "Metrics Docs",
  "description": "Business metric definitions",
  "retrievalTopK": 5,
  "scoreThreshold": 0.3,
  "defaultEnabled": true
}
```

响应：`201 Created`，data 为 Knowledge Base DTO。

### GET/PATCH/DELETE `/api/v1/knowledge-bases/:id`

PATCH 请求示例：

```json
{
  "retrievalTopK": 8,
  "revision": 2
}
```

DELETE 会同时删除该 collection 的 documents、chunks、embeddings。

### POST `/api/v1/knowledge-bases/:id/test`

通用验证接口。

响应：

```json
{
  "success": true,
  "data": {
    "id": "metrics-docs",
    "status": "connected",
    "validated": true,
    "revision": 2
  }
}
```

### POST `/api/v1/knowledge-bases/:id/files`

支持两种请求格式。

JSON 请求：

```json
{
  "filename": "metrics.md",
  "mimeType": "text/markdown",
  "content": "# GMV\nGMV means gross merchandise value."
}
```

Multipart 请求：

```text
Content-Type: multipart/form-data
field file=<metrics.md>
```

响应：

```json
{
  "success": true,
  "data": {
    "id": "doc-1",
    "collection_id": "metrics-docs",
    "filename": "metrics.md",
    "mime_type": "text/markdown",
    "created_at": "2026-06-23T00:00:00.000Z"
  }
}
```

### POST `/api/v1/knowledge-bases/:id/files/import`

从已上传的 FileAssetRef 导入 KB。KB 只保存 document/chunks/embeddings 投影，不重复保存原始文件。
第一版支持文本类文件：`txt`、`md`、`csv`、`json` 以及 `text/*` mime。

请求：

```json
{
  "fileIds": ["file-ref-1", "file-ref-2"]
}
```

响应使用 `207`，每个文件独立返回结果：

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "fileId": "file-ref-1",
        "status": "ready",
        "document": {
          "id": "doc-1",
          "collection_id": "metrics-docs",
          "filename": "metrics.md",
          "file_asset_ref_id": "file-ref-1",
          "mime_type": "text/markdown",
          "status": "ready"
        }
      },
      {
        "fileId": "file-ref-2",
        "status": "failed",
        "error": "KNOWLEDGE_FILE_TYPE_UNSUPPORTED:scan.pdf"
      }
    ]
  }
}
```

### POST `/api/v1/knowledge-bases/:id/search`

请求：

```json
{
  "query": "GMV definition",
  "topK": 3
}
```

响应：

```json
{
  "success": true,
  "data": [
    {
      "document_id": "doc-1",
      "chunk_id": "chunk-1",
      "filename": "metrics.md",
      "quote": "GMV means gross merchandise value.",
      "score": 0.91
    }
  ]
}
```

### POST `/api/v1/knowledge-bases/:id/reindex`

可带 `Idempotency-Key` header。当前实现同步执行并返回 `202`。

响应：

```json
{
  "success": true,
  "data": {
    "id": "4140c8cf-b30a-46d8-b3dc-0bb993578a0e",
    "type": "knowledge-reindex",
    "resource_id": "metrics-docs",
    "status": "completed",
    "progress": 100,
    "result": {
      "documents": 1,
      "chunks": 4
    }
  }
}
```

## 8. MCP Servers

MCP Server DTO 使用 `healthStatus` 表示状态。

### GET `/api/v1/mcp-servers`

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "local-mcp",
      "name": "Local MCP",
      "transport": "streamable-http",
      "serverUrl": "http://127.0.0.1:3333/mcp",
      "toolManifest": [],
      "hasSecret": false,
      "defaultEnabled": true,
      "builtin": false,
      "healthStatus": "connected",
      "revision": 2,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/mcp-servers`

请求：

```json
{
  "id": "local-mcp",
  "name": "Local MCP",
  "transport": "streamable-http",
  "serverUrl": "http://127.0.0.1:3333/mcp",
  "credentials": {
    "token": "mcp-token"
  },
  "defaultEnabled": true
}
```

响应：`201 Created`，data 为 MCP Server DTO，明文 token 不会返回。

### GET/PATCH/DELETE `/api/v1/mcp-servers/:id`

PATCH 请求示例：

```json
{
  "serverUrl": "http://127.0.0.1:3334/mcp",
  "revision": 2
}
```

### POST `/api/v1/mcp-servers/:id/test`

会连接 MCP server、调用 `listTools()`，并把 tools 写回 `toolManifest`。

响应：

```json
{
  "success": true,
  "data": {
    "id": "local-mcp",
    "latencyMs": 0,
    "status": "connected",
    "toolCount": 2,
    "revision": 3
  }
}
```

### GET `/api/v1/mcp-servers/:id/tools`

响应：

```json
{
  "success": true,
  "data": [
    {
      "name": "search_docs",
      "description": "Search local docs",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string"
          }
        }
      }
    }
  ]
}
```

## 9. Model Profiles

Model Profile DTO 使用 `connectionStatus` 表示状态。

### GET `/api/v1/model-profiles`

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "server-default",
      "name": "Server Default",
      "provider": "openai-compatible",
      "modelName": "qwen-plus",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "hasSecret": true,
      "defaultEnabled": true,
      "builtin": false,
      "connectionStatus": "connected",
      "revision": 1,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/model-profiles`

请求：

```json
{
  "id": "deepseek-chat",
  "name": "DeepSeek Chat",
  "provider": "openai-compatible",
  "modelName": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com",
  "credentials": {
    "apiKey": "sk-..."
  },
  "timeoutMs": 30000,
  "defaultEnabled": true
}
```

响应：`201 Created`，data 为 Model Profile DTO。

### GET/PATCH/DELETE `/api/v1/model-profiles/:id`

PATCH 请求示例：

```json
{
  "fallbackProfileId": "server-default",
  "temperature": 0.2,
  "maxTokens": 2048,
  "revision": 2
}
```

fallback chain 不能形成环，环会返回 `PROVIDER_TEST_FAILED`。

### POST `/api/v1/model-profiles/:id/test`

响应：

```json
{
  "success": true,
  "data": {
    "id": "deepseek-chat",
    "latencyMs": 612,
    "model": "deepseek-chat",
    "response": "ok",
    "status": "connected",
    "revision": 3
  }
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "PROVIDER_TEST_FAILED",
    "message": "PROVIDER_CONFIG_MISSING:deepseek-chat"
  }
}
```

## 10. Skills

Skill DTO 使用 `validationStatus` 表示状态。读接口不会返回 `packageBase64` 或
`packageContent`，需要通过 `/package` 单独读取。

### GET `/api/v1/skills`

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "data-analysis",
      "name": "Data Analysis",
      "description": "Analyze tabular data",
      "allowedTools": ["inspect_schema", "run_sql_readonly"],
      "version": "1.0.0",
      "manifest": {
        "entry": "SKILL.md",
        "files": ["SKILL.md"],
        "sizeBytes": 1024
      },
      "hasSecret": false,
      "defaultEnabled": true,
      "builtin": false,
      "validationStatus": "valid",
      "revision": 1,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/skills`

Skill 创建支持 multipart 上传 `.md` 或 `.zip`。包内必须有唯一 `SKILL.md`，且
frontmatter 必须包含 `name` 和 `description`。

Multipart 请求：

```text
Content-Type: multipart/form-data
field file=<SKILL.md or skill.zip>
field id=data-analysis
field defaultEnabled=true
```

响应：`201 Created`，data 为 Skill DTO。

### GET/PATCH/DELETE `/api/v1/skills/:id`

PATCH 只适合改元数据或启用状态；替换 package 用 `/replace`。

请求：

```json
{
  "defaultEnabled": false,
  "revision": 1
}
```

### POST `/api/v1/skills/:id/test`

通用验证接口。

响应：

```json
{
  "success": true,
  "data": {
    "id": "data-analysis",
    "status": "connected",
    "validated": true,
    "revision": 1
  }
}
```

### POST `/api/v1/skills/:id/validate`

响应：

```json
{
  "success": true,
  "data": {
    "id": "data-analysis",
    "revision": 1,
    "validationStatus": "valid"
  }
}
```

### POST `/api/v1/skills/:id/replace`

Multipart 请求同 `POST /api/v1/skills`，但写入已有 `:id`。

响应：data 为更新后的 Skill DTO。

### GET `/api/v1/skills/:id/package`

响应：

```json
{
  "success": true,
  "data": {
    "packageBase64": "LS0tCm5hbWU6IERhdGEgQW5hbHlzaXMK...",
    "packageContent": "Follow these data analysis instructions...",
    "packageFileName": "SKILL.md",
    "packageFormat": "skill-md"
  }
}
```

## 11. Artifacts

Artifact 由 agent tools 生成，当前 REST API 提供详情、preview 和下载。新文件型 artifact
通过 `file_asset_ref_id` 引用统一文件资产；旧 `storage_path` artifact 仍兼容读取。北向 AG-UI
`artifact` custom event 会携带 artifact summary 和下载入口。

### GET `/api/v1/artifacts/:id`

响应：

```json
{
  "success": true,
  "data": {
    "id": "artifact-1",
    "type": "table",
    "name": "orders preview",
    "preview_json": {
      "columns": ["id", "amount"],
      "rows": [
        {
          "id": 1,
          "amount": 99.5
        }
      ]
    },
    "mimeType": "application/json",
    "metadata": {
      "datasourceId": "api-duckdb-demo"
    },
    "createdAt": "2026-06-23T00:00:00.000Z"
  }
}
```

### GET `/api/v1/artifacts/:id/preview`

只返回 artifact preview JSON，不包一层 artifact summary。

响应：

```json
{
  "success": true,
  "data": {
    "columns": ["id", "amount"],
    "rows": [
      {
        "id": 1,
        "amount": 99.5
      }
    ]
  }
}
```

### GET `/api/v1/artifacts/:id/content`

返回 inline 内容，不使用 `ApiResult` envelope。

示例响应 header：

```text
Content-Type: application/json; charset=utf-8
Content-Disposition: inline; filename="orders-preview.json"
```

示例响应 body：

```json
{
  "columns": ["id", "amount"],
  "rows": [
    {
      "id": 1,
      "amount": 99.5
    }
  ]
}
```

如果 artifact 有 `file_asset_ref_id`，优先读取统一 FileAsset 内容；否则兼容读取旧
`storage_path`；再否则从 `preview_json` 序列化。

### GET `/api/v1/artifacts/:id/download`

返回 attachment 内容，不使用 `ApiResult` envelope。若 preview 是表格形态
`{ "columns": [], "rows": [] }`，优先导出 CSV。

示例响应 header：

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="orders-preview.csv"
```

示例响应 body：

```csv
id,amount
1,99.5
```

## 12. Agent Runtime Endpoint

### POST `/api/copilotkit`

这是 CopilotKit runtime endpoint，不是 `/api/v1` REST 配置接口。GUI/TUI 应按 AG-UI
`RunAgentInput` 和 AG-UI event stream 消费，不要自定义 SSE/chat 协议。

当前没有单独的 `/api/v1/runs`。前端上传文件后，如果要让 agent 感知文件，需要把
`POST /api/v1/files` 返回的 `data.files[].id` 放进 AG-UI run input 的
`forwardedProps.run_config.fileIds`。

最小请求形态：

```json
{
  "threadId": "thread-1",
  "runId": "run-1",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "分析 orders 表"
    }
  ],
  "forwardedProps": {
    "run_config": {
      "activeDatasourceId": "api-duckdb-demo",
      "enabledDatasourceIds": ["api-duckdb-demo"],
      "fileIds": ["file-ref-1"],
      "enabledKnowledgeIds": [],
      "enabledMcpServerIds": [],
      "enabledSkillIds": []
    }
  }
}
```

`fileIds` 是 `/api/v1/files` 返回的 FileAssetRef `id`。后端会在 run 开始时把这些文件
物化到当前 run workspace 的 `input/` 目录，并在模型上下文中注入文件清单。模型需要通过
workspace 工具读取文件内容，不会把大文件全文直接塞入 prompt。

后端也支持 `state.run_config.fileIds`、`context[].description === "run_config"`，以及
snake_case 的 `file_ids`。推荐前端优先使用 `forwardedProps.run_config.fileIds`，因为它优先级最高。

agent 生成结果文件后，可调用：

```text
publish_artifact         发布可下载交付物
promote_workspace_file   将 workspace 文件提升为后续 run 可复用的 file_id
```

详细字段、事件类型、幂等和 human-in-the-loop 见：
[CopilotKit / AG-UI Frontend Protocol Support](./copilotkit-ag-ui-frontend-protocol.md)。
