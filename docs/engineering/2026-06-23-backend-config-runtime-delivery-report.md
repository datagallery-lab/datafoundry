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
- Artifact：detail / preview / content / download REST；北向 AG-UI 事件暂保留 preview JSON。
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
- 前端左栏仍显示 KB/MCP “后端未支持”，这是前端能力开关尚未接 `/api/v1` 的问题，不是后端缺失。

## 5. 当前限制

- 多用户认证未做；当前仍是固定 `dev-user`，但表结构按 `workspace_id` / `user_id` 保留隔离维度。
- PostgreSQL / MySQL adapter 已实现，但还缺真实数据库服务端凭据下的端到端 smoke。
- 外部 model profile、embedding、MCP server 的真实调用依赖用户本地 secret。
- 前端当前仍主要使用 localStorage 配置，尚未接 `/api/v1` 配置面；后端接口已经可供接入。
- `@ag-ui/mastra@1.0.3` 仍要求旧 CopilotKit runtime canary；本轮未强行替换框架栈。
- Artifact 北向事件仍携带 preview JSON；等 workspace artifact 模型整合后再收敛。

## 6. 建议下一步

1. 前端将左栏配置源切换到 `/api/v1/workspace-config` 和各资源 CRUD。
2. 用真实 PostgreSQL / MySQL / model / MCP / embedding key 做集成验收。
3. 开始 conversation memory 设计与实现，明确 memory 与 Knowledge 的职责边界。
4. 将 artifact 北向事件从 preview JSON 逐步改为 workspace artifact reference。
