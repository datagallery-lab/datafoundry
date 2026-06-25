# 对话框文件上传 — 设计规格

> 日期：2026-06-24
> 范围：`apps/web`（`/data-tasks` 对话框），并提出 `apps/api` 后端能力需求 #13。
> 状态：待用户审阅

## 1. 目标与背景

`/data-tasks` 对话框需要支持上传文件，覆盖两类用途：

1. **图片**（png/jpg/webp/gif）：喂给多模态 LLM 直接"看"。
2. **数据/文本文件**（csv/tsv/xlsx/json/parquet/txt/pdf）：作为数据让 Agent 分析，
   文件需落到后端 session 工作区供文件工具读取。

单文件上限 **20MB**。

### 现状边界（已核实）

- 中间栏使用 CopilotKit v2 `<CopilotChat>`，输入框是完全自定义的
  `DataTaskChatInput`（通过 `input={ChatInput}` 注入）。
- CopilotKit v2 内置附件能力：`<CopilotChat attachments={AttachmentsConfig}>`
  与 `useAttachments` hook。但自定义输入的 children 插槽（`CopilotChatInputSlots`：
  `textArea/sendButton/addMenuButton/...`）**不含**附件 slot，因此 `<CopilotChat
  attachments>` 不会自动在我们的自定义输入里渲染附件 UI。必须按官方"自定义输入面"
  用法用 `useAttachments` 直接接管。
- 后端 `apps/api/src/upload-parser.ts` 仅服务 **Skill 配置**的 multipart 上传
  （SKILL.md / zip），与对话框无关。
- 后端 `run-input.ts:extractLastUserText` 只提取 `type:"text"` 的 content part，
  **忽略**图片/文件 part。图片内联能否真正喂给模型，取决于 `@ag-ui/mastra` 透传
  与模型是否多模态，**当前未验证**。
- 后端**没有**任何"对话框文件上传"接口；数据文件目前无法落到 session 工作区。

### 设计原则（遵循 `apps/web/DESIGN.md`「先行 UX，诚实标注」）

- 前端可先于后端实现完整交互；
- 任何后端尚不能兑现的效果，必须以「后端未支持」明确标注，且**不假装能用**；
- 只传 forward-compatible 的引用（path/url/ids），不传明文密钥，不把 20MB base64
  塞进 AG-UI 流。

## 2. 模态分流

| 模态 | 上传策略 | 进入 run 的形式 | 门控能力位 |
| --- | --- | --- | --- |
| 图片 png/jpg/webp/gif | 默认 base64 内联（`useAttachments` 默认策略） | message `InputContent`（`type:"image"`，含 `metadata.filename`） | `chat.imageInput` |
| 数据/文本 csv/tsv/xlsx/json/parquet/txt/pdf | `onUpload` → `POST /api/v1/chat/uploads`（multipart），返回 `{ url/path, mimeType, size }` | message `type:"file"` 引用 part + `run_config.attachments[]` 引用清单 | `chat.fileUpload` |

两类都先做完整前端 UI。能力位为 false 时按 §5 处理。

## 3. 前端组件与接入点

### 3.1 `useAttachments` 接入 `DataTaskChatInputLayout`

文件：`apps/web/src/app/data-tasks/components/chat/DataTaskChatInput.tsx`

- 在 `DataTaskChatInputLayout` 内调用 `useAttachments({ config })`，config 由绑定下放
  （见 §3.4）。
- `containerRef` 与现有 `columnRef`（mention + autoresize）合并到同一 callback ref，
  启用粘贴（clipboard）作用域。
- `handleDragOver / handleDragLeave / handleDrop` 挂到输入卡片外层容器；拖拽进入时
  显示高亮遮罩层（`dragOver` 状态）。
- 隐藏 `<input type="file" multiple ref={fileInputRef} accept={...}>`；通过附件按钮
  触发 `fileInputRef.current?.click()`。

### 3.2 附件按钮

- 复用 `SessionConfigBar` 的 `leading` 区，将"回形针"附件按钮与现有 `addMenuButton`
  并列（同样的 7×7 grid 容器样式）。
- `accept` 由允许的 MIME/扩展名列表生成。

### 3.3 `AttachmentChips` 组件

文件：新增 `apps/web/src/app/data-tasks/components/chat/AttachmentChips.tsx`

- 渲染位置：textarea 上方，与 `MentionChips` 同区（`mode === "input"` 时）。
- 每个 chip 显示：类型图标（image/sheet/doc/file 区分）、文件名（截断）、大小、
  状态徽标（`uploading` 转圈 / `ready` / `failed` 红字）、移除按钮（调用
  `removeAttachment(id)`）。
- 失败态显示 `onUploadFailed` 给出的原因（file-too-large / invalid-type /
  upload-failed）。
- 当该附件模态能力位为 false：chip 追加「后端未支持」徽标 + tooltip
  「后端接入后将随消息发送」。
- 视觉沿用 `ui-tokens.ts` 语义 token，不硬编码颜色。

### 3.4 绑定下放（`DataTaskChatInputBindingsContext`）

文件：`apps/web/src/app/data-tasks/components/chat/DataTaskChatInputBindingsContext.tsx`
与 `page.tsx`

- 在 `DataTaskChatInputBindings` 增加附件相关字段：附件配置（accept/maxSize/onUpload/
  onUploadFailed）与能力位（`imageInputSupported` / `fileUploadSupported`），保持
  `page.tsx` 为单一数据源（与现有 llm/mention 绑定一致）。
- 提交注入逻辑（§4）放在 `page.tsx` 的 `StableDataTaskChatInput` / 绑定层，复用现有
  `onClearPerRunMentions` 的"发送后清理"模式。

## 4. 提交流程（关键）

当前提交路径：`CopilotChatInput` 内部 → `onSubmitMessage(value: string)`，仅传文本。

- **无附件**：保持现有 `onSubmitMessage` 原路径完全不变（零回归）。
- **有附件**：拦截提交，按官方"自定义输入面"模式手动发起 run：
  1. `const ready = consumeAttachments();`（同时清空内部队列）
  2. 构造 `InputContent[]`：先 `{ type:"text", text }`，再把 `ready` 中**能力位允许的**
     附件映射为 `{ type, source, metadata:{ filename, ...} }`；能力位为 false 的附件
     **不进入** content（不假装发送）。
  3. `agent.addMessage({ id: crypto.randomUUID(), role:"user", content })`
  4. `await copilotkit.runAgent({ agent })`
  5. 清空 textarea、mention chips、附件 chips。
- `agent` / `copilotkit` 通过 `useAgent({ agentId })` / `useCopilotKit()` 获取
  （v2 已导出）。需与当前 `agentId` + `threadId` 对齐，避免发到错误线程。

## 5. 能力位门控（诚实标注）

文件：`apps/web/src/lib/config-api/capabilities.ts` 与 `types.ts` / `adapter.ts`

- 新增两个 backend 能力位（默认 `false`），由 `GET /api/v1/capabilities` 下发：
  - `chat.imageInput`：后端能在 run 中消费图片 part 并交给多模态 LLM。
  - `chat.fileUpload`：`POST /api/v1/chat/uploads` 端点可用且文件落 session 工作区。
- 前端行为：
  - 附件按钮、选文件、预览、移除、拖拽、粘贴**始终可用**（纯前端）。
  - 能力位为 false 时：对应模态的附件 chip 标注「后端未支持」；发送时该附件**不进入**
    outgoing message（§4 步骤 2）。文本照常发送。
  - 能力位为 true 时：图片走内联、数据文件走 `onUpload`，附件真实进入 run。
- 不传明文密钥；数据文件走引用而非内联大 base64。

## 6. 后端能力需求（已落档）

> 已写入：[对后端的能力要求 R-007](../../engineering/2026-06-25-backend-requirements.md#r-007-对话框文件上传)；
> 前端现状见 [前端能力现状](../../engineering/2026-06-25-frontend-capability-status.md)。

### #13a 对话框多模态图片消费

- 后端 run 入口解析 user message `content` 中的 `type:"image"` part，转交多模态 LLM；
  在 `extractLastUserText` 之外新增图片提取/转译。
- run 完成路径不变；下发 `capabilities.chat.imageInput = true`。
- 验收：上传一张图片提问，run 中 LLM 能据图作答（`run_events` 可验证图片进入了
  模型输入）。

### #13b 对话框文件上传端点

- 新增 `POST /api/v1/chat/uploads`（multipart，复用 `upload-parser` 思路与大小/类型
  限制），把文件写入 **session 工作区**（`{root}/{user_id}/{session_id}/uploads/`，
  依赖能力 #12 session 级工作区），返回 `{ path, mimeType, size }`。
- run 时 agent 文件工具（`read_file` / `list_files` 等）可读该路径。
- 安全：校验 `(user_id, session_id)`、禁 `..` 逃逸、限大小/类型；仅本 session 可见。
- 下发 `capabilities.chat.fileUpload = true`。
- 验收：上传一个 CSV，下一条消息里 Agent 能 `read_file` 读到并分析。

> 依赖：#13b 强依赖 #12（session 级工作区）；在 #12 落地前 `chat.fileUpload` 保持
> false，前端数据文件附件保持「后端未支持」。

## 7. 测试

文件：`apps/web/src/app/data-tasks/__tests__/`

- `chat-attachments.test.ts`（新增）：
  - 附件 → `InputContent` 映射（image/file 各一）。
  - 能力位门控：false 时附件被剔除、不进入 content；true 时进入。
  - 文件类型/大小校验分类（超限、类型不符）。
  - 提交分支：无附件走原 `onSubmitMessage`，有附件走 addMessage+runAgent。
- 复用 `npm run test:web` + `npm run build:web` 验证。

## 8. 文档维护

- 更新 `apps/web/src/app/data-tasks/DESIGN.md`：新增「对话框附件上传」小节
  （模态分流、能力位门控、提交流程）。
- 更新 `docs/engineering/2026-06-25-backend-requirements.md`：R-007（原能力清单 #13）。

## 9. 非目标（YAGNI）

- 不实现后端 `/api/v1/chat/uploads` 端点与图片消费（仅写需求，归 `apps/api`）。
- 不做附件的服务端持久化/历史回放 UI。
- 不做音频/视频附件（CopilotKit 支持，但本次范围外）。
- 不改 CopilotKit 发 run 的 `threadId`/`runId` 语义。
