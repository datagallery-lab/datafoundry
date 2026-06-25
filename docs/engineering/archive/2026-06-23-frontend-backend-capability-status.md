# Frontend Backend Capability Delivery Status（已冻结归档）

> **本文件已冻结（2026-06-25）。** 最新前端现状见
> [前端能力现状](../2026-06-25-frontend-capability-status.md)，对后端要求见
> [对后端的能力要求](../2026-06-25-backend-requirements.md)。本文为 06-24 时点的已交付对照快照。

日期：2026-06-24
来源：后端 R&D B 配置管理与 Agent Runtime 交付状态
对应需求：[前端 -> 后端能力需求清单](./frontend-backend-capability-requests.md)
**待实现项工作清单（含后端答复区）**：[backend-pending-requirements.md](./backend-pending-requirements.md)

## 定位

本文件记录后端相对前端能力需求清单的**已实现**状态。原
`frontend-backend-capability-requests.md` 继续作为需求原文；**未实现 / 部分完成**项的统一排期与后端答复见
[backend-pending-requirements.md](./backend-pending-requirements.md)。

## 总览

| # | 能力 | 当前后端状态 | 前端接入建议 | 主要依赖 | Open backlog |
| --- | --- | --- | --- | --- | --- |
| 1 | secretRef 密钥服务 | 已实现 SQLite AES-GCM secret store；读接口不回传明文 | 可从本地凭据改为 REST 写入 | `SECRET_MASTER_KEY` | — |
| 2 | Datasource REST + 真实 DB adapter | REST 已实现；PG/MySQL adapter 已实现但缺真实 DB smoke | 可接 `/api/v1/datasources`；PG/MySQL 标 beta | 1 | [O-003](./backend-pending-requirements.md#o-003-pg--mysql-真实环境验收) |
| 3 | effective run_config 执行 | 已实现 workspace defaults + per-run override + revision snapshot | 继续发送现有 `context.run_config` | - | — |
| 4 | LLM model-profiles + 按 run 切换 | 已实现 CRUD/test/run-level provider/fallback | 可接 model profile 表单 | 1, 3 | — |
| 5 | 查询策略与数据工具 | env SQL policy 与 per-datasource policy 已接入；策略只能收紧 | 可打开 query policy 字段 | 2 | — |
| 6 | KB / RAG 实现 + REST | 已实现 local-first FTS/vector、upload/search/reindex、`retrieve_knowledge` | 可接 KB REST；引用展示按后续 UX | 1, 3 | — |
| 7 | MCP 挂载 + registry REST | 已接官方 `@ag-ui/mcp-middleware`，支持 streamable HTTP / SSE | 可接 server 级启用；暂不暴露 per-tool allowlist | 1, 3 | — |
| 8 | Skill / task profile 策略层 | 已实现 multipart upload/validate/replace + prompt/tool policy | 可从 localStorage package 切到后端上传 | 3 | — |
| 9 | Artifact 预览/下载 API | 已实现 detail/preview/content/download；AG-UI 北向仍带 preview JSON | 可接产物卡片下载 | - | [O-004](./backend-pending-requirements.md#o-004-artifact-北向协议收敛) |
| 10 | 多用户认证 / workspace 隔离 | 固定 `dev-user`；schema 已按 user/workspace 设计 | 暂不做多人 UI | - | [O-006](./backend-pending-requirements.md#o-006-多用户认证) |
| 11 | LLM Token 用量上报 | 待确认 | 前端 reducer 已就绪 | - | [O-002](./backend-pending-requirements.md#o-002-llm-token-用量上报) |
| 12 | Session 级 Workspace 隔离 | **未实现** | 无需改 CopilotKit | - | [O-001](./backend-pending-requirements.md#o-001-session-级-workspace-隔离) |
| 13 | 对话框文件上传 | **未实现** | 附件 UI 就绪，能力位 false | 12 | [O-007](./backend-pending-requirements.md#o-007-对话框文件上传) |
| 14–20 | DB-GPT 配置扩展（类型 / 策略 / RAG / MCP / Skill / schema API） | **未实现或部分完成** | 左栏字段已展示，B 档标「待后端」 | 2–8 | [O-008–O-014](./backend-pending-requirements.md#总览) |

## 已验证

- `smoke:config-api` 覆盖配置 CRUD、secretRef、revision、job、schema cache、artifact API、
  本地 OpenAI-compatible model profile `/test`。
- `smoke:data-gateway` / `smoke:sql` 覆盖文件型与 demo datasource adapter。
- `smoke-copilotkit-context` 覆盖 run config、用户输入、task PLAN 投影。
- `typecheck`、`test:web`、`build:web` 在本轮相关变更后通过。

## 仍需真实环境验收

→ 跟踪项：[O-003 PG/MySQL 真实环境验收](./backend-pending-requirements.md#o-003-pg--mysql-真实环境验收)

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
