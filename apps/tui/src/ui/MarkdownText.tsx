import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownTextProps {
  content: string;
}

/**
 * Parse and render Markdown content with support for tables
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ content }) => {
  // Split content into blocks (paragraphs, tables, etc.)
  const blocks = parseMarkdownBlocks(content);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <Box key={index} flexDirection="column" marginBottom={block.type === 'table' ? 1 : 0}>
          {renderBlock(block)}
        </Box>
      ))}
    </Box>
  );
};

type MarkdownBlock =
  | { type: 'text'; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a table (contains |)
    if (line.trim().startsWith('|') || (i > 0 && lines[i - 1]?.trim().startsWith('|'))) {
      // Parse table
      const tableLines: string[] = [];

      // Collect all table lines
      while (i < lines.length && (lines[i].trim().startsWith('|') || lines[i].trim() === '')) {
        if (lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i]);
        }
        i++;
      }

      if (tableLines.length >= 2) {
        const table = parseMarkdownTable(tableLines);
        if (table) {
          blocks.push(table);
          continue;
        }
      }
    }

    // Regular text line
    if (line.trim() !== '') {
      // Accumulate consecutive text lines
      const textLines: string[] = [line];
      i++;

      while (i < lines.length && !lines[i].trim().startsWith('|') && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }

      blocks.push({
        type: 'text',
        content: textLines.join('\n'),
      });
    } else {
      i++;
    }
  }

  return blocks;
}

function parseMarkdownTable(lines: string[]): MarkdownBlock | null {
  if (lines.length < 2) return null;

  // First line is headers
  const headerLine = lines[0];
  const headers = headerLine
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell !== '');

  if (headers.length === 0) return null;

  // Second line should be separator (|---|---|)
  // Skip it for parsing, but verify it exists
  const separatorLine = lines[1];
  if (!separatorLine.includes('---')) {
    return null;
  }

  // Remaining lines are data rows
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const row = lines[i]
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell !== '');

    if (row.length > 0) {
      // Pad row to match header length
      while (row.length < headers.length) {
        row.push('');
      }
      rows.push(row.slice(0, headers.length));
    }
  }

  return {
    type: 'table',
    headers,
    rows,
  };
}

function renderBlock(block: MarkdownBlock): React.ReactElement {
  if (block.type === 'text') {
    return <Text>{block.content}</Text>;
  }

  if (block.type === 'table') {
    return <SimpleTable headers={block.headers} rows={block.rows} />;
  }

  return <Text>{JSON.stringify(block)}</Text>;
}

interface SimpleTableProps {
  headers: string[];
  rows: string[][];
}

/**
 * Simple table component for rendering Markdown tables
 */
const SimpleTable: React.FC<SimpleTableProps> = ({ headers, rows }) => {
  // Calculate column widths
  const columnWidths = headers.map((header, colIndex) => {
    const headerWidth = header.length;
    const maxRowWidth = Math.max(
      ...rows.map(row => (row[colIndex] || '').length),
      0
    );
    return Math.max(headerWidth, maxRowWidth);
  });

  // Render a row with padding
  const renderRow = (cells: string[], isHeader = false) => {
    const paddedCells = cells.map((cell, index) => {
      const width = columnWidths[index];
      return cell.padEnd(width, ' ');
    });

    return (
      <Text bold={isHeader}>
        {paddedCells.map((cell, index) => (
          <React.Fragment key={index}>
            {index === 0 && '| '}
            {cell}
            {' | '}
          </React.Fragment>
        ))}
      </Text>
    );
  };

  // Render separator
  const renderSeparator = () => {
    const separators = columnWidths.map(width => '-'.repeat(width));
    return (
      <Text dimColor>
        {separators.map((sep, index) => (
          <React.Fragment key={index}>
            {index === 0 && '|-'}
            {sep}
            {'-|'}
          </React.Fragment>
        ))}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      {renderRow(headers, true)}
      {renderSeparator()}
      {rows.map((row, index) => (
        <Box key={index}>{renderRow(row)}</Box>
      ))}
    </Box>
  );
};
