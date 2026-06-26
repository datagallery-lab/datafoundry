import React, { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type { DisplayMessage, DataArtifact, LiveToolCallRecord } from '../state/index.js';
import { ArtifactCard } from './ArtifactCard.js';
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
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Chat History</Text>
        {messageCount > 0 && (
          <Text dimColor> ({messageCount} messages)</Text>
        )}
      </Box>

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

      {/* Artifacts section */}
      {artifacts.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingTop={1} borderStyle="single" borderTop>
          <Box marginBottom={1}>
            <Text bold color="magenta">Artifacts</Text>
            <Text dimColor> ({artifacts.length})</Text>
          </Box>
          <Box flexDirection="column">
            {artifacts.slice(-3).map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
            {artifacts.length > 3 && (
              <Text dimColor>... and {artifacts.length - 3} more</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
