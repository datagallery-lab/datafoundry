import React from 'react';
import { Box, Text } from 'ink';
import type { LiveToolCallRecord } from '../state/index.js';

const RUNNING_TOOL_FRAME_MS = 250;
const RUNNING_TOOL_FRAMES = ['◐', '◓', '◑', '◒'] as const;

interface InlineToolCallProps {
  toolCall: LiveToolCallRecord;
  showName?: boolean;
}

function formatElapsedDuration(elapsedMs: number, status: LiveToolCallRecord['status']): string {
  const safeElapsedMs = Math.max(0, elapsedMs);

  if (status === 'running') {
    const totalSeconds = Math.floor(safeElapsedMs / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  if (safeElapsedMs < 1000) {
    return `${Math.round(safeElapsedMs)}ms`;
  }

  if (safeElapsedMs < 60000) {
    return `${(safeElapsedMs / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(safeElapsedMs / 60000);
  const seconds = Math.floor((safeElapsedMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Display a single tool call inline within message content
 * Shows status icon, name, and duration
 */
export const InlineToolCall: React.FC<InlineToolCallProps> = ({
  toolCall,
  showName = true,
}) => {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [frameIndex, setFrameIndex] = React.useState(0);

  React.useEffect(() => {
    if (
      (toolCall.status !== 'running' && toolCall.status !== 'pending') ||
      !toolCall.startedAtMs
    ) {
      setFrameIndex(0);
      return;
    }

    setNowMs(Date.now());
    setFrameIndex((index) => (index + 1) % RUNNING_TOOL_FRAMES.length);
    const interval = setInterval(() => {
      setNowMs(Date.now());
      setFrameIndex((index) => (index + 1) % RUNNING_TOOL_FRAMES.length);
    }, RUNNING_TOOL_FRAME_MS);

    return () => clearInterval(interval);
  }, [toolCall.status, toolCall.startedAtMs]);

  const getToolDisplayName = (name: string): string => {
    const displayNames: Record<string, string> = {
      'run_sql_readonly': 'Execute SQL',
      'inspect_schema': 'Inspect Schema',
      'list_data_sources': 'List Datasources',
      'get_table_schema': 'Get Table Schema',
      'query_data': 'Query Data',
    };
    return displayNames[name] || name;
  };

  const getStatusIcon = (status: LiveToolCallRecord['status']): string => {
    switch (status) {
      case 'running':
        return RUNNING_TOOL_FRAMES[frameIndex];
      case 'pending':
        return '○';
      case 'success':
        return '✓';
      case 'failed':
        return '✗';
      case 'cancelled':
        return '⊘';
      default:
        return '?';
    }
  };

  const getStatusColor = (status: LiveToolCallRecord['status']) => {
    switch (status) {
      case 'running':
        return 'yellow' as const;
      case 'pending':
        return 'gray' as const;
      case 'success':
        return 'green' as const;
      case 'failed':
        return 'red' as const;
      case 'cancelled':
        return 'yellow' as const;
      default:
        return 'gray' as const;
    }
  };

  const getDuration = (): string => {
    if (!toolCall.startedAtMs) return '';

    const isActive = toolCall.status === 'running' || toolCall.status === 'pending';
    const endTime = toolCall.finishedAtMs ?? (isActive ? nowMs : toolCall.startedAtMs);
    const elapsedMs = endTime - toolCall.startedAtMs;

    return formatElapsedDuration(elapsedMs, toolCall.status);
  };

  const icon = getStatusIcon(toolCall.status);
  const color = getStatusColor(toolCall.status);
  const duration = getDuration();

  return (
    <Box>
      <Text color={color}>{icon}</Text>
      {showName && (
        <>
          <Text dimColor> </Text>
          <Text dimColor>{getToolDisplayName(toolCall.name)}</Text>
        </>
      )}
      {duration && (
        <>
          <Text dimColor> (</Text>
          <Text dimColor>{duration}</Text>
          <Text dimColor>)</Text>
        </>
      )}
    </Box>
  );
};
