# Tool 与 Context Adapter 接入方式对比

日期：2026-06-22

## 当前结论

“一工具一个 `ToolResultAdapter`”保持不变，所有已注册工具统一从执行边界进入：

```text
tool.execute raw result
-> GovernedToolFactory
-> ToolResultDispatcher
-> exact ToolResultAdapter
-> ContextPackage(model/activity/audit/artifact)
-> Mastra model observation + AG-UI event + run event persistence
```

`ToolObservationRouter` 不再承担正常工具治理。它只处理未来动态/MCP 工具绕过显式注册的异常情况：

- 已被 dispatcher 标记的结果直接跳过，避免二次治理。
- 有 adapter 的动态结果补走同一个 dispatcher。
- 无 adapter 时只返回 bounded preview，并发 `context.adapter-missing` 告警。

## 不同工具接入方式

| 工具类别 | 工具来源 | 执行接入 | Adapter 调用点 | 特殊行为 |
| --- | --- | --- | --- | --- |
| Data | 自建 `createTool` | `createDataAgentToolRegistry` | `GovernedToolFactory` | 工具只执行 Data Gateway 和业务事件；不调用 adapter。 |
| Workspace | Mastra `createWorkspaceTools` | 显式创建，关闭自动注入 | `GovernedToolFactory` | 保留 Mastra Workspace/LocalSandbox 执行上下文。 |
| Task | Mastra harness builtin | 显式注册四个 `task_*` | `GovernedToolFactory` | 原生 thread state 持久化；PLAN 由 projector 消费治理后结果。 |
| Collaboration | Mastra harness builtin | `ask_user`、`submit_plan` | `GovernedToolFactory` | `undefined` suspend 结果不治理；resume result 正常治理。 |
| Dynamic/MCP | 未来运行时加载 | 尚未正式接入 | router fallback | 只作 fail-closed 兜底，不算接入完成。 |

## Adapter 覆盖

| Tool | Adapter | 主要投影 |
| --- | --- | --- |
| `list_data_sources` | `ListDataSourcesContextAdapter` | run allowlist 数据源摘要 |
| `inspect_schema` | `SchemaContextAdapter` | schema 裁剪和 run-local `schema_id` |
| `preview_table` | `PreviewTableContextAdapter` | bounded preview |
| `run_sql_readonly` | `SqlResultContextAdapter` | 行列裁剪、artifact/audit ref |
| `read_file` | `ReadFileContextAdapter` | 文件内容限额 |
| `write_file` | `WriteFileContextAdapter` | 写入摘要 |
| `edit_file` | `EditFileContextAdapter` | 编辑摘要 |
| `list_files` | `ListFilesContextAdapter` | 文件列表裁剪 |
| `grep` | `GrepContextAdapter` | 命中结果裁剪 |
| `file_stat` | `FileStatContextAdapter` | 元数据投影 |
| `mkdir` | `MkdirContextAdapter` | 创建结果摘要 |
| `execute_command` | `ExecuteCommandContextAdapter` | stdout/stderr/exit code 限额 |
| `task_write` | `TaskWriteContextAdapter` | 完整 task snapshot |
| `task_update` | `TaskUpdateContextAdapter` | task 变化和 snapshot |
| `task_complete` | `TaskCompleteContextAdapter` | 完成状态和 snapshot |
| `task_check` | `TaskCheckContextAdapter` | summary 和 incomplete tasks |
| `ask_user` | `AskUserContextAdapter` | resume answer 和错误摘要 |
| `submit_plan` | `SubmitPlanContextAdapter` | approval/rejection 和 feedback 摘要 |

## 新工具统一模板

1. 在工具目录实现副作用和 raw result schema，不调用 context adapter。
2. 新建唯一 `ToolResultAdapter`，只负责该工具结果的裁剪、脱敏和分层投影。
3. 在 `ContextSourceRegistry` 注册 adapter；重复注册直接失败。
4. 将工具交给 `GovernedToolFactory`；adapter 缺失时启动/建 agent 直接失败。
5. 为 raw 超长结果、模型投影、activity/audit/artifact 投影和并发状态增加 smoke。
6. MCP/Skill/Knowledge 工具也使用此模板，不新增第三条治理路径。

## 边界说明

- `schema_id` 只证明当前 run 内完成过 inspect，不是数据库授权凭证，也不声称实时检测 schema drift。
- SQL 安全、datasource 授权和只读限制仍由 Data Gateway 强制执行。
- SQL 执行上限按 run 全局计数；per-datasource 计数只用于指标，不能扩大预算。
- `ask_user` / `submit_plan` 的 suspend payload 走 `InteractionRuntimeAdapter`，resume tool result 才进入
  `ToolResultAdapter`。
- Native goal 不是工具，由 `GoalRuntimeAdapter` 单独封装 Mastra experimental API。
