# Frontend Backend Capability Delivery Status

日期：2026-06-23
来源：后端 R&D B 配置管理与 Agent Runtime 交付状态
对应需求：[前端 -> 后端能力需求清单](./frontend-backend-capability-requests.md)

## 定位

本文件记录后端相对前端能力需求清单的当前实现状态。原
`frontend-backend-capability-requests.md` 继续作为需求与缺口清单，不在其中写交付状态。

## 总览

| # | 能力 | 当前后端状态 | 前端接入建议 | 主要依赖 |
| --- | --- | --- | --- | --- |
| 1 | secretRef 密钥服务 | 已实现 SQLite AES-GCM secret store；读接口不回传明文 | 可从本地凭据改为 REST 写入 | `SECRET_MASTER_KEY` |
| 2 | Datasource REST + 真实 DB adapter | REST 已实现；PG/MySQL adapter 已实现但缺真实 DB smoke | 可接 `/api/v1/datasources`；PG/MySQL 标 beta | 1 |
| 3 | effective run_config 执行 | 已实现 workspace defaults + per-run override + revision snapshot | 继续发送现有 `context.run_config` | - |
| 4 | LLM model-profiles + 按 run 切换 | 已实现 CRUD/test/run-level provider/fallback | 可接 model profile 表单 | 1, 3 |
| 5 | 查询策略与数据工具 | env SQL policy 与 per-datasource policy 已接入；策略只能收紧 | 可打开 query policy 字段 | 2 |
| 6 | KB / RAG 实现 + REST | 已实现 local-first FTS/vector、upload/search/reindex、`retrieve_knowledge` | 可接 KB REST；引用展示按后续 UX | 1, 3 |
| 7 | MCP 挂载 + registry REST | 已接官方 `@ag-ui/mcp-middleware`，支持 streamable HTTP / SSE | 可接 server 级启用；暂不暴露 per-tool allowlist | 1, 3 |
| 8 | Skill / task profile 策略层 | 已实现 multipart upload/validate/replace + prompt/tool policy | 可从 localStorage package 切到后端上传 | 3 |
| 9 | Artifact 预览/下载 API | 已实现 detail/preview/content/download；AG-UI 北向仍带 preview JSON | 可接产物卡片下载 | - |
| 10 | 多用户认证 / workspace 隔离 | 固定 `dev-user`；schema 已按 user/workspace 设计 | 暂不做多人 UI | - |

## 已验证

- `smoke:config-api` 覆盖配置 CRUD、secretRef、revision、job、schema cache、artifact API、
  本地 OpenAI-compatible model profile `/test`。
- `smoke:data-gateway` / `smoke:sql` 覆盖文件型与 demo datasource adapter。
- `smoke-copilotkit-context` 覆盖 run config、用户输入、task PLAN 投影。
- `typecheck`、`test:web`、`build:web` 在本轮相关变更后通过。

## 仍需真实环境验收

- PostgreSQL / MySQL 需要用户提供可访问只读实例做集成验证。
- 外部 LLM provider 的 `/test` 依赖本地 API key 和 provider 网络可达性。
- embedding/vector 效果依赖本地 embedding key；无 key 时走本地 FTS fallback。
- MCP 真实调用依赖用户配置可达的 streamable HTTP / SSE MCP server。

## 前端接入顺序建议

1. 左栏配置源从 localStorage 迁到 `/api/v1/workspace-config` 与各资源 CRUD。
2. DB/LLM/KB/MCP/Skill 分别接入 `test` / `validate` 状态；失败时保留资源但标记不可用。
3. run 时继续发送 `context.run_config`；不要把 credential、Skill 包正文或 artifact 内容塞进 AG-UI context。
4. 产物先接 REST preview/download；AG-UI 北向 artifact 模型收敛留到 workspace 集成阶段。
5. 多用户认证、workspace 共享、artifact 北向模型收敛作为下一阶段产品化。
