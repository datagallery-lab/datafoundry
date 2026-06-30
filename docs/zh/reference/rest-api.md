# REST API 参考

本文汇总 Open Data Agent 当前对外 HTTP 接口。它面向二次开发、客户端集成和调试，不要求普通试用用户完整阅读。

默认地址：

```text
http://127.0.0.1:8787
```

## 接口分组


| 分组        | 入口                                         | 说明                                   |
| --------- | ------------------------------------------ | ------------------------------------ |
| 健康检查      | `GET /healthz`                             | 判断后端是否运行。                            |
| 能力发现      | `GET /api/v1/capabilities`                 | 查看当前环境启用的能力。                         |
| Agent run | `POST /api/copilotkit`                     | 通过 CopilotKit / AG-UI 启动一次 Agent 运行。 |
| 工作区配置     | `/api/v1/workspace-config`                 | 读取或更新工作区默认配置。                        |
| 数据源       | `/api/v1/datasources`                      | 管理数据源、测试连接、抓取 schema。                |
| 模型        | `/api/v1/model-profiles`                   | 管理 LLM 配置并测试连接。                      |
| 知识库       | `/api/v1/knowledge-bases`                  | 管理文档集合、检索和索引。                        |
| MCP       | `/api/v1/mcp-servers`                      | 管理 MCP Server 和 tools manifest。      |
| Skill     | `/api/v1/skills`                           | 上传、验证、选择和下载 Skill。                   |
| 文件        | `/api/v1/files`                            | 上传、下载和复用文件资产。                        |
| 产出        | `/api/v1/artifacts/:id`                    | 查看、预览、读取或下载 Agent 产出。                |
| 会话历史      | `/api/v1/sessions/:sessionId/conversation` | 读取服务端权威对话历史。                         |
| 异步任务      | `/api/v1/jobs/:id`                         | 查询或取消配置任务。                           |


## 通用约定

除文件下载、artifact content 和部分上传接口外，REST API 使用统一 envelope：

```json
{
  "success": true,
  "data": {}
}
```

错误响应：

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "resource not found"
  }
}
```

常见错误码包括：

```text
BAD_REQUEST, CONFLICT, DATASOURCE_TEST_FAILED, INTERNAL_ERROR, JOB_NOT_FOUND,
PROVIDER_TEST_FAILED, REVISION_CONFLICT, SECRET_MASTER_KEY_REQUIRED, UNAUTHORIZED,
RESOURCE_NOT_FOUND, NOT_ENABLED, UNSUPPORTED_FILE_TYPE, PARSE_FAILED, REINDEX_REQUIRED,
SQL_BLOCKED, SQL_TIMEOUT, PROVIDER_CONFIG_MISSING, PROVIDER_RATE_LIMITED
```

## 本地开发鉴权

本地开发模式支持下面的请求头：

```text
Authorization: Bearer <dev_token>
X-Dev-Token: <dev_token>
X-Workspace-Id: <workspace_id>
```

未传请求头时，后端会使用开发默认身份和默认 workspace。该行为仅适合本地试用和开发，不应视为生产鉴权设计。

## 健康与能力

### `GET /healthz`

用于确认后端是否运行。

```bash
curl http://127.0.0.1:8787/healthz
```

示例响应：

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

### `GET /api/v1/capabilities`

返回当前后端能力开关，例如数据源、文件、知识库、MCP、Skill 和 artifact export 是否启用。

```bash
curl http://127.0.0.1:8787/api/v1/capabilities
```

## 端点总览


| Method               | Path                                       | 说明                                   |
| -------------------- | ------------------------------------------ | ------------------------------------ |
| GET                  | `/healthz`                                 | 健康检查。                                |
| GET                  | `/api/v1/capabilities`                     | 后端能力开关。                              |
| POST                 | `/api/v1/chat/uploads`                     | 上传对话附件到 session workspace。           |
| GET                  | `/api/v1/datasource-types`                 | 发现支持的数据源类型 schema。                   |
| GET                  | `/api/v1/workspace-config`                 | 工作区配置全集。                             |
| PATCH                | `/api/v1/workspace-config`                 | 批量更新工作区默认启用状态。                       |
| GET                  | `/api/v1/run-defaults`                     | 当前 run 默认配置。                         |
| GET                  | `/api/v1/sessions/:sessionId/conversation` | 服务端权威对话历史与 tool-call 配对。             |
| GET                  | `/api/v1/jobs/:id`                         | 查询配置任务。                              |
| POST                 | `/api/v1/jobs/:id/cancel`                  | 取消配置任务。                              |
| GET / POST           | `/api/v1/datasources`                      | Datasource 列表 / 创建。                  |
| GET / PATCH / DELETE | `/api/v1/datasources/:id`                  | Datasource 详情 / 更新 / 删除。             |
| POST                 | `/api/v1/datasources/:id/test`             | Datasource 连接测试。                     |
| POST                 | `/api/v1/datasources/:id/introspect`       | Datasource schema 抓取。                |
| GET                  | `/api/v1/datasources/:id/schema`           | Datasource schema 快照。                |
| GET / POST           | `/api/v1/knowledge-bases`                  | Knowledge Base 列表 / 创建。              |
| GET / PATCH / DELETE | `/api/v1/knowledge-bases/:id`              | Knowledge Base 详情 / 更新 / 删除。         |
| POST                 | `/api/v1/knowledge-bases/:id/test`         | Knowledge Base 验证。                   |
| POST                 | `/api/v1/knowledge-bases/:id/files`        | 上传或写入文档。                             |
| POST                 | `/api/v1/knowledge-bases/:id/files/import` | 从 FileAssetRef 导入文档。                 |
| POST                 | `/api/v1/knowledge-bases/:id/search`       | 检索调试。                                |
| POST                 | `/api/v1/knowledge-bases/:id/reindex`      | 重建索引。                                |
| GET / POST           | `/api/v1/files`                            | 文件引用列表 / 批量上传。                       |
| GET / DELETE         | `/api/v1/files/:id`                        | 文件引用详情 / 删除引用。                       |
| GET                  | `/api/v1/files/:id/download`               | 下载文件资产内容。                            |
| GET / POST           | `/api/v1/mcp-servers`                      | MCP Server 列表 / 创建。                  |
| GET / PATCH / DELETE | `/api/v1/mcp-servers/:id`                  | MCP Server 详情 / 更新 / 删除。             |
| POST                 | `/api/v1/mcp-servers/:id/test`             | MCP Server 连通性与 tools manifest。      |
| GET                  | `/api/v1/mcp-servers/:id/tools`            | 拉取 MCP tools。                        |
| GET / POST           | `/api/v1/model-profiles`                   | Model Profile 列表 / 创建。               |
| GET / PATCH / DELETE | `/api/v1/model-profiles/:id`               | Model Profile 详情 / 更新 / 删除。          |
| POST                 | `/api/v1/model-profiles/:id/test`          | Model Provider 探测。                   |
| GET / POST           | `/api/v1/skills`                           | Skill 列表 / 上传创建。                     |
| POST                 | `/api/v1/skills/select`                    | 预览本次 run 的 Skill 筛选结果。               |
| GET / PATCH / DELETE | `/api/v1/skills/:id`                       | Skill 详情 / 更新 / 删除。                  |
| POST                 | `/api/v1/skills/:id/test`                  | Skill 通用验证。                          |
| POST                 | `/api/v1/skills/:id/validate`              | Skill 语义验证。                          |
| POST                 | `/api/v1/skills/:id/replace`               | 替换 Skill package。                    |
| GET                  | `/api/v1/skills/:id/package`               | 读取 Skill package 元数据。                |
| GET                  | `/api/v1/skills/:id/download`              | 下载 Skill package。                    |
| GET                  | `/api/v1/artifacts/:id`                    | Artifact 详情。                         |
| GET                  | `/api/v1/artifacts/:id/preview`            | Artifact preview JSON。               |
| GET                  | `/api/v1/artifacts/:id/content`            | Artifact inline 内容。                  |
| GET                  | `/api/v1/artifacts/:id/download`           | Artifact 下载。                         |
| POST                 | `/api/copilotkit`                          | CopilotKit / AG-UI Agent Runtime 入口。 |


## Agent Runtime

`POST /api/copilotkit` 是唯一的 Agent run 启动入口。Web 和 TUI 都应按 CopilotKit / AG-UI 的 `RunAgentInput` 和 event stream 语义接入，不需要自定义另一套 SSE 或 chat 协议。

最常用的运行上下文字段包括：


| 字段                          | 用途                               |
| --------------------------- | -------------------------------- |
| `threadId`                  | 会话维度。                            |
| `runId`                     | 单次运行维度。                          |
| `messages`                  | 当前用户输入。                          |
| `forwardedProps.run_config` | 本次运行选择的数据源、模型、知识库、MCP、Skill 和文件。 |
| `state.run_config`          | 状态中的运行配置，优先级低于 `forwardedProps`。 |


示例：

```json
{
  "threadId": "session-001",
  "runId": "run-001",
  "messages": [
    {
      "role": "user",
      "content": "统计 orders 表各渠道 GMV。"
    }
  ],
  "forwardedProps": {
    "run_config": {
      "activeDatasourceId": "api-duckdb-demo",
      "enabledDatasourceIds": ["api-duckdb-demo"],
      "activeLlmProfileId": "server-default"
    }
  }
}
```

## 文件与产出

文件生命周期分为两类：

- `POST /api/v1/files` 上传可复用文件，返回的 ID 可通过 `run_config.fileIds` 注入后续 run。
- `POST /api/v1/chat/uploads` 上传对话临时附件，写入当前 session workspace。

Agent 生成的用户可见结果通过 artifact 访问：

```bash
curl http://127.0.0.1:8787/api/v1/artifacts/<id>
curl http://127.0.0.1:8787/api/v1/artifacts/<id>/preview
curl http://127.0.0.1:8787/api/v1/artifacts/<id>/download
```

## 写入约定

- JSON 请求体默认上限为 1 MiB。
- `PATCH` 和覆盖写支持 `revision` 乐观并发控制。
- 重建索引、抓取 schema 等可重试动作可使用 `Idempotency-Key`。
- 凭据只在写接口提交，读接口不会返回明文。

## 延伸阅读

- 配置模型和资源边界请看 [配置 API 参考](configuration-api.md)。
- 数据源接入请看 [数据源指南](../guides/data-sources.md)。
- 系统结构和数据流请看 [架构概览](../architecture/overview.md)。

