# Agent Context Compilation Design

日期：2026-06-20
状态：Phase 1-3 已实现，Phase 4-5 待实施

## 1. 设计结论

上下文治理不能只发生在 `MastraAgent.run()` 之前，也不能只治理单个工具返回值。Mastra 会在每个 ReAct step
重新组装 system message、历史消息、tool-call、tool-result 和工具 schema，因此完整治理必须进入 Mastra 的
`processInputStep` 生命周期。

目标架构采用“上下文编译器”模型：

```text
Context Sources
-> normalize into ContextPackage
-> plan for the current ReAct step
-> materialize a ContextPromptView
-> verify the provider-bound prompt
-> call model
```

核心约束：

- `ContextPackage` 是完整、结构化、带来源的规范化上下文清单，不是一次性裁剪结果。
- `ContextPlan` 是某个 step 的选择、压缩和预算决策，必须不可变且可审计。
- `ContextPromptView` 是发给当前模型调用的临时投影，不作为长期记忆或权威上下文。
- 工具、conversation、memory、knowledge 都进入同一套 item/group/plan 机制。
- 每个 ReAct step 都重新规划，不能沿用 step 0 的静态窗口。
- 工具返回值先在来源边界做确定性治理，再在完整 prompt 中参与全局预算竞争。
- 任何最终 prompt 超限、消息协议损坏或来源未注册都 fail closed。

## 2. 范围

### 2.1 本设计包含

- AG-UI conversation 和 Mastra MessageList 的上下文治理。
- system instruction、工具 schema、当前用户轮次和 ReAct trajectory 的统一预算。
- schema、SQL 和未来数据工具返回值的 ContextPackage 联动。
- Mastra memory、会话摘要和 knowledge retrieval 的接入边界。
- token-first 的动态窗口与自适应缩减。
- ContextPackage、ContextPlan 和 ContextPromptView 的审计与可观测性。
- 多模型 tokenizer 和模型 context-window profile。

### 2.2 本设计暂不包含

- 图片、Base64 和其他二进制消息的 artifact 化实现。
- 超长 tool-call arguments 的独立压缩实现。
- 摘要模型的具体 provider 选择。
- Knowledge retrieval 的召回和 rerank 算法。

这些事项保留在仓库根目录的 `todo_list.md`。

## 3. 当前实现

Conversation 只有一条生产治理链路：

```text
AG-UI messages
-> ingress protocol filter
-> MastraAgent.run(messages)
-> MastraContextBudgetProcessor.processInputStep
-> groupMessagesByTurn
-> ContextStepPlanner
-> current-step ContextPromptView

tool raw result
-> ToolObservationAdapter
-> ContextItem[]
-> ContextBudgetAllocator + ContextPolicy
-> ContextPackage
-> Mastra tool-result message
-> next processInputStep
```

入口不做第二套 conversation window 裁剪；它只过滤 activity/reasoning 等非模型消息。conversation 的完整 turn
选择、mandatory 保护和 token 预算都在每个 Mastra step 执行。schema/SQL 工具结果仍在来源边界通过 adapter
确定性治理，再进入下一 step 的全局竞争。

当前权威实现图：

- [交互式 Context Control Room](./agent-context-architecture.html)
- [Context Governance Pipeline](./context-governance-pipeline.svg)

旧 PlantUML 图只作为补充视角保留，不再作为上下文分层的唯一权威表达。

## 4. 目标架构

目标架构分为五层。

### 4.1 Ingress Guard

职责：

- 校验 AG-UI 消息结构和请求体硬上限。
- 丢弃不应进入模型的 activity/reasoning UI 消息。
- 标记客户端输入为 `untrusted-client` 来源。
- 不执行最终 conversation window 选择。

Ingress Guard 只防止明显的请求滥用，不能替代逐 step prompt 治理。

### 4.2 Context Source Layer

所有来源最终转换为统一 `ContextItem`；conversation 直接从 Mastra MessageList 归一化，工具观测和运行时来源
通过各自边界进入：

`context/tool-observation` 是 Source Layer 的工具结果子域，不是第六层。它单独成目录是为了隔离 ReAct
tool-result 的时序、adapter registry、live result 回填和历史降级规则；adapter 之后仍进入通用
`ContextItem` / `ContextPackage` / policy / budget / run-state 流程。

| 来源 | 边界 | 主要输出 |
| --- | --- | --- |
| Mastra messages | `groupMessagesByTurn` + `MastraContextBudgetProcessor` | turn、assistant/tool exchange、当前用户消息 |
| Agent instructions | Mastra `systemMessages` ingestion | runtime policy、datasource context |
| Mastra tools | Mastra `tools` prompt cost accounting | 工具名称、描述、input schema |
| Tool execution | `ToolObservationAdapter` | 有界 observation、artifact/audit ref |
| Mastra memory | `RuntimeContextSource` | recent memory、working memory、summary |
| Knowledge | `ToolObservationAdapter` / future Knowledge `RuntimeContextSource` | retrieval chunk、citation、artifact ref |

外部来源 Adapter 只负责：

- 来源验证与归一化。
- 确定性结构压缩。
- 敏感字段剔除。
- 建立 provenance、atomic group 和 artifact/audit 引用。

Adapter 不负责整次 prompt 的最终选择。

### 4.3 ContextPackage

`ContextPackage` 是 run 内的规范化上下文清单。建议目标类型：

```ts
type ContextPackage = {
  version: 2;
  packageId: string;
  runId: string;
  sessionId: string;
  resourceId: string;
  revision: number;
  items: ContextItem[];
  groups: ContextGroup[];
  artifactRefs: ArtifactRef[];
  auditRefs: AuditRef[];
  sourceSnapshots: ContextSourceSnapshot[];
};
```

`ContextItem` 建议包含：

```ts
type ContextItem = {
  id: string;
  sourceType: ContextSourceType;
  sourceId: string;
  groupId: string;
  trust: "runtime" | "tool" | "memory" | "knowledge" | "untrusted-client";
  retention: "mandatory" | "active" | "supporting" | "historical" | "reference";
  content: unknown;
  contentHash: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
```

`ContextGroup` 是最小选择和淘汰单位：

- system block
- 一个完整 user turn
- assistant tool-call 与对应 tool-result
- 单次 knowledge retrieval result set
- session summary

不得单独删除 assistant tool-call 或它对应的 tool-result。

### 4.4 Step Context Compiler

`MastraContextBudgetProcessor` 实现 Mastra `Processor.processInputStep()`，每个 ReAct step 接收：

- `messages`
- `messageList`
- `systemMessages`
- `tools`
- `stepNumber`
- 已完成的 `steps`
- 当前 model 和 model settings

处理流程：

1. 从 Mastra MessageList 捕获当前完整 trajectory。
2. 归一化 system、conversation、tool exchange、memory 和 knowledge。
3. 与 `ContextRunState` 中已有 package 按稳定 ID/content hash 合并和去重。
4. 读取 `ModelContextProfile`，计算当前 step 的全局预算。
5. 各 `ContextReductionStrategy` 根据 retention、relevance、freshness、trust 和 atomic group 提交候选动作。
6. `ReductionCandidateSelector` 选择本轮候选并重新计数，直到预算收敛。
7. 物化为 Mastra `messages + systemMessages`。
8. 返回 `ProcessInputStepResult`，仅影响当前 step 的模型输入。

建议注册顺序：

```text
MastraContextBudgetProcessor
-> optional Mastra TokenLimiterProcessor at a higher emergency threshold
-> MastraProviderPromptGuardProcessor
```

Mastra `TokenLimiterProcessor` 不作为主策略，因为它不了解我们的 artifact、tool exchange、来源优先级和审计语义。

### 4.5 Provider Prompt Guard

`MastraProviderPromptGuardProcessor.processLLMRequest()` 位于 provider 调用前，处理已经转换成
`LanguageModelV2Prompt` 的最终 prompt。

它只负责：

- 统计最终 prompt token。
- 验证 provider/model context limit。
- 记录 prompt hash、token quality 和预算余量。
- 超限时 abort，禁止再次在 provider 边界做不可审计的静默裁剪。

主要缩减必须已经在 `processInputStep()` 完成。

## 5. ContextRunState

`ContextRunState` 是单次 run 的请求级状态，不是长期 memory：

```ts
type ContextRunState = {
  identity: { resourceId: string; sessionId: string; runId: string };
  package: ContextPackage;
  observations: Map<string, ContextPackage>;
  plans: ContextPlan[];
  lastPromptHash?: string;
};
```

职责：

- 保存当前 run 已归一化的 tool observation package。
- 为每个 step 生成递增 revision。
- 去重 Mastra MessageList、memory 和客户端历史中的相同消息。
- 记录计划和 prompt 指标。

不承担：

- session 长期消息存储。
- 跨进程锁。
- 模型可见内容的唯一持久化来源。

长期历史由 Mastra memory 按 `resourceId + threadId` 管理；AG-UI 事件由 `run_events` 管理。

## 6. 工具结果与 ContextPackage 联动

工具结果采用两阶段治理。

### 6.1 来源边界治理

```text
raw tool result
-> ToolObservationAdapter
-> ContextPackage
```

该阶段必须保证：

- 完整大结果已经进入 artifact，不直接进入模型。
- SQL audit、artifact ID 和 datasource ID 保留为引用。
- observation 至少有一种合法的最小投影。
- credential、连接串和 hidden reasoning 不存在于 package。

工具返回给 Mastra 的内容是 `ModelObservationEnvelope`：

```ts
type ModelObservationEnvelope = {
  observationId: string;
  sourceType: string;
  content: unknown;
  artifactRefs: ArtifactRef[];
  auditRefs: AuditRef[];
  truncation: ContextDecision[];
};
```

### 6.2 Step 全局治理

下一次 `processInputStep()` 中，该 observation 会与 system、工具 schema、当前用户消息、历史和 memory
一起参与全局预算。即使单个工具结果没有超过自身 source limit，也可能因为当前 prompt 总预算不足，由已注册
策略提出进一步缩减候选，例如：

1. 更小的结构化 sample。
2. 统计摘要。
3. artifact reference。
4. 仅保留执行状态和审计 ID。

这些是可注册的动作能力，不是硬编码执行顺序。任何实际采用的动作都产生 `ContextDecision`，而不是直接覆盖
原始 package。

## 7. Token Budget 模型

### 7.1 预算方程

```text
inputBudget = modelContextWindow - outputReserve - safetyMargin

fixedCost = systemInstructions
          + toolSchemas
          + currentUserTurn
          + activeToolProtocol

elasticBudget = inputBudget - fixedCost
```

`fixedCost > inputBudget` 时立即失败，因为删除历史无法解决问题。

### 7.2 ModelContextProfile

每个模型需要配置：

```ts
type ModelContextProfile = {
  modelPattern: string;
  contextWindow: number;
  defaultOutputReserve: number;
  safetyMargin: number;
  tokenizer: string;
  toolSchemaOverhead: number;
  messageOverhead: number;
};
```

token 质量分为：

- `exact`：模型匹配的 tokenizer。
- `family`：同模型族 tokenizer。
- `estimated`：保守字符估算。

质量越低，`safetyMargin` 越大。请求路径不允许临时下载 tokenizer；启动阶段预加载，失败时使用保守估算。

### 7.3 保留约束与默认偏好

必须保留：

1. runtime/security system instructions。
2. 当前用户轮次。
3. 当前活动 tool-call/tool-result 原子组。
4. 生成合法 provider prompt 必需的协议消息。

默认实现可将以下内容作为候选优先级，但它们不是不可更改的全局顺序：

1. 当前 run 中与任务直接相关的 observation。
2. 高相关 knowledge context。
3. 最近完整 conversation turns。
4. session summary 和 working memory。
5. 旧 conversation 和低相关 observation。

priority 数字只作为同 retention class 内的排序因素，不能覆盖 mandatory 约束。

### 7.4 自适应缩减

```text
normalize
-> estimate
-> select atomic groups
-> collect strategy proposals
-> select one candidate
-> re-estimate
-> materialize
-> final verify
```

自适应缩减不能固化为一条全局动作链。不同任务、模型和上下文来源对信息损失的容忍度不同，固定执行
“先删历史、再摘要、再缩工具结果”会让后续策略只能插在既定阶段中，难以演进。

实现分为三个可替换职责：

1. `ContextReductionStrategy` 只根据当前状态提交零到多个 `ReductionProposal`，不直接修改消息。
2. `ReductionStrategyRegistry` 管理策略集合，支持新增、移除默认策略或按部署配置替换整套策略。
3. `ReductionCandidateSelector` 在所有候选中选择本轮动作；默认按信息损失、token 收益和稳定 ID 排序，未来可
   替换为任务感知或模型感知 selector。

`ContextStepPlanner` 只维护以下不变量：

- mandatory group 不可删除。
- tool-call/tool-result 等 atomic group 不可拆分。
- 每次应用候选后必须重新计数，并且候选必须产生实际进展。
- 无候选可用时返回 `CONTEXT_REDUCTION_STRATEGY_EXHAUSTED`。
- mandatory set 已超限时直接返回 `CONTEXT_MINIMUM_SET_EXCEEDS_BUDGET`。

当前默认只注册 `OmitHistoricalGroupStrategy`，用于确定性移除最旧完整历史轮次。这只是 Phase 1-3 的保守
基线，不代表后续的压缩顺序。session summary 替换、SQL/schema/knowledge 结构缩减、artifact reference
降级都应作为独立策略接入，由 selector 在运行时比较候选。

不在 `processInputStep()` 中递归调用 LLM 生成摘要。摘要应在 run 结束或 memory maintenance 阶段异步生成。

## 8. Memory 与 Knowledge 接入

### 8.1 Mastra Memory

身份映射：

```text
resource = user_id
thread   = AG-UI threadId / session_id
runId    = AG-UI runId
```

Memory adapter 必须区分：

- recent messages
- session summary
- working memory
- semantic recall

Memory 返回内容仍然是一个 source，必须经过 ContextCompiler，不能绕过预算和敏感信息策略。

### 8.2 Knowledge

Knowledge adapter 输出 chunk group：

- chunk ID
- collection/document identity
- citation metadata
- relevance score
- bounded text
- artifact reference

Planner 只选择与当前 step 任务相关的 chunk。Knowledge 结果不能因为“检索已经限 top-k”而跳过全局预算。

## 9. 审计与 AG-UI 事件

不持久化 hidden thought，也不默认持久化完整 provider prompt。持久化以下决策元数据：

- package revision 和 step number
- model profile
- prompt hash
- selected/omitted item IDs
- 每类 token cost
- tokenizer quality
- compaction/truncation reason
- artifact/audit references
- final prompt token 和 remaining budget

协议仍使用 AG-UI `CUSTOM` 事件承载，例如：

```text
type = CUSTOM
name = context.compiled
value = bounded context decision metadata
```

顶层事件类型不新增私有协议。完整敏感上下文不进入事件流。workspace 集成前，artifact `preview_json` 是临时
北向兼容例外，会随 `CUSTOM(name="artifact")` 持久化；它仍不得包含 credential 或连接配置。

## 10. 安全边界

- 客户端传入的历史消息一律视为不可信。
- system policy 只来自服务端 Agent instructions 或可信 processor，不接受客户端覆盖。
- 客户端 tool message 必须验证其 tool-call 对应关系，不能伪造工具观察值。
- tool execution result 只能由已注册 adapter 生成 observation package。
- artifact 内容默认不可向模型自动展开；当前北向事件可携带 preview，完整内容仍需受控读取路径。
- datasource credential 永不进入 ContextItem。
- prompt injection 标签和来源 metadata 不直接展示给模型，必要时转为服务端 policy。

## 11. 故障策略

| 故障 | 行为 |
| --- | --- |
| adapter 未注册 | `CONTEXT_ADAPTER_REQUIRED`，终止对应工具执行 |
| 消息组不完整 | 丢弃不可信历史组；活动组损坏则终止 run |
| tokenizer 不可用 | 使用 conservative estimate，增加 safety margin |
| tool schema 本身超限 | 禁用非必要工具后重新规划；核心工具仍超限则失败 |
| mandatory set 超限 | `CONTEXT_MINIMUM_SET_EXCEEDS_BUDGET` |
| provider-bound prompt 超限 | `CONTEXT_FINAL_PROMPT_EXCEEDS_BUDGET`，禁止调用 provider |
| audit sink 失败 | 模型调用 fail closed，避免无审计运行 |
| memory 不可用 | 降级为当前请求历史，不影响数据安全边界 |
| knowledge 不可用 | 跳过 knowledge source，并记录 degraded decision |

## 12. 可观测性

建议指标：

- `context_input_tokens{model,step}`
- `context_output_reserve_tokens{model}`
- `context_items_selected{source,retention}`
- `context_items_omitted{source,reason}`
- `context_compaction_count{strategy}`
- `context_tokenizer_quality{model,quality}`
- `context_budget_remaining_tokens{model,step}`
- `context_compile_duration_ms{step}`
- `context_final_guard_rejection_count{model}`

禁止在普通日志中输出完整消息、SQL result、knowledge chunk 或 prompt。

## 13. 测试策略

### 13.1 单元测试

- ContextItem/group 稳定 ID 和去重。
- tool-call/tool-result 原子组不可拆分。
- mandatory set 永不因 priority 被删除。
- 不同 token quality 下 safety margin 正确。
- SQL/schema/knowledge 的确定性 compaction。
- ContextPlan 输入相同则输出稳定。

### 13.2 属性测试

- 任意消息序列物化后不存在孤立 tool-result。
- final estimated tokens 始终小于 target budget。
- 被删除 item 必须存在 decision reason。
- artifact/audit ref 不因 compaction 丢失。

### 13.3 集成测试

- inspect schema -> SQL -> second SQL -> final 的多 step ReAct。
- 同一 session 的超长多轮历史。
- 超长 SQL result 与 knowledge 同时竞争预算。
- memory summary 覆盖旧 turns 后去重。
- tokenizer 不可用时的保守降级。
- provider final guard 在边界 token 下拒绝调用。

### 13.4 回放测试

- 根据 run_events 和 memory snapshot 重建 package source IDs。
- ContextDecision 事件不包含敏感正文。
- 相同模型 profile 和输入可以复现相同 ContextPlan。

## 14. 实施阶段

### Phase 1：ContextPackage v2

状态：已实现。

- 将当前 `model/activity/...` 投影升级为 item inventory、group 和 revision。
- 保留 adapter 的确定性来源治理。
- 增加 `ContextPlan`、`ContextPromptView` 和 `ContextDecision` contract。

### Phase 2：Mastra Step Processor

状态：已实现。

- 实现 `MastraContextBudgetProcessor.processInputStep()`。
- 把 conversation 最终窗口选择从 API 前置阶段移入 processor。
- 引入 request-scoped `ContextRunState`。

### Phase 3：Token-first Planner

状态：已实现基础能力；精确 tokenizer 和更多 reduction strategy 按后续来源逐步接入。

- 引入 `ModelContextProfileRegistry`。
- 统计 system、tool schema、messages 和 output reserve。
- 实现 atomic-group selection 和 deterministic compaction。
- 增加 `MastraProviderPromptGuardProcessor`。

### Phase 4：Mastra Memory

- 接入 `resourceId + threadId` memory。
- 引入 session summary、working memory 和 recent messages source。
- 实现 memory/live/client history 去重。

### Phase 5：Knowledge

- 加入 retrieval adapter、citation 和 relevance-aware planning。
- 大型 retrieval result 使用 artifact reference。

## 15. 验收标准

- 每个 Mastra ReAct step 都产生一个可审计 `ContextPlan`。
- 工具返回值既经过来源边界治理，也参与下一 step 的全局 prompt 预算。
- 当前 prompt 预算覆盖 system、tool schema、conversation 和 output reserve；Phase 4-5 接入后同样覆盖 memory/knowledge。
- 不因裁剪产生孤立 tool-call/tool-result。
- token 超限时先自适应缩减，只有最小集合仍超限才失败。
- provider-bound prompt 在调用前完成最终硬校验。
- memory 和 knowledge 不可绕过 ContextPackage、adapter 和 policy。
- AG-UI 只持久化标准事件类型，context audit 使用 bounded `CUSTOM` event。

## 16. 图

- 权威上下文交互图：[agent-context-architecture.html](./agent-context-architecture.html)
- 权威五层流水线图：[context-governance-pipeline.svg](./context-governance-pipeline.svg)
