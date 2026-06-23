# Artifact 北向事件与引用化设计

日期：2026-06-22
状态：引用化延期，等待 workspace 集成
关联：[agent-context-management-design.md](./agent-context-management-design.md) §6.1、§9、§10

## 1. 当前决定

在 workspace 集成完成前，暂不实施 artifact 北向引用化和独立 preview REST API。当前 AG-UI 事件继续发送
`ArtifactSummary`，包括已有的 `preview_json`：

```ts
input.emitter.emit(createCustomEvent("artifact", result.artifact));
```

当前边界：

| 路径 | 当前行为 |
| --- | --- |
| AG-UI `CUSTOM(name="artifact")` | 包含 `id`、`type`、`name`、可选 `preview_json` |
| `run_events` | 持久化同一个 AG-UI artifact 事件，包括 preview |
| 模型 tool observation | 不包含 artifact preview，只保留 `artifact_id` |
| Metadata `artifacts` 表 | 保存 artifact metadata 和 `preview_json` |
| Artifact preview/download REST | 暂不提供 |

这是一项临时北向协议取舍，不改变 Agent 上下文和数据工具的安全边界。模型仍不能通过 tool result 自动展开
artifact preview。

## 2. 延期原因

北向引用化需要与 workspace 的 artifact 展示、加载状态、权限上下文和生命周期一起设计。现在先增加独立 REST
端点，会提前固化一套可能与 workspace 不一致的接口，并要求 GUI/TUI 同时维护事件和 REST 两条加载路径。

因此当前阶段保持单事件交付；workspace 接入后统一决定：

- workspace 如何声明和渲染 artifact。
- preview 是随事件推送、按引用读取，还是采用混合模式。
- artifact 加载、刷新、过期和错误状态如何表达。
- GUI/TUI 是否共享同一个 artifact client contract。

## 3. 当前已知代价

- artifact preview 会增加实时事件和 `run_events.payload_json` 的体积。
- replay 会重复读取 preview payload。
- 当前 `preview_json` 只有 SQL limit 等来源约束，尚无统一 `maxBytes` / `maxCellChars` artifact policy。
- 在引用化完成前，不应把 artifact event 当作适合无限扩大内容的通用传输通道。

新增 artifact 类型时，仍应保持 preview 有界，禁止 credential、连接串和其他敏感配置进入事件。

## 4. Workspace 集成后的目标

引用化阶段至少拆分以下 contract：

```ts
type ArtifactReference = {
  id: string;
  type: ArtifactType;
  name: string;
};

type ArtifactDetail = ArtifactReference & {
  preview_json?: unknown;
  session_id: string;
  run_id: string;
  created_at: string;
};
```

目标行为：

1. AG-UI/workspace 事件只携带 `ArtifactReference` 或 workspace 原生 artifact state。
2. 单条 detail 接口按认证用户读取有界 preview。
3. run artifact 列表只返回分页后的 reference，不批量返回 preview。
4. 完整 artifact content 与 preview 分离，使用受控 storage/blob 读取路径。
5. 写入前执行 artifact 专属 `maxRows`、`maxColumns`、`maxCellChars` 和 `maxBytes` policy。

## 5. 实施前置条件

- workspace artifact contract 已确认。
- 服务端认证上下文可提供权威 `user_id`，不接受客户端直接指定租户身份。
- 明确 preview、完整 content 和 storage path 的存储语义。
- GUI/TUI 对引用加载和错误状态达成统一协议。

## 6. 当前验收

- `CUSTOM("artifact")` 包含 `preview_json`。
- model-visible SQL observation 不包含 `artifact` 对象，仅保留 `artifact_id`。
- artifact event 与持久化 replay 使用相同 AG-UI 事件。
- 不新增 artifact preview/download REST 端点。
