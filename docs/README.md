# Documentation Map

更新时间：2026-06-25

## 实现依据（Source of Truth）

AI / 开发实现时按以下优先级读文档。**排在前面的覆盖排在后面的；backlog 不覆盖 spec。**

| 优先级 | 文档 | 用途 |
| --- | --- | --- |
| 1 | [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md) | AG-UI run 行为、事件类型、前后端协议 |
| 2 | [配置管理 REST 契约](engineering/config-management-api.md) | 配置 CRUD / `run_config` REST 契约与当前实现 |
| 3 | [后端 REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md) | 当前实际可用 REST 端点与 JSON 示例 |
| 4 | [File Asset / Workspace / Artifact / Knowledge 设计](engineering/2026-06-24-file-asset-workspace-artifact-knowledge-design.md) | 文件资产、workspace、artifact、KB 的统一生命周期 |
| 5 | [前端能力现状（自述快照）](engineering/2026-06-25-frontend-capability-status.md) | 前端已实现状态、字段接线与占位现状 |
| 6 | [对后端的能力要求](engineering/2026-06-25-backend-requirements.md) | 给后端的需求清单、验收、排期与答复区 |
| 7 | [Data Task 页面设计](../apps/web/src/app/data-tasks/DESIGN.md) | `/data-tasks` UI 映射、状态模型 |
| 8 | [AG-UI Agent Runtime 架构图](engineering/ag-ui-agent-runtime-architecture.svg) | 运行时结构示意 |
| 9 | 下方 Research / Product / PRD / 早期 Engineering | 历史输入，可能滞后于代码 |

App 级约束见 [`apps/api/AGENTS.md`](../apps/api/AGENTS.md)、[`apps/web/AGENTS.md`](../apps/web/AGENTS.md)。

## 文档归属原则

| 位置 | 放什么 |
| --- | --- |
| `docs/` | 跨 app 契约、backlog、产品/PRD、架构背景 |
| `apps/web/src/.../DESIGN.md` | 单个页面的 UI / 状态 / 组件设计 |
| `apps/*/README.md` | 该 app 的安装与运行 |
| `apps/*/AGENTS.md` | 给 AI 的局部实现约束 |

## Start Here

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [Repository README](../README.md) | 当前能力、运行和验证入口。 | Current |
| [Backend Config Runtime Delivery Report](engineering/2026-06-23-backend-config-runtime-delivery-report.md) | 本轮配置管理、run config、MCP、Skill、KB、adapter 交付报告。 | Current |
| [Backend REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md) | 当前后端 REST 端点、请求和响应样例。 | Current |
| [File Asset / Workspace / Artifact / Knowledge 设计](engineering/2026-06-24-file-asset-workspace-artifact-knowledge-design.md) | 文件资产、workspace、artifact、KB 的统一生命周期和边界。 | Current |
| [前端能力现状（自述快照）](engineering/2026-06-25-frontend-capability-status.md) | 前端已实现状态、字段接线与占位现状。 | Current |
| [对后端的能力要求](engineering/2026-06-25-backend-requirements.md) | 给后端的需求清单、验收、排期与答复区。 | Current |
| [研发 B 架构与开发计划](engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md) | Agent / Gateway / Knowledge 的阶段、边界和交付。 | Current |
| [CopilotKit / AG-UI 协议](engineering/copilotkit-ag-ui-frontend-protocol.md) | GUI/TUI 对接当前真实协议。 | Current |
| [上下文完整设计](engineering/agent-context-management-design.md) | ContextPackage、逐 step 编译、预算和后续 Memory/Knowledge。 | Current + Future |
| [Context Layering ADR](engineering/adr-0003-context-layering-and-naming.md) | 当前 context 分层、命名、public API/testing 边界。 | Current |
| [Memory Source Unification Plan](plans/2026-06-23-memory-context-source-unification.md) | memory-like source 的 authority/projection/context package 统一计划。 | Current + Future |
| [上下文交互架构图](engineering/agent-context-architecture.html) | 可视化查看 step loop、tool path、audit 和未来来源。 | Current + Future |
| [Conversation Memory 设计](engineering/2026-06-23-conversation-memory-design.md) | 服务端权威对话历史、消息持久化和 Mastra 入参组装。 | Current |
| [Mastra Memory 受控接入计划](plans/2026-06-23-mastra-memory-controlled-integration.md) | Mastra Memory 调研、架构决策和 Phase 1-3 实现状态。 | Current + Future |
| [通用数据 Agent 扩展方案](plans/2026-06-22-general-data-agent-expansion.md) | Run-bound Workspace、沙箱、context 与 artifact 的后续扩展。 | Proposed |
| [Tool Observation Adapter 对比](engineering/tool-observation-adapter-integration-comparison.md) | 当前三种接入路径与统一目标。 | Current |
| [TODO](../todo_list.md) | 尚未进入当前阶段的确认事项。 | Current |

## Current Architecture

- [系统架构 PlantUML](engineering/ag-ui-agent-runtime-architecture.puml) / [SVG](engineering/ag-ui-agent-runtime-architecture.svg)
- [Conversation Memory 架构](engineering/conversation-memory-architecture.puml) / [SVG](engineering/conversation-memory-architecture.svg)
- [Mastra Memory 受控接入架构 HTML](engineering/mastra-memory-controlled-integration.html)
- [上下文权威交互图 HTML](engineering/agent-context-architecture.html)
- [Context Governance Pipeline Mermaid](engineering/context-governance-pipeline.mmd) / [SVG](engineering/context-governance-pipeline.svg)

- [通用数据 Agent 扩展架构](engineering/general-data-agent-expansion-architecture.puml) / [SVG](engineering/general-data-agent-expansion-architecture.svg)

## Decisions And Implementation Notes

- [ADR-0001：上下文治理 Fail Closed](engineering/adr-0001-context-governance-fail-closed.md)
- [ADR-0002：每个 Mastra ReAct Step 编译上下文](engineering/adr-0002-context-compile-every-mastra-step.md)
- [ADR-0003：Context 分层、命名和文件组织](engineering/adr-0003-context-layering-and-naming.md)
- [Phase 1-3 实施计划](plans/2026-06-22-context-compilation-phases-1-3.md)
- [Memory Context Source 统一计划](plans/2026-06-23-memory-context-source-unification.md)
- [Tokenizer Cache Implementation Note](../TOKENIZER_CACHING.md)
- [Turn Grouping 统一设计](engineering/context-turn-grouping-unification-design.md)

### 活契约与对接（优先读）

- [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md)
- [配置管理 REST 契约](engineering/config-management-api.md)
- [后端 REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md)
- [前端能力现状（自述快照）](engineering/2026-06-25-frontend-capability-status.md)
- [对后端的能力要求](engineering/2026-06-25-backend-requirements.md)

## Historical Reviews

以下文档保留问题背景和评审过程，不作为当前代码事实来源：

- [AG-UI 协议适配分析](engineering/ag-ui-protocol-adaptation-analysis.md)
- [AG-UI 修复清单](engineering/ag-ui-protocol-fix-list.md)
- [DB-GPT-like 最终研发设计（10 天 MVP 基线）](engineering/db-gpt-like-data-agent-final-design-zh.md)

### 已冻结的前后端协作文档（按日期拆分前的合并版本）

> 自 2026-06-25 起，前端现状与对后端要求改为**按日期出独立快照**，不再往以下合并文档追加：

- [能力需求清单 #1–#20（2026-06-24 冻结）](engineering/archive/frontend-backend-capability-requests.md)
- [后端待实现清单 O-001–O-014（2026-06-25 冻结）](engineering/archive/backend-pending-requirements.md)
- [能力交付状态（2026-06-24 冻结）](engineering/archive/2026-06-23-frontend-backend-capability-status.md)
- [后端待实现清单（更早废弃版）](engineering/archive/backend-open-requirements-backlog.md)

## Product And Research Inputs

- [产品简报](product/db-gpt-like-data-agent-product-brief.md)
- [中文 PRD v0.2](prd/db-gpt-like-data-agent-prd-plan-zh.md)
- [English PRD v0.2](prd/db-gpt-like-data-agent-prd-plan.md)
- [DB-GPT GUI / Desktop Study](research/db-gpt-gui-desktop-study.md)

## Source Of Truth

发生冲突时按以下优先级判断：当前代码与 smoke tests → repository README → Current engineering docs → ADR →
historical review / PRD。历史文档不会覆盖已经实现并验证的 runtime 行为。

文档链接由 `npm run smoke:docs` 校验；新增 Current 文档或图时应同步更新本索引。
