# 前端能力现状（2026-06-27 增量）

日期：2026-06-27  
归属方：`apps/web`（`@open-data-agent/web`）  
文档类型：**前端自述增量** —— 只记录 2026-06-27 本轮新增的前端能力。完整快照见
[2026-06-25 前端能力现状](./2026-06-25-frontend-capability-status.md) 与
[2026-06-26 前端能力现状增量](./2026-06-26-frontend-capability-status.md)。

## 一句话现状

前端补齐了数据任务会话命名的基础交互：左侧会话可手动重命名，首次提问后会先用用户问题生成本地占位标题，并预留后端 LLM 短标题事件消费能力；同时增强了 dataset / chart artifact 的交互展示，让数据结果可以搜索、排序、导出 CSV，并支持图表类型切换与 PNG 导出。

## 本轮新增展示

| 区域 | 新增能力 | 后端依赖 |
| --- | --- | --- |
| 左栏会话 | inline 重命名，会话标题持久化到本地 session store | 后续 `PATCH /api/v1/sessions/:id` 做服务端同步 |
| 左栏会话 | 会话项采用「图标 + 标题 + ⋯ 操作菜单」；菜单含置顶 / 重命名 / 删除，分享占位禁用 | 分享待后端 |
| 左栏会话 | 首次提问后以前端截断文本回填占位标题 | 无 |
| 左栏会话 | 消费 `CUSTOM(name="session.title")` 覆盖非手动标题 | `conversation.title` 能力位 + 后端事件 |
| 产出 / Detail | dataset 表格搜索、列排序、导出当前视图 CSV | 无 |
| 产出 / Detail | chart artifact 可在 `bar` / `line` / `pie` 间切换 | 依赖既有 chart `points` / `series` |
| 产出 / Detail | chart 当前 SVG 导出 PNG | 无 |

## 会话标题策略

前端使用 `titleSource` 记录标题来源：

- `default`：新会话默认标题，当前为「新数据任务」。
- `auto-snippet`：首次用户提问后，前端从文本截断生成的临时标题。
- `llm`：后端模型生成短标题后，通过 `session.title` 事件回传。
- `user`：用户手动重命名，优先级最高，不被 `auto-snippet` 或 `llm` 覆盖。

本轮仅完成本地持久化与后端事件消费位。跨设备同步、服务端列表和手动重命名持久化见
[2026-06-27 后端需求增量](./2026-06-27-backend-requirements.md)。

## 数据结果交互

- **Dataset：** 表格支持客户端关键字搜索、列点击排序（再次点击在升序 / 降序 / 关闭之间切换）和 CSV 导出。导出的 CSV 以当前搜索 / 排序后的可见结果为准。
- **Chart：** 在已有 Recharts 渲染基础上支持 `bar` / `line` / `pie` 前端切换；导出 PNG 基于当前图表 SVG 生成。

## 新增能力位

| 能力位 | 默认 | 解锁 |
| --- | --- | --- |
| `conversation.title` | false | 消费后端 `CUSTOM(name="session.title")` 并用 LLM 标题覆盖非手动标题 |

能力位未翻 true 时，前端只保留本地占位 / 手动标题，不等待、不报错、不 mock 后端标题。

## 对后端的新要求

本轮新增后端需求见
[2026-06-27 后端需求增量](./2026-06-27-backend-requirements.md)，主要包括：

1. `session.title` 事件与 `conversation.title` capability。
2. `PATCH /api/v1/sessions/:id` 支持手动重命名服务端持久化。
3. `GET /api/v1/sessions` 服务端权威会话列表。
4. 数据增强类后端能力：服务端导出、schema 浏览器支持、运行取消、查询历史 / SQL 收藏。

## 验证记录

计划新增 / 更新单测：

- `session-config`：`titleSource`、手动重命名、自动标题覆盖规则、首问标题截断。
- `live-run-state`：`CUSTOM(name="session.title")` reducer。
- `table-rows`：搜索、排序、CSV 转义。

本地验证命令：

```bash
npm run test:web
npm run build:web
```
