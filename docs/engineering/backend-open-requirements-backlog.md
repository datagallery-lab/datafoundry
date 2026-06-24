# 后端待实现需求清单（Open Backlog）

日期：2026-06-24
维护方：`apps/api` / 研发 B（后端填写「后端答复区」）
提出方：`apps/web`（需求摘要来源于前端能力清单与联调反馈）

## 文档定位

本文件从下列来源**抽离尚未完成或仅部分完成**的项，作为后端排期与答复的**唯一工作清单**：

| 来源 | 说明 |
| --- | --- |
| [frontend-backend-capability-requests.md](./frontend-backend-capability-requests.md) | 前端原始需求（#1–#12） |
| [2026-06-23-frontend-backend-capability-status.md](./2026-06-23-frontend-backend-capability-status.md) | 后端交付对照（已实现项见该文件） |
| [2026-06-23-backend-config-runtime-delivery-report.md](./2026-06-23-backend-config-runtime-delivery-report.md) | 后端交付报告 §5 限制、§6 建议下一步 |

**已实现**（#1–#9 主体、#3 run_config、#4 LLM profile、#5 查询策略与数据工具、#6 KB、#7 MCP、#8 Skill 等）不再重复收录，见 [能力交付状态](./2026-06-23-frontend-backend-capability-status.md)。

**状态枚举**（后端答复区统一使用）：

`未排期` · `已排期` · `进行中` · `待验收` · `已完成` · `不做` · `阻塞`

---

## 总览

| ID | 需求 | 优先级 | 前端阻塞 | 当前状态 |
| --- | --- | --- | --- | --- |
| [O-001](#o-001-session-级-workspace-隔离跨-run-文件持久) | Session 级 Workspace 隔离 | **P1** | 多轮写文件后 `list_files` 为空 | 未实现 |
| [O-002](#o-002-llm-token-用量上报-ag-ui) | LLM Token 用量上报 | **P1** | Task Console 用量面板无真实数据 | 待确认 |
| [O-003](#o-003-postgresql--mysql-真实环境集成验收) | PG / MySQL 真实环境集成验收 | P1 | PG/MySQL 仅能标 beta，缺 E2E 证明 | 部分完成 |
| [O-004](#o-004-artifact-北向协议收敛) | Artifact 北向协议收敛 | P2 | 产物事件仍偏大；与 session workspace 联动 | 部分完成 |
| [O-005](#o-005-conversation-memory-服务端权威历史) | Conversation Memory 权威历史 | P2 | 仍依赖客户端回传全量 messages | 未实现 |
| [O-006](#o-006-多用户认证--租户-workspace-隔离) | 多用户认证 / 租户隔离 | P3 | 固定 `dev-user`，无法多人 | 未实现 |
| [O-007](#o-007-对话框文件上传图片多模态--数据文件落工作区) | 对话框文件上传（图片多模态 + 数据文件） | **P1** | 对话框附件标「后端未支持」，无法真实发送 | 未实现 |

---

## O-001 Session 级 Workspace 隔离（跨 run 文件持久）

| 字段 | 内容 |
| --- | --- |
| 来源 | 能力清单 #12；前端联调：同 session 第二轮 `list_files` 目录空 |
| 优先级 | **P1** |
| 依赖 | 无硬依赖；落地后需同步 #9 文件下载路径（见 O-004） |

### 问题

同一 AG-UI `threadId`（= `session_id`）内，CopilotKit 每轮提问发起**新 `runId`**（标准语义）。后端 Workspace 当前为 `{user}/{session}/{run}/`，且 run 结束调用 `destroyWorkspace()`，导致上一轮 `write_file` 在下一轮不可见。

### 需求摘要

1. Workspace 根目录改为 `{workspaceRoot}/{user_id}/{session_id}/`；`run_id` 不参与 path。
2. run terminal（completed / failed / canceled）**不再**删除 session 工作区。
3. 定义 session 级回收策略（MVP：长期保留 + 可选 TTL / 删除 session 时清理 API）。
4. 同 session 并发 run：MVP 建议继续「单 active run」，与 `RUN_ALREADY_ACTIVE` 对齐。
5. Artifact 文件读取路径与 #9 download API 对齐为 session 级（见 O-004）。
6. 集成测试：同 session 两 run 读写同一文件。

详细功能点与验收标准见 [能力清单 §12](./frontend-backend-capability-requests.md#12-session-级-workspace-隔离跨-run-文件持久p1)。

### 验收标准（摘要）

- Run A 写入 `outputs/report.csv` 并结束 → Run B（新 `runId`）`list_files` / `read_file` 成功。
- 不同 `threadId`、不同 `user_id` 互不可见；沙箱边界不退化。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 未排期 / 已排期 / 进行中 / 待验收 / 已完成 / 不做 / 阻塞 --> |
| **负责人** | <!-- 后端填写 --> |
| **计划版本 / 里程碑** | <!-- 后端填写 --> |
| **方案摘要** | <!-- 目录改造、destroy 策略、与 artifact 路径联动 --> |
| **预计工作量** | <!-- 后端填写 --> |
| **阻塞项** | <!-- 后端填写 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-002 LLM Token 用量上报（AG-UI）

| 字段 | 内容 |
| --- | --- |
| 来源 | 能力清单 #11 |
| 优先级 | **P1** |
| 依赖 | 无（与 LLM profile 独立） |

### 问题

前端 `live-run-state.ts` 与 Task Console 已消费 `CUSTOM(name="token_usage")`，后端未 emit；现有 `context.prompt-verified` / `context.compiled` 仅为上下文预算，非 LLM 计费用量。

### 需求摘要

每次 LLM 调用完成（或 run 结束汇总）emit：

```json
{
  "type": "CUSTOM",
  "name": "token_usage",
  "value": {
    "input_tokens": 1200,
    "output_tokens": 340,
    "tool_call_id": "可选，优先用于步骤归属",
    "model": "可选"
  }
}
```

优先使用 provider 返回的 `usage`，非 `PromptTokenCounter` 本地估算。

完整字段约定见 [能力清单 §11](./frontend-backend-capability-requests.md#11-llm-token-用量上报agui-token_usagep1)。

### 验收标准（摘要）

- run 结束后前端概览显示真实 Token 汇总；`run_events` 可查到 `token_usage` 事件。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 未排期 / 已排期 / 进行中 / 待验收 / 已完成 / 不做 / 阻塞 --> |
| **负责人** | <!-- 后端填写 --> |
| **方案摘要** | <!-- emit 位置：stream 归一化层 / run 收尾；分步 vs 汇总 --> |
| **阻塞项** | <!-- 例如：当前 provider 不返回 usage --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-003 PostgreSQL / MySQL 真实环境集成验收

| 字段 | 内容 |
| --- | --- |
| 来源 | [交付报告 §5](./2026-06-23-backend-config-runtime-delivery-report.md#5-当前限制)；能力清单 #2 残余 |
| 优先级 | P1 |
| 依赖 | 用户侧只读 PG/MySQL 实例与 secretRef 凭据 |

### 问题

REST 与 adapter 代码已实现，但缺少**真实数据库**下的端到端 smoke；前端只能将 PG/MySQL 标为 beta。

### 需求摘要

1. 使用真实只读 PG / MySQL 实例完成：`create → test → introspect → inspect_schema → run_sql_readonly` 全链路。
2. 失败场景返回结构化错误码（连接失败、权限不足、超时）。
3. 在交付状态文档或本 backlog 更新验收记录（实例类型、日期、执行人）。

### 验收标准（摘要）

- 至少各 1 个 PG、MySQL 真实实例跑通；文档记录验收命令与结果。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 部分完成：代码已有，缺真实环境 --> |
| **负责人** | <!-- 后端填写 --> |
| **验收环境** | <!-- PG 版本 / MySQL 版本 / 网络 --> |
| **验收日期** | <!-- 后端填写 --> |
| **阻塞项** | <!-- 例如：暂无可用测试库 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-004 Artifact 北向协议收敛

| 字段 | 内容 |
| --- | --- |
| 来源 | [交付报告 §5–§6](./2026-06-23-backend-config-runtime-delivery-report.md)；`todo_list.md` P2 workspace artifact |
| 优先级 | P2 |
| 依赖 | O-001 落地后 file 下载路径需一并调整 |

### 问题

- REST detail / preview / download **已实现**（能力清单 #9 主体已交付）。
- AG-UI `CUSTOM(name="artifact")` 仍携带较大 `preview_json`；file 类型 download 仍按 **run 级** workspace 路径读取。
- 完整二进制持久化归档能力仍弱（metadata + 小文本 preview 为主）。

### 需求摘要

1. 北向 artifact 事件逐步改为 **引用**（id + 摘要），大内容走 REST 分页 / download。
2. O-001 完成后，file artifact 磁盘路径改为 session 级；旧 run 级记录兼容策略需在 PR 说明。
3. （可选）完整文件 copy + hash + `storage_path` 落库。

### 验收标准（摘要）

- AG-UI 流中 artifact 事件体积可控；前端仍可通过 REST 查看 / 下载完整内容。
- Session workspace 改造后 download API 路径正确。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 部分完成 --> |
| **负责人** | <!-- 后端填写 --> |
| **分阶段计划** | <!-- 例如：Phase A 改路径；Phase B 事件引用化 --> |
| **与 O-001 联动** | <!-- 后端填写 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-005 Conversation Memory 服务端权威历史

| 字段 | 内容 |
| --- | --- |
| 来源 | [交付报告 §6 建议下一步 #3](./2026-06-23-backend-config-runtime-delivery-report.md#6-建议下一步)；`todo_list.md` P0 |
| 优先级 | P2 |
| 依赖 | 与 CopilotKit / Mastra 历史所有权方案对齐 |

### 问题

当前 run 仍**信任客户端回传**全量 `messages`；task thread-state 已接入 LibSQL，但 **conversation Memory 未开启**（`lastMessages=false`）。

### 需求摘要

1. 明确 CopilotKit 与 Mastra 的历史所有权与 message ID 去重策略。
2. 服务端按 `user_id + threadId` 管理权威 conversation 历史。
3. 开启 memory 前完成：tool-call/tool-result 配对校验、稳定 message ID。
4. 与 Knowledge 职责边界文档化（检索 vs 会话摘要）。

### 验收标准（摘要）

- 刷新页面或换客户端后，同 session 历史一致；prompt 无重复注入。
- 超长轮次有可观测的压缩 / 摘要策略（可与 `todo_list` P1 Reduction 联动）。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 未实现 --> |
| **负责人** | <!-- 后端填写 --> |
| **方案摘要** | <!-- Mastra memory 配置、与 AG-UI 转换层改动 --> |
| **设计文档链接** | <!-- 后端填写 --> |
| **阻塞项** | <!-- 例如：TaskStateProcessor 导出不一致 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-006 多用户认证 / 租户 Workspace 隔离

| 字段 | 内容 |
| --- | --- |
| 来源 | 能力清单 #10；[交付报告 §5](./2026-06-23-backend-config-runtime-delivery-report.md#5-当前限制) |
| 优先级 | P3 |
| 依赖 | 认证方案；表结构已预留 `workspace_id` / `user_id` |

### 问题

当前固定 `user_id=dev-user`，无登录与租户边界；配置与会话无法按真实用户隔离。

### 需求摘要

1. 用户认证（具体方案后端选型：Session / JWT / OIDC 等）。
2. 配置、run、artifact、session workspace 按 `(workspaceId, userId)` 隔离。
3. 支撑配置 `scope` 与团队共享（若产品需要）。

### 验收标准（摘要）

- 不同用户登录后仅见各自配置与会话；跨用户访问返回 403。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 未实现 --> |
| **负责人** | <!-- 后端填写 --> |
| **认证方案** | <!-- 后端填写 --> |
| **与现网 dev-user 迁移** | <!-- 后端填写 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## O-007 对话框文件上传（图片多模态 + 数据文件落工作区）

| 字段 | 内容 |
| --- | --- |
| 来源 | 能力清单 #13；设计规格 [2026-06-24-chat-file-upload-design.md](../superpowers/specs/2026-06-24-chat-file-upload-design.md) |
| 优先级 | **P1** |
| 依赖 | #13b 强依赖 O-001（session 级工作区） |

### 问题

`/data-tasks` 对话框需要上传文件：图片喂多模态 LLM，数据/文本文件供 Agent 分析。后端
当前 `upload-parser.ts` 仅服务 Skill 配置上传；`run-input.ts:extractLastUserText` 忽略
非文本 part（图片不进模型未验证）；无任何 chat 文件上传端点。

### 需求摘要

1. **#13a 多模态图片消费**：run 入口解析 user message `content` 中 `type:"image"` part，
   转交多模态 LLM；下发 `capabilities.chat.imageInput = true`。
2. **#13b 文件上传端点**：新增 `POST /api/v1/chat/uploads`（multipart，复用 `upload-parser`
   大小/类型限制思路），文件写入 `{workspaceRoot}/{user_id}/{session_id}/uploads/`，返回
   `{ path, mimeType, size }`；run 时 agent 文件工具可读；下发 `capabilities.chat.fileUpload = true`。
3. 安全：校验 `(user_id, session_id)`、禁 `..` 逃逸、限大小/类型；仅本 session 可见。

> 前端已先行实现完整附件 UI；能力位为 false 时附件标「后端未支持」且不进入 run（不假装能用）。

### 验收标准（摘要）

- 上传图片提问，run 中 LLM 能据图作答（`run_events` 可验证）。
- 上传 CSV，下一条消息 Agent 能 `read_file` 读到并分析。
- 不同 session 上传文件互不可见；沙箱边界不退化。

### 后端答复区

| 项 | 内容 |
| --- | --- |
| **状态** | <!-- 未排期 / 已排期 / 进行中 / 待验收 / 已完成 / 不做 / 阻塞 --> |
| **负责人** | <!-- 后端填写 --> |
| **方案摘要** | <!-- 图片 part 解析位置；上传端点与 session workspace 联动 --> |
| **与 O-001 联动** | <!-- 文件落 session 工作区路径 --> |
| **阻塞项** | <!-- 例如：当前 provider 非多模态 --> |
| **关联 PR / Issue** | <!-- 后端填写 --> |
| **备注** | <!-- 后端填写 --> |

---

## 建议排期顺序（前端视角，供后端调整）

1. **O-001** Session Workspace — 解除多轮文件分析核心阻塞。
2. **O-002** Token 用量 — Task Console 可观测性。
3. **O-003** PG/MySQL 真实验收 — 配置面可信度。
4. **O-004** + **O-001** 联动 — artifact 路径与北向收敛。
5. **O-005** Memory — 长会话与历史权威。
6. **O-006** 多用户 — 产品化。

---

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-06-24 | 初版：从能力清单 #11/#12、交付报告限制与 §6 建议、能力状态未实现项抽离 |
| 2026-06-24 | 新增 O-007 对话框文件上传（能力清单 #13） |
