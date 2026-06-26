import React from 'react';
import { Box, Text } from 'ink';
import type { DisplayMessage, LiveToolCallRecord } from '../state/index.js';
import { StreamingMessage } from './StreamingMessage.js';

interface MessageBubbleProps {
  message: DisplayMessage;
  maxContentLength?: number | undefined;
  allToolCalls?: LiveToolCallRecord[];
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  maxContentLength,
  allToolCalls = [],
}) => {
  // Get role color
  const getRoleColor = (role: DisplayMessage['role']): string => {
    switch (role) {
      case 'user':
        return 'blue';
      case 'assistant':
        return 'green';
      case 'system':
        return 'yellow';
      default:
        return 'gray';
    }
  };

  // Get role label
  const getRoleLabel = (role: DisplayMessage['role']): string => {
    switch (role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'Agent';
      case 'system':
        return 'System';
      default:
        return 'Unknown';
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      // Show only time if today
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } else {
      // Show date and time if not today
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
  };

  // Get border style for message bubble
  const getBorderColor = (role: DisplayMessage['role']): string => {
    switch (role) {
      case 'user':
        return 'blueBright';
      case 'assistant':
        return 'greenBright';
      case 'system':
        return 'yellowBright';
      default:
        return 'gray';
    }
  };
  return (
    <Box flexDirection="column">
      {/* Message header with role and timestamp */}
      <Box>
        <Text bold color={getRoleColor(message.role)}>
          {getRoleLabel(message.role)}
        </Text>
        <Text dimColor> • {formatTimestamp(message.timestamp)}</Text>
        {message.isStreaming && (
          <Text dimColor> • working...</Text>
        )}
      </Box>

      {/* Message content with tool calls */}
      <StreamingMessage
        message={message}
        allToolCalls={allToolCalls}
        maxContentLength={maxContentLength}
      />
    </Box>
  );
};
