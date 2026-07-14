import React from 'react';
import { Box, Text } from 'ink';
import { queuedPromptDisplayRows } from './components/QueuedPromptDisplay.js';
import { inkColors } from './theme.js';

export type WorkspaceTab = 'chat' | 'stats' | 'config' | 'outputs';

export const OUTPUTS_SIDEBAR_COLUMNS = 42;
export const OUTPUTS_SIDEBAR_BREAKPOINT_COLUMNS = 120;

export interface MainPaneColumns {
  chatColumns: number;
  outputsColumns: number;
  outputsVisible: boolean;
}

export function preferredOutputsSidebarColumns(columns: number): number {
  return Math.min(OUTPUTS_SIDEBAR_COLUMNS, Math.max(0, Math.floor(columns) - 1));
}

export function resolveMainPaneColumns({
  columns,
}: {
  columns: number;
}): MainPaneColumns {
  const safeColumns = Math.max(1, Math.floor(columns));
  const canShowOutputs = safeColumns > OUTPUTS_SIDEBAR_BREAKPOINT_COLUMNS;

  if (!canShowOutputs) {
    return {
      chatColumns: safeColumns,
      outputsColumns: 0,
      outputsVisible: false,
    };
  }

  const outputsColumns = preferredOutputsSidebarColumns(safeColumns);

  return {
    chatColumns: Math.max(1, safeColumns - outputsColumns),
    outputsColumns,
    outputsVisible: true,
  };
}

export function WorkspaceFrame({
  rows,
  columns,
  scrollableRows,
  scrollable,
  bottom,
  right,
  rightColumns = 0,
}: {
  rows: number;
  columns: number;
  scrollableRows: number;
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
  right?: React.ReactNode;
  rightColumns?: number | undefined;
}) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const sideColumns = right ? Math.max(1, Math.min(safeColumns - 1, Math.floor(rightColumns))) : 0;
  const mainColumns = Math.max(1, safeColumns - sideColumns);

  if (rows < 20) {
    return (
      <Box flexDirection="column" height={rows} width={safeColumns}>
        <Box paddingX={1} flexDirection="column">
          <Text color={inkColors.warning} bold>Terminal too small</Text>
          <Text dimColor>Resize to at least 80x20 for the DataFoundry TUI.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" height={rows} width={safeColumns}>
      <Box flexDirection="column" height={rows} width={mainColumns} flexShrink={0}>
        <Box
          height={Math.max(0, Math.floor(scrollableRows))}
          width={mainColumns}
          overflowY="hidden"
          flexDirection="column"
          flexShrink={0}
        >
          {scrollable}
        </Box>
        <Box width={mainColumns} flexShrink={0} flexDirection="column">
          {bottom}
        </Box>
      </Box>
      {right}
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
