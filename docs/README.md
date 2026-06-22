# Docs Index

## 实现依据（Source of Truth）

AI / 开发实现时按以下优先级读文档。**排在前面的覆盖排在后面的；backlog 不覆盖 spec。**

| 优先级 | 文档 | 用途 |
| --- | --- | --- |
| 1 | [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md) | AG-UI run 行为、事件类型、前后端协议 |
| 2 | [配置管理 REST 契约（草案）](engineering/config-management-api.md) | 配置 CRUD / `run_config` REST 契约 |
| 3 | [前端 → 后端能力需求清单](engineering/frontend-backend-capability-requests.md) | 后端缺口与排期（**不重复 spec 细节**） |
| 4 | [Data Task 页面设计](../../apps/web/src/app/data-tasks/DESIGN.md) | `/data-tasks` UI 映射、状态模型 |
| 5 | [AG-UI Agent Runtime 架构图](engineering/ag-ui-agent-runtime-architecture.svg) | 运行时结构示意 |
| 6 | 下方 Research / Product / PRD / 早期 Engineering | 历史输入，可能滞后于代码 |

App 级约束见 [`apps/api/AGENTS.md`](../apps/api/AGENTS.md)、[`apps/web/AGENTS.md`](../apps/web/AGENTS.md)。

## 文档归属原则

| 位置 | 放什么 |
| --- | --- |
| `docs/` | 跨 app 契约、backlog、产品/PRD、架构背景 |
| `apps/web/src/.../DESIGN.md` | 单个页面的 UI / 状态 / 组件设计 |
| `apps/*/README.md` | 该 app 的安装与运行 |
| `apps/*/AGENTS.md` | 给 AI 的局部实现约束 |

## Research

- [DB-GPT GUI / Desktop-like App Technical Study](research/db-gpt-gui-desktop-study.md)

## Product

- [DB-GPT-like Data Agent Product Brief](product/db-gpt-like-data-agent-product-brief.md)

## PRD

- [DB-GPT 类数据智能体工作台 PRD v0.2](prd/db-gpt-like-data-agent-prd-plan-zh.md)
- [DB-GPT-like Data Agent Workbench PRD v0.2](prd/db-gpt-like-data-agent-prd-plan.md)

## Engineering

### 活契约与对接（优先读）

- [CopilotKit / AG-UI 前端协议支持清单](engineering/copilotkit-ag-ui-frontend-protocol.md)
- [配置管理 REST 契约（草案）](engineering/config-management-api.md)
- [前端 → 后端能力需求清单](engineering/frontend-backend-capability-requests.md)

### 架构与设计（历史参考）

- [DB-GPT-like Data Agent 最终研发设计文档](engineering/db-gpt-like-data-agent-final-design-zh.md)
- [Agent / Data Gateway / Knowledge 架构设计与开发方案](engineering/rd-b-agent-gateway-knowledge-architecture-plan-zh.md)
- [AG-UI Agent Runtime PlantUML 架构图](engineering/ag-ui-agent-runtime-architecture.puml)
- [AG-UI Agent Runtime SVG 架构图](engineering/ag-ui-agent-runtime-architecture.svg)

PRD、Research 和较早的 Engineering 文档属于历史输入。当前实现以单一 CopilotKit/AG-UI runtime 为准；架构图见
[ag-ui-agent-runtime-architecture.svg](engineering/ag-ui-agent-runtime-architecture.svg)。
