# 快速开始

本文帮助你在本地启动 Open Data Agent，配置模型 API Key，并用内置演示数据源跑通第一个数据分析任务。

首次体验不需要准备自己的数据库。项目内置 DuckDB 演示数据源，配置好模型后即可直接提问。

## 环境要求

- Node.js >= 22
- npm
- 一个兼容 OpenAI `/chat/completions` 接口的 LLM API Key，例如通义千问、DeepSeek 或其他兼容服务

支持 Linux、macOS 和 Windows。请在同一个操作系统内安装和运行，不要在 Windows 与 WSL 之间共用同一个 `node_modules` 目录。

## 1. 安装依赖

在仓库根目录执行：

```bash
node -v
npm install
```

确认 `node -v` 输出的版本不低于 22。首次安装会编译工作区依赖，可能需要几分钟。

## 2. 配置模型

复制环境变量模板：

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

打开根目录 `.env`，至少填写下面的模型配置：

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=你的_API_Key
```

如果使用 DeepSeek，可参考：

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=你的_API_Key
```

`apps/web/.env.local` 默认连接本地后端：

```bash
NEXT_PUBLIC_AGENT_RUNTIME_URL=http://127.0.0.1:8787/api/copilotkit
```

本地默认启动时通常无需修改。

## 3. 启动 Web 工作台

在仓库根目录执行：

```bash
npm run dev
```

启动成功后打开：

- Web 工作台：[http://127.0.0.1:3000/data-tasks](http://127.0.0.1:3000/data-tasks)
- 后端健康检查：[http://127.0.0.1:8787/healthz](http://127.0.0.1:8787/healthz)

## 4. 跑通第一个问题

打开 `/data-tasks` 后：

1. 点击「新建数据任务」。
2. 确认左侧数据源使用内置演示数据源。
3. 确认输入框旁的模型已选择「服务端默认」或你配置的模型。
4. 在输入框中发送一个问题。

推荐从下面的问题开始：

```text
帮我查看数据源里有哪些表，并说明每张表的主要字段
```

也可以直接做统计：

```text
统计 orders 表里各渠道的订单数量和 GMV 总和
```

发送后，工作台会展示 Agent 的回复、执行步骤、追溯链和查询结果。如果能看到表结构检查、SQL 执行和结果产出，就说明本地体验已经跑通。

## 5. 可选：启动 TUI

如果你更习惯终端，可以在后端启动后运行：

```bash
npm run start:tui
```

也可以用演示模式体验界面和命令系统：

```bash
npm run start:tui -- --demo
```

更多命令和快捷键见 [TUI 指南](guides/tui.md)。

## 6. 常见问题

### 页面打不开

- 确认 Node.js 版本 >= 22。
- 确认 `npm install` 已在当前操作系统下完整执行。
- 确认 3000 端口未被其他程序占用。

### 发送问题后没有响应

- 检查 `.env` 中的 `LLM_API_KEY` 是否已填写。
- 检查 `LLM_BASE_URL` 和 `LLM_MODEL` 是否与你的模型服务匹配。
- 打开 [http://127.0.0.1:8787/healthz](http://127.0.0.1:8787/healthz)，确认后端正在运行。

### 数据库连接失败

- 确认地址、端口、账号和密码正确。
- PostgreSQL / MySQL 等服务端数据库需要确保网络可达。
- SQLite、CSV、Excel、DuckDB 文件需要确认本地路径有效。
- 首次接入建议使用只读账号或测试库。

## 下一步

- 了解 Web 界面：阅读 [Web 工作台指南](guides/web-workbench.md)。
- 了解命令行界面：阅读 [TUI 指南](guides/tui.md)。
- 连接自己的数据：阅读 [数据源指南](guides/data-sources.md)。
- 查看完整能力：阅读 [能力全览](capabilities.md)。

