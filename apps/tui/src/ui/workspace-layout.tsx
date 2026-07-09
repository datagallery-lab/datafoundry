import React from 'react';
import { Box, Text } from 'ink';
import { queuedPromptDisplayRows } from './components/QueuedPromptDisplay.js';

export type WorkspaceTab = 'chat' | 'stats' | 'config' | 'outputs';

export function WorkspaceFrame({
  rows,
  columns,
  scrollableRows,
  scrollable,
  bottom,
}: {
  rows: number;
  columns: number;
  scrollableRows: number;
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
}) {
  const safeColumns = Math.max(1, Math.floor(columns));

  if (rows < 20) {
    return (
      <Box flexDirection="column" height={rows} width={safeColumns}>
        <Box paddingX={1} flexDirection="column">
          <Text color="yellow" bold>Terminal too small</Text>
          <Text color="gray">Resize to at least 80x20 for the DataFoundry TUI.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} width={safeColumns}>
      <Box
        height={Math.max(0, Math.floor(scrollableRows))}
        width={safeColumns}
        overflowY="hidden"
        flexDirection="column"
        flexShrink={0}
      >
        {scrollable}
      </Box>
      <Box width={safeColumns} flexShrink={0} flexDirection="column">
        {bottom}
      </Box>
    </Box>
  );
}

export function estimateControlsRows(
  options: {
    commandNotice: boolean;
    queuedPromptCount?: number | undefined;
    activeTab: WorkspaceTab;
    homeScreen?: boolean;
    inputBoxRows?: number | undefined;
  },
): number {
  if (options.homeScreen) {
    return 1;
  }

  const inputBoxRows = Math.max(5, Math.ceil(options.inputBoxRows ?? 5));
  const queueRows = queuedPromptDisplayRows(options.queuedPromptCount ?? 0);

  if (options.activeTab === 'chat') {
    return inputBoxRows + queueRows + (options.commandNotice ? 1 : 0);
  }
  return inputBoxRows + queueRows + (options.commandNotice ? 4 : 3);
}

/** Backward-compatible alias for older viewport tests/helpers. */
export const estimateBottomRows = estimateControlsRows;

/** Rows available for the main content after reserving the measured controls. */
export function availableContentRows(
  terminalRows: number,
  controlsRows: number,
): number {
  return Math.max(0, terminalRows - Math.max(0, Math.ceil(controlsRows)));
}

/** Rows available for chat transcript inside the scrollable slot. */
export const chatViewportRows = availableContentRows;
