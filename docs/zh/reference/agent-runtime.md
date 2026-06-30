# Agent Runtime 与 AG-UI 参考

Open Data Agent 的分析运行通过 `POST /api/copilotkit` 启动。Web 工作台和 TUI 都使用同一个入口，并按 CopilotKit / AG-UI 事件流消费运行过程。

## 运行入口

```text
POST /api/copilotkit
```

这个接口不是普通配置 REST API。它负责启动一次 Agent run，并以事件流返回模型回复、工具调用、运行状态、产出引用和错误信息。

## 请求上下文

常用字段包括：

| 字段 | 说明 |
| --- | --- |
| `threadId` | 会话 ID，用于恢复对话和关联历史。 |
| `runId` | 单次运行 ID，用于追踪和回放。 |
| `messages` | 当前用户输入。 |
| `forwardedProps.run_config` | 本次运行选择的数据源、模型、知识库、MCP、Skill 和文件。 |
| `state.run_config` | 客户端状态中的运行配置，优先级低于 `forwardedProps`。 |

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

## 运行配置合并

后端会把三层配置合并成一次运行的有效配置：

```text
workspace defaults
  + per-run overrides
  + server policy
  = effective run config
```

- `workspace defaults` 来自工作区资源默认配置。
- `per-run overrides` 来自当前输入框、资源选择和 `run_config`。
- `server policy` 是后端最终安全裁决，客户端不能绕过。

## 事件消费

客户端应按 AG-UI 事件语义渲染，不应自定义另一套 chat/SSE 协议。常见事件类别包括：

| 类别 | 用途 |
| --- | --- |
| run 状态 | 表示运行开始、完成、取消或失败。 |
| 文本消息 | 展示 Agent 的自然语言回复。 |
| reasoning / thought | 展示可公开的思考摘要或步骤说明。 |
| tool call | 展示 schema 检查、SQL 查询、文件读取等工具调用。 |
| custom event | 承载 artifact、SQL audit、token usage、workspace metadata 等结构化信息。 |

## 安全边界

- 客户端不能把数据库密码、模型 API Key、MCP Token 等明文凭据放进 `messages`、`context` 或 `forwardedProps`。
- 数据源访问必须经过 Data Gateway；Agent 不能直接拿到数据库凭据。
- 文件、知识库、Skill 和 MCP 工具都通过后端策略筛选后进入运行上下文。
- 事件流可以用于前端展示和回放，但不应携带敏感明文。

## 延伸阅读

- 配置资源请看 [配置 API 参考](configuration-api.md)。
- HTTP 端点总览请看 [REST API 参考](rest-api.md)。
- 系统结构请看 [架构概览](../architecture/overview.md)。
