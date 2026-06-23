# Documentation Map

更新时间：2026-06-23

## 实现依据（Source of Truth）

AI / 开发实现时按以下优先级读文档。**排在前面的覆盖排在后面的；backlog 不覆盖 spec。**

| 优先级 | 文档 | 用途 |
| --- | --- | --- |
| 1 | [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md) | AG-UI run 行为、事件类型、前后端协议 |
| 2 | [配置管理 REST 契约](engineering/config-management-api.md) | 配置 CRUD / `run_config` REST 契约与当前实现 |
| 3 | [后端 REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md) | 当前实际可用 REST 端点与 JSON 示例 |
| 4 | [前端 → 后端能力需求清单](engineering/frontend-backend-capability-requests.md) | 前端提出的能力需求、缺口与排期 |
| 5 | [后端能力交付状态](engineering/2026-06-23-frontend-backend-capability-status.md) | 对能力需求的后端实现状态 |
| 6 | [Data Task 页面设计](../../apps/web/src/app/data-tasks/DESIGN.md) | `/data-tasks` UI 映射、状态模型 |
| 7 | [AG-UI Agent Runtime 架构图](engineering/ag-ui-agent-runtime-architecture.svg) | 运行时结构示意 |
| 8 | 下方 Research / Product / PRD / 早期 Engineering | 历史输入，可能滞后于代码 |

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
| [Frontend Backend Capability Delivery Status](engineering/2026-06-23-frontend-backend-capability-status.md) | 前端能力需求对应的后端实现状态。 | Current |
| [研发 B 架构与开发计划](engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md) | Agent / Gateway / Knowledge 的阶段、边界和交付。 | Current |
| [CopilotKit / AG-UI 协议](engineering/copilotkit-ag-ui-frontend-protocol.md) | GUI/TUI 对接当前真实协议。 | Current |
| [上下文完整设计](engineering/agent-context-management-design.md) | ContextPackage、逐 step 编译、预算和后续 Memory/Knowledge。 | Current + Future |
| [上下文交互架构图](engineering/agent-context-architecture.html) | 可视化查看 step loop、tool path、audit 和未来来源。 | Current + Future |
| [通用数据 Agent 扩展方案](plans/2026-06-22-general-data-agent-expansion.md) | Run-bound Workspace、沙箱、context 与 artifact 的后续扩展。 | Proposed |
| [Tool / Context Adapter 对比](engineering/tool-context-adapter-integration-comparison.md) | 当前三种接入路径与统一目标。 | Current |
| [TODO](../todo_list.md) | 尚未进入当前阶段的确认事项。 | Current |

## Current Architecture

- [系统架构 PlantUML](engineering/ag-ui-agent-runtime-architecture.puml) / [SVG](engineering/ag-ui-agent-runtime-architecture.svg)
- [当前上下文 PlantUML](engineering/agent-context-current.puml) / [SVG](engineering/agent-context-current.svg)
- [上下文类图](engineering/agent-context-target-class.puml) / [SVG](engineering/agent-context-target-class.svg)
- [上下文组件图](engineering/agent-context-target-component.puml) / [SVG](engineering/agent-context-target-component.svg)
- [上下文时序图](engineering/agent-context-target-sequence.puml) / [SVG](engineering/agent-context-target-sequence.svg)
- [上下文状态图](engineering/agent-context-target-state.puml) / [SVG](engineering/agent-context-target-state.svg)
- [通用数据 Agent 扩展架构](engineering/general-data-agent-expansion-architecture.puml) / [SVG](engineering/general-data-agent-expansion-architecture.svg)

## Decisions And Implementation Notes

- [ADR-0001：上下文治理 Fail Closed](engineering/adr-0001-context-governance-fail-closed.md)
- [ADR-0002：每个 Mastra ReAct Step 编译上下文](engineering/adr-0002-context-compile-every-mastra-step.md)
- [Phase 1-3 实施计划](plans/2026-06-22-context-compilation-phases-1-3.md)
- [Tokenizer Cache Implementation Note](../TOKENIZER_CACHING.md)
- [Turn Grouping 统一设计](engineering/context-turn-grouping-unification-design.md)
- [Artifact 北向临时决策](engineering/artifact-event-reference-design.md)

### 活契约与对接（优先读）

- [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md)
- [配置管理 REST 契约](engineering/config-management-api.md)
- [后端 REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md)
- [前端 → 后端能力需求清单](engineering/frontend-backend-capability-requests.md)
- [后端能力交付状态](engineering/2026-06-23-frontend-backend-capability-status.md)

## Historical Reviews

以下文档保留问题背景和评审过程，不作为当前代码事实来源：

- [AG-UI 协议适配分析](engineering/ag-ui-protocol-adaptation-analysis.md)
- [AG-UI 修复清单](engineering/ag-ui-protocol-fix-list.md)
- [DB-GPT-like 最终研发设计（10 天 MVP 基线）](engineering/db-gpt-like-data-agent-final-design-zh.md)

## Product And Research Inputs

- [产品简报](product/db-gpt-like-data-agent-product-brief.md)
- [中文 PRD v0.2](prd/db-gpt-like-data-agent-prd-plan-zh.md)
- [English PRD v0.2](prd/db-gpt-like-data-agent-prd-plan.md)
- [DB-GPT GUI / Desktop Study](research/db-gpt-gui-desktop-study.md)

## Source Of Truth

发生冲突时按以下优先级判断：当前代码与 smoke tests → repository README → Current engineering docs → ADR →
historical review / PRD。历史文档不会覆盖已经实现并验证的 runtime 行为。
