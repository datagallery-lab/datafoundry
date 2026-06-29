import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { DisplayMessage, LiveToolCallRecord } from '../state/index.js';
import { MarkdownText } from './MarkdownText.js';
import { InlineToolCall } from './InlineToolCall.js';

interface StreamingMessageProps {
  message: DisplayMessage;
  allToolCalls: LiveToolCallRecord[];
  maxContentLength?: number | undefined;
}

/**
 * Render a message by displaying its elements in order (ReAct style)
 * Elements can be text or tool calls, shown as they were received
 */
export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  message,
  allToolCalls,
  maxContentLength,
}) => {
  const showThinking = message.elements.length === 0 && Boolean(message.isStreaming);
  const [thinkingTick, setThinkingTick] = useState(0);

  useEffect(() => {
    if (!showThinking) return;

    const timer = setInterval(() => {
      setThinkingTick((tick) => (tick + 1) % 8);
    }, 360);

    return () => clearInterval(timer);
  }, [showThinking]);

  // If no elements, show a light pulsing placeholder while waiting for the first token/tool.
  if (showThinking) {
    const dotCount = thinkingTick % 4;
    const thinkingText = `thinking${'.'.repeat(dotCount)}${' '.repeat(3 - dotCount)}`;
    const bright = thinkingTick % 2 === 0;

    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={bright ? 'white' : 'gray'} dimColor={!bright}>
          {thinkingText}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {message.elements.map((element, index) => {
        if (element.type === 'text') {
          // Apply content length limit only to the last text element if streaming
          const isLastElement = index === message.elements.length - 1;
          const shouldTrimContent = Boolean(
            isLastElement &&
            message.isStreaming &&
            maxContentLength &&
            element.content.length > maxContentLength,
          );
          const visibleContent = shouldTrimContent && maxContentLength
            ? `...${element.content.slice(-maxContentLength)}`
            : element.content;

          return (
            <Box key={`element-${index}`} flexDirection="column">
              <MarkdownText content={visibleContent} />
            </Box>
          );
        } else if (element.type === 'tool_call') {
          // Render tool call
          const toolCall = allToolCalls.find(tc => tc.id === element.toolCallId);
          if (!toolCall) return null;

          return (
            <Box key={`element-${index}`} marginTop={1} marginBottom={1}>
              <InlineToolCall toolCall={toolCall} showName={true} />
            </Box>
          );
        }

        return null;
      })}

      {/* Show streaming cursor after all elements */}
      {message.isStreaming && message.elements.length > 0 && (
        <Text dimColor> ▊</Text>
      )}
    </Box>
  );
};
