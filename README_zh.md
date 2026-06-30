<h1 align="center">DataAgent 🚀</h1>

<p align="center">
  一个 TypeScript 数据 Agent 运行时与工作台，用于在数据库、文件、知识和生成物之上进行安全、可审计的分析。
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="docs/quick-start.md"><strong>快速开始</strong></a>
  ·
  <a href="docs/README.md"><strong>文档</strong></a>
  ·
  <a href="docs/engineering/supported-databases.md"><strong>支持的数据库</strong></a>
  ·
  <a href="#-参与贡献"><strong>参与贡献</strong></a>
  ·
  <a href="#-许可证"><strong>许可证</strong></a>
</p>

## ✨ 为什么是 DataAgent

现代数据 Agent 需要的不只是一个聊天模型。它们需要被选择过的上下文、数据源边界、SQL 策略、
可审计事件、持久化输出，以及一个可以回放完整运行过程的前端协议。

DataAgent 把这些能力放进同一个运行时：

- 🔎 **Schema-first 分析** - Agent 必须先检查数据源结构，之后才能执行只读 SQL。
- 🧠 **受治理的上下文** - 对话历史、记忆、工具结果、文件和知识来源会在同一个预算下编译。
- 🧾 **可审计执行** - AG-UI 事件、SQL 审计日志、Artifacts 和 Session 历史都会作为可回放记录持久化。
- 📦 **统一资产层** - 上传文件、Workspace 文件、生成输出和 KB 导入共用同一个去重资产层。
- 🧩 **协议就绪运行时** - CopilotKit / AG-UI 客户端消费同一套事件、运行状态、Artifacts 和回放数据。

## 🗄️ 接入你的数据栈

DataAgent 围绕 Data Gateway adapter 边界构建。当前运行时已经可以识别本地文件、嵌入式数据库、
云数仓、Lakehouse 引擎、业务数据库，以及搜索 / NoSQL 系统。

<p align="center">
  <img src="docs/assets/readme/database-wall.png" alt="Supported DataAgent datasource adapters" width="100%">
</p>

## 🧭 工作方式

<p align="center">
  <img src="docs/assets/readme/runtime-flow.png" alt="DataAgent runtime flow" width="100%">
</p>

前端只和一个后端运行时通信。后端负责身份、运行回放、上下文装配、记忆、工具策略、SQL 防护、
文件引用和 Artifact 创建。模型看到的是受治理的 Prompt；它永远不会看到原始数据源凭据。🛡️

## 🎬 GUI 和 TUI 预览位

这里预留给更完善的产品截图。GUI 和 TUI demo 准备好后，可以把占位图替换成截图或 GIF。

<table>
  <tr>
    <td><img src="docs/assets/readme/gui-slot.png" alt="GUI screenshot placeholder" width="100%"></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/tui-slot.png" alt="TUI screenshot placeholder" width="100%"></td>
  </tr>
</table>

## ⚡ 快速开始

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

打开工作台：

```text
http://127.0.0.1:3000/data-tasks
```

本地工作台内置一个 demo DuckDB 数据源。真实 Agent 运行需要在 `.env` 中配置真正的 LLM key。

```text
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=replace-with-your-key
```

DeepSeek 和其他 OpenAI-compatible provider 使用同一种 provider 模式：

```text
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=replace-with-your-key
```

## 🧩 你可以用它构建什么

| 使用场景 | 运行时支持 |
| --- | --- |
| 自然语言数据库分析 | 数据源选择、Schema 检查、SQL 防护、查询限制、超时、审计日志、表格 Artifact。 |
| 基于文件的 Agent 工作 | Session Workspace、跨 Session Workspace 资产、文件引用、下载、生成物。 |
| 知识辅助分析 | KB 导入、文档切片、本地搜索、可选的 embedding 检索、受治理的上下文注入。 |
| 前端 Agent UX | CopilotKit / AG-UI streaming、运行回放、任务状态、token 用量、Artifacts、交互挂起。 |
| 受控工具扩展 | Mastra tools、MCP middleware、Workspace tools、Skill packages、Tool observation adapters。 |

## 🛠️ 开发循环

```bash
npm run build
npm run smoke:config-api
npm run smoke:data-gateway
npm run smoke:copilotkit
npm run smoke:docs
```

针对你修改过的 package 使用对应 smoke 检查。`package.json` 中列出了完整验证集。

## 🤝 参与贡献

DataAgent 正在快速演进，因此小而聚焦的贡献最容易审查。

1. 行为变更、协议变更、数据源 adapter 和 Agent policy 变更，请先开 issue 或 discussion。
2. Pull request 保持聚焦，一次只修改一个运行时边界或功能区域。
3. 运行 `npm run build`，以及你改动过的 package 对应的 smoke 检查。
4. 如果变更影响 setup、API、数据源配置、事件行为或用户可见输出，请同步更新文档。
5. 不要提交凭据、本地数据库、生成的 storage 或私有 benchmark 数据。

## 🛣️ 路线图

<table>
  <tr>
    <td><strong>语义数据操作层</strong><br/>构建持久化业务语义层，覆盖指标、实体、Join、血缘、策略和可复用分析概念。</td>
    <td><strong>自主分析循环</strong><br/>让 Agent 可以规划调查、运行受控实验、批判发现，并收敛到有证据支撑的结论。</td>
  </tr>
  <tr>
    <td><strong>评测与可靠性实验室</strong><br/>构建可重复的 NL2SQL、检索、工具使用和端到端任务 benchmark，并配套回归门禁和失败取证。</td>
    <td><strong>多模态知识织物</strong><br/>把表格、文档、Notebook、图表、图片、日志和生成文件统一进同一个受治理的上下文与检索体系。</td>
  </tr>
  <tr>
    <td><strong>Agent 应用平台</strong><br/>把 DataAgent 暴露为面向领域分析 Agent、可复用工作流、自定义工具和可分享 Agent 应用的平台。</td>
    <td><strong>企业控制平面</strong><br/>加入多租户治理，覆盖身份、RBAC、审批、审计导出、policy-as-code、成本限制和部署运维。</td>
  </tr>
</table>

## 📚 文档

<table>
  <tr>
    <td><a href="docs/quick-start.md"><strong>快速开始</strong></a><br/>安装、配置模型 key，并运行工作台。</td>
    <td><a href="docs/engineering/copilotkit-ag-ui-frontend-protocol.md"><strong>AG-UI 协议</strong></a><br/>前端运行时事件和集成行为。</td>
  </tr>
  <tr>
    <td><a href="docs/engineering/supported-databases.md"><strong>支持的数据库</strong></a><br/>数据源类型、字段和注册示例。</td>
    <td><a href="docs/engineering/2026-06-23-conversation-memory-design.md"><strong>对话记忆</strong></a><br/>服务端权威历史和记忆装配。</td>
  </tr>
  <tr>
    <td><a href="docs/engineering/agent-context-management-design.md"><strong>上下文治理</strong></a><br/>上下文库存、策略、投影和 Prompt 预算。</td>
    <td><a href="docs/engineering/2026-06-24-file-asset-workspace-artifact-knowledge-design.md"><strong>文件和 Artifacts</strong></a><br/>文件、Workspace、Artifacts 和知识的统一生命周期。</td>
  </tr>
</table>

## 🧪 状态

DataAgent 正在积极开发中。当前代码和通过的 smoke checks 是事实来源；带日期的计划和评审文档仅保留作上下文，
不应覆盖已经实现的运行时行为。

## 📄 许可证

Apache License 2.0。见 [LICENSE](LICENSE)。
