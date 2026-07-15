/**
 * DataFoundry TUI 统一颜色主题
 *
 * 设计原则：
 * - 只保留一种主强调色（accent）用于交互和选中状态
 * - 其他颜色仅用于表达状态（success/warning/error）
 * - 避免多种颜色同时争夺注意力
 * - 使用低饱和度颜色提升专业感
 */

export const theme = {
  // 背景和基础
  background: '#0B0F14',
  surface: '#121820',
  border: '#27313C',
  focus: '#496783',

  // 文本
  text: '#E6EDF3',
  emphasis: '#B7C0C8',
  muted: '#7D8590',
  subtle: '#5F6975',

  // 语义色（低饱和度）
  accent: '#6CA8E8',    // 主强调色：当前模式、选中项、主要交互
  success: '#88C980',   // 成功状态：工具执行成功、连接正常
  warning: '#D8B76A',   // 警告状态：仅用于真正需要注意的问题
  error: '#F87171',     // 错误状态：失败、错误
} as const;

/**
 * 颜色使用映射
 * 定义了各个UI元素应该使用的颜色
 */
export const colorUsage = {
  // 标题和品牌
  appTitle: theme.accent,

  // 选中和激活状态
  selectedItem: theme.accent,
  activeMode: theme.accent,
  activeBorder: theme.accent,

  // 文件和资源名称
  fileName: theme.accent,
  resourceName: theme.text,

  // 状态指示器
  connected: theme.success,
  running: theme.warning,
  completed: theme.success,
  failed: theme.error,
  idle: theme.muted,

  // 工具调用
  toolSuccess: theme.success,
  toolRunning: theme.warning,
  toolFailed: theme.error,
  toolName: theme.muted,

  // 系统通知（降级处理，不再使用 magenta）
  systemNotice: theme.muted,
  outputsNotice: theme.muted,

  // 次要信息
  timestamp: theme.muted,
  metadata: theme.muted,
  dimText: theme.muted,
} as const;

/**
 * Ink 颜色映射。
 *
 * Ink/Chalk 支持 hex 字符串，这里直接暴露低饱和主题色，避免组件
 * 退回到高饱和的 cyan/yellow/green。
 */
export const inkColors = {
  background: theme.background,
  surface: theme.surface,
  border: theme.border,
  focus: theme.focus,
  accent: theme.accent,
  success: theme.success,
  warning: theme.warning,
  error: theme.error,
  emphasis: theme.emphasis,
  muted: theme.muted,
  subtle: theme.subtle,
  text: theme.text,
} as const;

/**
 * 获取状态对应的颜色
 */
export function getStatusColor(status: string): typeof inkColors[keyof typeof inkColors] {
  switch (status) {
    case 'success':
    case 'completed':
    case 'connected':
      return inkColors.success;
    case 'running':
    case 'pending':
      return inkColors.warning;
    case 'failed':
    case 'error':
    case 'disconnected':
      return inkColors.error;
    case 'cancelled':
    case 'idle':
    default:
      return inkColors.muted;
  }
}

export function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const kib = safeBytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MB`;
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/\/+$/u, '');
  return normalized.split('/').pop() || normalized;
}

/**
 * 颜色使用指南
 *
 * ✅ 推荐使用：
 * - accent: 选中项、当前模式、可交互元素、文件名
 * - success: 工具执行成功、连接正常
 * - warning: 真正需要用户注意的警告（不是所有运行中状态）
 * - muted (dimColor): 时间戳、快捷键、系统通知、次要信息
 *
 * ❌ 避免使用：
 * - magenta/purple: 已移除，用 muted 或 accent 替代
 * - 同时使用多种高亮色在相邻元素上
 * - 大面积背景色（除非是真正的错误/警告）
 *
 * 示例：
 * ```tsx
 * import { inkColors, getStatusColor } from './theme.js';
 *
 * // 选中项
 * <Text color={selected ? inkColors.accent : undefined}>Item</Text>
 *
 * // 状态指示
 * <Text color={getStatusColor(toolCall.status)}>✓</Text>
 *
 * // 次要信息
 * <Text dimColor>2.3s</Text>
 * ```
 */
