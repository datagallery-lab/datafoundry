# Context Turn Grouping 统一设计

日期：2026-06-22
状态：已实施
关联：[agent-context-management-design.md](./agent-context-management-design.md) §4.4、§13.1

## 1. 结论

Phase 1-3 初版曾有两套 conversation turn 分组实现：

- `MastraContextBudgetProcessor.createLiveContextItems`
- `ContextStepPlanner.createPromptGroups`

两者曾共享 `isConversationTurnStart`，但分别生成 group ID、fallback message ID 和 retention/mandatory，导致无显式
message ID 时，`ContextPlan.selectedGroupIds` / `omittedGroupIds` 不能稳定映射回 `ContextPackage.items`。

目标是在 `context/protocol/mastra/mastra-message-utils.ts` 中提供唯一的 conversation 分组入口 `groupMessagesByTurn`，processor 和 planner
只消费分组结果，不再自行推导 turn 边界或当前轮。

## 2. 职责边界

`groupMessagesByTurn` 只处理 `MastraDBMessage[]` conversation trajectory：

- user、assistant 和 tool observation 的 turn 边界。
- conversation message identity。
- 当前 turn、mandatory 和 retention。

它不处理：

- system instructions：由 system source 创建 mandatory group，并作为固定成本计入预算。
- memory summary：由 `RuntimeContextSource` 创建独立 source group。
- knowledge chunks：由 `ToolObservationAdapter` 或未来 Knowledge `RuntimeContextSource` 创建 retrieval result group。
- tool-call/tool-result 合法性：由单独的 protocol validator 按 `toolCallId` 验证。

通用扩展点是 `ContextItem` / `ContextGroup` / reduction strategy，不是把所有来源都转换成 conversation turn。

## 3. 当前问题

### 3.1 Group ID 不一致

Processor 的 fallback 是 `index-${index}`，planner 是 `${index}-${contentHash}`。同一条无 ID 消息会得到不同的
item/group identity，审计决策无法精确映射 inventory。

### 3.2 当前轮语义重复

Processor 按最后一个自然 user 消息的 index 标记 active，planner 把最后一个 group 标记 mandatory。正常
user turn 下结果等价，但完全没有 user 消息时：

- Processor 只把最后一条消息标为 active，同一个 orphan group 内出现混合 retention。
- Planner 把整个 orphan group 标为 mandatory。

### 3.3 原子性边界

当前按自然 user 消息开启新 turn，因此同一 ReAct trajectory 中的 assistant tool-call 和后续 tool-result 会留在
同一 turn，缩减时不会拆开。但“同组”不等于“配对合法”：孤立、重复或伪造 tool-result 仍需独立验证。

## 4. 目标 Contract

```ts
export type GroupedConversationMessage = {
  id: string;
  index: number;
  message: MastraDBMessage;
};

export type ConversationTurnGroup = {
  id: string;
  kind: "turn";
  order: number;
  isCurrent: boolean;
  mandatory: boolean;
  retention: "active" | "historical";
  members: GroupedConversationMessage[];
};

export const groupMessagesByTurn = (messages: MastraDBMessage[]): ConversationTurnGroup[];
```

### 4.1 Message identity

1. 有非空 `message.id`：直接使用。
2. 无 ID：生成 `anonymous-${hash(role + content)}-${occurrence}`。
3. `occurrence` 是当前 trajectory 内相同 fingerprint 的出现序号，不使用全局数组 index。

该 fallback 对正常的 append-only ReAct trajectory 稳定，也能区分同一 trajectory 中内容完全相同的消息。若客户端
在历史中间插入完全相同且无 ID 的消息，身份本身不可判定；权威长期历史接入后应在 ingress/persistence 层为消息
分配正式 ID，fallback 只作为防御性兼容。

### 4.2 Turn 分组

- 第一条消息创建一个 group。
- `isConversationTurnStart(message)` 为 true 时开启新 group。
- 其他 assistant/tool observation 追加到当前 group。
- group ID 使用首个 member identity：`turn-${member.id}`。
- 最后一个 group 是 current、mandatory、active；其余 group 是 historical、非 mandatory。
- 空消息数组返回空 groups。
- 完全没有自然 user 消息时，整个 orphan trajectory 是一个 current mandatory group。

因此，在已经存在 user turn 时，尾部 assistant 消息不会形成独立 assistant-only group；它始终追加到最后一个
user turn。独立 assistant-only group 只可能是第一条 user 出现前的 historical orphan，或完全没有 user 时的
current orphan。算法不会创建空 group。

## 5. 消费方

### 5.1 MastraContextBudgetProcessor

- system items 继续单独构建，不进入 `groupMessagesByTurn`。
- conversation items 从 `ConversationTurnGroup.members` 生成。
- `id`、`sourceId`、`groupId`、retention 和 priority 均来自统一分组结果。
- tool observation 仍使用独立 `sourceType`，但不改变所属 turn。

### 5.2 ContextStepPlanner

- 使用同一分组结果构建 `PromptMessageGroup`。
- 只追加 `tokenCost`，不再定义 group identity、mandatory 或 retention。
- reduction strategy 和 candidate selector 不变。

## 6. 不变量

- Processor inventory 和 planner 对同一 trajectory 产生完全相同的 conversation group ID。
- 当前 turn 永远 mandatory，历史 turn 才可由默认策略移除。
- 同一 turn 作为最小选择单位，不产生被单独删除的 tool-result。
- system、memory、knowledge 不依赖 conversation 分组器。
- fallback identity 不依赖消息在整个数组中的绝对 index。

## 7. 验证

- 显式 ID 和无 ID 消息的 group ID 对齐。
- 相同无 ID 消息在同一 trajectory 中仍有不同 identity。
- 前置无 ID 消息不会改变后续不同内容消息的 identity。
- 无 user 的 orphan trajectory 整体 mandatory。
- user -> assistant tool-call -> tool-result 位于同一 group。
- 历史 turn 被缩减时当前 tool exchange 保留。
- 全量 build、Agent、context compilation 和 CopilotKit context smoke 通过。

## 8. 延后事项

- 按 `toolCallId` 验证 tool-call/tool-result 配对、来源和重复结果。
- 在权威 conversation persistence 层强制分配 message ID。
- memory/knowledge 接入后的跨来源 dedup 和 group dependency。
