import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionListItem } from '../config/index.js';

interface SessionPickerProps {
  sessions: SessionListItem[];
  loading: boolean;
  error?: string | undefined;
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

const WINDOW_SIZE = 10;

const formatRelative = (timestamp: string | undefined): string => {
  if (!timestamp) return 'unknown';

  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'unknown';

  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
};

const getSessionTimestamp = (session: SessionListItem): string | undefined => {
  return session.lastMessageAt ?? session.updatedAt ?? session.createdAt;
};

const getSessionTitle = (session: SessionListItem): string => {
  return session.title?.trim() || 'Untitled session';
};

export const SessionPicker: React.FC<SessionPickerProps> = ({
  sessions,
  loading,
  error,
  onSelect,
  onCancel,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sessions;

    return sessions.filter((session) => {
      const title = getSessionTitle(session).toLowerCase();
      const threadId = session.threadId.toLowerCase();
      return title.includes(normalizedQuery) || threadId.includes(normalizedQuery);
    });
  }, [query, sessions]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredSessions]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(filteredSessions.length - 1, index + 1));
      return;
    }

    if (key.return) {
      const selectedSession = filteredSessions[selectedIndex];
      if (selectedSession) {
        onSelect(selectedSession.threadId);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.tab) {
      return;
    }

    if (input.length > 0) {
      setQuery((value) => value + input);
    }
  });

  const windowStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(WINDOW_SIZE / 2),
      Math.max(0, filteredSessions.length - WINDOW_SIZE),
    ),
  );
  const visibleSessions = filteredSessions.slice(windowStart, windowStart + WINDOW_SIZE);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      marginX={1}
    >
      <Text bold color="cyan">Resume a previous session</Text>
      <Box>
        <Text dimColor>Type to search: </Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} minHeight={WINDOW_SIZE}>
        {loading ? (
          <Text dimColor>Loading recent sessions...</Text>
        ) : error ? (
          <Text color="red">Failed to load sessions: {error}</Text>
        ) : sessions.length === 0 ? (
          <Text dimColor>No server sessions found.</Text>
        ) : filteredSessions.length === 0 ? (
          <Text dimColor>No sessions match "{query}".</Text>
        ) : (
          visibleSessions.map((session, index) => {
            const absoluteIndex = windowStart + index;
            const selected = absoluteIndex === selectedIndex;
            const title = truncate(getSessionTitle(session), 58);
            const threadId = truncate(session.threadId, 24);
            const relativeTime = formatRelative(getSessionTimestamp(session));

            return (
              <Box key={session.threadId}>
                <Text color={selected ? 'cyan' : 'white'}>{selected ? '>' : ' '} </Text>
                <Text dimColor>{relativeTime.padStart(9)} </Text>
                <Text color={selected ? 'cyan' : 'white'} bold={selected}>
                  {title}
                </Text>
                <Text dimColor> ({threadId})</Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down Navigate - Enter Resume - Esc Cancel</Text>
      </Box>
    </Box>
  );
};
