import React from 'react';
import { Box, Text } from 'ink';
import type { LiveToolCallRecord } from '../state/index.js';

interface InlineToolCallProps {
  toolCall: LiveToolCallRecord;
  showName?: boolean;
}

/**
 * Display a single tool call inline within message content
 * Shows status icon, name, and duration
 */
export const InlineToolCall: React.FC<InlineToolCallProps> = ({
  toolCall,
  showName = true,
}) => {
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
        return '●';
      case 'success':
        return '✓';
      case 'failed':
        return '✗';
      default:
        return '?';
    }
  };

  const getStatusColor = (status: LiveToolCallRecord['status']) => {
    switch (status) {
      case 'running':
        return 'yellow' as const;
      case 'success':
        return 'green' as const;
      case 'failed':
        return 'red' as const;
      default:
        return 'gray' as const;
    }
  };

  const getDuration = (): string => {
    if (!toolCall.startedAtMs) return '';

    const endTime = toolCall.finishedAtMs || Date.now();
    const elapsedMs = endTime - toolCall.startedAtMs;

    if (elapsedMs < 1000) {
      return `${elapsedMs}ms`;
    } else if (elapsedMs < 60000) {
      return `${(elapsedMs / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(elapsedMs / 60000);
      const seconds = Math.floor((elapsedMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
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
