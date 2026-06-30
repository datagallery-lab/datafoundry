import React from 'react';
import { Box, Text } from 'ink';
import type { DataArtifact, DisplayMessage, LiveToolCallRecord } from '../state/index.js';
import { MessageBubble } from './MessageBubble.js';

type ChatItem =
  | { id: string; type: 'empty' }
  | { id: string; type: 'spacer' }
  | { id: string; type: 'message'; message: DisplayMessage }
  | { id: string; type: 'artifacts'; artifacts: DataArtifact[] };

interface ChatAreaProps {
  messages: DisplayMessage[];
  artifacts: DataArtifact[];
  toolCalls?: LiveToolCallRecord[];
  totalMessageCount?: number;
  maxMessageContentLength?: number;
  viewportRows?: number;
  scrollbackRows?: number;
  columns?: number;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  artifacts,
  toolCalls = [],
  totalMessageCount,
  maxMessageContentLength,
  viewportRows,
  scrollbackRows = 0,
  columns = 100,
}) => {
  const items = chatItems(messages, artifacts, totalMessageCount);
  const safeViewportRows = viewportRows === undefined ? undefined : Math.max(1, viewportRows);
  const window = safeViewportRows === undefined
    ? undefined
    : chatRowWindow(items, safeViewportRows, scrollbackRows, columns, maxMessageContentLength);
  const visibleItems = window ? items.slice(window.itemStart, window.itemEnd) : items;

  const content = (
    <Box flexDirection="column">
      {visibleItems.map((item) => renderChatItem(item, toolCalls, maxMessageContentLength))}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {window && safeViewportRows !== undefined ? (
        <Box height={safeViewportRows} overflowY="hidden" flexDirection="column">
          <Box flexDirection="column" marginTop={-window.topCropRows}>
            {content}
          </Box>
        </Box>
      ) : content}
    </Box>
  );
};

export function estimateChatRows({
  messages,
  artifacts,
  totalMessageCount,
  maxMessageContentLength,
  columns = 100,
}: {
  messages: DisplayMessage[];
  artifacts: DataArtifact[];
  totalMessageCount?: number;
  maxMessageContentLength?: number;
  columns?: number;
}): number {
  return chatTotalRows(chatItems(messages, artifacts, totalMessageCount), columns, maxMessageContentLength);
}

function chatItems(
  messages: DisplayMessage[],
  artifacts: DataArtifact[],
  totalMessageCount?: number,
): ChatItem[] {
  const messageCount = totalMessageCount ?? messages.length;
  if (messages.length === 0 && messageCount === 0) {
    return [{ id: 'empty', type: 'empty' }];
  }

  const items: ChatItem[] = messages.map((message) => ({
    id: message.id,
    type: 'message',
    message,
  }));

  if (messages.length === 0 && messageCount > 0) {
    items.push({ id: 'spacer', type: 'spacer' });
  }

  if (artifacts.length > 0) {
    items.push({ id: 'artifacts', type: 'artifacts', artifacts });
  }

  return items;
}

function renderChatItem(
  item: ChatItem,
  toolCalls: LiveToolCallRecord[],
  maxMessageContentLength?: number,
): React.ReactNode {
  if (item.type === 'empty') {
    return (
      <Box key={item.id} flexDirection="column" paddingY={2}>
        <Text dimColor>No messages yet. Start typing to begin...</Text>
        <Text dimColor>Type your question and press Enter to send.</Text>
      </Box>
    );
  }

  if (item.type === 'spacer') {
    return <Box key={item.id} />;
  }

  if (item.type === 'artifacts') {
    return (
      <Box key={item.id} marginTop={1} paddingTop={1} borderStyle="single" borderTop>
        <Text color="magenta">
          New outputs available ({item.artifacts.length}). Use /outputs to view them.
        </Text>
      </Box>
    );
  }

  return (
    <Box key={item.id} flexDirection="column" marginBottom={1}>
      <MessageBubble
        message={item.message}
        maxContentLength={maxMessageContentLength}
        allToolCalls={toolCalls}
      />
    </Box>
  );
}

function chatRowWindow(
  items: ChatItem[],
  viewportRows: number,
  scrollbackRows: number,
  columns: number,
  maxMessageContentLength?: number,
) {
  const itemRows = items.map((item) => estimateChatItemRows(item, columns, maxMessageContentLength));
  const totalRows = itemRows.reduce((total, rows) => total + rows, 0);
  const safeViewportRows = Math.max(1, viewportRows);
  const safeScrollback = Math.max(0, Math.min(scrollbackRows, Math.max(0, totalRows - safeViewportRows)));
  const visibleEnd = totalRows - safeScrollback;
  const visibleStart = Math.max(0, visibleEnd - safeViewportRows);
  const overscanRows = 2;

  let cursor = 0;
  let itemStart = 0;
  let itemEnd = items.length;

  for (let index = 0; index < itemRows.length; index += 1) {
    const next = cursor + itemRows[index]!;
    if (next > Math.max(0, visibleStart - overscanRows)) {
      itemStart = index;
      break;
    }
    cursor = next;
  }

  let endCursor = cursor;
  for (let index = itemStart; index < itemRows.length; index += 1) {
    endCursor += itemRows[index]!;
    if (endCursor >= visibleEnd + overscanRows) {
      itemEnd = index + 1;
      break;
    }
  }

  return {
    safeScrollback,
    totalRows,
    visibleStart,
    visibleEnd,
    itemStart,
    itemEnd,
    topCropRows: Math.max(0, visibleStart - cursor),
  };
}

function chatTotalRows(
  items: ChatItem[],
  columns: number,
  maxMessageContentLength?: number,
): number {
  return items.reduce((total, item) => total + estimateChatItemRows(item, columns, maxMessageContentLength), 0);
}

function estimateChatItemRows(
  item: ChatItem,
  columns: number,
  maxMessageContentLength?: number,
): number {
  if (item.type === 'empty') {
    return 2;
  }
  if (item.type === 'spacer') {
    return 1;
  }
  if (item.type === 'artifacts') {
    return 3;
  }

  return estimateMessageRows(item.message, Math.max(20, columns - 8), maxMessageContentLength) + 1;
}

function estimateMessageRows(
  message: DisplayMessage,
  width: number,
  maxMessageContentLength?: number,
): number {
  let rows = 1;
  message.elements.forEach((element, index) => {
    if (element.type === 'tool_call') {
      rows += 3;
      return;
    }

    const isLastElement = index === message.elements.length - 1;
    const shouldTrimContent = Boolean(
      isLastElement &&
      message.isStreaming &&
      maxMessageContentLength &&
      element.content.length > maxMessageContentLength,
    );
    const visibleContent = shouldTrimContent && maxMessageContentLength
      ? `...${element.content.slice(-maxMessageContentLength)}`
      : element.content;
    rows += estimateTextRows(visibleContent, width);
  });
  if (message.isStreaming) {
    rows += 1;
  }
  return Math.max(1, rows);
}

function estimateTextRows(text: string, width: number): number {
  const lines = text.length > 0 ? text.split('\n') : [''];
  return lines.reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / Math.max(1, width)));
  }, 0);
}
