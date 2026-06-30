# Internal Documentation

工程契约、设计说明与 ADR。供贡献者与 AI Agent 阅读，不是公开文档入口。

公开文档见 [docs/README.md](../docs/README.md)。

## 维护规则

- 不包含凭据、个人路径、个人信息或来源敏感描述。
- 公开文档（`docs/`、`README*.md`）不得链接本目录。
- 修改文档后运行 `npm run smoke:docs`。

## 工程契约

| 文档 | 说明 |
| --- | --- |
| [copilotkit-ag-ui-frontend-protocol.md](engineering/copilotkit-ag-ui-frontend-protocol.md) | AG-UI 前端协议与事件契约 |
| [config-management-api.md](engineering/config-management-api.md) | 配置 REST API 与 `run_config` 合并模型 |
| [backend-rest-api-reference.md](engineering/backend-rest-api-reference.md) | 后端 REST API 完整参考 |
| [supported-databases.md](engineering/supported-databases.md) | 数据源 adapter 与注册说明 |
| [data-tasks-workbench-design.md](engineering/data-tasks-workbench-design.md) | Web `/data-tasks` 工作台 UI 设计 |
| [tui-protocol-client.md](engineering/tui-protocol-client.md) | TUI CopilotKit 协议客户端 |
| [tui-state-management.md](engineering/tui-state-management.md) | TUI 状态管理与 Store API |

## 架构与设计

| 文档 | 说明 |
| --- | --- |
| [agent-context-management-design.md](engineering/agent-context-management-design.md) | Agent 上下文治理设计 |
| [conversation-memory-design.md](engineering/conversation-memory-design.md) | 会话记忆设计 |
| [skill-system-design.md](engineering/skill-system-design.md) | Skill 系统设计 |
| [file-asset-workspace-artifact-knowledge-design.md](engineering/file-asset-workspace-artifact-knowledge-design.md) | 文件资产、工作区与知识库设计 |
| [context-turn-grouping-unification-design.md](engineering/context-turn-grouping-unification-design.md) | Context turn 分组统一设计 |
| [tokenizer-caching.md](engineering/tokenizer-caching.md) | Tokenizer 缓存实现说明 |

## ADR

| 文档 | 说明 |
| --- | --- |
| [adr-0001-context-governance-fail-closed.md](engineering/adr-0001-context-governance-fail-closed.md) | 上下文治理 fail-closed |
| [adr-0002-context-compile-every-mastra-step.md](engineering/adr-0002-context-compile-every-mastra-step.md) | 每 Mastra step 编译上下文 |
| [adr-0002-memory-authority-and-mastra-memory-boundary.md](engineering/adr-0002-memory-authority-and-mastra-memory-boundary.md) | 记忆权威与 Mastra memory 边界 |
| [adr-0003-context-layering-and-naming.md](engineering/adr-0003-context-layering-and-naming.md) | 上下文分层与命名 |
