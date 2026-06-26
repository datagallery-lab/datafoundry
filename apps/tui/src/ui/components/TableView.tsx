import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';

export interface TableColumn {
  header: string;
  accessor: string;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

export interface TableViewProps {
  columns: string[];
  rows: string[][];
  pageSize?: number;
  title?: string;
  showPagination?: boolean;
}

/**
 * Detect if a column contains primarily numeric data
 */
function isNumericColumn(rows: string[][], columnIndex: number): boolean {
  if (rows.length === 0) return false;

  // Sample first 10 rows to determine if numeric
  const sample = rows.slice(0, Math.min(10, rows.length));
  const numericCount = sample.filter(row => {
    const value = row[columnIndex];
    if (!value || value.trim() === '') return false;
    // Check if it's a number (including decimals, negatives, percentages)
    return /^-?\d+\.?\d*%?$/.test(value.trim());
  }).length;

  // If more than 70% of sampled values are numeric, treat as numeric column
  return numericCount / sample.length > 0.7;
}

/**
 * Calculate optimal column width based on content
 */
function calculateColumnWidth(
  header: string,
  rows: string[][],
  columnIndex: number,
  maxWidth = 30
): number {
  // Start with header length
  let maxLength = header.length;

  // Sample rows to find max content length (check first 20 rows for performance)
  const sampleSize = Math.min(20, rows.length);
  for (let i = 0; i < sampleSize; i++) {
    const value = rows[i]?.[columnIndex] || '';
    maxLength = Math.max(maxLength, String(value).length);
  }

  // Add padding and cap at maxWidth
  return Math.min(maxLength + 2, maxWidth);
}

/**
 * Truncate or pad string to fit column width
 */
function formatCell(value: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const str = String(value || '');

  if (str.length > width) {
    // Truncate with ellipsis
    return str.slice(0, width - 1) + '…';
  }

  const padding = width - str.length;

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
  } else {
    return str + ' '.repeat(padding);
  }
}

/**
 * Pagination controls component
 */
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalRows,
  pageSize,
}) => {
  const startRow = currentPage * pageSize + 1;
  const endRow = Math.min((currentPage + 1) * pageSize, totalRows);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>
          显示第 {startRow}-{endRow} 行，共 {totalRows} 行
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>
          第 {currentPage + 1}/{totalPages} 页
        </Text>
        {currentPage > 0 && (
          <>
            <Text dimColor> • </Text>
            <Text color="cyan">[P] 上一页</Text>
          </>
        )}
        {currentPage < totalPages - 1 && (
          <>
            <Text dimColor> • </Text>
            <Text color="cyan">[N] 下一页</Text>
          </>
        )}
      </Box>
    </Box>
  );
};

/**
 * Table statistics component
 */
interface TableStatsProps {
  totalRows: number;
  totalColumns: number;
}

const TableStats: React.FC<TableStatsProps> = ({ totalRows, totalColumns }) => {
  return (
    <Box marginBottom={1}>
      <Text dimColor>
        {totalColumns} 列 × {totalRows} 行
      </Text>
    </Box>
  );
};

/**
 * Simple table header component
 */
interface TableHeaderProps {
  columns: string[];
  widths: number[];
  alignments: ('left' | 'right' | 'center')[];
}

const TableHeader: React.FC<TableHeaderProps> = ({ columns, widths, alignments }) => {
  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        {columns.map((col, idx) => (
          <Box key={idx} width={widths[idx]} marginRight={idx < columns.length - 1 ? 1 : 0}>
            <Text bold color="cyan">
              {formatCell(col, widths[idx] || 10, alignments[idx])}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Separator */}
      <Box>
        {columns.map((_, idx) => (
          <Box key={idx} width={widths[idx]} marginRight={idx < columns.length - 1 ? 1 : 0}>
            <Text dimColor>
              {'─'.repeat(widths[idx] || 10)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/**
 * Table row component
 */
interface TableRowProps {
  row: string[];
  widths: number[];
  alignments: ('left' | 'right' | 'center')[];
}

const TableRow: React.FC<TableRowProps> = ({ row, widths, alignments }) => {
  return (
    <Box>
      {row.map((cell, idx) => (
        <Box key={idx} width={widths[idx]} marginRight={idx < row.length - 1 ? 1 : 0}>
          <Text>
            {formatCell(cell, widths[idx] || 10, alignments[idx])}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

/**
 * TableView component - displays tabular data with pagination and auto-formatting
 */
export const TableView: React.FC<TableViewProps> = ({
  columns,
  rows,
  pageSize = 10,
  title,
  showPagination = true,
}) => {
  const [currentPage, setCurrentPage] = useState(0);

  // Calculate pagination
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const shouldPaginate = showPagination && totalRows > pageSize;

  // Detect numeric columns for right alignment
  const columnAlignments = useMemo(() => {
    return columns.map((_, idx) => isNumericColumn(rows, idx) ? 'right' as const : 'left' as const);
  }, [columns, rows]);

  // Calculate column widths
  const columnWidths = useMemo(() => {
    return columns.map((header, idx) => calculateColumnWidth(header, rows, idx));
  }, [columns, rows]);

  // Get current page rows
  const pageRows = useMemo(() => {
    if (shouldPaginate) {
      const start = currentPage * pageSize;
      const end = start + pageSize;
      return rows.slice(start, end);
    }
    return rows;
  }, [rows, currentPage, pageSize, shouldPaginate]);

  // Handle empty data
  if (columns.length === 0 || rows.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {title && (
          <Box marginBottom={1}>
            <Text bold color="cyan">
              {title}
            </Text>
          </Box>
        )}
        <Text dimColor>无数据</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
      )}

      {/* Table Statistics */}
      <TableStats totalRows={totalRows} totalColumns={columns.length} />

      {/* Table */}
      <Box flexDirection="column">
        <TableHeader columns={columns} widths={columnWidths} alignments={columnAlignments} />
        {pageRows.map((row, idx) => (
          <TableRow key={idx} row={row} widths={columnWidths} alignments={columnAlignments} />
        ))}
      </Box>

      {/* Pagination */}
      {shouldPaginate && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalRows={totalRows}
          pageSize={pageSize}
        />
      )}

      {/* Summary for non-paginated small tables */}
      {!shouldPaginate && totalRows > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            已显示全部 {totalRows} 行
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Helper function to convert dataset artifact detail to TableView props
 */
export function datasetToTableProps(detail: {
  columns: string[];
  rows: string[][];
}): Pick<TableViewProps, 'columns' | 'rows'> {
  return {
    columns: detail.columns,
    rows: detail.rows,
  };
}
