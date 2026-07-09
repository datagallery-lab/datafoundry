import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { DataArtifact, TimelineEvent } from '../state/index.js';
import { isMouseInput } from '../input/mouse-wheel.js';
import { ArtifactCard } from './ArtifactCard.js';

interface OutputsViewProps {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  showHeader?: boolean | undefined;
}

interface OutputsScreenProps {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  columns?: number | undefined;
  rows?: number | undefined;
  onCancel: () => void;
}

function sourceLabel(artifact: DataArtifact, events: TimelineEvent[]): string {
  if (!artifact.createdByEventId) return '来源步骤未关联';
  const event = events.find((item) => item.id === artifact.createdByEventId);
  if (!event) return `来源 ${artifact.createdByEventId}`;
  return `来自 ${event.title}`;
}

export const OutputsView: React.FC<OutputsViewProps> = ({
  artifacts,
  events,
  showHeader = true,
}) => {
  return (
    <Box flexDirection="column" paddingX={2}>
      {showHeader && (
        <Box marginBottom={1}>
          <Text bold color="cyan">Outputs</Text>
          <Text dimColor> ({artifacts.length})</Text>
        </Box>
      )}

      {artifacts.length === 0 ? (
        <Box flexDirection="column" paddingY={2}>
          <Text dimColor>暂无产出。</Text>
          <Text dimColor>Agent 生成 SQL 结果、图表、报告或文件后会显示在这里。</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>最新产出排在前面。Chat 页只提示有新产出，详情通过 /outputs 查看。</Text>
          </Box>
          {artifacts.map((artifact, index) => (
            <Box key={artifact.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text dimColor>#{index + 1} </Text>
                <Text color="yellow">{sourceLabel(artifact, events)}</Text>
              </Box>
              <ArtifactCard artifact={artifact} keyboardActive={index === 0} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export const OutputsScreen: React.FC<OutputsScreenProps> = ({
  artifacts,
  events,
  columns = 100,
  rows = 40,
  onCancel,
}) => {
  const panelWidth = Math.max(24, columns);
  const panelHeight = Math.max(8, rows - 1);
  const separatorWidth = Math.max(0, panelWidth - 2);

  useInput((input, key) => {
    if (isMouseInput(input)) {
      return;
    }

    if (key.escape || input === 'q') {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      width={panelWidth}
      height={panelHeight}
      overflow="hidden"
    >
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        width={panelWidth}
        height={panelHeight}
        overflow="hidden"
      >
        <Box paddingX={1}>
          <Text bold color="cyan" wrap="truncate-end">Outputs</Text>
          <Text dimColor wrap="truncate-end"> ({artifacts.length})</Text>
        </Box>

        <Box>
          <Text color="gray">{'-'.repeat(separatorWidth)}</Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <OutputsView
            artifacts={artifacts}
            events={events}
            showHeader={false}
          />
        </Box>

        <Box>
          <Text color="gray">{'-'.repeat(separatorWidth)}</Text>
        </Box>

        <Box paddingX={1}>
          <Text dimColor wrap="truncate-end">Esc/q close</Text>
        </Box>
      </Box>
    </Box>
  );
};
