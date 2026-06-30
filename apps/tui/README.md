# 🎯 DataAgent TUI

终端用户界面 (Terminal User Interface)，为 DataAgent 提供完整的命令行交互体验。

## 📋 功能特性

### 核心功能
- ✅ **完整的 AG-UI 协议支持** - 13 种事件类型，实时流式响应
- ✅ **5 类配置管理** - Datasource / Model / Skill / MCP / Knowledge Base
- ✅ **12 个 Slash 命令** - 从帮助到恢复历史会话的完整命令系统
- ✅ **表格数据渲染** - 分页、自适应列宽、智能对齐
- ✅ **实时进度追踪** - 进度条、任务列表、工具调用可视化

### 用户体验
- 🎨 **3-Tab 响应式布局** - Chat / Stats / Config
- ⌨️ **键盘快捷键** - Ctrl+C/L/T/N/U/W, Tab, ↑/↓
- 🔍 **命令自动补全** - Tab 键触发，上下文感知
- 🎯 **友好的错误提示** - 分类错误、建议操作、自动重试
- 📝 **日志系统** - 文件日志、级别控制、日志轮转

## 🚀 快速启动

### 安装依赖

```bash
npm install
```

### 启动方式

#### 1. 连接真实后端
```bash
npm run start:tui

# 或指定后端 URL
npm run start:tui -- --runtime-url http://127.0.0.1:8787/api/copilotkit

# 恢复最近的服务端历史会话
npm run start:tui -- --resume

# 恢复指定 thread/session
npm run start:tui -- --resume thread-001
```

#### 2. 演示模式（无需后端）
```bash
npm run start:tui -- --demo
```

#### 3. 调试模式
```bash
npm run start:tui -- --debug
# 查看日志：tail -f ~/.dataagent/tui.log
```

## 📖 Slash 命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/help [command]` | 显示帮助 | `/help datasource` |
| `/datasource <action>` | 数据源管理 | `/datasource list` |
| `/model <action>` | 模型管理 | `/model switch <id>` |
| `/skill <action>` | Skill 管理 | `/skill list` |
| `/mcp <action>` | MCP 服务器管理 | `/mcp list` |
| `/kb <action>` | 知识库管理 | `/kb list` |
| `/tab <name>` | 切换视图（chat/stats/config/outputs） | `/tab outputs` |
| `/chat` `/stats` `/config` `/outputs` | 直接切换到对应视图 | `/stats` |
| `/status` | 显示当前会话状态 | `/status` |
| `/resume [latest\|list\|sessionId]` | 恢复服务端历史会话 | `/resume list` |
| `/export [filename]` | 导出对话 | `/export chat.json` |
| `/clear` | 清空对话 | `/clear` |
| `/exit` | 退出程序 | `/exit` |

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 退出程序 |
| `Tab` | 命令自动补全 |
| `↑` / `↓` | 历史命令导航 |
| `Ctrl+U` | 清空当前输入 |

完整文档：[IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md)
