# 快速开始

这篇文档面向第一次试用 DataAgent 的用户。读完后，你可以启动 Web 工作台，配置模型服务，用内置 DuckDB demo 数据源跑通一次数据分析任务。

首次体验不需要准备数据库。你只需要 Node.js、npm 和一个兼容 OpenAI `/chat/completions` 接口的模型 API Key。

## 环境要求

- Node.js >= 22
- npm
- Linux、macOS 或 Windows
- 一个模型 API Key，例如通义千问、DeepSeek 或其他 OpenAI-compatible 服务

Windows 用户请在同一个系统内安装和运行项目。不要在 Windows 和 WSL 之间共用 `node_modules`。

## 1. 安装依赖

在仓库根目录执行：

```bash
node -v
npm install
```

`node -v` 输出需要不低于 22。首次安装会编译工作区依赖，耗时取决于机器和网络。

## 2. 配置模型

复制环境变量模板：

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

打开根目录 `.env`，填写模型配置：

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=你的_API_Key
```

DeepSeek 示例：

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=你的_API_Key
```

前端默认连接本地后端：

```bash
NEXT_PUBLIC_AGENT_RUNTIME_URL=http://127.0.0.1:8787/api/copilotkit
```

如果你没有改后端端口，保留 `apps/web/.env.local` 默认值。

## 3. 启动 Web 工作台

```bash
npm run dev
```

启动后打开：

- Web 工作台：[http://127.0.0.1:3000/data-tasks](http://127.0.0.1:3000/data-tasks)
- 后端健康检查：[http://127.0.0.1:8787/healthz](http://127.0.0.1:8787/healthz)

你也可以分开启动：

```bash
npm run dev:api
npm run dev:web
```

## 4. 跑通第一个问题

打开 `/data-tasks` 后：

1. 点击「新建数据任务」。
2. 保留内置 DuckDB demo 数据源。
3. 在输入框旁选择「服务端默认」或你配置的模型。
4. 发送第一个问题。

推荐问题：

```text
帮我查看数据源里有哪些表，并说明每张表的主要字段。
```

统计问题：

```text
统计 orders 表里各渠道的订单数量和 GMV 总和。
```

你看到 schema 检查、SQL 执行和结果产出后，说明本地链路已经跑通。

## 5. 启动 TUI

后端运行后，可以启动终端界面：

```bash
npm run start:tui
```

演示模式不需要后端：

```bash
npm run start:tui -- --demo
```

恢复最近的服务端会话：

```bash
npm run start:tui -- --resume
```

更多命令见 [TUI 指南](guides/tui.md)。

## 6. 排查

### Node 版本不对

现象：`npm install` 或构建阶段报 Node 版本错误。

处理：

```bash
node -v
```

升级到 Node.js 22 或更高版本后，重新执行 `npm install`。

### 页面打不开

现象：浏览器打不开 `http://127.0.0.1:3000/data-tasks`。

处理：

- 确认 `npm run dev` 还在运行。
- 检查 3000 端口是否被占用。
- 如果 3000 被占用，查看终端输出中的实际前端端口。

### 后端未启动

现象：页面能打开，但发送问题没有响应，或资源面板加载失败。

处理：

```bash
curl http://127.0.0.1:8787/healthz
```

如果健康检查失败，重新启动：

```bash
npm run dev:api
```

### 模型不可用

现象：Agent run 报 provider、401、rate limit 或 model not found。

处理：

- 检查 `.env` 中的 `LLM_API_KEY`。
- 检查 `LLM_BASE_URL` 是否以模型服务的兼容接口为准。
- 检查 `LLM_MODEL` 是否在你的账号下可用。
- 在 Web 工作台的模型配置里执行测试动作。

### 端口冲突

默认端口：

| 服务 | 端口 |
| --- | --- |
| Web | 3000 |
| API | 8787 |

如果端口被占用，先停止占用进程，或按终端输出访问新的端口。改后端端口后，同步更新 `NEXT_PUBLIC_AGENT_RUNTIME_URL`。

### 数据库连接失败

- PostgreSQL / MySQL 等服务端数据库需要网络可达。
- SQLite、CSV、Excel、DuckDB 文件需要使用后端进程能访问的路径。
- 首次接入建议使用只读账号或测试库。
- 凭据只在创建或更新资源时提交，读接口不会回传明文。

## 下一步

- 使用 Web 界面：[Web 工作台指南](guides/web-workbench.md)
- 使用终端界面：[TUI 指南](guides/tui.md)
- 连接自己的数据：[数据源指南](guides/data-sources.md)
- 查看能力边界：[能力全览](capabilities.md)
