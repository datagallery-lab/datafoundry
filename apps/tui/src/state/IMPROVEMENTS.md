# TUI 状态管理层改进总结

## 改进内容

### 1. 配置管理集成 ✅

**新增功能：**
- `TuiAppState` 扩展支持 `workspaceConfig: WorkspaceConfigStore`
- 包含所有配置类型：datasources (db), models (llm), skills, mcp, kb
- 提供 `setWorkspaceConfig()` 和 `updateConfigKind()` 方法
- 预置选择器：`selectEnabledDatasources`, `selectEnabledLlms`, `selectEnabledSkills`

**使用场景：**
```typescript
// 读取配置
const datasources = store.select(selectEnabledDatasources);

// 更新配置
store.updateConfigKind('llm', [...newLlmConfigs]);
```

### 2. 会话级统计累积 ✅

**新增功能：**
- `TuiAppState` 新增 `sessionStats: SessionUsageStats`
- 自动累积统计：run 完成时自动调用 `accumulateSessionUsage()`
- 区分已完成统计和实时视图（包含进行中的 run）
- 统计维度：
  - 运行次数（总数/成功/失败）
  - 工具调用（总数/成功/失败/按工具分组）
  - SQL 查询（总数/成功/失败/扫描行数/耗时）
  - Token 使用（输入/输出）
  - 产出物数量

**使用场景：**
```typescript
// 获取实时统计（包含进行中）
const liveView = store.select(selectLiveSessionView);
console.log('Total runs:', liveView.runCount);
console.log('Tool calls:', liveView.toolCalls);

// 获取已完成的累积统计
const sessionStats = store.getState().sessionStats;
console.log('Completed runs:', sessionStats.completedRuns);
```

### 3. 派生状态选择器 ✅

**新增功能：**
- 实现选择器缓存机制（`selectorCache`）
- 提供 `store.select(selector)` 方法
- 预置 10+ 常用选择器：
  - `selectLiveSessionView` - 实时会话视图
  - `selectCurrentRunStats` - 当前 run 统计
  - `selectIsRunning` - 运行状态
  - `selectIsConnected` - 连接状态
  - `selectToolCallSuccessRate` - 工具调用成功率
  - `selectSqlSuccessRate` - SQL 成功率
  - 等等...

**性能优化：**
```typescript
// 选择器结果会被缓存，状态不变时直接返回缓存
const view1 = store.select(selectLiveSessionView); // 计算
const view2 = store.select(selectLiveSessionView); // 返回缓存

// 状态变化后缓存自动失效
store.handleLiveRunEvent({...});
const view3 = store.select(selectLiveSessionView); // 重新计算
```

### 4. 状态重置优化 ✅

**新增功能：**
- `reset()` - 重置整个会话（保留配置）
- `resetRun()` - 仅重置当前 run（保留会话统计和配置）

**使用场景：**
```typescript
// 开始新会话
store.reset();

// 仅重置当前 run（保留历史统计）
store.resetRun();
```

## 架构优势

### 1. 复用 Web 层核心逻辑

通过 symlink 复用：
- `live-run-state.ts` - 运行状态管理和统计逻辑
- `data-task-state.ts` - 配置管理和类型定义
- `workspace-layout.ts` - 工作区布局

**优势：**
- 避免代码重复
- 保持 TUI 和 Web 行为一致
- 共享测试覆盖

### 2. 清晰的状态层次

```
TuiAppState (TUI 完整状态)
├── TuiSessionState (会话状态)
│   ├── LiveRun (运行状态 - 复用)
│   │   ├── plan, events, artifacts, audits
│   │   ├── runStatus, toolCalls
│   │   └── tokenUsage
│   ├── messages (TUI 特有)
│   ├── inputBuffer (TUI 特有)
│   └── connectionStatus (TUI 特有)
├── workspaceConfig (新增)
│   ├── db, llm, skill
│   └── kb, mcp
└── sessionStats (新增)
    ├── runCount, completedRuns, failedRuns
    ├── toolCalls, sql, tokens
    └── artifactCount
```

### 3. 性能优化设计

**选择器缓存：**
- 避免重复计算派生状态
- 状态变化时自动失效
- 支持自定义选择器

**细粒度订阅：**
- 订阅者可使用选择器过滤变化
- 避免不必要的 UI 重渲染

## 使用建议

### 1. 优先使用选择器

```typescript
// ✅ 推荐
const isRunning = store.select(selectIsRunning);

// ❌ 不推荐
const isRunning = store.getState().runStatus === 'running';
```

### 2. 配置持久化

```typescript
// 加载配置
const savedConfig = loadFromFile('config.json');
store.setWorkspaceConfig(savedConfig);

// 保存配置
const config = store.getState().workspaceConfig;
saveToFile('config.json', config);
```

### 3. 统计展示

```typescript
// 定期显示会话统计
setInterval(() => {
  const stats = store.select(selectLiveSessionView);
  console.log(`📊 会话统计:
    - 运行: ${stats.completedRuns}/${stats.runCount}
    - 工具: ${stats.toolCalls.total} (成功率 ${(stats.toolCalls.success / stats.toolCalls.total * 100).toFixed(1)}%)
    - SQL: ${stats.sql.total} (${stats.sql.rowsScanned} 行)
    - Token: ${stats.tokens.inputTokens + stats.tokens.outputTokens}
  `);
}, 60000);
```

## 文件清单

### 修改的文件
- `apps/tui/src/state/store.ts` - 核心状态管理（重写）
- `apps/tui/src/state/index.ts` - 导出更新

### 新增的文件
- `apps/tui/src/state/store-usage-examples.md` - 使用指南
- `apps/tui/src/state/IMPROVEMENTS.md` - 本文档

### 已有的 symlink（无需修改）
- `apps/tui/src/state/live-run-state.ts` → `apps/web/...`
- `apps/tui/src/state/data-task-state.ts` → `apps/web/...`
- `apps/tui/src/state/workspace-layout.ts` → `apps/web/...`

## 后续建议

### 1. 配置管理 UI

为 TUI 添加配置管理界面：
- 列表/编辑数据源
- 切换 LLM 模型
- 管理技能包
- 查看连接状态

### 2. 统计面板

添加实时统计面板：
- 会话级别概览
- 当前 run 详情
- 成功率图表
- Token 使用趋势

### 3. 配置持久化

实现配置文件读写：
```typescript
// ~/.config/dataagent-tui/config.json
{
  "workspaceConfig": {...},
  "preferences": {...}
}
```

### 4. 性能监控

添加性能指标：
- 状态更新频率
- 选择器命中率
- 重渲染次数

### 5. 测试覆盖

补充单元测试：
- 状态更新逻辑
- 选择器正确性
- 统计累积准确性
- 配置验证

## 总结

✅ **已完成：**
- 配置管理状态集成
- 会话级统计自动累积
- 派生状态选择器和缓存
- 性能优化机制

✅ **架构优势：**
- 复用 Web 层核心逻辑（symlink）
- 清晰的状态层次和关注点分离
- 高性能选择器机制
- 易于扩展和测试

📖 **文档支持：**
- 完整的使用指南（store-usage-examples.md）
- 详细的改进说明（本文档）
- 代码注释和类型定义

🎯 **下一步：**
- 在 TUI 主循环中集成新的 store
- 实现配置管理 UI
- 添加统计面板展示
- 补充单元测试
