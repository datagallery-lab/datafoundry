import React from 'react';
import { Box, Text } from 'ink';
import type { DataArtifact } from '../state/index.js';
import { TableView } from './components/TableView.js';

interface ArtifactCardProps {
  artifact: DataArtifact;
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact }) => {
  // Get artifact icon based on kind
  const getArtifactIcon = (kind: DataArtifact['kind']) => {
    switch (kind) {
      case 'chart':
        return '📊';
      case 'csv':
        return '📋';
      case 'memo':
        return '📝';
      case 'dashboard':
        return '📈';
      default:
        return '📄';
    }
  };

  // Get artifact type label
  const getTypeLabel = (type?: DataArtifact['type']) => {
    if (!type) return '';
    switch (type) {
      case 'dataset':
        return '[Dataset]';
      case 'chart':
        return '[Chart]';
      case 'sql':
        return '[SQL]';
      case 'report':
        return '[Report]';
      default:
        return '';
    }
  };

  // Render artifact detail based on type
  const renderDetail = () => {
    if (!artifact.detail) return null;

    switch (artifact.detail.type) {
      case 'sql':
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>SQL: {artifact.detail.sql.slice(0, 80)}...</Text>
            <Text dimColor>
              Scanned: {artifact.detail.scannedRows} rows, Duration: {artifact.detail.durationMs}ms
            </Text>
          </Box>
        );

      case 'dataset':
        return (
          <Box flexDirection="column" marginTop={1}>
            <TableView
              columns={artifact.detail.columns}
              rows={artifact.detail.rows}
              pageSize={10}
              showPagination={artifact.detail.rows.length > 10}
            />
          </Box>
        );

      case 'chart':
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>
              Unit: {artifact.detail.unit}, Points: {artifact.detail.points.length}
            </Text>
          </Box>
        );

      case 'report':
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>
              Sections: {artifact.detail.sections.length}
            </Text>
          </Box>
        );

      default:
        return null;
    }
  };

  const versionLabel = artifact.version?.startsWith('v')
    ? artifact.version
    : artifact.version
      ? `v${artifact.version}`
      : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
    >
      {/* Artifact header */}
      <Box>
        <Text>{getArtifactIcon(artifact.kind)} </Text>
        <Text bold>{artifact.title}</Text>
        {artifact.type && (
          <Text dimColor> {getTypeLabel(artifact.type)}</Text>
        )}
      </Box>

      {/* Artifact summary */}
      <Box paddingLeft={2}>
        <Text>{artifact.summary}</Text>
      </Box>

      {/* Artifact details */}
      {renderDetail()}

      {/* Version and timestamp */}
      <Box justifyContent="space-between" marginTop={0}>
        {versionLabel && (
          <Text dimColor>{versionLabel}</Text>
        )}
        {artifact.recordedAtMs && (
          <Text dimColor>
            {new Date(artifact.recordedAtMs).toLocaleTimeString()}
          </Text>
        )}
      </Box>
    </Box>
  );
};
