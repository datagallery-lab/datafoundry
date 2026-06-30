# Documentation

当前公开文档以中文为主，入口在 [中文文档](zh/README.md)。英文文档会在中文内容稳定后统一补齐。

## 快速入口

| 目标 | 文档 |
| --- | --- |
| 了解产品定位 | [产品概览](zh/overview.md) |
| 本地跑通演示 | [快速开始](zh/quick-start.md) |
| 查看能力范围 | [能力全览](zh/capabilities.md) |
| 使用 Web 工作台 | [Web 工作台指南](zh/guides/web-workbench.md) |
| 使用 TUI | [TUI 指南](zh/guides/tui.md) |
| 连接数据源 | [数据源指南](zh/guides/data-sources.md) |
| 查看支持的数据源 | [支持的数据源](zh/reference/supported-datasources.md) |
| 对接 API | [REST API 参考](zh/reference/rest-api.md) 与 [配置 API 参考](zh/reference/configuration-api.md) |
| 理解运行协议 | [Agent Runtime 与 AG-UI 参考](zh/reference/agent-runtime.md) |
| 理解系统结构 | [架构概览](zh/architecture/overview.md) |

## 文档边界

`docs/` 只放适合开源访客阅读的公开文档和公开资产。历史迭代过程、实现计划、PRD、研究材料和来源敏感内容不放在公开文档路径中。

少量仍有维护价值的工程契约放在仓库内部文档区。这些文件可随开源仓提交，但不是公开阅读入口，也不能包含凭据、个人路径、个人信息、客户信息或来源敏感描述。

## 维护规则

- 公开文档不要链接内部文档区。
- 新增对外能力时，优先更新 `zh/` 下的中文文档。
- 示例凭据只能使用占位值，例如 `replace-with-your-key`、`<dev_token>`。
- 不保留来源敏感叙述。
- 修改文档后运行 `npm run smoke:docs`。
