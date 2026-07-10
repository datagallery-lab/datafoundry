import React from 'react';
import { Box, Text } from 'ink';
import type { StartupInfo } from './transcript-lines.js';
import { textWidth, truncateToWidth } from './text-width.js';

interface HomeSplashProps {
  rows: number;
  columns: number;
  startup: StartupInfo;
  input: React.ReactNode | ((width: number) => React.ReactNode);
}

const WORDMARK = [
  {
    left: '█▀▄ ▄▀█ ▀█▀ ▄▀█',
    right: '█▀▀ █▀█ █ █ █▄ █ █▀▄ █▀█ █▄█',
  },
  {
    left: '█▄▀ █▀█  █  █▀█',
    right: '█▀  █▄█ █▄█ █ ▀█ █▄▀ █▀▄  █ ',
  },
];

const WORDMARK_WIDTH = Math.max(
  ...WORDMARK.map((line) => textWidth(`${line.left}   ${line.right}`)),
);

function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width));
}

function statusText(startup: StartupInfo): string {
  const run = startup.runStatus === 'running' ? 'Running' : startup.runStatus;
  const connection = startup.connectionStatus === 'connected' ? 'Connected' : startup.connectionStatus;
  return `${connection} · ${run} · ${startup.modelName}`;
}

export function HomeSplash({ rows, columns, startup, input }: HomeSplashProps) {
  const availableWidth = Math.max(24, columns - 4);
  const promptWidth = Math.min(76, Math.max(48, Math.floor(columns * 0.68)), availableWidth);
  const showLogo = availableWidth >= WORDMARK_WIDTH && rows >= 13;

  return (
    <Box width="100%" height={rows} flexDirection="column" overflowY="hidden">
      <Box flexGrow={1} minHeight={0} />
      <Box width="100%" flexDirection="column" alignItems="center" flexShrink={0}>
        {showLogo ? (
          <Box flexDirection="column" width={WORDMARK_WIDTH}>
            {WORDMARK.map((line, index) => (
              <Text key={`home-logo-${index}`}>
                <Text color="gray">{line.left}</Text>
                <Text color="gray">   </Text>
                <Text color="white" bold>{line.right}</Text>
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="row">
            <Text color="gray">data</Text>
            <Text color="white" bold>foundry</Text>
          </Box>
        )}

        <Box height={1} />
        <Box width={promptWidth} flexDirection="column">
          {typeof input === 'function' ? input(promptWidth) : input}
        </Box>

        <Box height={1} />
        <Box width={promptWidth} flexDirection="column" alignItems="center">
          <Text color="yellow" wrap="truncate-end">
            ● Tip <Text color="gray">Run </Text>
            <Text color="white">/datasource</Text>
            <Text color="gray"> to choose data, then ask a business question</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {fit(statusText(startup), promptWidth)}
          </Text>
        </Box>
      </Box>
      <Box flexGrow={1} minHeight={0} />
    </Box>
  );
}
