# Conversation Memory 设计与实现

日期：2026-06-23

架构图：[PlantUML](./conversation-memory-architecture.puml) /
[SVG](./conversation-memory-architecture.svg)

## 1. 目标

Conversation Memory 的第一阶段目标是把“对话历史所有权”从客户端回传迁到服务端：

- AG-UI `threadId` 仍映射为内部 `session_id`。
- AG-UI `runId` 仍表示一次执行，同一个 session 可以包含多个 run。
- 服务端按 `user_id + session_id` 持久化可复用自然语言消息。
- 新 run 进入 Mastra 前，由服务端组装“最近历史 + 当前 user message”。
- 客户端传来的旧 assistant/system/developer/activity/reasoning 消息不再直接进入模型上下文。

这不是 Knowledge/RAG，也不是 `run_events` 的替代品。

## 2. 边界

| 能力 | 职责 |
| --- | --- |
| `run_events` | 完整持久化 AG-UI event stream，用于回放和审计运行轨迹。 |
| `conversation_messages` | 持久化可进入模型上下文的 user/assistant 自然语言消息。 |
| `conversation_summaries` | 持久化覆盖一段 message position 的会话摘要。 |
| `MastraContextBudgetProcessor` | 治理每一步 Mastra prompt，包括 token budget、turn selection、tool result 降级。 |
| `taskStateRuntime` | Mastra task thread-state slice，只保存当前任务列表，不保存会话历史。 |
| Knowledge | 用户上传/配置资料的检索边界，不保存聊天历史。 |

当前阶段不让 Mastra 原生 `Memory` 接管 conversation history。Mastra 提供 `MessageHistory`、`WorkingMemory`、
`SemanticRecall` 和 `Observational Memory` 等原生 memory/processor 能力，也提供 `Agent.generate()` 这样的
原生模型调用入口；但这些能力的存储和 thread 语义不是我们当前的权威 `conversation_messages` /
`conversation_summaries` schema。后续接入 Mastra memory 时，metadata 仍是 session/run/message 的权威事实源，
Mastra memory 只做摘要、working memory 或 semantic recall 增强。

## 3. 当前实现

### 3.1 Metadata

新增表：

```text
conversation_messages
  id
  user_id
  session_id
  run_id
  role            user | assistant
  source          client | agent
  message_id      AG-UI/client message id
  content_json
  content_text
  content_hash
  position
  created_at
```

摘要表：

```text
conversation_summaries
  id
  user_id
  session_id
  source_run_id
  from_position
  to_position
  summary_text
  summary_hash
  created_at
```

去重策略：

- 有 `message_id` 时，按 `user_id + session_id + message_id` 去重。
- 没有 `message_id` 时，只在同一 run 内按 `role + content_hash` 去重。
- 不跨 run 按纯文本去重，避免用户故意重复提问时丢消息。

### 3.2 API runtime

新 run 的消息组装流程：

```text
RunAgentInput
  -> claim run
  -> persist current user message
  -> load conversation_messages by user_id + session_id
  -> build messages = recent persisted history + current user message
  -> createDataFoundry(messages)
  -> @ag-ui/mastra
```

`ConversationMemoryService` 是唯一生产入口，负责：

- 写入当前 user message。
- 加载 `user_id + session_id` 下的最近历史。
- 加载 latest session summary。
- 应用 `ConversationMemoryWindowPolicy`，生成模型入参消息。
- 创建 `ConversationMemoryEventObserver`，在 `RUN_FINISHED` 时写入 assistant 文本。

默认窗口策略：

| 策略项 | 默认值 | 说明 |
| --- | --- | --- |
| `historyLoadLimit` | 96 | 从 metadata 预取的最大历史消息数。 |
| `maxHistoryMessages` | 24 | 可进入模型入参的最大历史消息数。 |
| `maxHistoryTokens` | 6000 | history + current user 的估算 token 上限。 |
| `maxMessageChars` | 6000 | 单条 conversation message 字符硬上限。 |
| `maxTotalChars` | 24000 | 本次入口 conversation window 字符硬上限。 |
| `summaryTriggerMessages` | 18 | 未摘要消息达到该数量后触发自动摘要。 |
| `summaryKeepRecentMessages` | 8 | 自动摘要时保留为原文的最近消息数。 |
| `summaryMaxChars` | 2000 | 自动 summary 的最大字符数。 |

token 估算使用现有 `ContextTokenCounter.countTokensSync`。如果 tokenizer 未缓存，则使用同步估算，不阻塞请求下载。
当前 user message 是 mandatory：预算过小时仍保留当前 user，历史从旧到新被淘汰。

summary 作为服务端生成的 trusted context block 进入入口消息：

```text
<conversation_summary from_position="1" to_position="40">
...
</conversation_summary>
```

当前 `@ag-ui/mastra` 对 system/developer 历史的转换不稳定，因此 summary 暂以服务端生成的 `user` message 注入，
但 message id 使用 `memory-summary:*`，内容用标签标明其来源和覆盖范围。summary 不写入 `conversation_messages`，
也不作为普通 assistant 回复处理。

replacement 策略复用同一条 `ConversationMemoryService` 通路：当 latest summary 覆盖到 `to_position=N` 时，
入口 history 候选只保留 `position > N` 的原始消息。这样 summary 和已摘要原文不会同时进入模型上下文。

自动 summary 生成挂在 `ConversationMemoryEventObserver.flushCompleted()` 之后，并且复用同一条
`ConversationMemoryService` / replacement 通路：

- 只基于 `conversation_messages` 和 latest summary 生成。
- 不读取 hidden thought，不读取 tool result，不读取 artifact 内容。
- 未摘要消息达到 `summaryTriggerMessages` 后触发。
- 生成时保留最近 `summaryKeepRecentMessages` 条原文，其余合并进 `conversation_summaries`。
- `ConversationSummarizer` 是可插拔接口；默认实现是 deterministic fallback。
- 生产 runtime 注入 `MastraConversationSummarizer`，内部使用 `@mastra/core/agent` 的 `Agent.generate()` 生成摘要。
- Mastra summary 生成失败或返回空文本时，不影响主 run 完成，自动降级为 deterministic summary。
- 无论 summarizer 类型如何，最终都写回同一张 `conversation_summaries` 表。

这意味着 Mastra 在当前阶段承担“原生模型调用执行器”的角色，而不是 conversation memory 的权威持久化层。

Mastra Memory 已完成受控接入 Phase 1-3：

- `AgentMemoryRuntime` 复用现有应用级 LibSQL storage，但默认仍保持 `lastMessages=false`、`semanticRecall=false`、
  `observationalMemory=false`。
- `ConversationMemoryBridge` 在 metadata summary 提交成功后，把 latest summary 单向 mirror 到 Mastra
  WorkingMemory。
- API server 当前默认 `MASTRA_CONVERSATION_MEMORY_MODE=working-memory-readonly`，在非 resume run 开始前把 latest
  summary backfill 到 Mastra WorkingMemory，然后让 Mastra 自己的 memory input processor 以 read-only system
  context 注入。
- 在 `working-memory-readonly` 中，`ConversationMemoryService` 仍负责过滤已被 latest summary 覆盖的原始历史，
  但不再生成 `memory-summary:*` tagged user message。`off` / `shadow` 模式才继续使用 tagged summary 作为入口
  compact history。
- `assertCompactMemoryPromptBoundary()` 作为 provider 边界断言，防止 WorkingMemory 模式下再次出现 tagged summary，
  保证 compact memory 在 prompt 中只有一个来源。
- 本阶段仍不启用 Mastra MessageHistory、Semantic Recall 或 Observational Memory。

长期记忆第一阶段已经接入为独立受控来源：

- `metadata.long_term_memories` 保存跨窗口可复用的长期事实，当前支持 `user`、`session`、`datasource` 三种 scope。
- API 在新 run 创建 DataFoundry 前，用当前 user input、session 和 datasource 做本地相关性检索，最多取 6 条。
- `LongTermMemoryContextSource` 通过 Mastra `MastraContextRuntimeSourceProcessor` 把检索结果写入 `ContextRunState` inventory，
  再由 `ContextStepPlanner` / `ContextPromptMaterializer` 生成 `context:long-term-memory` prompt view message。
- 长期记忆以 `sourceType=long-term-memory`、`trust=memory`、`retention=supporting` 进入 ContextPackage，因此和普通历史一样接受 token budget、source policy 和 provider prompt guard 治理。
- `RUN_FINISHED` 后，长期记忆抽取器只读取本轮已持久化的 user/assistant 自然语言消息；不读取 hidden thought、
  tool result、SQL 原始结果或 artifact 原文。
- 生产默认使用 `MastraLongTermMemoryExtractor` 做 LLM 抽取，失败或无候选时降级到
  `DeterministicLongTermMemoryExtractor`。候选会经过 scope、长度和敏感字段过滤后才写入 metadata。
- 成功写入时持久化 `memory.long-term.extracted` AG-UI `CUSTOM` 审计事件，只包含 count 和 memory ids，不包含记忆正文。
- 这条通路不是 Mastra Semantic Recall。Semantic Recall 后续只能作为 shadow 候选来源，确认质量和预算策略后，
  再转换成同一类 ContextPackage source 进入 prompt。
- `smoke:memory-recall-shadow` 已固定 shadow 报告结构：本地长期记忆、Knowledge 和未来 Mastra Semantic Recall 分开
  比较。当前 Mastra Semantic Recall 明确为 `not_configured`，直到 vector/embedder 策略被批准。

resume suspended run 暂时保持原链路，不重组历史，避免破坏 human-in-the-loop 恢复上下文。

run request fingerprint 也按这个所有权模型收敛：只把最新 user content 放入 `messages` 指纹，不把客户端
回传的旧历史纳入幂等判断。当前 user content、run identity、tools、context、state、forwarded props 和
effective run config 仍然参与指纹。

### 3.3 Assistant 写入

`ConversationMemoryEventObserver` 观察 AG-UI `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_CHUNK`：

- 只收集 `role=assistant` 的文本。
- `RUN_FINISHED` 完成分支 flush 到 `conversation_messages`。
- suspended/canceled/error 不把未完成 assistant 文本写入 conversation memory。

## 4. 不变的北向协议

本阶段不新增 CopilotKit/AG-UI event 类型，不改 `/api/copilotkit` 请求/响应协议。

前端仍然可以传 `threadId`、`runId`、`messages`，但后端只把本次最新 user 文本作为当前输入。历史由服务端
`conversation_summaries` 和 `conversation_messages` 提供。

## 5. 后续阶段

- 将超长多模态消息 artifact 化，conversation memory 只保留引用。
- 继续评估 semantic recall / observational memory，但必须先复用长期记忆的 ContextPackage source 形态和预算策略，
  且不接管 metadata 的权威历史。
- 增加 session/run 查询 REST，供 GUI/TUI 查看历史。
- 对 tool-call/tool-result pairing 做独立一致性校验，不把工具结果直接放入 conversation memory。
