# 通用数据 Agent 扩展方案

状态：修订待确认（2026-06-22）
范围：R&D B，Agent Runtime / Context Governance / Data Gateway / Artifact
关联架构图：[PlantUML](../engineering/general-data-agent-expansion-architecture.puml) / [SVG](../engineering/general-data-agent-expansion-architecture.svg)

## 1. 修订摘要

本版修正上一稿中不可直接实施的假设：

1. Phase 1 使用 `LocalSandbox`，不再使用当前依赖中不存在的 `ComputeSDKSandbox({ provider: "local" })`。
2. Workspace 在 `createDataAgent` 时按 run 静态创建和绑定，不依赖额外的 Mastra `RequestContext` 身份解析。
3. `LocalSandbox` 默认 `isolation: "none"`，因此命令执行必须 fail-closed；文件工具不受影响。
4. Mastra Workspace 自动注入的工具结果在 step-level 统一拦截，再按 `toolName` 路由到一工具一个
   `ToolResultAdapter`；通用层只负责路由和未知工具 fallback。
5. 正式接入 Mastra builtin `task_*`、`ask_user`、`submit_plan` 和 native goal capability。
   `task_*` 全面覆盖计划、终态和回放后，删除旧三任务硬编码 PLAN 实现。
6. Artifact 不扫描整个工作区；只归档显式登记或 `outputs/` 目录中的允许产物。
7. 多 datasource 不通过放宽现有 `selected_datasource_id` 偷渡实现，后续引入明确的 datasource allowlist。

## 2. 目标与非目标

### 2.1 目标

把当前只读数据 Agent 扩展为能够在受控工作区中生成文件、执行分析脚本并产出 artifact 的通用数据 Agent：

- 保留 `inspect_schema` / `run_sql_readonly` 的数据安全与 SQL 审计边界。
- 接入 Mastra Workspace 文件工具。
- 在可验证的本地隔离后启用 `execute_command`。
- 每个工具通过自己的 `ToolResultAdapter` 进入每一步 prompt 编译和预算治理。
- 接入 task、ask/approval 和 goal，并保持 AG-UI 事件、持久化与回放统一。
- 每个 run 拥有独立工作区和明确生命周期。
- 生成的 CSV、JSON、图表和脚本可显式归档为 artifact。

### 2.2 非目标

以下内容不进入首期 Workspace 交付：

- 不切换 e2b/modal/daytona 等远程 sandbox provider。
- 不开放任意多 datasource 访问。
- 不在 Phase 1 重设计 artifact 北向 AG-UI 事件。
- 不实现跨 run 的持久项目工作区。
- 不允许 Agent 访问仓库源码、宿主凭据或非工作区路径。

## 3. 已核实的技术事实

1. 当前安装的 `@mastra/core@^1.42.0` 从 `@mastra/core/workspace` 公开导出 `Workspace`、
   `LocalFilesystem`、`LocalSandbox` 和 Workspace tools。
2. 当前包不导出 `ComputeSDKSandbox`。远程 Compute SDK provider 需要独立包，包名和版本必须在引入阶段重新验证。
3. `LocalSandbox` 默认 `isolation: "none"`；macOS seatbelt 和 Linux bubblewrap 需要显式检测与配置。
4. `Agent` 配置 `workspace` 后，Mastra 会注入 Workspace tools，但这些工具不会自动调用我们的
   `ContextOrchestrator.packageToolResult()`；需要从 Mastra tool observation 统一提取并路由到已注册 adapter。
5. Mastra builtin task tools 的公开入口是 `@mastra/core/harness`。task state 需要通过确定性的 AG-UI projector
   转换为 PLAN activity 后，才能替代当前北向实现。
6. `ask_user` 和 `submit_plan` 使用 Mastra native tool suspension，需要宿主实现 suspend/resume、持久化和 AG-UI 映射。
7. 当前版本的 goal 是 experimental Agent capability，配置入口是 `AgentConfig.goal` 和 objective API，
   不是 `@mastra/core/harness` 导出的 builtin tool。
8. `task_*` 只在 memory-backed Agent 上工作，并依赖 thread-scoped state store；只注册 tool 会返回 no-memory error。
9. 当前 `@ag-ui/mastra` 会缓存普通 tool-call chunk，并在后续出现 `tool-call-suspended` 时抑制普通工具事件，
   因此 ask/submit 的交互事件不能依赖默认 tool event 流。
10. 当前 `createDataAgent` 每个 run 创建一次，已经持有可信的 `AgentRunContext`，无需再次从模型请求上下文中解析身份。
11. 当前 `ArtifactService` 只能创建 metadata/preview 记录，尚不具备文件复制、hash、大小和存储路径落库的完整归档能力。

禁止以 `node_modules/@mastra/core/dist/chunk-*.js` 文件名作为设计或实现依据。只能依赖 package exports、公开类型和契约测试。

## 4. 架构原则

### 4.1 身份只有一个可信来源

`user_id/session_id/run_id` 由 API 完成 run claim 后创建 `AgentRunContext`。Workspace、artifact 和审计统一使用该对象，
不接受模型参数覆盖，也不从 tool arguments 中重新推导。

### 4.2 Workspace 与 run 静态绑定

当前 Agent 实例是 per-run，因此 Workspace 也使用 per-run 静态实例：

```typescript
const runWorkspace = createRunWorkspace({ runContext, workspaceRoot });
const agent = new Agent({ workspace: runWorkspace.workspace });
```

`createDataAgent` 返回 `workspaceLifecycle`，由 API runtime 在 terminal path 上调用。这样可避免：

- 每次 tool call 重新创建 Workspace/Sandbox。
- 依赖未注入的 Mastra `RequestContext`。
- workspace 所有者不清楚，无法可靠归档和清理。

### 4.3 数据访问和脚本执行分离

- 数据库只能通过 Data Gateway 工具访问。
- Workspace 脚本不得直接获得 datasource credentials。
- SQL 仍由 `run_sql_readonly` 执行并审计。
- 如需把 SQL 结果用于脚本，应由受控工具导出到 Workspace，而不是把数据库连接交给脚本。

### 4.4 北向协议保持 AG-UI

Workspace、context、artifact 和 task 的内部实现不能改变北向原则：

- 所有实时事件使用 AG-UI 标准事件类型。
- 扩展数据放在 AG-UI `CUSTOM` payload，不创造第二套 SSE event schema。
- 持久化保存发给客户端的同类型事件，支持原样回放。
- `task_*` 是计划状态的唯一目标事实来源，AG-UI PLAN activity 是它的北向投影和持久化事件。
- 旧 PLAN 实现仅在迁移期保留，覆盖验收通过后整套删除，不保留双写或长期兼容路径。

## 5. 目标组件

### 5.1 RunWorkspaceFactory

职责：

- 解析工作区根目录：调用方注入 > `WORKSPACE_ROOT` > 系统 temp 子目录。
- 使用不可逆编码或安全 path segment 构造 `{root}/{user}/{session}/{run}`。
- 创建 `LocalFilesystem({ basePath: runDir, contained: true })`。
- 检测本地 isolation backend。
- 创建并初始化 `LocalSandbox`，或在隔离不可用时关闭执行工具。
- 返回 Workspace、runDir、capabilities 和 lifecycle handle。

不得直接把未校验的外部 ID 传给 `path.join()`。即使当前 ID 通常是 UUID，也必须在边界统一校验或编码，防止路径穿越。

```typescript
type RunWorkspaceHandle = {
  workspace: Workspace;
  runDir: string;
  capabilities: {
    commandExecution: boolean;
    isolation: "seatbelt" | "bwrap" | "none";
  };
  archive(): Promise<ArtifactSummary[]>;
  destroy(): Promise<void>;
};
```

### 5.2 WorkspaceSecurityPolicy

安全策略不是单一命令黑名单，而是分层执行：

1. 没有可靠 isolation 时不暴露 `execute_command`。
2. Sandbox 只继承明确允许的环境变量，默认仅保留必要的 `PATH`。
3. 设置命令超时、输出 token/byte 限制、进程数量和工作区容量限制。
4. 禁止网络访问；远程 provider 切换前必须用集成测试验证，而不是相信配置名。
5. `beforeToolCall` 只作为附加策略，拦截已知危险输入，不作为唯一安全边界。
6. 禁止后台进程脱离 run abort signal。

Phase 1 默认配置：

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `WORKSPACE_COMMAND_ENABLED` | `true` | 仍受 isolation 检测约束 |
| `WORKSPACE_ALLOW_UNSANDBOXED_EXECUTION` | `false` | 生产环境不得开启 |
| `WORKSPACE_COMMAND_TIMEOUT_MS` | `30000` | 单次命令超时 |
| `WORKSPACE_MAX_OUTPUT_TOKENS` | `3000` | Workspace tool 第一层输出限制 |
| `WORKSPACE_MAX_BYTES` | `104857600` | 每 run 100 MiB 初始上限 |
| `WORKSPACE_MAX_FILES` | `500` | 防止异常文件膨胀 |

### 5.3 ToolObservationRouter 与一工具一 Adapter

“一工具一个 `ToolResultAdapter`”是既定扩展边界，继续保留。统一层只解决 Mastra 自动工具不会主动调用
`ContextOrchestrator.packageToolResult()` 的接入问题，不能取代各工具 adapter。

```text
Mastra messages
  -> ToolObservationRouter.extract(toolName, callId, rawResult)
  -> ContextSourceRegistry.resolveByToolName(toolName)
  -> concrete ToolResultAdapter.adapt(rawResult)
  -> ContextPackageBuilder
  -> StepContextPlanner
  -> PromptView
  -> ProviderPromptGuard
```

职责边界：

- `ToolObservationRouter`：稳定解析 Mastra tool message、去重 tool call、查找 adapter、记录缺失 adapter。
- `ContextSourceRegistry`：按精确 `toolName` 注册和解析 adapter，重复注册直接失败。
- `ToolResultAdapter`：理解该工具的 input/output schema，并生成 model/activity/audit 三种投影所需的 `ContextItem`。
- 共享 helper：只复用 truncate、artifact reference、hash、stdout/stderr budget 等纯策略，不合并工具语义。
- fallback adapter：仅用于未知工具的 fail-safe 截断和告警，不视为该工具已经完成治理。

首批 adapter：

| Adapter | Tool | 专属治理 |
|---|---|---|
| `InspectSchemaContextAdapter` | `inspect_schema` | schema 结构裁剪、表列优先级 |
| `RunSqlReadonlyContextAdapter` | `run_sql_readonly` | rows 预览、audit/artifact ref |
| `ReadFileContextAdapter` | `read_file` | mime、文本截断、大文件引用化 |
| `WriteFileContextAdapter` | `write_file` | 路径、大小、hash，不回灌文件全文 |
| `EditFileContextAdapter` | `edit_file` | 修改摘要、路径、版本信息 |
| `ListFilesContextAdapter` | `list_files` | 数量、深度和 metadata 限制 |
| `GrepContextAdapter` | `grep` | 命中数、路径、行号和片段预算 |
| `SearchContextAdapter` | `search` | score、来源和 top-k 限制 |
| `ExecuteCommandContextAdapter` | `execute_command` | stdout/stderr/exitCode 分离治理 |
| `RegisterOutputContextAdapter` | `register_output` | artifact manifest ref |
| `ExportQueryResultContextAdapter` | `export_query_result` | 导出摘要、audit/artifact ref |
| `TaskWriteContextAdapter` | `task_write` | 稳定 task ID 和完整替换结果 |
| `TaskUpdateContextAdapter` | `task_update` | 单 task 变更和当前快照 |
| `TaskCompleteContextAdapter` | `task_complete` | 完成状态和剩余任务 |
| `TaskCheckContextAdapter` | `task_check` | completion summary |
| `AskUserContextAdapter` | `ask_user` | 问题、选项、resume answer |
| `SubmitPlanContextAdapter` | `submit_plan` | plan、审批结果、feedback |

新增工具的 Definition of Done 必须包含 adapter、预算测试和未知/超长结果测试。不能只注册 Mastra tool。

### 5.4 WorkspaceArtifactService

归档范围只有两种来源：

1. Agent 通过受控工具显式登记到 `WorkspaceArtifactManifest`。
2. 位于工作区 `outputs/` 下且通过类型、大小和 symlink 校验的文件。

不扫描和归档整个 runDir。以下内容默认排除：

- 临时文件、依赖目录、缓存、隐藏文件。
- 超出大小限制的文件。
- symlink、socket、device 等非普通文件。
- manifest 未允许的可执行文件和未知二进制。

归档事务顺序：

```text
close background processes
  -> freeze output manifest
  -> validate files
  -> copy to artifact storage + hash
  -> create artifact metadata
  -> emit/persist AG-UI artifact CUSTOM event
  -> destroy workspace
```

`ArtifactService` 需要扩展 `createFileArtifact()`，至少记录 `storage_path`、`mime_type`、`size_bytes`、`sha256`、
`source_relative_path`。北向事件暂时继续携带 `preview_json`；引用化协议按已有 artifact 设计待办单独迁移。

### 5.5 WorkspaceLifecycleCoordinator

API runtime 负责终态编排，不能在已经向客户端发送 `RUN_FINISHED` 后才异步归档：

```text
Mastra generation complete
  -> archive workspace
  -> archive succeeded: emit artifact events
  -> update run status
  -> emit RUN_FINISHED
  -> destroy workspace
```

失败处理：

- Agent 执行失败：终止进程，尝试归档已登记产物，记录失败原因，发送 `RUN_ERROR`。
- 归档失败：run 不得标记成功；发送 `RUN_ERROR` 或明确的部分失败状态。
- 客户端取消：abort command，清理 workspace，run 标记 cancelled；需要先补 metadata status 枚举。
- 进程崩溃：启动时 janitor 清理过期目录，并根据 run metadata 判断是否允许恢复。

## 6. 工具分层

| 层 | 工具 | 来源 | 首期状态 |
|---|---|---|---|
| 数据安全通道 | `inspect_schema`、`run_sql_readonly` | 自研 / Data Gateway | 保持 |
| Workspace 文件 | `read_file`、`write_file`、`edit_file`、`list_files`、`grep/search` | Mastra Workspace | Phase 1A |
| Workspace 执行 | `execute_command` | Mastra Workspace / LocalSandbox | Phase 1B，fail-closed |
| 产物 | `register_output`、`export_query_result` | 自研 | Phase 1C |
| 协作 | `task_write/update/complete/check` | `@mastra/core/harness` | Phase 2A |
| 交互 | `ask_user`、`submit_plan` | `@mastra/core/harness` | Phase 2B |
| 目标 | native goal configuration/objective | Mastra experimental Agent capability | Phase 2C，封装接入 |
| 数据源发现 | `list_data_sources`、`preview_table` | 自研 / Data Gateway | Phase 3 |

Mastra Workspace 工具默认使用 `mastra_workspace_*` 名称。Phase 1 如果暴露 `read_file` 等短名称，必须通过
`WorkspaceToolsConfig` 的公开 `name` 配置显式重映射，并使用 `WORKSPACE_TOOLS` 常量作为配置 key，不能依赖内部字符串。

Mastra goal 能力仍标记为 experimental，因此必须封装在 `GoalRuntimeAdapter` 后面。业务层不能直接持久化 Mastra
内部对象；只保存自己的 objective/status/evaluation DTO 和对应 AG-UI 事件，未来可替换实现。

## 7. Datasource 授权模型

Phase 1 继续只允许 `selected_datasource_id`。Tool arguments 即使传入其他 datasource，也必须被拒绝。

Phase 2 如果支持多 datasource，先扩展可信运行上下文：

```typescript
type DatasourceSelection = {
  activeDatasourceId: string;
  allowedDatasourceIds: readonly string[];
};
```

- allowlist 由服务端授权层生成，不由模型提供。
- `list_data_sources` 只能返回 allowlist 内的数据源。
- inspect/SQL/export 都在 Data Gateway 再校验 user + allowlist。
- SQL 次数限制默认是 per-run global budget；per-datasource 指标用于审计，不得借此把总上限乘以数据源数量。

现有 tool state 本来就是 per-agent/per-run 闭包，并不存在跨 run 共享竞态。重构 state 的目的应写成“支持明确的多数据源状态和并发指标”，而不是修复不存在的共享状态问题。

## 8. Builtin 协作能力与 AG-UI 边界

### 8.1 task_*：唯一计划事实来源

接入 `taskWriteTool`、`taskUpdateTool`、`taskCompleteTool`、`taskCheckTool` 和 `TaskStateProcessor`。Task 使用稳定 ID，
不再使用固定数组 index。内部事实来源是 Mastra task state，北向投影仍使用 AG-UI PLAN activity：

前置条件：建立应用级 Mastra runtime，注册 memory-backed Agent，接入 `MastraMemory` 和 thread-state storage，并在每次
run 使用可信的 `resourceId=user_id`、`threadId=session_id`。`TaskStateProcessor` 负责把 task list 带入后续 step/run。
应用侧 `run_events` 只保存已经发出的 AG-UI 协议事件用于回放，不再维护另一份可写 task state。

Task 接入阶段只启用 storage-backed thread state：Memory 设置 `readOnly: true`、`lastMessages: false`，并关闭
semantic recall、working memory、observational memory 和自动标题。这样 task/goal 可以持久化，但不会把历史消息自动
加入 prompt。正式启用对话 Memory 前，必须先解决 CopilotKit 完整历史与 Mastra history 的所有权和 message ID 去重；
禁止两条历史来源同时无条件注入。

```text
task_* tool result
  -> TaskStateProcessor / task snapshot
  -> TaskActivityProjector
  -> AG-UI ACTIVITY_SNAPSHOT / ACTIVITY_DELTA (activityType = PLAN)
  -> RunEventWriter
  -> GUI / TUI and replay
```

`TaskActivityProjector` 是协议 adapter，不是第二份 task state。它必须是纯函数：同一个 task snapshot 永远产生相同
AG-UI snapshot/patch。状态映射：

| Mastra task status | AG-UI PLAN status |
|---|---|
| `pending` | `pending` |
| `in_progress` | `running` |
| `completed` | `completed` |

Mastra task schema 没有 `failed/skipped`。这些是 run terminal projection：run error 时当前任务投影为 `failed`、其余未开始任务
投影为 `skipped`；正常完成时如果仍有 incomplete task，先执行 `task_check`，不能由服务端默默改写 Mastra task state。

### 8.2 旧 PLAN 删除条件

以下条件全部满足后，一次性删除旧实现，不长期双写：

1. task state 可在同一 session 的多 run 中恢复，并按 user/session 隔离。
2. task tool call/result、AG-UI PLAN 事件和持久化 replay 一致。
3. 正常、失败、取消和恢复路径都有确定终态。
4. GUI/TUI 使用动态 task ID/顺序通过验收。
5. context adapter 覆盖四个 task 工具的结果。
6. run identity/idempotency smoke 验证重放不会重复执行 task tool。

删除范围包括：

- `apps/api/src/plan-state.ts`。
- `createInitialPlanTaskState`、`observePlanActivityEvent` 和固定三任务 terminal patch。
- `createPlanActivityEvent` 中固定的“检查 schema / 执行 SQL / 最终回答”任务。
- `data-tools.ts` 中所有硬编码 `/tasks/{index}/status` delta。

### 8.3 ask_user / submit_plan：挂起与恢复

两个工具使用 Mastra native `tool-call-suspended` 和 `resumeStream()`。API 需要增加 `InteractionRuntimeAdapter`：

- 把 suspend payload 投影为 AG-UI `CUSTOM interaction.requested`，事件本身仍是标准 AG-UI event type。
- metadata run status 增加 `suspended`、`cancelled`。
- 持久化 interaction ID、toolCallId、类型、payload、状态和 resume fingerprint。
- resume 必须校验 user/session/run/toolCallId，并且同一答案幂等。
- suspended 时不发送 `RUN_FINISHED`；恢复后继续同一个逻辑 run 和 event seq。
- `ask_user` 支持 free text、single select、multi select。
- `submit_plan` 支持 approved/rejected + feedback；拒绝后允许模型修订并再次提交。

### 8.4 goal：封装 experimental capability

当前 Mastra goal 不是 builtin tool。通过 `GoalRuntimeAdapter` 使用 `AgentConfig.goal` 和 objective API：

- 服务端从可信请求创建 objective，不允许模型任意修改资源预算。
- judge 默认复用配置的模型 provider，但使用独立 maxRuns/token/cost budget。
- `goal.maxRuns` 与 Agent max steps 共同受全局 run budget 约束。
- goal evaluation 投影为 AG-UI `CUSTOM goal.updated` 并原样持久化。
- task 描述“怎么做”，goal 判断“是否达成”，二者不互相替代。
- 因为 API experimental，Mastra 类型和状态只存在于 adapter 内，外部使用自有 DTO。

## 9. 分阶段交付

### Phase 1A：Run-bound Workspace 文件能力

- 实现 `RunWorkspaceFactory`，静态绑定到 per-run Agent。
- 接入 read/write/edit/list/grep 文件工具，暂不启用命令。
- 实现 path segment 校验、容量限制和清理。
- 实现 `ToolObservationRouter`，并为每个首期 Workspace 工具注册独立 `ToolResultAdapter`。
- 验证不同 user/session/run 工作区相互隔离。

验收：Agent 只能在自己的 runDir 读写；大型文件结果不会直接撑爆 prompt；当前 SQL 和 AG-UI 链路无回归。

### Phase 1B：本地命令执行安全

- 检测 seatbelt/bwrap。
- 仅在 isolation 可用且通过 smoke 时暴露 `execute_command`。
- 配置 env allowlist、超时、输出、进程、网络和 abort 策略。
- 验证路径逃逸、网络外联、fork/background 和超时场景。

验收：隔离不可用时模型看不到执行工具；隔离可用时命令只能影响 runDir，run 取消会终止子进程。

### Phase 1C：文件 Artifact 归档

- 扩展 ArtifactService 文件存储契约。
- 实现 manifest/register_output 和 `outputs/` allowlist 归档。
- 在 `RUN_FINISHED` 前完成归档和事件持久化。
- 实现成功、失败、取消和进程崩溃后的 workspace janitor。

验收：artifact 文件、metadata、事件三者一致；回放时不依赖已经删除的 workspace。

### Phase 2A：Builtin task 与旧 PLAN 替换

- [x] 从 `@mastra/core/harness` 接入四个 task tool。
- [x] 接入独立的应用级 Mastra Memory/LibSQL thread-state storage。
- [x] 实现四个独立 task `ToolResultAdapter`。
- [x] 实现 `TaskPlanProjector` 和动态 PLAN snapshot。
- [x] 按 thread/session 隔离、持久化，并依赖 AG-UI event store 回放 PLAN。
- [x] 删除旧三任务 PLAN、固定 index 和 terminal patch。

当前 `@mastra/core` 的 `harness/tools.d.ts` 声明导出 `TaskStateProcessor`，但 `@mastra/core/harness` 的运行时
export 中不存在该符号。现阶段使用 `TaskStateContextProcessor` 从同一原生 threadState store 读取并在每个 step
注入快照；task mutation 和持久化仍由 Mastra builtin tool 完成。升级 Mastra 后应优先复核并替换为公开的
`TaskStateProcessor`。

验收：Mastra task state 是唯一计划事实来源；实时与 replay 的 AG-UI PLAN 完全一致；仓库中不存在固定 task index。

### Phase 2B：ask_user / submit_plan 挂起恢复

- [x] 接入两个 builtin tool 及各自 `ToolResultAdapter`。
- [x] 实现 `InteractionRuntimeAdapter`、suspended/cancelled run 状态和同一 CopilotKit endpoint resume。
- [x] 完成 interaction requested/resolved AG-UI 事件、幂等和回放。
- [x] smoke 覆盖重复 resume、不同答案拒绝、cancel 和 plan approval；GUI/TUI 联调待前端执行。

验收：GUI/TUI 可用同一协议回答问题和审批计划；挂起期间不会误发 terminal event。

### Phase 2C：Native goal

- [x] 实现 `GoalRuntimeAdapter` 和稳定业务 DTO。
- [ ] 配置 judge model、maxRuns、独立 token/cost budget（当前已有 model + maxRuns）。
- [x] 通过 Mastra thread state 持久化 objective/evaluation，并在启动和终态投影 `goal.updated`。
- [ ] 验证 task 完成但 goal 未达成、goal 达成提前结束、judge 失败和预算耗尽。

验收：goal 可以驱动 Agent 继续执行，但 experimental Mastra 类型不泄漏到 contracts、metadata 和北向协议。

### Phase 3：数据通道补全与多 datasource

- 增加 datasource allowlist 和 active datasource。
- 补 `list_data_sources`、`preview_table`、`export_query_result`。
- 为 Data Gateway 补二次授权和导出限制。
- 验证多 datasource 并发时的总 SQL budget、审计和 artifact 归属。

### Phase 4：长期上下文和生产 sandbox

- 接入 Mastra memory、session summary 和长期 context reduction strategy。
- 评估并接入 e2b/modal/daytona 等远程 sandbox。
- 处理 quota、成本、冷启动、并发池和租户隔离。
- 执行 artifact 北向引用化迁移。

## 10. 非功能要求

### 安全

- 默认拒绝未隔离命令执行。
- Workspace 根目录之外零写权限。
- 不向 Workspace 注入 LLM key、数据库凭据和服务端环境变量。
- 所有 datasource 和 artifact 操作按 `user_id` 隔离。

### 可靠性

- workspace archive/cleanup 必须幂等。
- 同一 `run_id + request_fingerprint` 重放不能重复执行命令或重复创建 artifact。
- terminal event 必须在必要归档完成后发送。
- janitor 不得删除仍处于 running 或可恢复状态的工作区。

### 可观测性

至少记录：

- workspace 创建、初始化、归档、销毁耗时。
- isolation backend 与 command capability。
- 文件数、总字节数、命令次数、超时和拒绝原因。
- context observation 原始 token、保留 token、截断/降级决策。
- artifact copy/hash/metadata/event 各阶段状态。

## 11. 测试矩阵

| 类别 | 必测场景 |
|---|---|
| 身份隔离 | 不同 user/session/run 不能互访路径 |
| 路径安全 | `..`、绝对路径、symlink、编码路径逃逸被拒绝 |
| Sandbox | isolation 缺失 fail-closed；seatbelt/bwrap 冒烟通过 |
| 命令 | timeout、超量输出、后台进程、网络访问、abort |
| Context | 每个工具命中自己的 adapter；read/grep/command 大结果缩减；未知工具 fail-safe |
| Artifact | manifest allowlist、hash、复制失败、重复归档、回放 |
| 生命周期 | finished/error/cancel/disconnect/crash/janitor |
| Task | 动态 task、跨 run 恢复、terminal projection、旧 PLAN 删除、replay |
| Interaction | ask/approve/reject/resume、重复答案、断线重连、挂起不终结 |
| Goal | 达成/未达成、judge 失败、maxRuns、token/cost budget |
| 回归 | SQL readonly、context compile、run identity、AG-UI replay 全部通过 |

## 12. 关键决策记录

### ADR-A：使用 per-run 静态 Workspace

- **决定**：在 `createDataAgent` 内创建并静态绑定 Workspace。
- **原因**：Agent 已经 per-run；身份可信、生命周期清晰、无需重复 resolver。
- **代价**：未来改为长生命周期 Agent 时需重新引入 resolver/cache key。

### ADR-B：本地命令执行 fail-closed

- **决定**：无 seatbelt/bwrap 时不暴露 `execute_command`。
- **原因**：`LocalSandbox` 的默认 none 模式不能作为不可信模型代码的安全边界。
- **代价**：部分开发环境只能使用文件工具，直到安装或启用隔离后端。

### ADR-C：Mastra task 是计划事实来源，AG-UI PLAN 是协议投影

- **决定**：接入 builtin task，并在覆盖验收后删除旧三任务 PLAN 实现。
- **原因**：稳定 task ID 和 task state 能覆盖动态计划；AG-UI projector 保持 GUI/TUI 与回放协议统一。
- **代价**：需要先接入 Mastra memory/thread-state storage，再实现 terminal projection 和确定性 AG-UI 映射。

### ADR-D：Step 统一拦截，一工具一个 Context Adapter

- **决定**：在 `processInputStep()` 提取 observation，再按 toolName 路由给独立 `ToolResultAdapter`。
- **原因**：覆盖自动注入工具，同时保留每个工具独立 schema、语义和压缩策略。
- **代价**：每个新工具必须同步实现 adapter 和测试；未知工具仅走 fail-safe fallback。

### ADR-E：Artifact 采用显式输出清单

- **决定**：只归档 manifest 或 `outputs/` allowlist 文件。
- **原因**：扫描整个工作区会误收临时文件、依赖和敏感内容。
- **代价**：工具和 prompt 必须明确要求 Agent 登记最终产物。

### ADR-F：ask_user / submit_plan 使用同一逻辑 run 挂起恢复

- **决定**：suspend 不结束 run；resume 继续同一 run ID 和 event sequence。
- **原因**：保持任务、goal、context 和审计连续，避免把一次交互拆成伪造的新 run。
- **代价**：metadata 和 API 必须支持 suspended/cancelled 状态、resume 幂等和断线恢复。

### ADR-G：Goal 使用可替换 Runtime Adapter

- **决定**：接入 Mastra native goal，但只在 `GoalRuntimeAdapter` 内使用 experimental API。
- **原因**：获得原生循环完成度判断，同时保护 contracts、metadata 和北向协议不依赖实验类型。
- **代价**：需要维护稳定 DTO、judge 预算和未来 Mastra 升级兼容测试。

## 13. 待确认决策

以下事项不阻塞 Phase 1A，但需要在对应阶段开工前确认：

1. **开发环境无 isolation 时是否允许显式开启宿主执行**
   推荐：默认和 CI 永远禁用；只允许开发者在本机通过 `WORKSPACE_ALLOW_UNSANDBOXED_EXECUTION=true` 临时开启，
   并在 run event/audit 中记录高风险标记。

2. **失败 run 的工作区保留策略**
   推荐：成功 run 归档后立即清理；失败/取消 run 默认保留 24 小时用于调试，然后由 janitor 删除。
   生产环境可以配置为失败也立即清理。

3. **Mastra thread-state storage 的物理存储**
   推荐：先使用官方 storage provider 和独立的应用级数据库文件，不与每个 run 建库；通过 resource/thread ID 与现有
   metadata 建立逻辑关联。不要让两套 SQLite driver 同时管理同一个数据库文件。若必须单库，再单独设计并实现
   Mastra storage adapter，而不是直接共用文件。
