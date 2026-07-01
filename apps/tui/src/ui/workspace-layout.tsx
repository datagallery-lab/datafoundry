import React from 'react';
import { Box, Text } from 'ink';

export function WorkspaceFrame({
  rows,
  scrollable,
  bottom,
}: {
  rows: number;
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
}) {
  if (rows < 20) {
    return (
      <Box flexDirection="column" minHeight={rows}>
        <Box paddingX={1} flexDirection="column">
          <Text color="yellow" bold>Terminal too small</Text>
          <Text color="gray">Resize to at least 80x20 for the DataFoundry TUI.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" minHeight={rows}>
      <Box flexGrow={1} overflowY="hidden" flexDirection="column">
        {scrollable}
      </Box>
      <Box flexShrink={0} flexDirection="column">
        {bottom}
      </Box>
    </Box>
  );
}

/** Rows available for chat transcript inside the scrollable slot. */
export function chatViewportRows(
  terminalRows: number,
  options: { commandNotice: boolean; activeTab: 'chat' | 'stats' | 'config' | 'outputs' },
): number {
  const bottomRows = options.activeTab === 'chat'
    ? (options.commandNotice ? 5 : 4)
    : (options.commandNotice ? 9 : 8);
  return Math.max(5, terminalRows - bottomRows);
}
