# ADR-0001: Agent Context Governance Uses a Fail-Closed Pipeline

日期：2026-06-22
状态：Accepted；工具来源边界已实现，逐 ReAct step 编译见 ADR-0002

## Context

Agent 将逐步增加数据工具、memory 和 knowledge 来源。原始工具返回值直接进入模型会造成上下文溢出、完整 artifact
泄漏和新增工具漏配策略的问题。AG-UI conversation 还必须保留 role、tool call 和 tool result 的协议关系。

## Decision

外部工具结果统一经过来源边界：

```text
ToolObservationAdapter
-> ToolObservationDispatcher
-> ContextBudgetAllocator
-> ContextPolicy
-> ContextPackageBuilder
```

- 工具必须注册 adapter；未注册时返回 `CONTEXT_ADAPTER_REQUIRED`。
- adapter 负责保持来源结构合法并生成有界 sample/preview。
- policy 负责最终 char/token 硬校验。
- model、activity、artifact ref、audit ref 和 truncation 分层输出。
- conversation 不走第二套入口 adapter；它在每个 `processInputStep` 按完整 user turn 治理。
- hidden reasoning 和 AG-UI activity 不进入模型 conversation。

## Alternatives

1. 保留 raw fallback：扩展方便，但漏注册会绕过安全和预算边界，因此拒绝。
2. 每个 tool wrapper 自行裁剪：短期简单，但无法统一 conversation、memory 和 knowledge，因此拒绝。
3. 只依赖 Mastra/model 的上下文限制：无法保证 AG-UI preview、artifact 和审计分层，因此拒绝。

## Consequences

- 新工具必须同时实现并注册 adapter。
- adapter 输出仍需通过统一预算校验，不能自行声明“安全”。
- 不可压缩到合法最小结构的输入会显式失败，不会静默发送原始数据。
- Phase 4 需要在同一 compiler 中加入 summary、memory 和跨 source 去重。

## References

- [ADR-0002: Compile Context for Every Mastra ReAct Step](./adr-0002-context-compile-every-mastra-step.md)
