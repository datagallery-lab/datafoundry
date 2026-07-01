import React from 'react';
import { Box, Text } from 'ink';
import type { DataArtifact, DisplayMessage, LiveToolCallRecord } from '../state/index.js';
import {
  buildChatLines,
  chatContentWidth,
  countChatLines,
  type StartupInfo,
} from './transcript-lines.js';

export { chatContentWidth, countChatLines };
export type { StartupInfo };

interface ChatAreaProps {
  messages: DisplayMessage[];
  artifacts: DataArtifact[];
  toolCalls?: LiveToolCallRecord[];
  totalMessageCount?: number;
  maxMessageContentLength?: number | undefined;
  viewportRows?: number;
  scrollbackRows?: number;
  columns?: number;
  startup?: StartupInfo | undefined;
}

/**
 * Chat transcript viewport.
 *
 * The transcript is rendered into a flat list of single-row lines (see
 * {@link buildChatLines}), then the visible window is an exact slice of that
 * list. Because each line is pre-wrapped to the content width, Ink renders one
 * terminal row per line and the row count is deterministic - so scrolling is a
 * pure integer slice with no height estimation and no negative-margin cropping.
 */
export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  artifacts,
  toolCalls = [],
  totalMessageCount,
  maxMessageContentLength,
  viewportRows,
  scrollbackRows = 0,
  columns = 100,
  startup,
}) => {
  const lines = buildChatLines({
    messages,
    artifacts,
    toolCalls,
    totalMessageCount,
    maxMessageContentLength,
    columns,
    startup,
  });

  if (viewportRows === undefined) {
    return (
      <Box flexDirection="column">
        {lines.map((line) => line.node)}
      </Box>
    );
  }

  const viewport = Math.max(1, viewportRows);
  const total = lines.length;
  const maxScroll = Math.max(0, total - viewport);
  const safeScroll = Math.max(0, Math.min(scrollbackRows, maxScroll));
  const top = Math.max(0, total - viewport - safeScroll);
  const visible = lines.slice(top, top + viewport);
  // The startup banner should sit at the top on a fresh session. Once chat
  // content exists, keep the newest content pinned near the input as before.
  const messageCount = totalMessageCount ?? messages.length;
  const topAlignStartup = startup !== undefined && messages.length === 0 && messageCount === 0;
  const padCount = Math.max(0, viewport - visible.length);
  const topPadding = topAlignStartup ? 0 : padCount;
  const bottomPadding = topAlignStartup ? padCount : 0;

  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      <Box height={viewport} flexDirection="column" overflowY="hidden">
        {Array.from({ length: topPadding }, (_, index) => (
          <Text key={`pad:${index}`}> </Text>
        ))}
        {visible.map((line) => line.node)}
        {Array.from({ length: bottomPadding }, (_, index) => (
          <Text key={`pad-bottom:${index}`}> </Text>
        ))}
      </Box>
    </Box>
  );
};
