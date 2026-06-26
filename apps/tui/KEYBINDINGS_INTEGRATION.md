# 键盘快捷键系统集成示例

## 文件说明

### 1. `/apps/tui/src/ui/keybindings.ts`
核心键盘快捷键管理模块，包含：

- **CommandHistory**: 命令历史管理器
  - `add(command)`: 添加命令到历史
  - `previous()`: 获取上一条命令 (↑)
  - `next()`: 获取下一条命令 (↓)
  - `reset()`: 重置导航状态
  - `clear()`: 清空历史

- **CommandCompletion**: 命令补全管理器
  - `complete(input)`: 获取补全建议
  - `getCompletions(input)`: 获取所有匹配项
  - `setCommands(commands)`: 更新可用命令列表
  - `reset()`: 重置补全状态

- **KEYBINDINGS**: 快捷键定义数组
- **getStatusBarShortcuts()**: 获取状态栏显示的快捷键

### 2. `/apps/tui/src/ui/InputBox.tsx`
增强的输入框组件，集成了历史记录和命令补全：

```typescript
<InputBox
  value={state.inputBuffer}
  onChange={handleInputChange}
  onSubmit={handleSubmit}
  disabled={false}
  commands={['show tables', 'describe table', 'help']} // 可选的命令列表
/>
```

**支持的快捷键**：
- `Enter`: 提交输入
- `↑`: 上一条历史命令
- `↓`: 下一条历史命令
- `Tab`: 命令补全（循环所有匹配项）
- `Ctrl+U`: 清空当前输入
- `Ctrl+W`: 删除一个单词
- `Backspace`: 删除字符

### 3. `/apps/tui/src/ui/KeybindingsHelp.tsx`
快捷键帮助显示组件：

```typescript
// 紧凑模式
<KeybindingsHelp compact />

// 完整模式
<KeybindingsHelp />

// 状态栏指示器
<ShortcutsIndicator />
```

### 4. `/apps/tui/src/ui/App.tsx`
主应用组件，集成全局快捷键：

**全局快捷键**：
- `Ctrl+C`: 退出应用
- `Ctrl+L`: 清空屏幕（保留 thread）
- `Ctrl+T`: 切换标签页
- `Ctrl+N`: 新建会话
- `Tab`: 循环切换标签页
- `1/2/3`: 快速切换到对应标签页

## 使用示例

### 基本用法

```typescript
import { CommandHistory, CommandCompletion, DEFAULT_COMMANDS } from './keybindings.js';

// 创建历史管理器
const history = new CommandHistory(100); // 最多保存 100 条

// 添加命令
history.add('show tables');
history.add('describe users');

// 导航历史
const prev = history.previous(); // 'describe users'
const prev2 = history.previous(); // 'show tables'
const next = history.next(); // 'describe users'

// 创建补全管理器
const completion = new CommandCompletion([
  'show tables',
  'show schema',
  'describe table',
  'help',
]);

// 获取补全
const result = completion.complete('sho'); // 'show tables'
const result2 = completion.complete('sho'); // 'show schema' (循环)

// 获取所有匹配
const matches = completion.getCompletions('sho'); // ['show tables', 'show schema']
```

### 在 React 组件中使用

```typescript
import React, { useRef, useState } from 'react';
import { useInput } from 'ink';
import { CommandHistory, CommandCompletion } from './keybindings.js';

function MyInput() {
  const [input, setInput] = useState('');
  const historyRef = useRef(new CommandHistory());
  const completionRef = useRef(new CommandCompletion(['command1', 'command2']));

  useInput((char, key) => {
    if (key.upArrow) {
      const prev = historyRef.current.previous();
      if (prev) setInput(prev);
    } else if (key.downArrow) {
      const next = historyRef.current.next();
      if (next !== null) setInput(next);
    } else if (key.tab) {
      const completion = completionRef.current.complete(input);
      if (completion) setInput(completion);
    } else if (key.return) {
      historyRef.current.add(input);
      handleSubmit(input);
      setInput('');
    }
  });

  return <Text>{input}</Text>;
}
```

### 自定义命令列表

```typescript
// 动态更新命令补全列表
const [availableCommands, setAvailableCommands] = useState<string[]>([]);

useEffect(() => {
  // 从数据源加载可用命令
  fetchAvailableCommands().then(commands => {
    setAvailableCommands(commands);
  });
}, []);

// 传递给 InputBox
<InputBox
  commands={availableCommands}
  // ... 其他 props
/>
```

## 快捷键参考

### 系统快捷键
- `Ctrl+C`: 退出应用
- `Ctrl+L`: 清空屏幕

### 导航快捷键
- `Tab`: 切换标签页（循环）
- `Ctrl+T`: 切换标签页（同 Tab）
- `1`: 切换到聊天标签
- `2`: 切换到统计标签
- `3`: 切换到配置标签

### 会话快捷键
- `Ctrl+N`: 新建会话
- `Ctrl+R`: 重置会话（如需添加）

### 输入快捷键
- `↑`: 上一条历史命令
- `↓`: 下一条历史命令
- `Tab`: 命令补全（在输入框焦点时）
- `Enter`: 发送消息
- `Backspace`: 删除字符
- `Ctrl+U`: 清空输入
- `Ctrl+W`: 删除单词

## 扩展指南

### 添加新的快捷键

1. 在 `keybindings.ts` 中添加定义：

```typescript
export const KEYBINDINGS: KeybindingAction[] = [
  // ... 现有快捷键
  { key: 'Ctrl+H', description: 'Show help', category: 'system' },
];
```

2. 在 `App.tsx` 中实现处理逻辑：

```typescript
useInput((input, key) => {
  // ... 现有处理
  
  // 新增快捷键
  if (key.ctrl && input === 'h') {
    setActiveTab('help');
    return;
  }
});
```

### 添加新的命令类别

```typescript
// 在 keybindings.ts 中
export const SQL_COMMANDS = [
  'SELECT * FROM',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'DROP TABLE',
];

export const DATA_COMMANDS = [
  'show tables',
  'describe table',
  'show schema',
  'explain query',
];

// 合并使用
const allCommands = [...SQL_COMMANDS, ...DATA_COMMANDS, ...DEFAULT_COMMANDS];
```

### 持久化历史记录

```typescript
// 保存到本地存储
class PersistentCommandHistory extends CommandHistory {
  constructor(maxSize: number, storageKey: string) {
    super(maxSize);
    this.loadFromStorage(storageKey);
  }

  add(command: string): void {
    super.add(command);
    this.saveToStorage();
  }

  private loadFromStorage(key: string): void {
    const stored = localStorage.getItem(key);
    if (stored) {
      const history = JSON.parse(stored);
      history.forEach((cmd: string) => super.add(cmd));
    }
  }

  private saveToStorage(key: string): void {
    localStorage.setItem(key, JSON.stringify(this.getAll()));
  }
}
```

## 测试

### 单元测试示例

```typescript
import { CommandHistory, CommandCompletion } from './keybindings';

describe('CommandHistory', () => {
  it('should navigate history', () => {
    const history = new CommandHistory();
    history.add('cmd1');
    history.add('cmd2');
    
    expect(history.previous()).toBe('cmd2');
    expect(history.previous()).toBe('cmd1');
    expect(history.next()).toBe('cmd2');
  });
});

describe('CommandCompletion', () => {
  it('should complete commands', () => {
    const completion = new CommandCompletion(['show', 'show tables']);
    
    expect(completion.complete('sho')).toBe('show');
    expect(completion.complete('sho')).toBe('show tables');
  });
});
```

## 性能优化

1. **使用 useRef 而不是 useState**：历史和补全状态不需要触发重渲染
2. **限制历史大小**：默认 100 条，避免内存溢出
3. **防抖输入**：对于实时补全提示，考虑添加防抖
4. **懒加载命令列表**：大量命令时按需加载

## 注意事项

1. **输入焦点管理**：确保全局快捷键不干扰输入框
2. **快捷键冲突**：避免与系统或终端默认快捷键冲突
3. **可访问性**：提供清晰的快捷键提示和帮助文档
4. **跨平台兼容**：某些快捷键在不同操作系统上可能不同
