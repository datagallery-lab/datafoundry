# TUI 指南

TUI 是 Open Data Agent 的终端用户界面，适合远程服务器、开发者工作流、命令行偏好用户和需要快速验证后端能力的场景。

与 Web 工作台相比，TUI 更强调键盘操作、命令系统、实时流式反馈和导出能力。

## 启动方式

### 连接真实后端

先启动后端或完整开发服务：

```bash
npm run dev
```

然后启动 TUI：

```bash
npm run start:tui
```

如果后端地址不是默认地址，可以显式指定：

```bash
npm run start:tui -- --runtime-url http://127.0.0.1:8787/api/copilotkit
```

### 演示模式

演示模式不需要后端，适合快速查看界面、布局和命令系统：

```bash
npm run start:tui -- --demo
```

### 调试模式

调试模式会输出更多运行信息：

```bash
npm run start:tui -- --debug
```

日志默认写入：

```text
~/.dataagent/tui.log
```

## 主要视图

TUI 采用 3 个主要视图：


| 视图     | 用途                             |
| ------ | ------------------------------ |
| Chat   | 与 Agent 对话，查看实时响应、工具调用和分析结果。   |
| Stats  | 查看当前任务统计、步骤进度和运行状态。            |
| Config | 查看或管理数据源、模型、Skill、MCP 和知识库等配置。 |


你可以使用 `Ctrl+T` 或数字键 `1-3` 切换视图。

## 常用命令

TUI 支持 Slash 命令。输入 `/` 后可以使用 `Tab` 补全。


| 命令                     | 作用             | 示例                   |
| ---------------------- | -------------- | -------------------- |
| `/help [command]`      | 查看帮助           | `/help datasource`   |
| `/datasource <action>` | 管理数据源          | `/datasource list`   |
| `/model <action>`      | 管理或切换模型        | `/model switch <id>` |
| `/skill <action>`      | 管理 Skill       | `/skill list`        |
| `/mcp <action>`        | 管理 MCP Server  | `/mcp list`          |
| `/kb <action>`         | 管理知识库          | `/kb list`           |
| `/config [show         | capabilities]` | 查看配置或能力              |
| `/stats`               | 查看统计信息         | `/stats`             |
| `/export [filename]`   | 导出对话           | `/export chat.json`  |
| `/clear`               | 清空当前对话         | `/clear`             |
| `/exit`                | 退出程序           | `/exit`              |


具体 action 是否可用取决于当前后端能力和本地配置。

## 快捷键


| 快捷键              | 功能      |
| ---------------- | ------- |
| `Ctrl+C`         | 退出程序。   |
| `Ctrl+T` / `1-3` | 切换视图。   |
| `Tab`            | 命令自动补全。 |
| `↑` / `↓`        | 浏览历史命令。 |
| `Ctrl+U`         | 清空当前输入。 |


## 典型使用流程

1. 启动后端和 TUI。
2. 使用 `/config capabilities` 查看当前后端能力。
3. 使用 `/datasource list` 查看可用数据源。
4. 直接输入自然语言问题，例如：

```text
帮我查看当前数据源有哪些表，并统计 orders 表各渠道 GMV。
```

1. 在 Chat 视图观察流式回复和工具调用。
2. 使用 `/stats` 查看任务状态。
3. 使用 `/export chat.json` 导出对话记录。

## 与 Web 工作台的区别


| 维度   | Web 工作台        | TUI             |
| ---- | -------------- | --------------- |
| 主要用户 | 试用用户、业务分析、客户演示 | 终端用户、开发者、远程环境   |
| 操作方式 | 图形界面、点击和输入框    | 键盘、Slash 命令     |
| 追溯展示 | 右侧控制台和详情页      | Chat / Stats 视图 |
| 结果查看 | 表格、图表、SQL、报告预览 | 文本和表格渲染，适合导出    |
| 环境依赖 | 浏览器和前端服务       | 终端和后端服务         |


如果你需要完整视觉演示，优先使用 Web 工作台。如果你需要在 SSH、CI 或轻量终端环境中验证能力，TUI 更方便。

## 排查建议

- 无法连接后端：确认 `npm run dev` 或 `npm run dev:api` 正在运行。
- 模型无响应：检查根目录 `.env` 中的模型配置。
- 命令不可用：先运行 `/config capabilities` 查看当前环境支持情况。
- 输出异常：使用 `--debug` 启动，并查看 `~/.dataagent/tui.log`。

