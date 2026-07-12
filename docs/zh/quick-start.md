# 快速开始

这篇文档面向第一次部署 DataFoundry 的用户。读完后，你可以按**正式态**启动 Web 工作台（`build` + `start`，`password` 认证），配置模型服务，用内置 DuckDB demo 数据源跑通一次数据分析任务。

正式态分两种环境，**启动命令相同**，差别主要在邮箱与公网地址：

| 环境 | 用途 | `AUTH_EMAIL_DELIVERY` | `AUTH_PUBLIC_BASE_URL` |
| --- | --- | --- | --- |
| **正式测试** | 本机或内网验收、联调 | `test`（验证/重置链接打到控制台） | 如 `http://127.0.0.1:3000` |
| **真实生产** | 对外服务 | `smtp`（真实发信） | 公网 HTTPS 域名 |

两种正式态都**不要跑** `npm run dev` / `dev:api` / `dev:web`。贡献者本地热更新见文末附录。

首次体验不需要准备业务数据库。你只需要 Node.js、npm 和一个兼容 OpenAI `/chat/completions` 接口的模型 API Key。

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

## 2. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

### 2.1 模型（两种正式态都要）

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

### 2.2 正式测试（推荐首次验收）

根目录 `.env`：

```bash
DATAFOUNDRY_AUTH_MODE=password
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_EMAIL_DELIVERY=test
AUTH_EMAIL_FROM=DataFoundry <no-reply@example.com>
# smtp 相关可先留空
```

`apps/web/.env.local`（会在 `next build` 时打进前端）：

```bash
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE=password
# 正式态留空，走同源 BFF（Cookie + CSRF）
NEXT_PUBLIC_AGENT_RUNTIME_URL=
NEXT_PUBLIC_CONFIG_API_URL=
API_PROXY_TARGET=http://127.0.0.1:8787
```

注册/重置密码时，验证链接会打印在 **API 进程控制台**，复制到浏览器即可。

### 2.3 真实生产

在正式测试配置基础上改为：

```bash
DATAFOUNDRY_AUTH_MODE=password
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=https://datafoundry.example.com
AUTH_EMAIL_DELIVERY=smtp
AUTH_EMAIL_FROM=DataFoundry <no-reply@example.com>
AUTH_SMTP_HOST=smtp.example.com
AUTH_SMTP_PORT=587
AUTH_SMTP_SECURE=false
AUTH_SMTP_USER=
AUTH_SMTP_PASSWORD=
```

前端同样保持 `password` + 空公开 API URL + `API_PROXY_TARGET`。对外入口请用反代，样例见 [`deploy/nginx.datafoundry.conf.example`](https://github.com/datagallery-lab/datafoundry/blob/main/deploy/nginx.datafoundry.conf.example)：静态资源压缩，SSE 路径 `/api/copilotkit` 关闭 gzip 与 `proxy_buffering`。

## 3. 构建并启动（正式测试 / 真实生产相同）

```bash
npm run build
npm run build:web
npm run start:api    # :8787
npm run start:web    # :3000
```

检查：

```bash
curl http://127.0.0.1:8787/healthz   # 进程存活
curl http://127.0.0.1:8787/ready     # Mastra / builtin 就绪（含 startup_ms）
```

打开 [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)（真实生产则打开你的公网域名）注册或登录后进入 `/data-tasks`。

改过 `apps/web/.env.local` 中的 `NEXT_PUBLIC_*` 后，需要重新执行 `npm run build:web`。

## 4. 跑通第一个问题

打开 `/data-tasks` 后：

1. 点击「新建数据任务」。
2. 选择内置 **DTC Growth Review** 数据源（也可保留 DuckDB demo 做最小烟测）。
3. 在输入框旁选择「服务端默认」或你配置的模型。
4. 发送第一个问题。

推荐问题：

```text
帮我查看数据源里有哪些表，并说明每张表的主要字段。
```

统计问题：

```text
对比各渠道的 GMV、毛利、投放和退款，并说明下一轮预算应优先增加到哪个渠道。
```

你看到 schema 检查、SQL 执行和结果产出后，说明链路已经跑通。

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

现象：浏览器打不开工作台地址。

处理：

- 确认 `npm run start:web` 还在运行（正式态不要开 `dev`）。
- 检查 3000 端口是否被占用。
- 如果 3000 被占用，查看终端输出中的实际前端端口。

### 后端未启动

现象：页面能打开，但发送问题没有响应，或资源面板加载失败。

处理：

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/ready
```

如果健康检查失败：

```bash
npm run start:api
```

### 注册收不到邮件

- **正式测试**（`AUTH_EMAIL_DELIVERY=test`）：到运行 `start:api` 的终端里找验证链接。
- **真实生产**（`smtp`）：检查 `AUTH_SMTP_*` 与发信账号；确认 `AUTH_PUBLIC_BASE_URL` 与对外域名一致。

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

如果端口被占用，先停止占用进程，或按终端输出访问新的端口。改后端端口后，同步更新 `API_PROXY_TARGET`。

### 数据库连接失败

- PostgreSQL / MySQL 等服务端数据库需要网络可达。
- SQLite、CSV、Excel、DuckDB 文件需要使用后端进程能访问的路径。
- 首次接入建议使用只读账号或测试库。
- 凭据只在创建或更新资源时提交，读接口不会回传明文。

## 附录：贡献者本地热更新（非正式态）

仅用于改代码时的热更新，**不是**正式测试或真实生产路径。与正式态二选一，不要混开。

```bash
# 根目录 .env
DATAFOUNDRY_AUTH_MODE=dev

# apps/web/.env.local
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE=dev
NEXT_PUBLIC_AGENT_RUNTIME_URL=http://127.0.0.1:8787/api/copilotkit

npm run dev
# 或：npm run dev:api && npm run dev:web
```

## 下一步

- 使用 Web 界面：[Web 工作台指南](guides/web-workbench.md)
- 使用终端界面：[TUI 指南](guides/tui.md)
- 连接自己的数据：[数据源指南](guides/data-sources.md)
- 查看能力边界：[能力全览](capabilities.md)
