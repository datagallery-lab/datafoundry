# ADR-0002: Compile Context for Every Mastra ReAct Step

日期：2026-06-22
状态：Accepted / Phase 1-3 Implemented

## Context

早期 conversation 只在 `MastraAgent.run()` 前治理一次，工具返回值则由各自 adapter 单独压缩。Mastra 在每个
ReAct step 会追加 tool-call、tool-result，并重新组合 system messages、history 和 tools。只做 run 前窗口或
tool-local 裁剪无法保证最终 provider prompt 的总预算，也无法统一 memory 和 knowledge。

## Decision

引入基于 Mastra `Processor.processInputStep()` 的 Step Context Compiler：

- `ContextPackage` 保存 run 内完整的规范化 context inventory。
- 每个 step 根据完整 `messages/systemMessages/tools` 生成不可变 `ContextPlan`。
- 根据 plan 物化仅供当前模型调用的 `ContextPromptView`。
- `processLLMRequest()` 只执行 provider-bound prompt 的最终统计和硬校验。
- 工具结果先经过 `ToolObservationAdapter`，再进入下一 step 的全局规划。
- session summary 在 memory maintenance 阶段生成，不在 processor 内递归调用 LLM。

## Consequences

### Positive

- 每个模型调用都共享相同的安全、预算和审计边界。
- conversation、tool result、memory 和 knowledge 可以统一竞争全局预算。
- 可保持完整 turn 和 tool exchange，不依赖无语义的字符串裁剪。
- ContextPlan 可以测试、审计和回放。

### Negative / Remaining Work

- 每个 step 增加 token 统计和规划开销。
- 需要维护 model context profile 和 tokenizer quality。
- 精确 tokenizer、Memory、Knowledge 和更多 reduction strategy 尚待接入。

### Neutral

- Mastra memory 仍是上下文来源，不是数据安全边界。
- Mastra `TokenLimiterProcessor` 只保留为可选 emergency guard。

## Alternatives Considered

### 只在 API 入口裁剪一次

实现简单，但看不到后续 tool result 和 Mastra 实际 system/tool schema，拒绝。

### 继续由每个工具独立裁剪

可以限制单个 observation，但无法处理整次 prompt 的跨来源预算，拒绝。

### 只使用 Mastra TokenLimiterProcessor

缺少 artifact、audit、atomic tool exchange 和来源优先级语义，不能承担业务上下文治理，拒绝。

## References

- [Agent Context Compilation Design](./agent-context-management-design.md)
- [ADR-0001](./adr-0001-context-governance-fail-closed.md)
