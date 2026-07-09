# Backend contract hardening 实现计划

> **面向 AI 代理的工作者：** 内联执行本计划。步骤使用复选框跟踪进度。

**目标：** 闭合 HITL / artifact / checkpoint 三处后端契约缺口，前端补丁标为 legacy。

**架构：** 写路径保证 suspend 时落 `TOOL_CALL_START`；读路径合成缺失 toolCalls；扩展 checkpoint `runIds`；artifact 生产者已带 `tool_call_id` 的路径对齐并标注；前端仅加注释。

**技术栈：** TypeScript / apps/api / apps/web / vitest / smoke scripts

---

### 任务 1：HITL 写路径 — suspend 前补 TOOL_CALL_START

**文件：**
- 修改：`apps/api/src/interaction-runtime-adapter.ts`
- 修改：`apps/api/src/server.ts`

- [x] 导出 `buildHitlToolCallStartEvent(interrupt)`
- [x] `server.ts` 跟踪已见 `TOOL_CALL_START`；interrupt 时若缺失则 `emit` 后再 suspend

### 任务 2：HITL 读路径 + checkpoint runIds

**文件：**
- 修改：`apps/api/src/config-api.ts`

- [x] `runIds` union pendingInteractions
- [x] 对缺失的 pending interaction 合成 `toolCalls` DTO（`awaitingInteraction: true`）
- [x] 无 events 的 HITL-only run 发出 suspended checkpoint

### 任务 3：Artifact / frontend legacy 注释

**文件：**
- 修改：`packages/artifacts/src/index.ts`（JSDoc：必须传 tool_call_id）
- 修改：`apps/web/.../conversation-restore.ts`、`live-run-state.ts`
- 修改：`scripts/smoke-files.mjs`（chart 带 tool_call_id）

- [x] 标注 synthetic parent / HITL bootstrap / e2e replay / artifact heuristic / user-only guess 为 legacy

### 任务 4：测试与验证

- [x] 扩展 conversation-restore / smoke-config-api HITL 合成断言
- [x] 跑 typecheck + vitest restore/live-run + smoke-config-api / conversation-memory / files
