import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DataArtifact, TimelineEvent } from '../state/index.js';
import { isMouseInput } from '../input/mouse-wheel.js';
import { ArtifactCard } from './ArtifactCard.js';
import { textWidth, truncateToWidth } from './text-width.js';

interface OutputsViewProps {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  selectedIndex: number;
  windowStart: number;
  maxVisibleItems: number;
  contentWidth: number;
}

interface OutputsScreenProps {
  artifacts: DataArtifact[];
  events: TimelineEvent[];
  columns?: number | undefined;
  rows?: number | undefined;
  onCancel: () => void;
}

const RESERVED_LINES = 5;
const ITEM_HEIGHT = 4;

const truncate = (value: string, maxWidth: number): string => {
  const firstLine = value.split(/\r?\n/, 1)[0] ?? '';
  return truncateToWidth(firstLine, Math.max(1, maxWidth), '...');
};

function sourceLabel(artifact: DataArtifact, events: TimelineEvent[]): string {
  if (!artifact.createdByEventId) return '来源步骤未关联';
  const event = events.find((item) => item.id === artifact.createdByEventId);
  if (!event) return `来源 ${artifact.createdByEventId}`;
  return `来自 ${event.title}`;
}

function artifactTypeLabel(artifact: DataArtifact): string {
  switch (artifact.detail?.type ?? artifact.type) {
    case 'dataset':
      return 'Dataset';
    case 'chart':
      return 'Chart';
    case 'sql':
      return 'SQL';
    case 'report':
      return 'Report';
    case 'file':
      return 'File';
    default:
      return artifact.kind;
  }
}

function artifactDetailLabel(artifact: DataArtifact): string | undefined {
  const detail = artifact.detail;
  if (!detail) return undefined;

  switch (detail.type) {
    case 'dataset':
      return `${detail.columns.length.toLocaleString()} 列 x ${detail.rows.length.toLocaleString()} 行`;
    case 'sql':
      return `${detail.scannedRows.toLocaleString()} rows scanned, ${detail.durationMs}ms`;
    case 'chart':
      return [
        `${detail.points.length.toLocaleString()} points`,
        detail.series?.length ? `${detail.series.length.toLocaleString()} series` : undefined,
        detail.chartType,
      ].filter(Boolean).join(', ');
    case 'report':
      return `${detail.sections.length.toLocaleString()} sections`;
    case 'file':
      return [
        detail.path,
        detail.size !== undefined ? `${detail.size.toLocaleString()} bytes` : undefined,
      ].filter(Boolean).join(', ');
    default:
      return undefined;
  }
}

function artifactVersionLabel(artifact: DataArtifact): string | undefined {
  if (!artifact.version) return undefined;
  return artifact.version.startsWith('v') ? artifact.version : `v${artifact.version}`;
}

function artifactTimeLabel(artifact: DataArtifact): string | undefined {
  if (!artifact.recordedAtMs) return undefined;
  return new Date(artifact.recordedAtMs).toLocaleTimeString();
}

function artifactMetadata(artifact: DataArtifact, events: TimelineEvent[]): string {
  return [
    artifactTypeLabel(artifact),
    artifactDetailLabel(artifact),
    artifactVersionLabel(artifact),
    artifactTimeLabel(artifact),
    sourceLabel(artifact, events),
  ].filter(Boolean).join(' - ');
}

export const OutputsView: React.FC<OutputsViewProps> = ({
  artifacts,
  events,
  selectedIndex,
  windowStart,
  maxVisibleItems,
  contentWidth,
}) => {
  const visibleArtifacts = artifacts.slice(windowStart, windowStart + maxVisibleItems);
  const showScrollUp = windowStart > 0;
  const showScrollDown = windowStart + maxVisibleItems < artifacts.length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {artifacts.length === 0 ? (
        <Box flexDirection="column" paddingY={2}>
          <Text dimColor wrap="truncate-end">
            {truncate('暂无产出。', contentWidth)}
          </Text>
          <Text dimColor wrap="truncate-end">
            {truncate('Agent 生成 SQL 结果、图表、报告或文件后会显示在这里。', contentWidth)}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <Box marginBottom={1}>
            <Text dimColor wrap="truncate-end">
              {truncate('最新产出排在前面。上下选择，Enter 查看详细表格。', contentWidth)}
            </Text>
          </Box>
          {visibleArtifacts.map((artifact, index) => {
            const absoluteIndex = windowStart + index;
            const selected = absoluteIndex === selectedIndex;
            const isFirst = index === 0;
            const isLast = index === visibleArtifacts.length - 1;
            const prefix = selected
              ? '> '
              : isFirst && showScrollUp
                ? '^ '
                : isLast && showScrollDown
                  ? 'v '
                  : '  ';
            const titleWidth = Math.max(1, contentWidth - 2);
            const summaryWidth = Math.max(1, contentWidth - 2);
            const metadataWidth = Math.max(1, contentWidth - 2);
            const typeLabel = ` [${artifactTypeLabel(artifact)}]`;
            const title = truncate(
              artifact.title,
              Math.max(1, titleWidth - textWidth(typeLabel)),
            );

            return (
              <Box
                key={artifact.id}
                flexDirection="column"
                marginBottom={isLast ? 0 : 1}
              >
                <Box>
                  <Text color={selected ? 'cyan' : 'white'} bold={selected}>
                    {prefix}
                  </Text>
                  <Text color={selected ? 'cyan' : 'white'} bold={selected} wrap="truncate-end">
                    {title}
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {truncate(typeLabel, Math.max(1, titleWidth - textWidth(title)))}
                  </Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text dimColor wrap="truncate-end">
                    {truncate(artifact.summary, summaryWidth)}
                  </Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text dimColor wrap="truncate-end">
                    {truncate(artifactMetadata(artifact, events), metadataWidth)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

const OutputsDetailView: React.FC<{
  artifact: DataArtifact;
  events: TimelineEvent[];
  index: number;
  contentWidth: number;
}> = ({ artifact, events, index, contentWidth }) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box>
        <Text dimColor>#{index + 1} </Text>
        <Text color="yellow" wrap="truncate-end">
          {truncate(sourceLabel(artifact, events), Math.max(1, contentWidth - 4))}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <ArtifactCard artifact={artifact} keyboardActive />
      </Box>
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
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    () => artifacts[0]?.id ?? null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const panelWidth = Math.max(24, columns);
  const panelHeight = Math.max(8, rows - 1);
  const contentWidth = Math.max(10, panelWidth - 4);
  const separatorWidth = Math.max(0, panelWidth - 2);
  const maxVisibleItems = Math.max(
    1,
    Math.floor((panelHeight - RESERVED_LINES) / ITEM_HEIGHT),
  );
  const selectedIndex = useMemo(() => {
    if (artifacts.length === 0) return -1;
    const index = artifacts.findIndex((artifact) => artifact.id === selectedArtifactId);
    return index >= 0 ? index : 0;
  }, [artifacts, selectedArtifactId]);
  const selectedArtifact = selectedIndex >= 0 ? artifacts[selectedIndex] : undefined;
  const windowStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxVisibleItems / 2),
      Math.max(0, artifacts.length - maxVisibleItems),
    ),
  );
  const headerSuffix = detailOpen && selectedArtifact
    ? ` / ${selectedIndex + 1}`
    : ` (${artifacts.length})`;
  const headerTitle = truncate(
    'Outputs',
    Math.max(1, contentWidth - textWidth(headerSuffix)),
  );
  const footerText = detailOpen
    ? 'Esc/Backspace list - q close - PageUp/PageDown table'
    : 'Up/Down/j/k navigate - Enter view - Esc/q close';

  useEffect(() => {
    if (artifacts.length === 0) {
      setSelectedArtifactId(null);
      setDetailOpen(false);
      return;
    }

    if (!selectedArtifactId || !artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(artifacts[0]?.id ?? null);
    }
  }, [artifacts, selectedArtifactId]);

  useInput((input, key) => {
    if (isMouseInput(input)) {
      return;
    }

    if (detailOpen) {
      if (input === 'q') {
        onCancel();
        return;
      }
      if (key.escape || key.backspace || key.delete) {
        setDetailOpen(false);
      }
      return;
    }

    if (key.escape || input === 'q') {
      onCancel();
      return;
    }

    if (key.upArrow || (key.ctrl && input === 'p') || input === 'k') {
      if (artifacts.length === 0) return;
      const nextIndex = Math.max(0, selectedIndex - 1);
      setSelectedArtifactId(artifacts[nextIndex]?.id ?? null);
      return;
    }

    if (key.downArrow || (key.ctrl && input === 'n') || input === 'j') {
      if (artifacts.length === 0) return;
      const nextIndex = Math.min(artifacts.length - 1, selectedIndex + 1);
      setSelectedArtifactId(artifacts[nextIndex]?.id ?? null);
      return;
    }

    if (key.return && selectedArtifact) {
      setDetailOpen(true);
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
          <Text bold color="cyan" wrap="truncate-end">{headerTitle}</Text>
          <Text dimColor wrap="truncate-end">
            {truncate(headerSuffix, Math.max(1, contentWidth - textWidth(headerTitle)))}
          </Text>
        </Box>

        <Box>
          <Text color="gray">{'-'.repeat(separatorWidth)}</Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {detailOpen && selectedArtifact ? (
            <OutputsDetailView
              artifact={selectedArtifact}
              events={events}
              index={selectedIndex}
              contentWidth={contentWidth}
            />
          ) : (
            <OutputsView
              artifacts={artifacts}
              events={events}
              selectedIndex={selectedIndex}
              windowStart={windowStart}
              maxVisibleItems={maxVisibleItems}
              contentWidth={contentWidth}
            />
          )}
        </Box>

        <Box>
          <Text color="gray">{'-'.repeat(separatorWidth)}</Text>
        </Box>

        <Box paddingX={1}>
          <Text dimColor wrap="truncate-end">
            {truncate(footerText, contentWidth)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
