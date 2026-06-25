# Backend Config Runtime Delivery Report

日期：2026-06-23
范围：研发 B 后端；未修改前端业务代码

## 1. 目标

本轮目标是在最新前端代码基础上，完成后端配置管理与运行时扩展，使 GUI/TUI 后续可以通过
REST 配置面 + AG-UI run 协议接入，而不绕过 Agent / Data Gateway / Knowledge 的安全边界。

## 2. 当前架构

```text
Frontend
  -> POST /api/copilotkit                  # AG-UI run 协议
  -> /api/v1/*                             # 配置、资源、artifact REST

apps/api
  -> resolveEffectiveRunConfig             # workspace defaults + per-run override + server policy
  -> @ag-ui/mastra MastraAgent
  -> @ag-ui/mcp-middleware                 # enabled MCP servers
  -> packages/agent-runtime tools

packages/agent-runtime
  -> Data tools -> packages/data-gateway
  -> Knowledge tool -> packages/knowledge
  -> Workspace / collaboration / task tools
  -> ToolObservationAdapter context governance

packages/metadata
  -> SQLite metadata, run_events, config resources, encrypted secrets, jobs, SQL audit, artifacts
```

核心边界不变：

- Data Gateway 不是前端查询 API，只由 agent tools 调用。
- 凭据只存在服务端 secret store，不进入 AG-UI、prompt、run_events 或 API 读响应。
- run_events 持久化标准 AG-UI `BaseEvent`，审计信息通过 AG-UI `CUSTOM` 或独立审计表承载。
- Skill / MCP / Knowledge 都由 `effectiveRunConfig` 决定本轮是否可用。

## 3. 已交付

- `/api/v1` 配置管理：datasource、knowledge-base、MCP server、model profile、skill、workspace config、run defaults、job、artifact。
- Secret 管理：SQLite AES-GCM 加密，`SECRET_MASTER_KEY` 服务端注入，读接口不回传明文。
- Effective run config：合并 workspace defaults、per-run override 和 server policy，生成资源 revision snapshot。
- Data Gateway：新增 PostgreSQL / MySQL adapter；per-datasource query policy 只能收紧 server policy。
- Knowledge：local-first `LocalKnowledgeService`，支持 FTS fallback 和可选 embedding vector retrieval。
- MCP：使用官方 `@ag-ui/mcp-middleware`，run 内按启用 server 动态挂载 streamable HTTP / SSE。
- Skill：multipart 上传/校验/替换，`allowedTools` 收窄工具集，active skill 注入 agent policy。
- Artifact：detail / preview / content / download REST；北向 AG-UI 事件已收敛为 id + 摘要引用。
- Audit 修复：升级 Next/Vitest，AG-UI langgraph 在 semver 范围内覆盖到 `0.0.42`。
- 真实前端验证修复：schema / SQL tool observation adapter 支持已治理 payload 和错误 payload，
  避免 Mastra streaming 下一步 processor 因 `rows` / `tables` 缺失崩溃。

## 4. 验证结果

已通过：

- `npm run typecheck`
- `npm run test:web`
- `npm run build:web`
- `npm run smoke:config-api`（含本地 OpenAI-compatible model profile `/test`）
- `node scripts/smoke-copilotkit.mjs`
- `node scripts/smoke-copilotkit-context.mjs`
- `node scripts/smoke-context-compilation.mjs`
- `node scripts/smoke-metadata.mjs`
- `node scripts/smoke-run-identity.mjs`
- `node scripts/smoke-data-gateway.mjs`
- `node scripts/smoke-sql-readonly.mjs`
- `node scripts/smoke-agent-runtime.mjs`
- `node scripts/smoke-task-state.mjs`
- `node scripts/smoke-collaboration-tools.mjs`
- `node scripts/smoke-workspace-tools.mjs`
- `node scripts/smoke-tool-state-isolation.mjs`

`npm audit --json` 当前结果：0 critical、0 high、11 low、9 moderate。

实际页面验证：

- API 以 `API_PORT=8877`、临时 `SECRET_MASTER_KEY` 启动。
- Web 以 `NEXT_PUBLIC_AGENT_RUNTIME_URL=http://127.0.0.1:8877/api/copilotkit` 启动。
- Safari 打开 `http://127.0.0.1:3000/data-tasks`，页面正常渲染。
- 发送 `orders` 后，前端显示 run 已完成，工具步骤 3/3 成功：`list_data_sources`、
  `inspect_schema`、`preview_table`，并渲染 `orders` 表 schema、3 行 preview 和最终回答。
- 当前后端 `/api/v1` 能力位已经覆盖 KB / MCP / Skill / datasource 等配置入口；前端可直接按
  `GET /api/v1/capabilities` 与 workspace config 返回值接线。

## 5. 当前限制

> 下列限制中**后端待办**已收录至 [对后端的能力要求](./2026-06-25-backend-requirements.md)。

- 产品化认证网关未做；当前为 local-first dev token 方案，运行链路和配置资源已按
  `workspace_id` / `user_id` 隔离 → [R-006](./2026-06-25-backend-requirements.md#r-006-多用户认证)。
- PostgreSQL / MySQL adapter 已实现，但还缺真实数据库服务端凭据下的端到端 smoke → [R-003](./2026-06-25-backend-requirements.md#r-003-pg--mysql-真实环境验收)。
- 外部 model profile、embedding、MCP server 的真实调用依赖用户本地 secret。
- 前端配置面已开始接入 `/api/v1`；后端接口和能力位按
  [对后端的能力要求](./2026-06-25-backend-requirements.md) 继续验收。
- `@ag-ui/mastra@1.0.3` 仍要求旧 CopilotKit runtime canary；本轮未强行替换框架栈。
- Artifact 北向事件已按 R-004 收敛；legacy run 级 `storage_path` artifact 迁移/兼容清理仍可后续处理。
- Workspace 已按 R-001 改为 session 级目录；回收策略仍按后续产品化生命周期治理。

## 6. 建议下一步

> **未实现项统一跟踪**：[对后端的能力要求](./2026-06-25-backend-requirements.md)（含后端答复区）

1. 用前端真实页面继续联调 `/api/v1/workspace-config`、各资源 CRUD 和 AG-UI run_config。
2. 用真实 PostgreSQL / MySQL / model / MCP / embedding key 做集成验收 → [R-003](./2026-06-25-backend-requirements.md#r-003-pg--mysql-真实环境验收)。
3. 继续补真实 DB 扩展 adapter 第二批（Oracle / SQL Server）和外部 RAG 能力。
4. 产品化认证网关、workspace 共享和后台 job 生命周期治理。
