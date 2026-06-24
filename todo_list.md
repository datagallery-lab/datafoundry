# Open Data Agent Workbench TODO

更新时间：2026-06-24

本文档记录研发 B（Agent / Data Gateway / Knowledge）范围内已确认、但尚未进入当前开发阶段的事项。
优先级和实施顺序仍以项目计划文档为准。

## P0：会话与运行正确性

- [x] 明确并实现会话标识语义：
  - AG-UI `threadId` 映射为内部 `session_id`。
  - AG-UI `runId` 表示一次执行；同一 session 可以包含多个 run。
  - `resourceId` 使用内部 `user_id`，作为 Mastra memory 的租户隔离边界。
- [x] 修复 session ID 的跨用户冲突风险：
  - 数据库主键已改为包含 `user_id` 的复合标识。
  - 禁止其他用户使用相同 `threadId` 更新既有 session。
- [x] 定义重复 `runId` 的幂等策略：
  - 已完成、失败或取消的 run：请求指纹一致时回放已持久化的 AG-UI 事件。
  - 排队或运行中的 run：返回 `RUN_ALREADY_ACTIVE` 冲突。
  - 禁止将重复 run 静默当作新执行。
- [x] 支持并持久化 AG-UI `parentRunId`，用于重试、分支和派生运行。
- [x] Conversation Memory 第一阶段：由服务端按 `user_id + threadId` 管理权威历史，避免完全信任客户端回传历史。
  - task 接入阶段仅启用 thread-state storage：`readOnly=true`、`lastMessages=false`，关闭 semantic/working/observational memory。
  - [x] task thread-state 已接入应用级 LibSQL；conversation history 已由 metadata `conversation_messages` 管理。
  - [x] 正式历史由服务端组装，按 AG-UI message ID 去重，客户端旧 assistant/system/developer 消息不直通模型。
  - [x] `ConversationMemoryService` 已统一 current user 写入、history load、window policy 和 assistant observer。
  - [x] conversation entry window 已有 token-aware 估算裁剪和字符硬上限。
  - [x] `conversation_summaries` 已提供 latest summary 持久化和 tagged context 注入基线。
  - [x] 自动 deterministic summary 生成器和旧轮次替换策略已接入同一条 service/window 通路。
  - [x] 将 deterministic summary generator 升级为可选 LLM/Mastra summarizer。
  - [x] 完成 Mastra Memory 受控接入 Phase 1/2：统一 runtime 抽象，并将 metadata summary shadow mirror 到 WorkingMemory。
  - [x] 启用 read-only WorkingMemory prompt 注入，复用 Mastra memory input processor 消费 summary 投影。
  - [x] 实现 one-source-only prompt 断言，并在 WorkingMemory 消费模式移除重复 tagged summary。
  - [ ] Mastra 升级后复核 `TaskStateProcessor` 的声明/运行时导出不一致并替换临时 context processor。
  - [x] 接入 Mastra memory 时保持 metadata 为权威历史，Mastra memory 只做摘要增强。
  - [x] 建立 metadata-backed 长期记忆源，并通过 ContextPackage 受控注入 prompt。
  - [x] 完成长期记忆自动抽取：只消费 completed run 的自然语言 user/assistant 消息，过滤敏感候选。
  - [x] 建立 memory recall shadow 报告门禁，分开比较长期记忆、Knowledge 和未来 Mastra Semantic Recall。
  - [ ] 批准 Mastra semantic recall 的 vector/embedder 策略后，再填充 shadow 报告并复用长期记忆 source。

## P1：上下文治理

- [x] 将窗口选择从“字符数为主”升级为“token 为主、字符数为快速保护上限”。
- [x] 实现 token 超限时的可扩展自适应缩减基线：
  - 优先保留系统指令、当前用户轮次和正在执行的 tool-call/tool-result 配对。
  - 按完整轮次从旧到新淘汰，避免破坏消息结构。
  - strategy registry 和 candidate selector 均可替换，不固化后续压缩顺序。
  - 无合法候选或最小集合仍超限时返回明确错误。
- [x] 实现 `MastraContextBudgetProcessor`，通过 `processInputStep` 治理每一次 ReAct 循环的完整消息集合。
- [x] 完成 ContextPackage 与 Mastra 每一步 prompt 组装联动的整体设计、类图、时序图和状态图。
- [x] 实现 `MastraProviderPromptGuardProcessor` 作为 provider 调用前硬兜底，不在边界静默裁剪。
- [x] 在模型调用边界记录最终 prompt token 指标，并验证每一步均未超过模型上下文限制。
- [x] 完成 context 分层、命名和 public API 收口：`inventory/source/tool-observation/policy/projection/protocol`
  分层落地，应用层不再直接依赖 tool-observation adapter 或 runtime source 内部 seam。
- [ ] 增加 session summary 替换、结构化 tool result、knowledge chunk 和 artifact 降级等 reduction strategy。
- [x] 接入 Mastra read-only WorkingMemory 消费会话摘要投影。
- [x] 实现本地长期记忆召回：`user/session/datasource` scope、相关性检索、ContextPackage source 标记。
- [x] 实现长期记忆写入：LLM 抽取、deterministic fallback、metadata upsert 和审计事件。
- [x] 实现 semantic recall shadow 报告骨架，当前明确标记 Mastra Semantic Recall 为 `not_configured`。
- [ ] 接入 Mastra memory 后继续实现真实 Mastra semantic recall shadow、OM shadow 和超长轮次压缩。
- [ ] 核对 AG-UI 到 Mastra 的消息转换规则；当前适配层可能忽略客户端传入的 system/developer 消息。
- [ ] 在权威 conversation persistence 层为所有消息分配稳定 ID，逐步取消匿名 fingerprint fallback。
- [ ] 按 `toolCallId` 验证 tool-call/tool-result 的配对、来源、重复结果和孤立消息。

## P2：延期治理项

- [ ] workspace 集成后重新设计 artifact 北向协议，再实施事件引用化、分页 detail API 和完整内容存储。
- [ ] 对超长 tool-call arguments 建立独立预算、截断和 artifact 引用策略。
- [ ] 将图片、Base64 和其他二进制消息 artifact 化，消息中只保留受控引用和元数据。
- [ ] 扩展模型 tokenizer/context-window profile，并在启动阶段预热已有 tokenizer cache。
- [ ] 对大型 schema、查询结果和知识检索结果统一采用摘要、分页和 artifact 引用。

## P3：可观测性与回放

- [ ] 建立 session/run 查询接口，支持按用户和会话查看历史 run。
- [x] 上下文缩减和 provider token 预算通过 bounded AG-UI `CUSTOM` 事件持久化。
- [ ] 增加重复请求和未来摘要生成的服务端指标/审计事件。
- [x] 验证终态 run 的持久化 AG-UI 事件可以按原顺序回放，不依赖运行时内存状态。
- [ ] 将新增架构图统一改用浅色 HTML/手绘卡通风格；历史 PlantUML 图后续逐步迁移，不再新增 PlantUML 图。
