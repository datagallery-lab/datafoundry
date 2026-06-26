# GUI 后端功能适配分析

## 概览

DataAgent 的 Web GUI 是一个全功能的数据分析工作台，通过 AG-UI 协议（CopilotKit）与后端实时交互。GUI 不仅展示后端的执行结果，还实现了细粒度的状态追踪、工具调用可视化、以及完整的 ReAct 循环展示。

---

## 一、核心后端功能适配

### 1.1 数据工具调用 (Data Tools)

GUI 完整适配了后端的数据工具系统，并为每种工具类型提供了专门的 UI 渲染：

#### 已适配的工具类型

| 工具名称 | 后端功能 | GUI 展示 | 状态追踪 |
|---------|---------|---------|---------|
| `inspect_schema` | 检查数据源表结构 | 表名+列名可视化卡片 | ✅ 完整 |
| `run_sql_readonly` | 执行只读 SQL 查询 | SQL 代码+结果表格+审计信息 | ✅ 完整 |
| `list_data_sources` | 列举可用数据源 | 归类为"结构检查" | ✅ 完整 |
| `preview_table` | 预览表数据 | 归类为"取数" | ✅ 完整 |
| `retrieve_knowledge` | RAG 知识检索 | 归类为"知识检索" | ✅ 完整 |
| 通用工具 (`*`) | 任何未识别工具 | 通用卡片展示参数+结果 | ✅ 完整 |

**关键实现：**
- `data-task-state.ts` 定义了工具类型映射：`dataStepKindForTool()`
- `page.tsx` 为每种工具注册了专门的渲染器（`useRenderTool`）
- 支持工具的"前端降级"：未知工具自动归类为 `other` 类型

#### 工具调用展示

GUI 为工具调用提供了三层可视化：

1. **聊天流中的工具卡片**（`SqlToolCard`, `SchemaToolCard`, `GenericToolCard`）
   - 分离式布局：工具调用卡片 + 执行结果卡片
   - 实时状态：等待执行 → 执行中 → 已完成/失败
   - SQL 工具特殊处理：语法高亮 + 表格渲染 + 审计信息

2. **右侧任务控制台**（`TaskConsole`）
   - Timeline 视图：按时间顺序展示所有数据步骤
   - 分类展示：结构检查/数据查询/取数/知识检索
   - 可点击查看详情

3. **完整追溯面板**（`TraceOverlay`）
   - 展开式全屏视图
   - 关联数据产物（Artifacts）
   - 审计日志（SQL 行数、耗时）

---

### 1.2 数据源管理 (Data Sources)

**后端能力：**
- 支持 DuckDB (demo)、SQLite、CSV、Excel
- 只读模式（`readonly`）
- 通过 Data Gateway 统一执行 SQL

**GUI 适配：**

```typescript
// 数据源配置界面
export const DB_TYPE_OPTIONS = [
  { value: "duckdb", label: "DuckDB（内置 demo）" },
  { value: "sqlite", label: "SQLite（文件）" },
  { value: "csv", label: "CSV 文件" },
  { value: "xlsx", label: "Excel 文件" },
];
```

**配置字段：**
- `datasourceId`: 数据源 ID（传给后端）
- `type`: 数据库类型
- `mode`: 访问模式（当前固定为 `readonly`）
- `filePath`: 文件路径（SQLite/CSV/Excel）

**前瞻性设计：**
- PostgreSQL/MySQL 选项已预留，通过 `requiresCapability: "datasource.server"` 门控
- 查询策略字段（`maxRows`, `timeoutMs`）已准备，等待后端 `datasource.queryPolicy` 能力

**可视化：**
- 左侧边栏的"DB"配置入口
- 内置 `api-duckdb-demo` 数据源
- 配置面板支持添加自定义数据源

---

### 1.3 LLM 模型配置

**后端能力：**
- 环境变量：`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`
- 支持多种 Provider：OpenAI 兼容、百炼、DeepSeek、Anthropic 等

**GUI 适配：**

```typescript
export const LLM_PROVIDER_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI 兼容" },
  { value: "bailian", label: "百炼 DashScope" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
];
```

**配置字段：**
- `provider`: LLM 提供商
- `baseUrl`: API 基础 URL
- `apiKey`: API 密钥（仅本地存储，不传给后端）
- `modelName`: 模型名称（如 `gpt-4o`, `qwen-plus`）

**安全机制：**
- API Key 仅存储在浏览器 `localStorage`
- 通过 AG-UI 协议传给后端时，只传 `hasApiKey` 标志，不传明文
- 使用 `secretRef` 模型（预留）

**可视化：**
- 聊天输入框下方的模型选择器
- 左侧边栏的"LLM"配置面板
- 默认"服务端默认"选项（读取后端环境变量）

---

### 1.4 Skill 技能包管理

**后端能力：**
- 预置 Skill：通用数据分析、Schema 探索、SQL 分析、报告草稿
- 支持自定义 Skill（SKILL.md 格式）

**GUI 适配：**

```typescript
export const DATA_SKILLS: DataSkill[] = [
  { id: "data-agent-default", name: "通用数据分析" },
  { id: "schema-explore", name: "Schema 探索" },
  { id: "sql-analysis", name: "SQL 分析" },
  { id: "report-draft", name: "报告草稿" },
];
```

**功能：**
- Skill 上传解析器：`parseSkillMdContent()`
- Frontmatter 解析：`name`, `description`, `version`, `allowed-tools`
- 本地存储（`packageContent`）

**前瞻性设计：**
- ZIP 包格式预留
- 后端 REST API (`POST /api/v1/skills`) 待接入

**可视化：**
- 左侧边栏的"Skill"配置面板
- 支持导入 `.md` 文件
- 显示已启用的 Skill 列表

---

### 1.5 MCP 服务器配置

**后端能力：** ❌ 未实现

**GUI 适配：**
```typescript
export const MCP_TRANSPORT_OPTIONS = [
  { value: "sse", label: "SSE (Server-Sent Events)" },
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "stdio", label: "stdio（本地命令）" },
];
```

**状态：** "后端未支持" 标记，配置界面已准备

---

### 1.6 知识库 (Knowledge Base)

**后端能力：** ❌ 未实现（`packages/knowledge` 仅有接口）

**GUI 适配：**
- 配置字段：`indexName`, `retrievalTopK`
- 状态：左侧边栏显示"后端未支持"

---

## 二、实时状态追踪

### 2.1 AG-UI 事件系统

GUI 完整集成了 AG-UI 协议的所有事件类型：

| 事件类型 | 作用 | GUI 响应 |
|---------|-----|---------|
| `RUN_STARTED` | Agent 运行开始 | 重置运行状态，显示"执行中" |
| `RUN_FINISHED` | Agent 运行完成 | 标记完成，统计汇总 |
| `RUN_ERROR` | Agent 运行失败 | 显示错误信息 |
| `STATE_SNAPSHOT` | Agent 状态快照 | 更新 `runStatus` |
| `STATE_DELTA` | Agent 状态增量 | 应用 JSON Patch |
| `ACTIVITY_SNAPSHOT` | 活动快照 | 更新计划任务/工具步骤 |
| `ACTIVITY_DELTA` | 活动增量 | 增量更新计划状态 |
| `TOOL_CALL_START` | 工具调用开始 | 创建工具调用记录 |
| `TOOL_CALL_ARGS` | 工具参数流式传输 | 更新 SQL 等参数 |
| `TOOL_CALL_END` | 工具调用结束 | 标记工具执行完成 |
| `TOOL_CALL_RESULT` | 工具结果返回 | 更新结果，判断成功/失败 |
| `CUSTOM:sql_audit` | SQL 审计日志 | 记录行数、耗时 |
| `CUSTOM:artifact` | 数据产物 | 创建 Artifact 卡片 |
| `CUSTOM:token_usage` | Token 使用统计 | 更新 Token 计数 |

**实现：**
- `live-run-state.ts` 的 `reduceLiveRunEvent()` 函数
- 使用 React 订阅模式：`agent.subscribe()`

---

### 2.2 计划任务追踪 (Plan Tasks)

**后端能力：**
- `ACTIVITY_SNAPSHOT` + `activityType: "PLAN"` 推送计划
- 计划包含多个任务（`task`），每个任务有状态

**GUI 展示：**

```typescript
const defaultPlan: LivePlanTask[] = [
  { id: "schema", title: "检查数据源 schema", status: "pending" },
  { id: "sql", title: "生成并执行只读 SQL", status: "pending" },
  { id: "final", title: "生成最终回答", status: "pending" },
];
```

**状态：**
- `pending` → `running` → `completed` / `failed`
- 右侧控制台的"计划"面板显示进度

---

### 2.3 工具执行状态

**三层状态系统：**

1. **CopilotKit 状态**（前端协议层）
   - `inProgress`: 工具已规划
   - `executing`: 工具正在执行
   - `complete`: 工具完成

2. **后端工具状态**（AG-UI 事件）
   - `running`: 后端执行中
   - `success`: 后端返回成功
   - `failed`: 后端返回失败

3. **最终展示状态**（合并后）
   - `pending`: 等待执行
   - `executing`: 执行中
   - `complete`: 已完成
   - `failed`: 执行失败

**状态解析逻辑：**
```typescript
export function resolveToolDisplayStatus(input: {
  copilotStatus: CopilotToolStatus;
  backendPhase?: BackendToolPhase;
  hasResult: boolean;
  resultIsError?: boolean;
}): ToolDisplayStatus
```

**可视化：**
- 工具卡片的状态徽章（带颜色+动画）
- 失败时显示错误详情（分类：工具错误/协议错误/投递错误）

---

### 2.4 SQL 审计追踪

**后端能力：**
- `CUSTOM:sql_audit` 事件
- 包含：`datasource_id`, `status`, `row_count`, `elapsed_ms`

**GUI 展示：**

```typescript
export type LiveAudit = {
  id: string;
  datasourceId?: string;
  status?: string;
  rowCount?: number;
  elapsedMs?: number;
};
```

**可视化：**
- SQL 工具结果卡片显示审计信息
- 右侧控制台的统计面板汇总
- 会话级别的 SQL 统计（总查询数、行数、耗时）

---

### 2.5 数据产物 (Artifacts)

**后端能力：**
- `CUSTOM:artifact` 事件
- 类型：`table`, `chart`, `markdown`, `html`

**GUI 展示：**

```typescript
export type DataArtifactType = "dataset" | "chart" | "sql" | "report";

export interface DataArtifact {
  id: string;
  title: string;
  kind: "chart" | "csv" | "memo" | "dashboard";
  type?: DataArtifactType;
  summary: string;
  version?: string;
  detail?: ArtifactDetail; // 包含表格预览、图表数据等
}
```

**可视化：**
- 右侧控制台的"产物"面板
- 支持表格预览（前 50 行）
- 自动关联到生成它的工具调用

---

### 2.6 Token 使用统计

**后端能力：**
- `CUSTOM:token_usage` 事件
- 字段：`input_tokens`, `output_tokens` / `prompt_tokens`, `completion_tokens`

**GUI 展示：**

```typescript
export type TokenUsageStats = {
  inputTokens: number;
  outputTokens: number;
};
```

**可视化：**
- 右侧控制台的"统计"标签页
- 单次运行统计 + 会话累计统计
- 实时更新（运行中的 Token 也会计入）

---

## 三、UI 组件层次

### 3.1 主工作区布局

```
┌─────────────────────────────────────────────────────────┐
│  SessionPane     │  ChatPane        │  TaskConsole      │
│  (左侧边栏)      │  (聊天区)        │  (右侧面板)       │
│                  │                  │                   │
│  - 会话列表      │  - 用户消息      │  - 产物面板       │
│  - 新建任务      │  - Agent 回复    │  - Timeline       │
│  - 配置入口:     │  - 工具调用卡片  │  - 统计信息       │
│    · DB          │  - ReAct 步骤    │  - 完整追溯入口   │
│    · KB          │                  │                   │
│    · MCP         │  - 输入框        │                   │
│    · LLM         │  - 模型选择器    │                   │
│    · Skill       │                  │                   │
└─────────────────────────────────────────────────────────┘
```

**响应式设计：**
- 侧边栏可折叠
- 右侧面板可隐藏
- 根据视口宽度自动调整布局

---

### 3.2 ReAct 步骤可视化

**ReAct 循环展示：**

每个 Agent 回合渲染为一个"步骤卡片"（`StepAssistantMessage`）：

1. **带工具调用的回合**：
   - 标题："ReAct 回合"
   - 子面板 1："思考"（琥珀色） - Agent 的推理文本
   - 子面板 2："工具调用"（紫色） - 工具卡片列表

2. **纯文本回合**：
   - 中间回合："思考·观察"（琥珀色）
   - 最后回合："最终回答"（绿色）

3. **流式状态**：
   - 执行中：边框光晕 + 闪烁光标
   - 自动展开当前步骤，折叠已完成步骤

**视觉层次：**
- 步骤徽章：数字（ReAct 步骤）/ 点（思考）/ 勾（最终回答）
- 状态指示器：执行中 / 生成中
- 可折叠：点击标题栏展开/折叠

---

### 3.3 工具调用卡片设计

**分离式布局：**

```
┌─────────────────────────────────────────────┐
│  工具调用                              状态  │
│  run_sql_readonly                    执行中 │
│                                             │
│  SQL                                        │
│  ┌─────────────────────────────────────┐   │
│  │ SELECT region, SUM(revenue)         │   │
│  │ FROM orders                         │   │
│  │ GROUP BY region                     │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  执行结果                            已返回  │
│  run_sql_readonly                           │
│                                             │
│  行数: 5    耗时: 84ms    审计: audit-123  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  region     │  revenue              │   │
│  ├─────────────────────────────────────┤   │
│  │  North      │  1,234,567            │   │
│  │  South      │  987,654              │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**颜色编码：**
- 工具调用：紫色系
- SQL 结果：绿色系
- Schema 结果：蓝色系
- 失败/错误：红色系
- 执行中：琥珀色（带 pulse 动画）

---

### 3.4 右侧任务控制台

**三个标签页：**

1. **产物**（默认）
   - 显示所有 Artifacts
   - 表格预览 + 元信息
   - 支持点击查看详情

2. **Timeline**
   - 按时间顺序列出所有数据步骤
   - 分类图标（结构检查/查询/取数/知识）
   - 点击展开详情

3. **统计**
   - 运行状态（进行中/已完成/失败）
   - 工具调用统计（总数/成功/失败，按工具分组）
   - SQL 统计（查询数/行数/耗时）
   - Artifact 数量
   - Token 使用量（输入/输出）

**交互：**
- 点击 Timeline 项 → 跳转到聊天区对应位置
- 点击 Artifact → 高亮显示
- "完整追溯"按钮 → 打开全屏 Trace Overlay

---

## 四、前瞻性设计（已准备，待后端支持）

### 4.1 能力门控系统

```typescript
export type BackendCapability =
  | "datasource.server"       // PostgreSQL/MySQL (#2)
  | "datasource.queryPolicy"  // 查询策略 (#5)
  | "llm.samplingParams"      // 采样参数 (#4)
  | "artifact.export";        // 产物导出 (#9)

export const BACKEND_CAPABILITIES: Record<BackendCapability, boolean> = {
  "datasource.server": false,
  "datasource.queryPolicy": false,
  "llm.samplingParams": false,
  "artifact.export": false,
};
```

**原理：**
- 配置字段通过 `requiresCapability` 门控
- 能力关闭时，字段隐藏且不参与验证
- 后端实现后，只需翻转一个布尔标志，UI 自动启用

---

### 4.2 PostgreSQL/MySQL 支持

**已准备的配置字段：**
- `host`, `port`, `database`, `schema`
- `username`, `password`

**门控：** `requiresCapability: "datasource.server"`

---

### 4.3 查询策略配置

**已准备的字段：**
- `maxRows`: 最大返回行数
- `timeoutMs`: 查询超时

**门控：** `requiresCapability: "datasource.queryPolicy"`

---

### 4.4 LLM 采样参数

**已准备的字段：**
- `temperature`: 温度
- `maxTokens`: 最大 Token 数

**门控：** `requiresCapability: "llm.samplingParams"`

---

### 4.5 Artifact 导出

**已规划：**
- 预览 API
- 下载 API
- CSV/Excel 导出

**门控：** `requiresCapability: "artifact.export"`

---

## 五、安全与隐私

### 5.1 凭证管理

**原则：** 凭证（API Key、密码）仅存储在浏览器，不通过 AG-UI 协议外发

**实现：**

```typescript
const SECRET_SETTING_KEYS = [
  "apiKey", "api_key", "token", "secret",
  "password", "credentialsJson"
];

function sanitizeWorkspaceConfig(workspaceConfig) {
  // 从 AG-UI context 中移除所有敏感字段
  // 只传递 hasApiKey 标志
}
```

**后端模型：**
- 前端传 `secretRef` 指针
- 后端从安全存储中解析实际密钥

---

### 5.2 Skill 包内容隔离

**本地存储字段：**
```typescript
export const SKILL_PACKAGE_LOCAL_ONLY_KEYS = ["packageContent"];
```

- `packageContent` 仅保存在 `localStorage`
- 通过 AG-UI 协议时，用 `hasPackageContent: "true"` 替代正文
- 等待后端 REST API 后，改为服务端存储

---

## 六、性能优化

### 6.1 状态合并策略

**问题：** AG-UI 事件流可能快速推送大量事件

**解决：**
- 使用 React 的状态合并机制
- `reduceLiveRunEvent()` 采用不可变更新
- 只在关键字段变化时重新渲染

---

### 6.2 工具结果缓存

**问题：** 工具结果可能通过多个事件源到达

**解决：**
```typescript
function useEffectiveToolResult(toolCallId, copilotResult?) {
  const backendResult = useBackendToolResult(toolCallId);
  return copilotResult ?? backendResult; // 优先使用 CopilotKit 结果
}
```

---

### 6.3 关联逻辑

**工具调用与活动步骤的关联：**
```typescript
export function findCorrelatedToolCall(
  toolCalls: LiveToolCallRecord[],
  toolName: string | undefined,
  stepId: string | undefined,
): LiveToolCallRecord | undefined
```

**策略：**
1. 优先按 `stepId` 匹配（后端明确关联）
2. 其次匹配同名且未关联的运行中工具
3. 最后匹配同名的任意未关联工具
4. 兜底：同名工具列表的最后一个

---

## 七、多语言支持

**当前状态：** 界面文字为中文

**国际化准备：**
- 标签和提示文字都是字符串字面量，便于提取
- 错误消息分离在独立函数中

---

## 八、总结

### ✅ 后端已完全实现的功能（2026-06-23 最新）

根据最新的 `origin/main` commit（6141152 feat: add backend config runtime APIs），后端已经完整实现了配置管理和运行时扩展：

**1. REST API 配置管理** (`/api/v1/*`)
- ✅ **Datasource CRUD** - 完整的增删改查、测试、schema 抓取
- ✅ **Knowledge Base CRUD** - 创建、测试、文档上传、检索、重建索引
- ✅ **MCP Server CRUD** - 配置、连通性测试、tools manifest 拉取
- ✅ **Model Profile CRUD** - LLM 配置、provider 探测
- ✅ **Skill CRUD** - 上传、验证、替换 Skill 包
- ✅ **Workspace Config** - 统一配置视图、批量启用/禁用
- ✅ **Artifact API** - 详情、预览、内容、下载

**2. 数据工具调用**
- ✅ `inspect_schema` (Schema 检查)
- ✅ `run_sql_readonly` (只读 SQL)
- ✅ `list_data_sources` (数据源列表)
- ✅ `preview_table` (表预览)
- ✅ `retrieve_knowledge` (知识检索) - 新增

**3. 数据源支持**
- ✅ DuckDB (demo)
- ✅ SQLite
- ✅ CSV
- ✅ Excel
- ✅ **PostgreSQL** - 已实现适配器（需真实 DB 验证）
- ✅ **MySQL** - 已实现适配器（需真实 DB 验证）

**4. LLM 配置**
- ✅ 多 Provider 支持（OpenAI 兼容、百炼、DeepSeek、Anthropic、Google）
- ✅ Model Profile REST API
- ✅ Provider 测试与探测
- ✅ 采样参数支持（temperature、maxTokens）
- ✅ **secretRef 密钥管理** - SQLite AES-GCM 加密存储

**5. Knowledge Base (RAG)**
- ✅ **Local-first 实现** - FTS fallback + 可选 vector embedding
- ✅ 文档上传、检索、重建索引
- ✅ `retrieve_knowledge` 工具集成

**6. MCP 服务器**
- ✅ **官方 `@ag-ui/mcp-middleware` 集成**
- ✅ Streamable HTTP / SSE 传输支持
- ✅ 动态工具挂载

**7. Skill 管理**
- ✅ Multipart 上传、验证、替换
- ✅ `allowedTools` 工具集收窄
- ✅ Active skill 注入 agent policy

**8. 查询策略**
- ✅ 环境变量 SQL policy（`SQL_MAX_ROWS`, `SQL_TIMEOUT_MS`）
- ✅ **Per-datasource policy** - 只能收紧 server policy

**9. Artifact 管理**
- ✅ 详情、预览、内容、下载 REST API
- ✅ SQLite 持久化存储

**10. 实时状态**
- ✅ 计划任务追踪
- ✅ 工具执行状态
- ✅ SQL 审计日志（独立审计表）
- ✅ Artifact 产出
- ✅ Token 统计
- ✅ Run events 持久化

**11. 安全机制**
- ✅ **Secret 加密存储** - AES-GCM，需要 `SECRET_MASTER_KEY`
- ✅ 凭证隔离 - 读接口不返回明文
- ✅ Effective run config - workspace defaults + per-run override + server policy

---

### 🔄 待前端接入的功能（后端已就绪）

⏳ **配置源迁移**
- 后端 REST API 已完整实现
- 前端仍使用 `localStorage`
- **下一步**：将左栏配置源切换到 `/api/v1/workspace-config`

⏳ **能力开关同步**
- 后端 `/api/v1/capabilities` 已返回所有能力状态
- 前端 `BACKEND_CAPABILITIES` 仍为硬编码
- **下一步**：从 API 动态获取能力开关

⏳ **PostgreSQL/MySQL UI 启用**
- 后端适配器已实现
- 前端 UI 已准备（通过 `datasource.server` 门控）
- **下一步**：翻转前端能力开关

⏳ **Knowledge Base UI 启用**
- 后端已完整实现
- 前端显示"后端未支持"
- **下一步**：启用 KB 配置面板

⏳ **MCP UI 启用**
- 后端已集成官方中间件
- 前端显示"后端未支持"
- **下一步**：启用 MCP 配置面板

⏳ **查询策略字段启用**
- 后端已支持 per-datasource policy
- 前端字段通过 `datasource.queryPolicy` 门控隐藏
- **下一步**：翻转能力开关，显示 `maxRows`/`timeoutMs` 字段

⏳ **LLM 采样参数字段启用**
- 后端已支持 temperature/maxTokens
- 前端字段通过 `llm.samplingParams` 门控隐藏
- **下一步**：翻转能力开关

⏳ **Artifact 下载功能**
- 后端 API 已实现（`/api/v1/artifacts/:id/download`）
- 前端产物卡片未接入下载按钮
- **下一步**：添加下载交互

---

### GUI 的核心价值

1. **完整性**：覆盖所有已实现的后端功能
2. **实时性**：毫秒级事件响应，流式渲染
3. **可扩展性**：能力门控系统，后端更新后前端自动启用
4. **可视化深度**：从聊天流到 Timeline 到完整追溯的三层展示
5. **ReAct 原生**：专为 ReAct 循环设计的 UI 模式
6. **安全优先**：凭证永不离开浏览器
7. **面向未来**：所有待支持功能的 UI 已就绪

---

## 九、后端验证状态（2026-06-23）

### 已通过的测试

后端团队已完成全面验证：

**单元/集成测试：**
- ✅ `npm run typecheck`
- ✅ `npm run test:web`
- ✅ `npm run build:web`

**Smoke 测试：**
- ✅ `smoke:config-api` - 配置 CRUD、secretRef、revision、job、artifact API
- ✅ `smoke:copilotkit` - AG-UI 协议端到端
- ✅ `smoke:copilotkit-context` - Run config、用户输入、task PLAN 投影
- ✅ `smoke:context-compilation` - 上下文编译流程
- ✅ `smoke:metadata` - 元数据存储
- ✅ `smoke:run-identity` - Run 身份管理
- ✅ `smoke:data-gateway` - 数据网关
- ✅ `smoke:sql-readonly` - SQL 只读工具
- ✅ `smoke:agent-runtime` - Agent 运行时
- ✅ `smoke:task-state` - 任务状态
- ✅ `smoke:collaboration-tools` - 协作工具
- ✅ `smoke:workspace-tools` - 工作区工具
- ✅ `smoke:tool-state-isolation` - 工具状态隔离

**真实页面验证：**
- ✅ Web 界面正常渲染（Safari @ http://127.0.0.1:3000/data-tasks）
- ✅ 发送 `orders` 查询
- ✅ 前端显示 run 已完成
- ✅ 3 个工具步骤成功：`list_data_sources`、`inspect_schema`、`preview_table`
- ✅ 渲染 `orders` 表 schema
- ✅ 显示 3 行 preview
- ✅ 显示最终回答

### 待真实环境验收

⏳ **PostgreSQL/MySQL**
- 适配器已实现
- 需要用户提供可访问的只读实例做集成验证

⏳ **外部 LLM Provider**
- `/test` 依赖本地 API key 和 provider 网络可达性

⏳ **Embedding/Vector**
- 效果依赖本地 embedding key
- 无 key 时走本地 FTS fallback

⏳ **MCP Server**
- 真实调用依赖用户配置可达的 streamable HTTP / SSE MCP server

---

## 十、前端接入路线图

### 阶段 1：配置源迁移（优先级最高）

**目标**：将左栏配置从 `localStorage` 迁移到后端 REST API

**步骤：**
1. 从 `/api/v1/capabilities` 动态获取能力开关，替换硬编码的 `BACKEND_CAPABILITIES`
2. 页面加载时调用 `/api/v1/workspace-config` 获取配置
3. 配置变更时调用对应资源的 CRUD API（`/api/v1/datasources`、`/api/v1/model-profiles` 等）
4. 凭证字段改为直接提交到后端（不再存 `localStorage`）
5. 从 API 响应中读取 `secretRef` 和 `hasSecret`

**影响范围：**
- `apps/web/src/app/data-tasks/data-task-state.ts` - 配置加载/持久化逻辑
- `apps/web/src/app/data-tasks/page.tsx` - 初始化和更新逻辑

---

### 阶段 2：能力门控启用（优先级高）

**目标**：启用已实现但被门控隐藏的功能

**步骤：**
1. **PostgreSQL/MySQL**
   - 前端能力开关：`datasource.server: true`
   - UI 自动显示 host/port/database/username/password 字段
   
2. **Knowledge Base**
   - 前端能力开关：`knowledge: true`
   - 启用 KB 配置面板
   - 接入文档上传、检索调试接口

3. **MCP Server**
   - 前端能力开关：`mcp: true`
   - 启用 MCP 配置面板
   - 接入连通性测试接口

4. **查询策略**
   - 前端能力开关：`datasource.queryPolicy: true`
   - 显示 `maxRows`/`timeoutMs` 字段

5. **LLM 采样参数**
   - 前端能力开关：`llm.samplingParams: true`
   - 显示 `temperature`/`maxTokens` 字段

**影响范围：**
- `apps/web/src/app/data-tasks/data-task-state.ts` - `BACKEND_CAPABILITIES` 对象

---

### 阶段 3：增强功能接入（优先级中）

**目标**：接入后端已实现的增强功能

**步骤：**
1. **Artifact 下载**
   - 产物卡片添加"下载"按钮
   - 调用 `/api/v1/artifacts/:id/download`

2. **Datasource Schema 抓取**
   - 配置面板添加"抓取 Schema"按钮
   - 调用 `/api/v1/datasources/:id/introspect`
   - 显示抓取任务状态（`/api/v1/jobs/:id`）

3. **Knowledge Base 重建索引**
   - KB 配置面板添加"重建索引"按钮
   - 调用 `/api/v1/knowledge-bases/:id/reindex`

4. **连接测试状态显示**
   - 配置列表显示 `connectionStatus`（connected/failed/untested）
   - 配置详情页添加"测试连接"按钮

**影响范围：**
- 产物组件、配置面板组件

---

### 阶段 4：Run Config 优化（优先级低）

**目标**：利用后端的 effective run config 机制

**当前状态：**
- 前端继续发送 `context.run_config`
- 后端自动合并 workspace defaults + per-run override + server policy

**未来优化：**
- 支持 per-run 临时启用/禁用资源
- 显示 effective config（合并后的最终配置）
- Revision-based 乐观并发控制

---

## 十一、更新后的架构对比

### 之前的理解（不准确）

```
GUI → localStorage 配置 → AG-UI 协议 → 后端（部分功能待实现）
```

### 实际架构（2026-06-23）

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (GUI / TUI)                                        │
│   ├─ localStorage (临时，待迁移)                            │
│   └─ AG-UI 协议 (实时运行)                                  │
└─────────────────────────────────────────────────────────────┘
                        ↓                    ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend (apps/api)                                          │
│   ├─ POST /api/copilotkit  (AG-UI Runtime)                 │
│   │   └─ @ag-ui/mastra MastraAgent                         │
│   │       └─ @ag-ui/mcp-middleware                         │
│   │           └─ packages/agent-runtime tools              │
│   │                                                         │
│   └─ /api/v1/* (REST Config API)                           │
│       ├─ /datasources (CRUD + test + introspect)           │
│       ├─ /knowledge-bases (CRUD + upload + search)         │
│       ├─ /mcp-servers (CRUD + test)                        │
│       ├─ /model-profiles (CRUD + test)                     │
│       ├─ /skills (CRUD + validate + replace)               │
│       ├─ /workspace-config (统一配置视图)                   │
│       ├─ /run-defaults (运行默认配置)                       │
│       ├─ /capabilities (能力开关)                           │
│       ├─ /jobs (异步任务状态)                               │
│       └─ /artifacts (产物管理)                              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Core Services                                               │
│   ├─ packages/data-gateway (SQL 执行，含 PG/MySQL)         │
│   ├─ packages/knowledge (FTS + Vector RAG)                 │
│   ├─ packages/metadata (SQLite 存储 + Secret 加密)         │
│   └─ packages/agent-runtime (工具治理 + 上下文编排)        │
└─────────────────────────────────────────────────────────────┘
```

**关键边界：**
- ✅ Data Gateway 只由 agent tools 调用，不是前端查询 API
- ✅ 凭据只存服务端 secret store（AES-GCM），不进入 AG-UI 或前端
- ✅ Run events 持久化到 SQLite，审计信息通过 AG-UI `CUSTOM` 或独立审计表
- ✅ Effective run config = workspace defaults + per-run override + server policy

---

## 参考文档

**前端：**
- `apps/web/src/app/data-tasks/data-task-state.ts` - 状态定义与工具映射
- `apps/web/src/app/data-tasks/live-run-state.ts` - 实时状态 reducer
- `apps/web/src/app/data-tasks/page.tsx` - 主界面与工具渲染器
- `apps/web/src/app/data-tasks/tool-call-display.ts` - 工具状态解析
- `apps/web/src/app/data-tasks/use-data-agent-run.ts` - AG-UI 事件订阅

**后端（最新）：**
- `apps/api/src/config-api.ts` - REST API 实现（1158 行）
- `apps/api/src/server.ts` - HTTP 服务器入口
- `docs/engineering/2026-06-23-backend-config-runtime-delivery-report.md` - 交付报告
- `docs/engineering/2026-06-23-backend-rest-api-reference.md` - REST API 参考（1132 行）
- `docs/engineering/2026-06-23-frontend-backend-capability-status.md` - 能力状态对照表
