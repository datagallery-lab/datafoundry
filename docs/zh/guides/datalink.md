# DataLink 语义服务

DataLink 是 DataFoundry 的一方语义图服务，用于将物理 Schema 与数据画像连接到业务概念、实体、可 JOIN 路径和带置信度的关系。源码位于 `services/datalink`，继续使用 Python 实现。

## 运行拓扑

启用后，现有 DataFoundry 部署会启动四个本地进程：

| 进程 | 默认地址 | 用途 |
| --- | --- | --- |
| Web | `http://127.0.0.1:3000` | 工作台界面 |
| DataFoundry API | `http://127.0.0.1:8787` | Agent Runtime 与管理 API |
| DataLink MCP | `http://127.0.0.1:8080/mcp` | 向 Agent 提供 `datalink_explore` 语义上下文 |
| DataLink REST | `http://127.0.0.1:8081` | 图谱管理与可视化 API |

API 会按用户和 workspace 幂等注册 `builtin-datalink`。该托管资源会优先显示在 DataLink 面板中，不能通过配置 API 删除；REST 健康检查失败时显示为 `unavailable`。用户自行配置的外部 DataLink 服务仍可继续使用。

## 启用内置服务

安装 Python 3.10+ 与 [uv](https://docs.astral.sh/uv/) 后执行：

```bash
npm run install:datalink
```

在根目录 `.env` 中设置：

```bash
DATALINK_ENABLED=true
```

贡献者热更新使用 `npm run dev`；正式部署使用：

```bash
npm run build
npm run build:web
npm run start
```

按 `Ctrl+C` 会统一结束所有子进程。`DATALINK_ENABLED=false` 或未配置时，只启动 Web 与 API，也不会检查 Python 或 uv。

## 配置

托管服务默认使用以下路径与端口：

```bash
DATALINK_CONFIG_PATH=services/datalink/datalink_config.json
DATALINK_GRAPH_DB_PATH=storage/datalink/datalink.db
DATALINK_API_HOST=127.0.0.1
DATALINK_API_PORT=8081
DATALINK_MCP_HOST=127.0.0.1
DATALINK_MCP_PORT=8080
```

DataLink 默认复用 DataFoundry 的 `LLM_*` 与 `EMBEDDING_*`。只有需要为语义服务指定独立供应商时，才配置 `DATALINK_LLM_MODEL`、`DATALINK_LLM_BASE_URL`、`DATALINK_LLM_API_KEY` 或对应的 `DATALINK_EMBEDDING_*`。

API Key 不需要写入 `datalink_config.json`，应保存在环境变量或部署 Secret 管理系统中。图数据库默认存放在已忽略的 `storage/` 目录，正式部署时需要纳入备份策略。

## 拆分进程

已有进程守护系统时，仍沿用当前部署方式分别启动：

```bash
npm run start:api
npm run start:web
npm run start:datalink:mcp
npm run start:datalink:api
```

四个命令读取同一份根目录 `.env`。关闭自动启动不会影响通过 MCP 设置连接外部 DataLink 服务。

## 验证

```bash
curl http://127.0.0.1:8081/healthz
```

预期响应：

```json
{"status":"ok","service":"datalink"}
```

如果启动提示缺少 uv，请安装后重新执行 `npm run install:datalink`。如果工作台显示托管服务不可用，请检查 `8080`、`8081` 端口与两个 DataLink 进程日志，并确认图数据库路径可写。
