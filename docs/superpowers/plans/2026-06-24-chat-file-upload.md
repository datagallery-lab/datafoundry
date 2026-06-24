# 对话框文件上传 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 `/data-tasks` 对话框支持上传文件——图片走 AG-UI 多模态内联、数据/文本文件走后端上传端点，统一由 `useAttachments` 接管自定义输入，并以能力位诚实门控「后端未支持」。

**架构：** 在 `lib/config-api` + `data-task-state` 增加 `chat.imageInput` / `chat.fileUpload` 两个能力位；新增纯函数模块 `chat-attachments.ts` 负责附件分类、`onUpload` 策略、附件→`InputContent` 映射与可发送过滤；在 `StableDataTaskChatInput`（page 层）调用 `useAttachments` + `useAgent` + `useCopilotKit`，把附件控制器下传到 `DataTaskChatInput` 布局渲染 chips/按钮/拖拽区，并在有附件时拦截提交改走 `agent.addMessage` + `copilotkit.runAgent`。后端能力仅写需求（已落 #13 / O-007），本计划不实现后端。

**技术栈：** Next.js + React + TypeScript，CopilotKit v2（`@copilotkit/react-core/v2`、`@copilotkit/shared`），Vitest，Tailwind v4 语义 token。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/lib/config-api/types.ts`（修改） | `BackendCapabilitiesResponse` 增加 `chat.imageInput` / `chat.fileUpload` 字段 |
| `apps/web/src/lib/config-api/capabilities.ts`（修改） | 默认值 + `applyBackendCapabilities` 映射新能力位 |
| `apps/web/src/app/data-tasks/data-task-state.ts`（修改） | `BackendCapability` 联合类型 + `BACKEND_CAPABILITIES` 默认值新增两项 |
| `apps/web/src/app/data-tasks/components/chat/chat-attachments.ts`（创建） | 纯函数：附件分类、`onUpload` 策略工厂、`attachmentToInputContent`、`filterSendableAttachments`、`buildAttachmentsConfig` |
| `apps/web/src/app/data-tasks/components/chat/AttachmentChips.tsx`（创建） | 渲染附件 chips（图标/名/大小/状态/移除/「后端未支持」徽标）+ 拖拽遮罩 |
| `apps/web/src/app/data-tasks/components/chat/DataTaskChatInput.tsx`（修改） | 接收附件控制器，挂 containerRef/drag、渲染 chips 与附件按钮 |
| `apps/web/src/app/data-tasks/components/chat/DataTaskChatInputBindingsContext.tsx`（修改） | bindings 增加 `agentId` / `activeThreadId` |
| `apps/web/src/app/data-tasks/page.tsx`（修改） | `StableDataTaskChatInput` 调用 `useAttachments`/`useAgent`/`useCopilotKit`，拦截提交；bindings 注入 `agentId`/`activeThreadId` |
| `apps/web/src/app/data-tasks/__tests__/chat-attachments.test.ts`（创建） | `chat-attachments.ts` 纯函数单测 |
| `apps/web/src/app/data-tasks/__tests__/chat-capabilities.test.ts`（创建） | 能力位映射 + 门控单测 |
| `apps/web/src/app/data-tasks/DESIGN.md`（修改） | 新增「对话框附件上传」小节 |

---

## 任务 1：能力位 — 类型与映射

**文件：**
- 修改：`apps/web/src/lib/config-api/types.ts:37-45`
- 修改：`apps/web/src/lib/config-api/capabilities.ts:9-14`、`:30-45`
- 修改：`apps/web/src/app/data-tasks/data-task-state.ts:557-568`
- 测试：`apps/web/src/app/data-tasks/__tests__/chat-capabilities.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/web/src/app/data-tasks/__tests__/chat-capabilities.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  applyBackendCapabilities,
  resetCapabilitiesForTests,
} from "../../../lib/config-api/capabilities";

describe("chat attachment capabilities", () => {
  it("defaults chat.imageInput and chat.fileUpload to false", () => {
    resetCapabilitiesForTests();
    const mapped = applyBackendCapabilities({});
    expect(mapped["chat.imageInput"]).toBe(false);
    expect(mapped["chat.fileUpload"]).toBe(false);
  });

  it("maps backend response flags through", () => {
    const mapped = applyBackendCapabilities({
      "chat.imageInput": true,
      "chat.fileUpload": true,
    });
    expect(mapped["chat.imageInput"]).toBe(true);
    expect(mapped["chat.fileUpload"]).toBe(true);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:web -- chat-capabilities`
预期：FAIL（`chat.imageInput` 不在 `BackendCapability` 类型 / 返回 `undefined`）

- [ ] **步骤 3：修改类型与映射**

`apps/web/src/lib/config-api/types.ts` 的 `BackendCapabilitiesResponse` 增加两字段：

```ts
export type BackendCapabilitiesResponse = {
  "artifact.export"?: boolean;
  "chat.fileUpload"?: boolean;
  "chat.imageInput"?: boolean;
  "datasource.queryPolicy"?: boolean;
  "datasource.server"?: boolean;
  "llm.samplingParams"?: boolean;
  knowledge?: boolean;
  mcp?: boolean;
  skills?: boolean;
};
```

`apps/web/src/app/data-tasks/data-task-state.ts` 的 `BackendCapability` 与默认表
（注意保留原有注释项；当前文件 `:557-568` 区段）：

```ts
export type BackendCapability =
  | "datasource.server" // PostgreSQL / MySQL adapters (#2)
  | "datasource.queryPolicy" // per-datasource maxRows/timeout wired (#5)
  | "llm.samplingParams" // per-run sampling consumed (#4)
  | "artifact.export" // artifact preview/download API (#9)
  | "chat.imageInput" // chat multimodal image parts consumed (#13a)
  | "chat.fileUpload"; // chat file upload endpoint to session workspace (#13b)

export const BACKEND_CAPABILITIES: Record<BackendCapability, boolean> = {
  "datasource.server": false,
  "datasource.queryPolicy": false,
  "llm.samplingParams": false,
  "artifact.export": false,
  "chat.imageInput": false,
  "chat.fileUpload": false,
};
```

> 注：读取 `data-task-state.ts:557-568` 确认 `llm.samplingParams` / `artifact.export`
> 现有默认值后再粘贴，避免覆盖与现状不一致的初值。

`apps/web/src/lib/config-api/capabilities.ts` 的默认表与 `applyBackendCapabilities`：

```ts
const DEFAULT_BACKEND_CAPABILITIES: Record<BackendCapability, boolean> = {
  "datasource.server": false,
  "datasource.queryPolicy": false,
  "llm.samplingParams": false,
  "artifact.export": true,
  "chat.imageInput": false,
  "chat.fileUpload": false,
};
```

`applyBackendCapabilities` 内的赋值对象增加两行：

```ts
  backendCapabilities = {
    "datasource.server": response["datasource.server"] ?? false,
    "datasource.queryPolicy": response["datasource.queryPolicy"] ?? false,
    "llm.samplingParams": response["llm.samplingParams"] ?? false,
    "artifact.export": response["artifact.export"] ?? true,
    "chat.imageInput": response["chat.imageInput"] ?? false,
    "chat.fileUpload": response["chat.fileUpload"] ?? false,
  };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run test:web -- chat-capabilities`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add apps/web/src/lib/config-api/types.ts apps/web/src/lib/config-api/capabilities.ts apps/web/src/app/data-tasks/data-task-state.ts apps/web/src/app/data-tasks/__tests__/chat-capabilities.test.ts
git commit -m "feat(web): 新增 chat.imageInput/chat.fileUpload 能力位"
```

---

## 任务 2：附件纯函数模块 `chat-attachments.ts`

**文件：**
- 创建：`apps/web/src/app/data-tasks/components/chat/chat-attachments.ts`
- 测试：`apps/web/src/app/data-tasks/__tests__/chat-attachments.test.ts`

说明：本模块是无 React 依赖的纯逻辑，集中处理「图片 vs 数据文件」分流、能力门控、附件→`InputContent` 映射与可发送过滤，便于单测。`onUpload` 策略工厂以注入的 `uploadDataFile`（真正调用后端的函数）与 `readBase64`（读 base64）为依赖，保持可测。

类型与常量：

```ts
import type { Attachment, AttachmentUploadResult } from "@copilotkit/shared";
import type { InputContent } from "@ag-ui/core";

export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  ".csv",
  ".tsv",
  ".xlsx",
  ".json",
  ".parquet",
  ".txt",
  ".pdf",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/json",
  "text/plain",
  "application/pdf",
].join(",");

export type ChatAttachmentCapabilities = {
  imageInput: boolean;
  fileUpload: boolean;
};

export const UNSUPPORTED_METADATA_KEY = "__chatUnsupported";
```

分类（图片用 mime 前缀；其余视为数据文件）：

```ts
export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
```

`onUpload` 策略工厂：

```ts
export type UploadDataFile = (
  file: File,
) => Promise<{ path: string; mimeType: string; size: number }>;

export function createChatOnUpload(deps: {
  capabilities: () => ChatAttachmentCapabilities;
  readBase64: (file: File) => Promise<string>;
  uploadDataFile: UploadDataFile;
}) {
  return async (file: File): Promise<AttachmentUploadResult> => {
    const caps = deps.capabilities();
    if (isImageMime(file.type)) {
      const value = await deps.readBase64(file);
      return {
        type: "data",
        value,
        mimeType: file.type,
        metadata: caps.imageInput ? {} : { [UNSUPPORTED_METADATA_KEY]: true },
      };
    }
    if (!caps.fileUpload) {
      // 数据文件后端未支持：不上传、不读 base64，仅占位以便显示 chip。
      return {
        type: "url",
        value: "",
        mimeType: file.type,
        metadata: { [UNSUPPORTED_METADATA_KEY]: true },
      };
    }
    const uploaded = await deps.uploadDataFile(file);
    return {
      type: "url",
      value: uploaded.path,
      mimeType: uploaded.mimeType,
      metadata: {},
    };
  };
}
```

可发送判定 + 映射：

```ts
export function isAttachmentUnsupported(att: Attachment): boolean {
  return att.metadata?.[UNSUPPORTED_METADATA_KEY] === true;
}

export function attachmentToInputContent(att: Attachment): InputContent {
  const metadata = {
    ...(att.filename ? { filename: att.filename } : {}),
    ...att.metadata,
  };
  return { type: att.type, source: att.source, metadata } as InputContent;
}

/** Only attachments whose modality the backend can consume become message content. */
export function buildMessageContent(
  text: string,
  attachments: Attachment[],
): InputContent[] {
  const sendable = attachments.filter((att) => !isAttachmentUnsupported(att));
  return [
    { type: "text", text } as InputContent,
    ...sendable.map(attachmentToInputContent),
  ];
}
```

- [ ] **步骤 1：编写失败的测试**

创建 `apps/web/src/app/data-tasks/__tests__/chat-attachments.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "@copilotkit/shared";
import {
  buildMessageContent,
  createChatOnUpload,
  isAttachmentUnsupported,
  isImageMime,
  UNSUPPORTED_METADATA_KEY,
} from "../components/chat/chat-attachments";

function imageFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
}
function csvFile(): File {
  return new File(["a,b\n1,2"], "data.csv", { type: "text/csv" });
}
function att(over: Partial<Attachment>): Attachment {
  return {
    id: "1",
    type: "image",
    source: { type: "data", value: "x", mimeType: "image/png" } as Attachment["source"],
    filename: "a.png",
    status: "ready",
    ...over,
  };
}

describe("chat-attachments", () => {
  it("classifies image mime", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("text/csv")).toBe(false);
  });

  it("image upload inlines base64; marks unsupported when imageInput off", async () => {
    const onUpload = createChatOnUpload({
      capabilities: () => ({ imageInput: false, fileUpload: false }),
      readBase64: vi.fn().mockResolvedValue("BASE64"),
      uploadDataFile: vi.fn(),
    });
    const result = await onUpload(imageFile());
    expect(result).toMatchObject({ type: "data", value: "BASE64" });
    expect(result.metadata?.[UNSUPPORTED_METADATA_KEY]).toBe(true);
  });

  it("data file without capability is placeholder, no upload, no base64", async () => {
    const readBase64 = vi.fn();
    const uploadDataFile = vi.fn();
    const onUpload = createChatOnUpload({
      capabilities: () => ({ imageInput: true, fileUpload: false }),
      readBase64,
      uploadDataFile,
    });
    const result = await onUpload(csvFile());
    expect(result).toMatchObject({ type: "url", value: "" });
    expect(result.metadata?.[UNSUPPORTED_METADATA_KEY]).toBe(true);
    expect(readBase64).not.toHaveBeenCalled();
    expect(uploadDataFile).not.toHaveBeenCalled();
  });

  it("data file with capability uploads to backend path", async () => {
    const onUpload = createChatOnUpload({
      capabilities: () => ({ imageInput: true, fileUpload: true }),
      readBase64: vi.fn(),
      uploadDataFile: vi.fn().mockResolvedValue({
        path: "uploads/data.csv",
        mimeType: "text/csv",
        size: 9,
      }),
    });
    const result = await onUpload(csvFile());
    expect(result).toMatchObject({ type: "url", value: "uploads/data.csv" });
    expect(result.metadata?.[UNSUPPORTED_METADATA_KEY]).toBeUndefined();
  });

  it("buildMessageContent drops unsupported attachments but keeps text", () => {
    const content = buildMessageContent("hi", [
      att({ id: "ok" }),
      att({ id: "bad", metadata: { [UNSUPPORTED_METADATA_KEY]: true } }),
    ]);
    expect(content[0]).toEqual({ type: "text", text: "hi" });
    expect(content).toHaveLength(2); // text + 1 sendable
  });

  it("isAttachmentUnsupported reads metadata flag", () => {
    expect(isAttachmentUnsupported(att({ metadata: { [UNSUPPORTED_METADATA_KEY]: true } }))).toBe(true);
    expect(isAttachmentUnsupported(att({}))).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:web -- chat-attachments`
预期：FAIL（模块不存在）

- [ ] **步骤 3：编写最少实现代码**

创建 `apps/web/src/app/data-tasks/components/chat/chat-attachments.ts`，内容为本任务上方「类型与常量 / 策略工厂 / 映射」三段代码合并。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run test:web -- chat-attachments`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add apps/web/src/app/data-tasks/components/chat/chat-attachments.ts apps/web/src/app/data-tasks/__tests__/chat-attachments.test.ts
git commit -m "feat(web): 对话框附件分类/上传策略/内容映射纯函数"
```

---

## 任务 3：`AttachmentChips` 组件

**文件：**
- 创建：`apps/web/src/app/data-tasks/components/chat/AttachmentChips.tsx`

无独立单测（纯展示组件，由任务 6 的 `build:web` + 任务 2 的逻辑覆盖）。视觉沿用 `ui-tokens.ts` / 语义 token。

- [ ] **步骤 1：实现组件**

```tsx
"use client";

import type { Attachment } from "@copilotkit/shared";
import { formatFileSize } from "@copilotkit/shared";
import { isAttachmentUnsupported } from "./chat-attachments";

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pb-1">
      {attachments.map((att) => {
        const unsupported = isAttachmentUnsupported(att);
        return (
          <span
            key={att.id}
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-surface-subtle px-2 py-1 text-xs text-foreground"
            title={unsupported ? "后端接入后将随消息发送" : att.filename}
          >
            <AttachmentIcon modality={att.type} />
            <span className="truncate">{att.filename ?? "附件"}</span>
            {typeof att.size === "number" && (
              <span className="shrink-0 text-muted-light">
                {formatFileSize(att.size)}
              </span>
            )}
            {att.status === "uploading" && (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-border border-t-primary" />
            )}
            {unsupported && (
              <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700">
                后端未支持
              </span>
            )}
            <button
              type="button"
              aria-label="移除附件"
              onClick={() => onRemove(att.id)}
              className="shrink-0 cursor-pointer text-muted-light hover:text-foreground"
            >
              <CloseIcon />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function AttachmentIcon({ modality }: { modality: Attachment["type"] }) {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      {modality === "image" ? (
        <>
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <circle cx="7.5" cy="7.5" r="1.5" />
          <path d="m4 15 4-4 3 3 2-2 3 3" />
        </>
      ) : (
        <>
          <path d="M6 2.5h6l4 4V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
          <path d="M12 2.5v4h4" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}
```

- [ ] **步骤 2：Commit**

```bash
git add apps/web/src/app/data-tasks/components/chat/AttachmentChips.tsx
git commit -m "feat(web): 附件 chips 组件（含后端未支持徽标）"
```

---

## 任务 4：bindings 增加 `agentId` / `activeThreadId`

**文件：**
- 修改：`apps/web/src/app/data-tasks/components/chat/DataTaskChatInputBindingsContext.tsx:13-27`

- [ ] **步骤 1：扩展 bindings 类型**

在 `DataTaskChatInputBindings` 类型末尾（`chatColumnWidth: number;` 之后）追加：

```ts
  agentId: string;
  activeThreadId: string | null;
```

- [ ] **步骤 2：编译验证**

运行：`npm run build:web`
预期：会因 `page.tsx` 的 `chatInputBindings` 缺少新字段而 FAIL（下一任务补齐）。可暂跳过，留待任务 5 一起验证。

- [ ] **步骤 3：Commit（与任务 5 合并提交，本步不单独 commit）**

> 说明：本任务的类型变更与任务 5 的注入是同一处契约，合并到任务 5 末尾一次性 commit，避免中间态构建失败。

---

## 任务 5：page 层接入 `useAttachments` 并拦截提交

**文件：**
- 修改：`apps/web/src/app/data-tasks/page.tsx`（导入区 `:3-11`、`StableDataTaskChatInput` `:143-161`、`chatInputBindings` `:658-687`）
- 修改：`apps/web/src/app/data-tasks/components/chat/DataTaskChatInput.tsx`（props 透传与布局）

### 5.1 page.tsx 导入与 bindings 注入

- [ ] **步骤 1：补充导入**

`page.tsx` 顶部从 v2 增加 `useAgent`、`useCopilotKit`；从 shared 增加 `readFileAsBase64`：

```ts
import {
  CopilotChat,
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotChatInput,
  CopilotChatToolCallsView,
  CopilotKit,
  useAgent,
  useAgentContext,
  useCopilotKit,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { readFileAsBase64 } from "@copilotkit/shared";
```

并在文件内新增上传函数（POST 到后端端点，能力为 true 时才会被 `createChatOnUpload` 调用）：

```ts
import { getConfigApiBaseUrl } from "../../lib/config-api";

async function uploadChatDataFile(file: File): Promise<{ path: string; mimeType: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${getConfigApiBaseUrl()}/api/v1/chat/uploads`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("CHAT_UPLOAD_FAILED");
  return (await res.json()) as { path: string; mimeType: string; size: number };
}
```

> 注：`getConfigApiBaseUrl` 已从 `lib/config-api` 导出（`client.ts`），按现有相对
> 路径风格调整 import 前缀。

- [ ] **步骤 2：bindings 注入 agentId / activeThreadId**

`chatInputBindings`（`page.tsx:658-687`）的返回对象增加两项、依赖数组增加 `activeThreadId`：

```ts
  const chatInputBindings = useMemo(
    () => ({
      // ...现有字段保持不变...
      chatColumnWidth,
      agentId,
      activeThreadId,
    }),
    [
      // ...现有依赖保持不变...
      workspaceConfig,
      activeThreadId,
    ],
  );
```

> `agentId` 是模块级常量（`page.tsx:128`），无需进依赖数组；`activeThreadId`
> 是已有的 state/变量（用于 `<CopilotChat threadId>`），确认其变量名后填入。

### 5.2 StableDataTaskChatInput 接管附件与提交

- [ ] **步骤 3：改写 `StableDataTaskChatInput`**

`page.tsx:143-161` 替换为（调用 `useAttachments`/`useAgent`/`useCopilotKit`，构造附件控制器并拦截提交）：

```tsx
function StableDataTaskChatInput({
  inputProps,
}: {
  inputProps: ComponentProps<typeof DataTaskChatInput>;
}) {
  const bindings = useDataTaskChatInputBindings();
  const { agent } = useAgent({ agentId: bindings.agentId });
  const { copilotkit } = useCopilotKit();

  const capabilities = useCallback(
    () => ({
      imageInput: hasCapability("chat.imageInput"),
      fileUpload: hasCapability("chat.fileUpload"),
    }),
    [],
  );
  const onUpload = useMemo(
    () =>
      createChatOnUpload({
        capabilities,
        readBase64: (file) => readFileAsBase64(file),
        uploadDataFile: uploadChatDataFile,
      }),
    [capabilities],
  );

  const attachmentsApi = useAttachments({
    config: {
      enabled: true,
      accept: CHAT_ATTACHMENT_ACCEPT,
      maxSize: CHAT_ATTACHMENT_MAX_BYTES,
      onUpload,
      onUploadFailed: ({ message }) => {
        if (typeof window !== "undefined") console.warn(`[attachments] ${message}`);
      },
    },
  });

  const handleSubmitMessage = (value: string) => {
    const ready = attachmentsApi.consumeAttachments();
    if (ready.length > 0 && agent) {
      const content = buildMessageContent(value, ready);
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
      void copilotkit.runAgent({ agent });
    } else {
      inputProps.onSubmitMessage?.(value);
    }
    bindings.onClearPerRunMentions();
    requestAnimationFrame(scheduleChatTextareaResize);
  };

  return (
    <DataTaskChatInput
      {...inputProps}
      {...bindings}
      attachmentsApi={attachmentsApi}
      onSubmitMessage={handleSubmitMessage}
      showDisclaimer={false}
    />
  );
}
```

新增导入（`page.tsx` 顶部）：

```ts
import { useAttachments } from "@copilotkit/react-core/v2";
import { hasCapability } from "./data-task-state";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_BYTES,
  buildMessageContent,
  createChatOnUpload,
} from "./components/chat/chat-attachments";
```

> `hasCapability` 若已在 `data-task-state` 的现有导入里则复用，不重复导入。
> `useCallback`/`useMemo` 已在文件顶部 React 导入中。

- [ ] **步骤 4：编译验证（部分）**

运行：`npm run build:web`
预期：FAIL —— `DataTaskChatInput` 尚未声明 `attachmentsApi` prop（下一节补齐）。

### 5.3 DataTaskChatInput / 布局渲染附件

- [ ] **步骤 5：扩展 `DataTaskChatInputProps` 并透传**

`DataTaskChatInput.tsx`：在 `DataTaskChatInputProps`（`:26-39`）增加：

```ts
import type { UseAttachmentsReturn } from "@copilotkit/react-core/v2";
// ...
  attachmentsApi: UseAttachmentsReturn;
```

`DataTaskChatInput` 函数解构出 `attachmentsApi` 并下传给 `DataTaskChatInputLayout`
（与现有 `mentionResources` 等一致地经 `slots` 渲染回调透传）。在 `DataTaskChatInputLayout`
的 props 类型与解构中同样加入 `attachmentsApi: UseAttachmentsReturn`。

- [ ] **步骤 6：布局接线 containerRef / drag / chips / 按钮**

`DataTaskChatInputLayout`（`:159-296`）：

1. 合并 containerRef —— 现有 `columnRef`（`:169-175`）再叠加附件容器 ref：

```tsx
  const columnRef = useCallback(
    (node: HTMLDivElement | null) => {
      mention.columnRef(node);
      autoresizeRef(node);
      attachmentsApi.containerRef(node);
    },
    [mention.columnRef, autoresizeRef, attachmentsApi.containerRef],
  );
```

2. 外层卡片容器（`data-testid="copilot-chat-input"` 那个 div，`:216-219`）挂拖拽事件
   与遮罩：

```tsx
        <div
          data-testid="copilot-chat-input"
          onDragOver={attachmentsApi.handleDragOver}
          onDragLeave={attachmentsApi.handleDragLeave}
          onDrop={attachmentsApi.handleDrop}
          className="relative flex w-full flex-col overflow-visible rounded-2xl border border-border bg-surface shadow-[0_8px_28px_-6px_rgba(15,23,42,0.12),0_2px_8px_-2px_rgba(15,23,42,0.05)]"
        >
          {attachmentsApi.dragOver && (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary-light/10 text-sm font-medium text-primary">
              拖拽文件到此处上传
            </div>
          )}
```

3. 在 `MentionChips`（`:234-239`）上方渲染 `AttachmentChips`：

```tsx
                  <AttachmentChips
                    attachments={attachmentsApi.attachments}
                    onRemove={attachmentsApi.removeAttachment}
                  />
                  <MentionChips ... />
```

4. 隐藏 file input + 附件按钮，放进 `SessionConfigBar` 的 `leading`（`:274-278`）与
   现有 `addMenuButton` 并列：

```tsx
              leading={
                <div className="flex items-center gap-1">
                  <input
                    ref={attachmentsApi.fileInputRef}
                    type="file"
                    multiple
                    accept={CHAT_ATTACHMENT_ACCEPT}
                    className="hidden"
                    onChange={attachmentsApi.handleFileUpload}
                  />
                  <button
                    type="button"
                    aria-label="上传文件"
                    title="上传文件"
                    onClick={() => attachmentsApi.fileInputRef.current?.click()}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-subtle hover:text-foreground"
                  >
                    <PaperclipIcon />
                  </button>
                  <div className="grid h-7 w-7 place-items-center [&_button]:flex [&_button]:h-7 [&_button]:w-7 [&_button]:items-center [&_button]:justify-center">
                    {addMenuButton}
                  </div>
                </div>
              }
```

新增导入与 `PaperclipIcon`（文件底部，与 `CheckIcon` 等并列）：

```tsx
import { AttachmentChips } from "./AttachmentChips";
import { CHAT_ATTACHMENT_ACCEPT } from "./chat-attachments";
// ...
function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 9.5 9 15a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-6 6a1 1 0 0 1-1.4-1.4l5.3-5.3" />
    </svg>
  );
}
```

> `handleFileUpload`/`fileInputRef`/`containerRef`/`handleDragOver`/`handleDragLeave`/
> `handleDrop`/`removeAttachment`/`attachments`/`dragOver`/`consumeAttachments` 均来自
> `UseAttachmentsReturn`（已在任务前置核实其签名）。

- [ ] **步骤 7：lint + 编译验证**

运行：`npm run build:web`
预期：PASS（类型与 JSX 均通过）。如有 lint 报错按提示修复。

- [ ] **步骤 8：Commit**

```bash
git add apps/web/src/app/data-tasks/page.tsx apps/web/src/app/data-tasks/components/chat/DataTaskChatInput.tsx apps/web/src/app/data-tasks/components/chat/DataTaskChatInputBindingsContext.tsx
git commit -m "feat(web): 对话框接入 useAttachments，附件拦截提交与拖拽/粘贴上传"
```

---

## 任务 6：文档与整体验证

**文件：**
- 修改：`apps/web/src/app/data-tasks/DESIGN.md`

- [ ] **步骤 1：DESIGN.md 增补「对话框附件上传」小节**

在「Auxiliary UI modules」或「Backend-unsupported affordances」附近新增一节，说明：
模态分流（图片内联 / 数据文件 `onUpload`）、能力位 `chat.imageInput` / `chat.fileUpload`
门控、能力为 false 时附件标「后端未支持」且不进入 run、提交时 `agent.addMessage` +
`runAgent` 路径，并把更新日期改为当日。

- [ ] **步骤 2：全量测试**

运行：`npm run test:web`
预期：PASS（含新增 `chat-attachments` / `chat-capabilities`）。

- [ ] **步骤 3：构建**

运行：`npm run build:web`
预期：PASS。

- [ ] **步骤 4：Commit**

```bash
git add apps/web/src/app/data-tasks/DESIGN.md
git commit -m "docs(web): DESIGN 增补对话框附件上传小节"
```

---

## 自检

**1. 规格覆盖度**

- 规格 §2 模态分流 → 任务 2 `createChatOnUpload`（image=data/base64，datafile=url/endpoint）。
- 规格 §3.1 useAttachments 接入 / containerRef / drag / paste → 任务 5.3 步骤 6。
- 规格 §3.2 附件按钮 → 任务 5.3 步骤 6（SessionConfigBar leading）。
- 规格 §3.3 AttachmentChips → 任务 3。
- 规格 §3.4 绑定下放 → 任务 4 + 任务 5.1。
- 规格 §4 提交流程（有/无附件分支）→ 任务 5.2 `handleSubmitMessage`。
- 规格 §5 能力位门控 → 任务 1 + 任务 2（`UNSUPPORTED_METADATA_KEY` 过滤）。
- 规格 §6 后端需求 → 已落 #13 / O-007（非本计划实现）。
- 规格 §7 测试 → 任务 1/2 单测 + 任务 6 全量。
- 规格 §8 文档 → 任务 6。

**2. 占位符扫描**：无 TODO / 待定；所有代码步骤含完整代码块。

**3. 类型一致性**：`UseAttachmentsReturn` 字段（`attachments/containerRef/fileInputRef/
handleFileUpload/handleDragOver/handleDragLeave/handleDrop/removeAttachment/dragOver/
consumeAttachments`）与 d.ts 一致；`AttachmentUploadResult` 的 `type:"data"|"url"` 与
`createChatOnUpload` 返回一致；`buildMessageContent` 在任务 2 定义、任务 5.2 使用，签名一致；
`hasCapability` / `BackendCapability` 新增项在任务 1 定义、任务 5.2 使用。

> 待实现时需现场核实的一处（计划已标注）：`data-task-state.ts` 现有
> `llm.samplingParams` / `artifact.export` 默认初值，粘贴 `BACKEND_CAPABILITIES`
> 时勿覆盖与现状不一致的初值。`getConfigApiBaseUrl` 导出已确认。
