# 配置 API 参考

配置 API 用于管理工作区资源，例如数据源、模型、知识库、MCP Server、Skill、文件和产出。Agent run 本身不通过这些资源接口启动，而是通过 CopilotKit / AG-UI 入口 `/api/copilotkit` 启动。

默认服务地址：

```text
http://127.0.0.1:8787
```

## 设计边界

Open Data Agent 将「配置管理」和「Agent run」分开：


| 类型          | 入口                | 用途             |
| ----------- | ----------------- | -------------- |
| 配置 REST API | `/api/v1/*`       | 创建、测试、启用、删除资源。 |
| Agent run   | `/api/copilotkit` | 启动一次数据分析运行。    |


数据源、模型、知识库、MCP 和 Skill 可以先在工作区中注册，再由本次 run 的 `run_config` 选择是否启用。

## 三层配置模型

一次运行的有效配置来自三层合并：

```text
effectiveRunConfig = merge(workspaceDefaults, perRunOverrides, serverPolicy)
```


| 层级                 | 归属    | 说明                      |
| ------------------ | ----- | ----------------------- |
| workspace defaults | 工作区配置 | 工作区默认安装了哪些资源、默认是否可用。    |
| per-run overrides  | 本次运行  | 当前问题临时启用或关闭哪些资源、使用哪个模型。 |
| server policy      | 后端策略  | 后端最终裁决权限、安全策略和强制开关。     |


## 鉴权说明

当前本地版本使用 local-first 开发身份解析：

```text
Authorization: Bearer <dev_token>
X-Dev-Token: <dev_token>
X-Workspace-Id: <workspace_id>
```

如果没有传认证头，本地服务会使用开发默认身份和默认 workspace。这个机制只适合本地试用和开发集成，不代表生产鉴权方案。生产环境应接入正式身份系统，并由后端入口解析用户和 workspace。

## 通用响应格式

大多数 REST API 使用统一 envelope。

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
    "message": "JSON_OBJECT_REQUIRED",
    "details": {}
  }
}
```

HTTP status 表示传输层结果，`error.code` 表示稳定业务错误。

## 通用资源字段

配置资源通常包含：


| 字段                        | 说明             |
| ------------------------- | -------------- |
| `id`                      | 稳定资源 ID。       |
| `name`                    | 展示名称。          |
| `description`             | 资源说明。          |
| `defaultEnabled`          | 是否默认对新 run 可用。 |
| `builtin`                 | 是否为内置资源。       |
| `createdAt` / `updatedAt` | 审计时间。          |
| `revision`                | 乐观并发版本。        |


更新资源时可以使用 `revision` 或 `If-Match` 做并发控制。冲突会返回 `REVISION_CONFLICT`。

## 凭据原则

- 凭据只在创建或更新资源时提交。
- 读接口不会回传明文凭据。
- 资源读响应只返回 `secretRef`、`hasSecret` 或同等标记。
- 前端和 TUI 不能把凭据放入 AG-UI messages、context 或 forwarded props。
- 如需清除凭据，使用资源支持的 `clearCredentials: true`。

## 主要资源接口


| 资源         | 路径                         | 用途                                  |
| ---------- | -------------------------- | ----------------------------------- |
| 数据源        | `/api/v1/datasources`      | 注册数据库或文件型数据源，测试连接，抓取 schema。        |
| 数据源类型      | `/api/v1/datasource-types` | 发现可用类型和字段 schema。                   |
| 知识库        | `/api/v1/knowledge-bases`  | 创建集合、上传文档、搜索、重建索引。                  |
| MCP Server | `/api/v1/mcp-servers`      | 配置外部 MCP 工具服务，测试并获取 tools manifest。 |
| 模型配置       | `/api/v1/model-profiles`   | 管理 LLM provider、Base URL、模型和采样参数。   |
| Skill      | `/api/v1/skills`           | 上传、验证、选择和下载 Skill package。          |
| 文件         | `/api/v1/files`            | 上传可复用文件，供后续 run 引用。                 |
| 工作区配置      | `/api/v1/workspace-config` | 读取或更新工作区资源默认启用状态。                   |
| 运行默认       | `/api/v1/run-defaults`     | 获取当前 run 默认配置。                      |
| 任务         | `/api/v1/jobs/:id`         | 查询或取消异步配置任务。                        |
| 产出         | `/api/v1/artifacts/:id`    | 查看、预览、读取或下载 Agent 产出。               |


## 与 Agent run 的衔接

配置资源创建后，需要在 Agent run 中通过 `run_config` 选择本次使用的资源：

```json
{
  "forwardedProps": {
    "run_config": {
      "activeDatasourceId": "sales-pg",
      "enabledDatasourceIds": ["sales-pg"],
      "activeLlmProfileId": "server-default",
      "enabledKnowledgeIds": ["metrics-docs"],
      "enabledMcpServerIds": ["local-tools"],
      "skill_mode": "auto",
      "fileIds": ["file-ref-1"]
    }
  }
}
```

后端会把 workspace defaults、per-run overrides 和 server policy 合并为不可变快照，再交给 Agent Runtime。

## 测试动作

多数资源提供 `POST /:id/test` 或创建前 dry-run，用于验证连接或配置是否可用。例如：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/datasources/sales-pg/test
curl -X POST http://127.0.0.1:8787/api/v1/model-profiles/qwen/test
curl -X POST http://127.0.0.1:8787/api/v1/mcp-servers/local-tools/test
```

测试动作不应泄露明文凭据，响应通常返回状态、延迟和诊断信息。

## 延伸阅读

- 数据源接入请看 [数据源指南](../guides/data-sources.md)。
- 完整端点列表请看 [REST API 参考](rest-api.md)。
- Agent run 和事件流请看 [架构概览](../architecture/overview.md)。

