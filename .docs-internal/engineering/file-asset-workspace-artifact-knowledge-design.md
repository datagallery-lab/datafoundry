# File Asset / Workspace / Artifact / Knowledge Design

日期：2026-06-24

## 目标

统一处理前端批量上传文件、agent workspace 文件处理、artifact 下载、knowledge import。
核心约束是：同一份物理文件内容不能重复存储；其他模块只能引用统一文件资产。

## 核心模型

```text
FileAsset
  唯一物理文件资产
  sha256 去重
  storage_path 权威来源

FileAssetRef
  业务引用关系
  表达 user/workspace/session/run/source/filename/status
```

前端拿到和传入的 `file_id` 指向 `FileAssetRef.id`，不是物理资产 id。这样同一个物理内容可被
不同用户、run、artifact、KB document 以不同业务语义引用。

## 生命周期

| 对象 | 生命周期 | 说明 |
| --- | --- | --- |
| FileAsset | 长期 | 只要还有 ref 就保留，后台 GC 后续清理孤儿资产 |
| FileAssetRef | 按业务场景 | 删除 ref 不立即删除物理文件 |
| Run Workspace | 短期 | agent scratch space，默认不进入资产库 |
| Artifact | 长期 | 交付结果，引用 FileAssetRef |
| KnowledgeDocument | 跟随 KB | 索引投影，引用 FileAssetRef |

## 数据流

```text
Frontend batch upload
  -> POST /api/v1/files
  -> FileAsset sha256 dedupe
  -> FileAssetRef(source=upload)

Agent run
  -> run_config.fileIds
  -> FileAssetRef authorization
  -> workspace/input/<filename>
  -> model sees file list only

Agent deliverable
  -> write_file output/report.html
  -> publish_artifact
  -> FileAssetRef(source=artifact)
  -> Artifact(file_asset_ref_id)
  -> GET /api/v1/artifacts/:id/download

Agent reusable file
  -> write_file output/cleaned.csv
  -> promote_workspace_file
  -> FileAssetRef(source=workspace)
  -> GET /api/v1/files/:id/download

Knowledge import
  -> POST /api/v1/knowledge-bases/:id/files/import
  -> FileAssetRef content
  -> KnowledgeDocument(file_asset_ref_id)
  -> chunks / optional embeddings
```

## 边界

- Workspace 是 run-scoped 临时工作台，不是文件资产库。
- Artifact 是交付物，不是所有 workspace 文件的镜像。
- Knowledge 不保存原始文件，只保存索引投影。
- agent 必须显式调用 `publish_artifact` 或 `promote_workspace_file`，中间文件不会自动进入 FileAssetRef。
- 下载统一走 FileAsset 内容；旧 artifact `storage_path` 只作为兼容 fallback。

## 当前实现

- `packages/files`：`LocalFileAssetService`，负责 FileAsset/FileAssetRef 创建、读取、下载、workspace 物化。
- `packages/metadata`：`file_assets`、`file_asset_refs`，以及 artifact `file_asset_ref_id`。
- `apps/api`：`/api/v1/files`、`/api/v1/files/:id/download`、KB file import。
- `packages/artifacts`：`createArtifactFromFile()`，创建 artifact 引用统一文件资产。
- `packages/agent-runtime`：
  - run `fileIds` 注入 workspace `input/`。
  - `publish_artifact` 发布可下载交付物。
  - `promote_workspace_file` 提升可复用 workspace 文件。
  - 两个工具均走 ToolObservationAdapter。

## 后续

- 增加孤儿 FileAsset GC。
- 增加 PDF/DOCX/XLSX 解析器。
- 增加 artifact/file 引用在 ContextPackage 中的专用 `fileRefs`。
- 增加 workspace retention 清理任务。
