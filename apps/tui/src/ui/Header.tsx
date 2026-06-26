import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionStatus, LiveRunStatus } from '../state/index.js';

interface HeaderProps {
  threadId: string | undefined;
  connectionStatus: ConnectionStatus;
  runStatus: LiveRunStatus;
  lastError: string | undefined;
  modelName: string;
  directory: string;
}

export const Header: React.FC<HeaderProps> = ({
  threadId,
  connectionStatus,
  runStatus,
  lastError,
  modelName,
  directory,
}) => {
  // Connection status color and icon
  const getConnectionDisplay = (): { color: string; icon: string; text: string } => {
    switch (connectionStatus) {
      case 'connected':
        return { color: 'green', icon: '●', text: 'Connected' };
      case 'disconnected':
        return { color: 'gray', icon: '○', text: 'Disconnected' };
      case 'error':
        return { color: 'red', icon: '✖', text: 'Error' };
      default:
        return { color: 'gray', icon: '○', text: 'Unknown' };
    }
  };

  // Run status color and icon
  const getRunDisplay = (): { color: string; icon: string; text: string } => {
    switch (runStatus) {
      case 'idle':
        return { color: 'gray', icon: '○', text: 'Idle' };
      case 'running':
        return { color: 'yellow', icon: '◐', text: 'Running' };
      case 'completed':
        return { color: 'green', icon: '✓', text: 'Completed' };
      case 'failed':
        return { color: 'red', icon: '✖', text: 'Failed' };
      default:
        return { color: 'gray', icon: '○', text: 'Unknown' };
    }
  };

  const connDisplay = getConnectionDisplay();
  const runDisplay = getRunDisplay();

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1} marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          DataAgent TUI
        </Text>
        {threadId && (
          <Text dimColor>
            {'  '}session: {threadId.slice(0, 8)}
          </Text>
        )}
      </Box>

      <Box>
        <Text dimColor>model:     </Text>
        <Text>{modelName}</Text>
      </Box>

      <Box>
        <Text dimColor>directory: </Text>
        <Text>{directory}</Text>
      </Box>

      <Box>
        <Text color={connDisplay.color}>
          {connDisplay.icon} {connDisplay.text}
        </Text>
        <Text dimColor> | </Text>
        <Text color={runDisplay.color}>
          {runDisplay.icon} {runDisplay.text}
        </Text>
      </Box>

      {lastError && (
        <Box>
          <Text color="red">
            Error: {lastError}
          </Text>
        </Box>
      )}
    </Box>
  );
};
