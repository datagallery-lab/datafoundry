import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type {
  ConnectionStatus,
  DataArtifact,
  DisplayMessage,
  LiveRunStatus,
  LiveToolCallRecord,
} from '../state/index.js';
import { InlineToolCall } from './InlineToolCall.js';
import { textWidth, truncateToWidth, wrapToWidth } from './text-width.js';

/**
 * A single terminal row. The chat viewport renders these one-per-row and slices
 * them to the visible window, so every node here MUST occupy exactly one row and
 * never exceed the content width (otherwise Ink re-wraps and the slice math, and
 * therefore scrolling, drifts). Strings are pre-wrapped/truncated to guarantee
 * this; keys are content-stable so streaming appends don't re-key earlier rows.
 */
export interface VisualLine {
  key: string;
  node: React.ReactNode;
}

export interface StartupInfo {
  threadId: string | undefined;
  connectionStatus: ConnectionStatus;
  runStatus: LiveRunStatus;
  modelName: string;
  directory: string;
}

export interface BuildChatLinesInput {
  messages: DisplayMessage[];
  artifacts: DataArtifact[];
  toolCalls?: LiveToolCallRecord[] | undefined;
  totalMessageCount?: number | undefined;
  maxMessageContentLength?: number | undefined;
  columns?: number | undefined;
  startup?: StartupInfo | undefined;
}

const INDENT = '  ';
const INDENT_WIDTH = 2;
const MAX_ELEMENT_LINES = 1000;
const MAX_TABLE_ROWS = 12;

/** Total display-column budget for a single chat row (mirrors the old estimate). */
export function chatContentWidth(columns: number): number {
  return Math.max(20, columns - 4);
}

/**
 * Build the entire chat transcript as a flat list of single-row lines. Pure and
 * deterministic: the same inputs always produce the same lines, which is what
 * lets the viewport and the scroll bookkeeping agree on an exact row count.
 */
export function buildChatLines(input: BuildChatLinesInput): VisualLine[] {
  const columns = input.columns ?? 100;
  const contentWidth = chatContentWidth(columns);
  const bodyWidth = Math.max(1, contentWidth - INDENT_WIDTH);
  const toolCalls = input.toolCalls ?? [];
  const messageCount = input.totalMessageCount ?? input.messages.length;

  const lines: VisualLine[] = [];
  const push = (key: string, node: React.ReactNode) => {
    lines.push({ key, node });
  };

  if (input.startup) {
    pushStartupLines(input.startup, contentWidth, push);
  }

  const hasMessages = input.messages.length > 0;
  if (!hasMessages && messageCount === 0) {
    if (!input.startup) {
      push('empty:0', <Text key="empty:0" dimColor>No messages yet. Start typing to begin...</Text>);
      push('empty:1', <Text key="empty:1" dimColor>Type your question and press Enter to send.</Text>);
    }
    return lines;
  }

  for (const message of input.messages) {
    pushMessageLines(message, toolCalls, bodyWidth, push);
    push(`m:${message.id}:after`, blankNode(`m:${message.id}:after`));
  }

  // Restored sessions can report a count without hydrated messages yet.
  if (!hasMessages && messageCount > 0) {
    push('spacer:0', blankNode('spacer:0'));
  }

  if (input.artifacts.length > 0) {
    // The preceding message/spacer already trails a blank row, so emit the
    // notice directly to keep a single-line gap consistent with the rest.
    const text = truncateToWidth(
      `New outputs available (${input.artifacts.length}). Use /outputs to view them.`,
      contentWidth,
    );
    push('artifacts:0', <Text key="artifacts:0" color="magenta">{text}</Text>);
  }

  return lines;
}

/** Convenience for callers that only need the row count (e.g. scroll clamps). */
export function countChatLines(input: BuildChatLinesInput): number {
  return buildChatLines(input).length;
}

/**
 * Collapse the blank-line padding models tend to emit around tool calls so
 * blocks join with a single separator row (DataDock-style spacing). Leading and
 * trailing blank lines are dropped, and any internal run of blanks collapses to
 * one. A whitespace-only element returns '' so the caller can skip it entirely
 * (e.g. the lone "\n\n" a model streams right before invoking a tool).
 */
function normalizeBlankLines(content: string): string {
  const lines = content.split('\n');
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
    lines.pop();
  }

  const collapsed: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && previousBlank) {
      continue;
    }
    collapsed.push(line);
    previousBlank = isBlank;
  }
  return collapsed.join('\n');
}

function pushMessageLines(
  message: DisplayMessage,
  toolCalls: LiveToolCallRecord[],
  bodyWidth: number,
  push: (key: string, node: React.ReactNode) => void,
): void {
  const headerKey = `m:${message.id}:h`;
  push(headerKey, <MessageHeader key={headerKey} message={message} />);

  if (message.elements.length === 0 && message.isStreaming) {
    const key = `m:${message.id}:thinking`;
    push(key, <ThinkingLine key={key} />);
    return;
  }

  let blocksEmitted = 0;
  let emittedLines = 0;

  // Exactly one blank row between consecutive blocks (text/tool); none before
  // the first so the header stays glued to its content. Mirrors DataDock's
  // uniform marginTop={1} spacing within the flat single-row line model.
  const separate = (key: string): void => {
    if (blocksEmitted > 0) {
      push(key, blankNode(key));
    }
  };

  message.elements.forEach((element, elementIndex) => {
    const keyBase = `m:${message.id}:e${elementIndex}`;

    if (element.type === 'text') {
      const normalized = normalizeBlankLines(element.content);
      if (normalized === '') {
        return;
      }
      separate(`${keyBase}:gap`);
      blocksEmitted += 1;
      pushMarkdownLines(normalized, bodyWidth, keyBase, (key, node) => {
        if (emittedLines >= MAX_ELEMENT_LINES) {
          return;
        }
        emittedLines += 1;
        push(key, node);
      });
      return;
    }

    // tool_call element
    const toolCall = toolCalls.find((candidate) => candidate.id === element.toolCallId);
    if (!toolCall) {
      return;
    }
    const key = `${keyBase}:tool`;
    separate(`${key}:gap`);
    blocksEmitted += 1;
    push(
      key,
      <Box key={key} paddingLeft={INDENT_WIDTH}>
        <InlineToolCall toolCall={toolCall} showName />
      </Box>,
    );
  });

  if (message.isStreaming && message.elements.length > 0) {
    const key = `m:${message.id}:cursor`;
    push(key, <Text key={key} dimColor>{`${INDENT}▊`}</Text>);
  }
}

/**
 * Turn one text element into rows: blank lines stay blank, tables render with
 * CJK-aware column widths, and every other line is hard-wrapped to bodyWidth and
 * indented. No inline markdown styling is applied (parity with the prior plain
 * MarkdownText renderer), which keeps each row a single flat string.
 */
function pushMarkdownLines(
  content: string,
  bodyWidth: number,
  keyBase: string,
  push: (key: string, node: React.ReactNode) => void,
): void {
  const rawLines = content.split('\n');
  let index = 0;

  while (index < rawLines.length) {
    const line = rawLines[index] ?? '';

    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      let cursor = index;
      while (cursor < rawLines.length && (rawLines[cursor] ?? '').trim().startsWith('|')) {
        tableLines.push(rawLines[cursor] ?? '');
        cursor += 1;
      }
      const table = parseTable(tableLines);
      if (table) {
        pushTableLines(table, bodyWidth, `${keyBase}:t${index}`, push);
        index = cursor;
        continue;
      }
    }

    if (line.trim() === '') {
      push(`${keyBase}:b${index}`, blankNode(`${keyBase}:b${index}`));
    } else {
      const chunks = wrapToWidth(line, bodyWidth);
      chunks.forEach((chunk, chunkIndex) => {
        const key = `${keyBase}:l${index}_${chunkIndex}`;
        push(key, <Text key={key}>{INDENT + chunk}</Text>);
      });
    }
    index += 1;
  }
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) {
    return null;
  }
  const headers = splitTableRow(lines[0] ?? '');
  if (headers.length === 0) {
    return null;
  }
  if (!(lines[1] ?? '').includes('---')) {
    return null;
  }

  const rows: string[][] = [];
  for (let index = 2; index < lines.length; index += 1) {
    const cells = splitTableRow(lines[index] ?? '');
    if (cells.length === 0) {
      continue;
    }
    while (cells.length < headers.length) {
      cells.push('');
    }
    rows.push(cells.slice(0, headers.length));
  }

  return { headers, rows };
}

function splitTableRow(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '');
}

function pushTableLines(
  table: ParsedTable,
  bodyWidth: number,
  keyBase: string,
  push: (key: string, node: React.ReactNode) => void,
): void {
  const columnWidths = table.headers.map((header, columnIndex) => {
    const bodyMax = table.rows.reduce(
      (max, row) => Math.max(max, textWidth(row[columnIndex] ?? '')),
      0,
    );
    return Math.max(textWidth(header), bodyMax);
  });

  const renderRow = (cells: string[]): string => {
    const padded = columnWidths.map((width, columnIndex) => padToWidth(cells[columnIndex] ?? '', width));
    return truncateToWidth(`| ${padded.join(' | ')} |`, bodyWidth);
  };

  const headerKey = `${keyBase}:head`;
  push(headerKey, <Text key={headerKey} bold>{INDENT + renderRow(table.headers)}</Text>);

  const separator = columnWidths.map((width) => '-'.repeat(Math.max(1, width)));
  const separatorText = truncateToWidth(`| ${separator.join(' | ')} |`, bodyWidth);
  push(`${keyBase}:sep`, <Text key={`${keyBase}:sep`} dimColor>{INDENT + separatorText}</Text>);

  const visibleRows = table.rows.slice(0, MAX_TABLE_ROWS);
  visibleRows.forEach((row, rowIndex) => {
    const key = `${keyBase}:r${rowIndex}`;
    push(key, <Text key={key}>{INDENT + renderRow(row)}</Text>);
  });

  if (table.rows.length > MAX_TABLE_ROWS) {
    const hidden = table.rows.length - MAX_TABLE_ROWS;
    const key = `${keyBase}:more`;
    const text = truncateToWidth(`... ${hidden} more rows; open /outputs for full content ...`, bodyWidth);
    push(key, <Text key={key} dimColor>{INDENT + text}</Text>);
  }
}

function padToWidth(value: string, width: number): string {
  const extra = Math.max(0, width - textWidth(value));
  return `${value}${' '.repeat(extra)}`;
}

function pushStartupLines(
  startup: StartupInfo,
  contentWidth: number,
  push: (key: string, node: React.ReactNode) => void,
): void {
  const conn = connectionDisplay(startup.connectionStatus);
  const run = runDisplay(startup.runStatus);
  const session = startup.threadId ? `  session: ${startup.threadId.slice(0, 8)}` : '';

  push(
    'startup:title',
    <Text key="startup:title">
      <Text bold color="cyan">DataAgent TUI</Text>
      {session ? <Text dimColor>{truncateToWidth(session, Math.max(0, contentWidth - 13))}</Text> : null}
    </Text>,
  );
  push(
    'startup:model',
    <Text key="startup:model">
      <Text dimColor>model:     </Text>
      <Text>{truncateToWidth(startup.modelName, Math.max(0, contentWidth - 11))}</Text>
    </Text>,
  );
  push(
    'startup:dir',
    <Text key="startup:dir">
      <Text dimColor>directory: </Text>
      <Text>{truncateToWidth(startup.directory, Math.max(0, contentWidth - 11))}</Text>
    </Text>,
  );
  push(
    'startup:status',
    <Text key="startup:status">
      <Text color={conn.color}>{conn.icon} {conn.text}</Text>
      <Text dimColor> | </Text>
      <Text color={run.color}>{run.icon} {run.text}</Text>
    </Text>,
  );
  push('startup:after', blankNode('startup:after'));
}

function blankNode(key: string): React.ReactNode {
  return <Text key={key}> </Text>;
}

interface MessageHeaderProps {
  message: DisplayMessage;
}

const MessageHeader: React.FC<MessageHeaderProps> = ({ message }) => (
  <Text>
    <Text bold color={roleColor(message.role)}>{roleLabel(message.role)}</Text>
    <Text dimColor> • {formatTimestamp(message.timestamp)}</Text>
    {message.isStreaming ? <Text dimColor> • working...</Text> : null}
  </Text>
);

const ThinkingLine: React.FC = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => (value + 1) % 4), 360);
    return () => clearInterval(timer);
  }, []);
  const dotCount = tick % 4;
  const text = `thinking${'.'.repeat(dotCount)}${' '.repeat(3 - dotCount)}`;
  const bright = tick % 2 === 0;
  return (
    <Text color={bright ? 'white' : 'gray'} dimColor={!bright}>{INDENT + text}</Text>
  );
};

function roleColor(role: DisplayMessage['role']): string {
  switch (role) {
    case 'user':
      return 'blue';
    case 'assistant':
      return 'green';
    case 'system':
      return 'yellow';
    default:
      return 'gray';
  }
}

function roleLabel(role: DisplayMessage['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Agent';
    case 'system':
      return 'System';
    default:
      return 'Unknown';
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function connectionDisplay(status: ConnectionStatus): { color: string; icon: string; text: string } {
  switch (status) {
    case 'connected':
      return { color: 'green', icon: '●', text: 'Connected' };
    case 'disconnected':
      return { color: 'gray', icon: '○', text: 'Disconnected' };
    case 'error':
      return { color: 'red', icon: '✖', text: 'Error' };
    default:
      return { color: 'gray', icon: '○', text: 'Unknown' };
  }
}

function runDisplay(status: LiveRunStatus): { color: string; icon: string; text: string } {
  switch (status) {
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
}
