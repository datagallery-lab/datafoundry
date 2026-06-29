import React, { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type { DisplayMessage, DataArtifact, LiveToolCallRecord } from '../state/index.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallsView } from './ToolCallsView.js';

interface ChatAreaProps {
  messages: DisplayMessage[];
  artifacts: DataArtifact[];
  toolCalls?: LiveToolCallRecord[];
  autoScroll?: boolean;
  totalMessageCount?: number;
  maxMessageContentLength?: number;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  artifacts,
  toolCalls = [],
  autoScroll = true,
  totalMessageCount,
  maxMessageContentLength,
}) => {
  const messagesEndRef = useRef<boolean>(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messages.length > 0) {
      messagesEndRef.current = true;
    }
  }, [messages.length, autoScroll]);

  // Get active tool calls (running status)
  const activeToolCalls = toolCalls.filter(tc => tc.status === 'running');

  // Get recent completed tool calls for the last message
  const recentToolCalls = toolCalls
    .filter(tc => tc.status !== 'running')
    .slice(-5); // Show last 5 completed tool calls
  const messageCount = totalMessageCount ?? messages.length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Message list */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 && messageCount === 0 ? (
          <Box flexDirection="column" paddingY={2}>
            <Text dimColor>No messages yet. Start typing to begin...</Text>
            <Text dimColor>Type your question and press Enter to send.</Text>
          </Box>
        ) : messages.length === 0 ? (
          <Box />
        ) : (
          <>
            {messages.map((message, index) => {
              return (
                <Box key={message.id} flexDirection="column" marginBottom={1}>
                  <MessageBubble
                    message={message}
                    maxContentLength={maxMessageContentLength}
                    allToolCalls={toolCalls}
                  />
                </Box>
              );
            })}
          </>
        )}
      </Box>

      {/* Artifacts notice */}
      {artifacts.length > 0 && (
        <Box marginTop={1} paddingTop={1} borderStyle="single" borderTop>
          <Text color="magenta">
            New outputs available ({artifacts.length}). Use /outputs to view them.
          </Text>
        </Box>
      )}
    </Box>
  );
};
