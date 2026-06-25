# Agent Skill System Design

日期：2026-06-25

## 背景

当前项目已经有初步的 skill 配置雏形：

- `run_config.activeSkillId`
- `run_config.enabledSkillIds`
- `ConfigResource(kind="skill")`
- `upload-parser.ts` 可解析 `SKILL.md` / zip，提取 `name`、`description`、`version`、`allowed-tools`

但当前 skill 仍主要表现为一段 `skillPolicy.instructions`，由 agent runtime 拼进主指令。这种方式有三个问题：

1. skill 没有走 Mastra 原生 `skill / skill_search / skill_read` 机制。
2. skill 内容绕过了统一 tool-call context governance。
3. 当 skill 数量增多时，缺少显式筛选、授权、审计和预算边界。

本设计目标是把 skill 系统做成 agent 的一等能力，同时保持架构干净：skill 负责“如何做”的任务知识，tool 负责“实际做”的可执行能力。

## 目标

1. 支持上传、注册、启停、筛选、运行期加载 skill。
2. 优先使用 Mastra 原生 workspace skill 机制。
3. skill tool call 必须走统一 ToolObservationAdapter 和 ContextPackage。
4. skill 可见性由 run config 和后端策略共同决定。
5. skill 不直接放权；`allowed-tools` 只参与运行期工具集合收敛。
6. 支持后续扩展到 workspace skill、用户 skill、内置 skill、团队 skill。

## 非目标

- 不把 skill 设计成新的可执行工具系统。
- 不重写 Mastra 的 `skill`、`skill_search`、`skill_read`。
- 第一阶段不做 embedding semantic skill recall。
- 第一阶段不由 skill 系统直接执行脚本。脚本可通过 `skill_read` 读取，并在策略允许时通过受控 workspace/sandbox tools 执行。

## Mastra 能力判断

Mastra skill 是符合 Agent Skills specification 的任务说明包：

```text
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
```

当 `Workspace` 配置 `skills` 后，Mastra 会自动暴露：

- `skill`：加载完整 skill instructions。
- `skill_search`：搜索 skill 内容。
- `skill_read`：读取 references/scripts/assets。

当前项目应升级到已公开 `@mastra/core/skills` export 的 Mastra 版本，建议以 `@mastra/core@1.46.x` 为最低目标版本。升级后再接入，避免依赖当前 1.43.x bundle 内部实现。

## 核心决策

### ADR-1：skill 是指令包，不是工具

skill 不进入 `ToolName` 业务工具枚举，不替代 `createTool`。

原因：

- tool 有输入输出 schema、执行副作用、审计结果。
- skill 是任务流程、约束、参考资料和操作手册。
- 混在一起会导致授权边界不清晰。

### ADR-2：默认采用 auto skill selection

默认 `skill_mode` 采用 `auto`，前端显式选择 skill 时切换为 `selected`。

原因：

- 用户不应每次都手工选择 skill。
- skill 是 agent 能力系统的一部分，应能根据任务、tag、文件、数据源做轻量自动匹配。
- `auto` 仍然受 `max_skills`、status、user/workspace ownership、tool policy 约束，不等于全库开放。

### ADR-3：本次 run 只挂载筛选后的 skill

Mastra workspace 的 `skills` 只接收本次 run 可见的 skill 路径，而不是全库 skill。

原因：

- `skill_search` 的搜索范围天然受 workspace skills 限制。
- 避免模型绕过后端筛选，在全库里搜到未授权 skill。
- 审计中可以明确说明本次 run 为什么看到这些 skill。

### ADR-4：workspace default enabled skills 进入 auto 候选集合

`default_enabled=true` 的 workspace skill 默认进入 `auto` 模式候选集合。

原因：

- workspace 管理者需要一种低摩擦方式声明“这些 skill 是本工作区常用能力”。
- 候选不等于最终启用，仍需经过 query/tag/task/file affinity 和 `max_skills` 截断。
- run resource revisions 会记录最终 selected skills，保证回放和审计稳定。

### ADR-5：多个 skill 的 allowed-tools 默认取并集

多个 selected skill 都声明 `allowed-tools` 时，默认先取并集，再和系统、数据源、MCP、run policy 做交集。

原因：

- 多 skill 协作时，每个 skill 可能覆盖任务的一部分，交集容易过度收窄导致可用工具缺失。
- 放权边界仍由系统策略和 run policy 控制，skill 的并集不会突破全局允许集合。
- 高安全任务可以通过 `strict_skill_tools=true` 切换为交集策略。

### ADR-6：skill tool result 必须进入 ContextPackage

`skill`、`skill_search`、`skill_read` 的结果和其他 tool observation 一样处理。

原因：

- skill instructions 可能很长，必须受 token budget 管理。
- skill_read 可能读取大量 reference/script 内容，不能直接无限进入模型上下文。
- 所有模型可见上下文都应可审计、可回放、可压缩。

### ADR-7：FileAsset 是 skill package 的物理权威来源

上传的 `SKILL.md` / zip 进入 FileAsset 去重存储，skill registry 只保存引用和解析后的 metadata。

原因：

- 同一份 skill 包不重复存储。
- 便于版本化、下载、发布、回滚。
- 和 file / artifact / knowledge 的资产设计保持一致。

### ADR-8：builtin skill 后置

第一阶段不实现 builtin skill。

原因：

- 当前优先验证 workspace/user uploaded skill 的注册、筛选、Mastra runtime 接入和 context governance。
- builtin skill 涉及发布、版本、系统预置、升级策略，适合在最小闭环稳定后再补。

### ADR-9：skill scripts 允许执行，但必须走受控工具链

`scripts/` 不再定义为完全只读。允许执行，但执行必须满足以下条件：

- 模型必须先通过 `skill_read` 读取脚本或说明。
- 实际执行必须调用现有受控 workspace/sandbox tool，例如 `execute_command`。
- 是否可执行由最终 effective tool policy 决定，skill 自身不能放权。
- 如全局策略要求 human approval，则必须通过 `ask_user` / tool approval 后执行。
- 执行结果按普通 workspace tool observation 进入 ContextPackage 和审计。

原因：

- 许多 skill 的价值来自配套脚本，例如渲染、校验、转换、批处理。
- 不新增一套 skill script runtime，可以复用已有 workspace/sandbox、隔离、审批、审计能力。
- skill 只提供脚本和使用说明，执行仍由受控工具完成。

## 运行配置

### Run Config

新增或扩展 `run_config`：

```json
{
  "skill_mode": "auto",
  "skill_ids": ["skill_sql_analysis"],
  "skill_tags": ["data-analysis"],
  "skill_policy": {
    "max_skills": 5,
    "allowed_tool_names": ["inspect_schema", "run_sql_readonly", "publish_artifact"],
    "deny_tool_names": ["execute_command"],
    "require_user_invocable": true
  }
}
```

兼容现有字段：

```json
{
  "activeSkillId": "skill_sql_analysis",
  "enabledSkillIds": ["skill_sql_analysis", "skill_report"]
}
```

兼容策略：

- `activeSkillId` 映射为 `skill_ids[0]`，并可作为 UI 当前选择。
- `enabledSkillIds` 映射为候选 skill 集合。
- 新字段使用 snake_case / camelCase 双别名解析。

### Skill Mode

| 模式 | 含义 | 推荐场景 |
| --- | --- | --- |
| `none` | 本次 run 不启用 skill | 调试、极简任务 |
| `selected` | 只启用 `skill_ids` 指定 skill | 前端明确选择 |
| `auto` | 在候选集合中按规则筛选 | 默认生产模式 |
| `all` | 启用当前用户/工作区所有 enabled skill | 开发调试，不建议生产默认 |

默认值：

```json
{
  "skill_mode": "auto",
  "skill_policy": {
    "max_skills": 5,
    "require_user_invocable": true
  }
}
```

`auto` 的候选集合包含：

- `status="enabled"` 且当前 user/workspace 可访问的 skill。
- workspace `default_enabled=true` 的 skill。
- run_config 显式传入的 `skill_ids`。
- run_config `skill_tags` 命中的 skill。

注意：`default_enabled=true` 只表示进入 auto 候选集合，不代表无条件 selected。最终仍需要
query/tag/task/file affinity 命中；否则不相关 skill 的 `allowed-tools` 可能错误收窄普通任务工具集。

## 数据模型

### SkillRecord

逻辑上新增 `SkillRecord`，第一阶段可继续落在 `ConfigResource(kind="skill")`，但 payload 应规范化。

```ts
type SkillRecord = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  description: string;
  version: string;
  status: "draft" | "enabled" | "disabled" | "archived";
  scope: "builtin" | "workspace" | "user";
  tags: string[];
  user_invocable: boolean;
  allowed_tools: string[];
  denied_tools: string[];
  package_file_ref_id: string;
  package_format: "skill-md" | "zip";
  package_entry: string;
  package_files: string[];
  created_at: string;
  updated_at: string;
};
```

`ConfigResource.payload` 建议结构：

```json
{
  "name": "sql-analysis",
  "description": "Use for read-only SQL data analysis.",
  "version": "1.0.0",
  "scope": "workspace",
  "tags": ["data-analysis", "sql"],
  "userInvocable": true,
  "allowedTools": ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"],
  "deniedTools": ["execute_command"],
  "packageFileRefId": "file_ref_xxx",
  "packageFormat": "zip",
  "packageEntry": "sql-analysis/SKILL.md",
  "packageFiles": ["sql-analysis/SKILL.md", "sql-analysis/references/sql-policy.md"]
}
```

## REST API 设计

### 注册 skill

```http
POST /api/v1/skills
Content-Type: multipart/form-data
```

表单：

- `file`: `SKILL.md` 或 zip
- `scope`: `workspace | user`，默认 `workspace`
- `default_enabled`: boolean，默认 false
- `tags`: JSON array 或逗号分隔字符串

响应：

```json
{
  "data": {
    "id": "skill_sql_analysis",
    "name": "sql-analysis",
    "description": "Use for read-only SQL data analysis.",
    "version": "1.0.0",
    "status": "enabled",
    "allowed_tools": ["inspect_schema", "run_sql_readonly"],
    "package_file_ref_id": "file_ref_123"
  }
}
```

### 列表

```http
GET /api/v1/skills?status=enabled&tag=data-analysis
```

响应：

```json
{
  "data": {
    "skills": [
      {
        "id": "skill_sql_analysis",
        "name": "sql-analysis",
        "description": "Use for read-only SQL data analysis.",
        "version": "1.0.0",
        "status": "enabled",
        "tags": ["data-analysis", "sql"],
        "default_enabled": true
      }
    ]
  }
}
```

### 详情

```http
GET /api/v1/skills/:id
```

响应包含 metadata，不默认返回完整 package 内容。

### 启停 / 更新

```http
PATCH /api/v1/skills/:id
Content-Type: application/json
```

请求：

```json
{
  "status": "enabled",
  "default_enabled": true,
  "tags": ["data-analysis"],
  "user_invocable": true
}
```

### 下载 package

```http
GET /api/v1/skills/:id/download
```

返回原始 `SKILL.md` 或 zip package。

### Run 前预览筛选结果

```http
POST /api/v1/skills/select
Content-Type: application/json
```

请求：

```json
{
  "user_input": "分析 orders 表并生成报告",
  "run_config": {
    "skill_mode": "auto",
    "skill_tags": ["data-analysis"],
    "skill_policy": {
      "max_skills": 5
    }
  }
}
```

响应：

```json
{
  "data": {
    "skills": [
      {
        "id": "skill_sql_analysis",
        "name": "sql-analysis",
        "score": 12.5,
        "reasons": ["tag:data-analysis", "description:sql", "description:analysis"]
      }
    ],
    "effective_policy": {
      "mode": "auto",
      "max_skills": 5
    }
  }
}
```

## Skill 筛选

### 输入

```ts
type SkillSelectionInput = {
  userInput: string;
  runConfig: EffectiveRunConfig;
  workspaceId: string;
  userId: string;
  datasourceIds: string[];
  fileIds: string[];
  chatMode: string;
};
```

### 输出

```ts
type SkillSelectionResult = {
  selectedSkills: SkillRecord[];
  effectiveToolPolicy: {
    allowedTools?: string[];
    deniedTools: string[];
  };
  audit: Array<{
    skillId: string;
    decision: "selected" | "rejected";
    reasons: string[];
    score?: number;
  }>;
};
```

### 规则

1. 读取当前用户 / workspace 下 `status="enabled"` 的 skill。
2. `none`：返回空集合。
3. `selected`：只允许 `skill_ids`，不存在或 disabled 时报错。
4. `all`：返回 enabled 集合，受 `max_skills` 限制。
5. `auto`：
   - 如果有 `skill_ids`，作为强候选。
   - 如果有 `skill_tags`，按 tag 过滤或加权。
   - 使用 query 关键词匹配 `name/description/tags`。
   - 根据 `chat_mode`、datasource/file 类型做确定性加权。
   - 截断到 `max_skills`。

第一阶段评分示例：

```text
+10 exact tag
+8 name token match
+5 description token match
+3 file extension affinity
+3 chat_mode affinity
-infinity disabled / not user_invocable / policy denied
```

后续可替换为 BM25 或 Mastra workspace search，但输出结构不变。

## Tool Policy 收敛

skill 的 `allowed-tools` 不是放权，而是收敛工具集合。

```text
effectiveAllowedTools =
  systemAllowedTools
  ∩ runConfigAllowedTools
  ∩ datasourcePolicyAllowedTools
  ∩ selectedSkillAllowedTools
  ∩ mcpPolicyAllowedTools
  - deniedTools
```

如果多个 selected skill 都声明 `allowed-tools`：

- 默认取并集后再与系统策略取交集。
- 如果 run_config 声明 `strict_skill_tools=true`，则取交集，适合高安全任务。

如果 skill 没有声明 `allowed-tools`：

- 不额外增加 allowed tools。
- 不收窄已有工具，除非 `strict_skill_tools=true`。

## Runtime 接入

### 目标链路

```text
AG-UI RunAgentInput
  -> extractEffectiveRunConfig
  -> resolveRunConfig
  -> selectSkills
  -> materialize selected skill packages to run workspace
  -> Mastra Workspace(skills = selected skill dirs)
  -> Mastra Agent exposes skill / skill_search / skill_read
  -> model calls skill tools
  -> ToolObservationAdapter packages skill observations
  -> ContextPackage / budget / audit / replay
```

### Workspace 物化

skill package 来源是 FileAssetRef。

每次 run：

```text
workspace/
  input/
  output/
  skills/
    sql-analysis/
      SKILL.md
      references/
```

`Workspace.skills` 只配置：

```ts
skills: ["skills/sql-analysis", "skills/reporting"]
```

或者配置到统一 `skills` 目录，由 Mastra 扫描。

### Mastra Agent 装配

升级后建议使用：

```ts
new Workspace({
  filesystem,
  sandbox,
  skills: selectedSkillPaths,
  bm25: true
});
```

第一阶段不启用 vector skill search。

## Context Governance 接入

新增 skill tool observation adapters：

| Mastra tool | Context source type | 说明 |
| --- | --- | --- |
| `skill` | `skill-activation` | 完整 skill instructions |
| `skill_search` | `skill-search` | 搜索结果 |
| `skill_read` | `skill-read` | reference/script/asset 内容 |

包装规则：

- `skill` 结果：高优先级，但需要摘要和字符/token 上限。
- `skill_search` 结果：中优先级，保留 names/reasons/snippets。
- `skill_read` 结果：按文件类型治理，大文本可截断，二进制资产只返回引用。

ContextPackage metadata：

```ts
{
  sourceKind: "tool-observation",
  sourceOwner: "skill",
  trust: "tool",
  refs: {
    skillIds: ["skill_sql_analysis"],
    fileRefs: ["file_ref_123"]
  }
}
```

## 事件和审计

新增或复用 AG-UI custom event：

```text
skill.selection
skill.workspace.materialized
tool.call.started(skill)
tool.call.completed(skill)
context.package.updated
```

`skill.selection` payload：

```json
{
  "mode": "auto",
  "selected": [
    {
      "id": "skill_sql_analysis",
      "name": "sql-analysis",
      "reasons": ["tag:data-analysis", "query:orders"]
    }
  ],
  "rejected": [
    {
      "id": "skill_shell_ops",
      "name": "shell-ops",
      "reasons": ["policy:execute_command_denied"]
    }
  ]
}
```

持久化要求：

- run events 记录筛选结果。
- run resource revisions 记录 selected skill revision。
- tool call result 走现有 context package 审计。

## Prompt 约束

系统基础 prompt 只描述 skill 使用方式，不注入全部 skill instructions：

```text
When a task matches an available skill, use skill_search or skill to load the relevant instructions.
Skills are guidance packages, not executable tools. To perform actions, use the approved tools.
Do not use skills outside the available skill list for this run.
```

如果本次没有 selected skills，不提 skill。

## 安全策略

1. zip 解压必须继续使用安全路径校验。
2. 禁止 symlink、绝对路径、`..`、过大文件、过多 entry。
3. `scripts/` 可以被执行，但只能通过受控 workspace/sandbox tools 执行，不能由 skill 系统自动执行。
4. skill package 默认不进入模型上下文，只有 tool call 后才进入。
5. skill selection 不能扩大工具权限。
6. `skill_search` 不能搜索未授权 skill。
7. skill package 下载需校验 user/workspace ownership。

## 与 Memory / Knowledge 的边界

| 模块 | 作用 |
| --- | --- |
| Skill | 任务方法、流程、操作手册 |
| Memory | 用户/会话偏好、历史事实、长期记忆 |
| Knowledge | 外部业务知识、文档检索、数据语义 |
| Tool | 可执行动作 |

skill 可以引用 knowledge 工具，但 skill 本身不变成 knowledge。
skill instructions 被加载后作为 tool observation 进入 context，不进入 long-term memory，除非未来显式做“skill usage learning”。

## 模块规划

### packages/skills

职责：

- skill package 解析和校验。
- skill metadata schema。
- skill registry service。
- skill selection service。
- skill package materializer。

建议导出：

```ts
SkillRegistryService
SkillSelectionService
SkillPackageParser
SkillPackageMaterializer
SkillToolPolicyResolver
```

### packages/metadata

第一阶段继续复用 `config_resources(kind="skill")`。

必要增强：

- payload schema 规范化。
- revision 纳入 run resource revisions。
- 未来可拆 `skills` 专表，但当前不强制。

### packages/agent-runtime

职责：

- 接收 selected skill paths。
- 创建包含 skill paths 的 Mastra Workspace。
- 注册 skill tool observation adapters。
- 在 static tool names 中加入 Mastra skill tools，仅用于 capability/审计展示。

### apps/api

职责：

- REST skill API。
- run_config skill 字段解析。
- run 前 skill selection。
- workspace/run skill materialization。

## 分阶段实现

## 当前实现状态（2026-06-25）

已实现后端 / agent 最小闭环，不包含前端 UI：

- 已升级 `@mastra/core` 到 `^1.46.0`，使用公开 `@mastra/core/skills` / workspace skill 能力。
- 新增 `packages/skills`：
  - `parseSkillPackage`
  - `buildSkillResourcePayload`
  - `selectSkillsForRun`
  - `materializeSkillPackages`
- `POST /api/v1/skills` 上传的 `SKILL.md` / zip 会进入 FileAssetRef；Skill metadata 只保存
  `packageFileRefId`、manifest、tags、allowed/denied tools 等。
- `POST /api/v1/skills/select` 可预览本次 run 的 auto/selected 筛选结果。
- `run_config` 支持 `skill_mode` / `skill_ids` / `skill_tags` / `skill_policy`，并兼容
  `activeSkillId` / `enabledSkillIds`。
- run 开始时只把 selected skills 物化到 isolated workspace `skills/` 目录，并传给 Mastra
  `Workspace.skills`。
- `skill` / `skill_search` / `skill_read` 已注册 ToolObservationAdapter，结果进入 ContextPackage。
- `skill.selection` custom event 会记录 selected skills、audit reasons、effective tool policy。
- `allowed-tools` 默认按并集收敛，再受系统/run/MCP 策略约束；builtin skill 第一阶段被选择器拒绝。
- `allowed-tools` 收敛 action tools；`skill` / `skill_search` / `skill_read` 作为 skill meta tools
  默认保留，除非被 `deniedTools` 明确禁止。

验证：

- `npm run build`
- `npm run smoke:skills`
- `npm run smoke:config-api`

### Phase 1：版本升级与最小原生接入

- 升级 `@mastra/core` 到支持 `@mastra/core/skills` 的版本。
- 新建 `packages/skills`。
- 把现有 `parseSkillUpload` 迁移或包裹到 `packages/skills`。
- 支持 skill 注册/list/detail/download。
- run 时根据 `enabledSkillIds/activeSkillId` 物化 selected skill 到 workspace。
- Mastra Workspace 配置 `skills`。
- 验证模型可调用 `skill`、`skill_search`、`skill_read`。

验收：

- 上传 `SKILL.md` 后，run_config 指定 skill，模型可以通过 `skill` 加载。
- 未指定 skill 时不可见。
- `skill_search` 搜索不到未授权 skill。

### Phase 2：筛选与工具策略

- 实现 `skill_mode` / `skill_ids` / `skill_tags` / `skill_policy`。
- 实现确定性 auto selector。
- `allowed-tools` 纳入 effective tool policy。
- 持久化 `skill.selection` audit event。

验收：

- selected 模式严格只启用指定 skill。
- auto 模式可按 query/tag 选中合理 skill。
- denied tool 不会出现在最终可用工具集合。
- 多 skill 的 `allowed-tools` 默认按并集收敛。
- workspace default enabled skills 会进入 auto 候选集合。

### Phase 3：Context Adapter 与预算治理

- 新增 `skill-activation` / `skill-search` / `skill-read` adapters。
- skill tool result 进入 ContextPackage。
- 超长 skill_read 做截断/摘要/引用化。
- capability 文档列出新增 Mastra skill tools。

验收：

- skill tool call 有 context package event。
- 大 reference 不会无限进入模型上下文。
- replay 可复现 skill tool observation。

### Phase 4：前端协作和管理体验

- 前端配置页展示 skill list、启停、上传。
- run 启动时支持 explicit selected skills。
- 增加 `/api/v1/skills/select` 供前端预览 auto selection。

验收：

- GUI/TUI 能展示当前可用 skill。
- run 前能看到本次将启用哪些 skill。

### Phase 5：高级能力

- BM25 skill search 优化。
- skill version pinning / rollback。
- builtin skills。
- team/workspace skill marketplace。
- 可选 semantic skill recall。

## 测试计划

Smoke：

- `smoke:skills-api`
- `smoke:skill-selection`
- `smoke:copilotkit-run-skill`
- `smoke:context-skill-tools`

关键断言：

- 上传非法 zip 被拒绝。
- disabled skill 不可被 selected。
- `skill_search` 范围只包含 selected skills。
- `allowed-tools` 不扩大工具权限。
- `skill` tool result 进入 ContextPackage。
- run event 中记录 skill selection。

## 风险

| 风险 | 缓解 |
| --- | --- |
| Mastra 升级引入 breaking changes | 先单独升级并跑全量 smoke |
| skill instructions 过长 | 通过 ToolObservationAdapter 预算治理 |
| skill 诱导使用危险工具 | allowed/denied tools 收敛，系统策略优先 |
| `skill_search` 搜全库 | 每次 run 只挂 selected skill paths |
| zip package 安全问题 | 继续使用安全解压策略，scripts 执行必须走受控 workspace/sandbox tools |
| 和 knowledge/memory 重叠 | 明确 skill 是方法论，不是业务知识或用户记忆 |

## 已确认的设计点

1. 默认 `skill_mode` 采用 `auto`。
2. 多个 skill 的 `allowed-tools` 默认使用并集，再受系统/run/datasource/MCP 策略收敛。
3. 允许 workspace `default_enabled=true` 的 skill 自动进入候选集合。
4. builtin skill 第一阶段暂不实现。
5. `scripts/` 允许执行，但必须通过受控 workspace/sandbox tools 和审批/审计边界。
