# 架构概览

DataFoundry 采用本地优先的工作台架构。Web 和 TUI 作为用户入口，后端统一负责 Agent Runtime、配置管理、数据源访问、知识检索、文件和产出管理。

## 高层结构

```text
Web 工作台 / TUI / 其他客户端
  -> CopilotKit / AG-UI Agent run
  -> REST 配置与资源 API
  -> Agent Runtime
  -> Data Gateway / Knowledge / MCP / Skill / Files / Artifacts
  -> Metadata 与审计存储
```

精选架构图可参考仓库首页使用的运行流程图：[`docs/assets/readme/runtime-flow.png`](../../assets/readme/runtime-flow.png)。

## 主要模块


| 模块            | 职责                                             |
| ------------- | ---------------------------------------------- |
| `apps/web`    | Web 数据任务工作台，负责图形化对话、资源管理、追溯和产出展示。              |
| `apps/tui`    | 终端用户界面，负责命令行对话、数据源与 Skill 选择、统计和产出查看。          |
| `apps/api`    | 后端 HTTP 服务，提供 `/api/copilotkit` 和 `/api/v1/*`。 |
| Agent Runtime | 创建 DataFoundry，管理工具、运行上下文和 AG-UI 事件。            |
| Data Gateway  | 管理数据源、schema 检查、预览和只读 SQL 执行。                  |
| Knowledge     | 管理知识库文档、分块、检索和引用边界。                            |
| MCP           | 挂载外部工具服务，并执行工具 allowlist 和 timeout 策略。         |
| Skills        | 解析、存储、选择并在 run workspace 中物化 Skill package。    |
| Files         | 管理可复用文件资产和 run 内文件引用。                          |
| Artifacts     | 管理 Agent 生成的表格、图表、报告和可下载文件。                    |
| Metadata      | 保存用户、workspace、session、run、事件、资源配置、密钥引用和审计记录。  |


## 两类北向接口

后端对客户端暴露两类接口：


| 接口          | 路径                | 说明                            |
| ----------- | ----------------- | ----------------------------- |
| Agent run   | `/api/copilotkit` | 启动一次 Agent 分析运行，返回 AG-UI 事件流。 |
| REST 配置 API | `/api/v1/*`       | 管理工作区资源、文件、任务、产出和配置。          |


Web 和 TUI 都不直接读取后端内部 SQLite、Data Gateway 实现类或 Knowledge 实现类。它们只通过 HTTP 接口交互。

## 数据分析运行流程

```text
用户输入问题
  -> 客户端发送 AG-UI RunAgentInput
  -> 后端解析 threadId、runId、messages 和 run_config
  -> 合并 workspace defaults、per-run overrides 和 server policy
  -> Agent 检查 schema
  -> Agent 执行只读 SQL 或调用其他受控工具
  -> 后端写入 run events、SQL audit 和 artifacts
  -> 客户端展示文本、步骤、追溯和产出
```

关键点：

- `threadId` 表示会话，`runId` 表示单次运行。
- `run_config` 选择本次可用的数据源、模型、知识库、MCP、Skill 和文件。
- 后端负责重建服务端权威对话历史，客户端不需要把所有历史重新塞回下一次 run。
- 同一条 AG-UI 事件流既返回给客户端，也持久化为后续回放和审计依据。

## 数据访问边界

Data Gateway 位于 Agent 和真实数据源之间。它负责：

- 数据源注册和连接测试。
- schema introspection。
- 预览和只读 SQL 执行。
- SQL guard、limit、timeout、allowlist 和字段 mask。
- SQL audit 和结果 artifact 创建。

这意味着客户端不会拿到数据库凭据，Agent 也不能绕过 Data Gateway 直接访问数据库。

## 配置与凭据

工作区配置走 `/api/v1/*` REST API。资源凭据只在创建或更新时提交，后端会保存密钥引用，读接口不回传明文。

一次运行的有效配置由三层组成：

```text
workspace defaults
  + per-run overrides
  + server policy
  = effective run config
```

这种设计让左侧工作区配置、本次对话选择和后端安全策略保持分离。

## 文件、知识库和产出

文件可以作为可复用 FileAssetRef 存储，也可以作为单次对话附件进入 session workspace。Agent 运行中可通过受控 workspace 工具读取文件。

知识库通过后端服务管理文档、分块和检索结果。Agent 只看到经过策略控制的检索摘要和引用。

产出由 Artifact 服务管理，常见类型包括表格、图表、SQL、报告和文件。Web 适合预览、下载和导出，TUI 适合命令行查看。

## 本地开发与生产化边界

当前文档覆盖的是本地优先版本。它适合试用、演示和开发集成。生产化部署通常还需要补充：

- 正式身份认证和多租户隔离。
- Secret 管理服务，例如 KMS 或 Vault。
- 更完整的部署、监控和审计策略。
- 对外数据库的真实环境 E2E 验证。

这些不影响本地演示主路径，但在正式对外交付前需要单独评估。
