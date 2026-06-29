import React from 'react';
import { Box, Text } from 'ink';
import type { DataArtifact, TimelineEvent } from '../state/index.js';
import { ArtifactCard } from './ArtifactCard.js';

interface OutputsViewProps {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
}

function sourceLabel(artifact: DataArtifact, events: TimelineEvent[]): string {
  if (!artifact.createdByEventId) return '来源步骤未关联';
  const event = events.find((item) => item.id === artifact.createdByEventId);
  if (!event) return `来源 ${artifact.createdByEventId}`;
  return `来自 ${event.title}`;
}

export const OutputsView: React.FC<OutputsViewProps> = ({ artifacts, events }) => {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Outputs</Text>
        <Text dimColor> ({artifacts.length})</Text>
      </Box>

      {artifacts.length === 0 ? (
        <Box flexDirection="column" paddingY={2}>
          <Text dimColor>暂无产出。</Text>
          <Text dimColor>Agent 生成 SQL 结果、图表、报告或文件后会显示在这里。</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>最新产出排在前面。Chat 页只显示最近 3 个摘要。</Text>
          </Box>
          {artifacts.map((artifact, index) => (
            <Box key={artifact.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text dimColor>#{index + 1} </Text>
                <Text color="yellow">{sourceLabel(artifact, events)}</Text>
              </Box>
              <ArtifactCard artifact={artifact} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
