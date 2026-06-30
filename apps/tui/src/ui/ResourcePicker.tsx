import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ResourcePickerItem {
  id: string;
  name: string;
  description?: string | undefined;
  detail?: string | undefined;
  enabled?: boolean | undefined;
  active?: boolean | undefined;
}

interface ResourcePickerProps {
  title: string;
  items: ResourcePickerItem[];
  loading: boolean;
  error?: string | undefined;
  warning?: string | undefined;
  emptyMessage: string;
  onSelect: (item: ResourcePickerItem) => void;
  onCancel: () => void;
}

const WINDOW_SIZE = 10;

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const ResourcePicker: React.FC<ResourcePickerProps> = ({
  title,
  items,
  loading,
  error,
  warning,
  emptyMessage,
  onSelect,
  onCancel,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;

    return items.filter((item) => {
      const values = [
        item.id,
        item.name,
        item.description ?? '',
        item.detail ?? '',
      ];
      return values.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [query, items]);

  useEffect(() => {
    const activeIndex = filteredItems.findIndex((item) => item.active);
    setSelectedIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [filteredItems]);

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
      if (filteredItems.length === 0) return;
      setSelectedIndex((index) => Math.min(filteredItems.length - 1, index + 1));
      return;
    }

    if (key.return) {
      const selectedItem = filteredItems[selectedIndex];
      if (selectedItem) {
        onSelect(selectedItem);
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
      Math.max(0, filteredItems.length - WINDOW_SIZE),
    ),
  );
  const visibleItems = filteredItems.slice(windowStart, windowStart + WINDOW_SIZE);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      marginX={1}
    >
      <Text bold color="cyan">{title}</Text>
      <Box>
        <Text dimColor>Type to search: </Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
      </Box>

      {warning ? (
        <Box marginTop={1}>
          <Text color="yellow">{warning}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1} minHeight={WINDOW_SIZE}>
        {loading ? (
          <Text dimColor>Loading...</Text>
        ) : error ? (
          <Text color="red">{error}</Text>
        ) : items.length === 0 ? (
          <Text dimColor>{emptyMessage}</Text>
        ) : filteredItems.length === 0 ? (
          <Text dimColor>No items match "{query}".</Text>
        ) : (
          visibleItems.map((item, index) => {
            const absoluteIndex = windowStart + index;
            const selected = absoluteIndex === selectedIndex;
            const stateMarker = item.active ? '*' : item.enabled === false ? ' ' : '+';
            const titleText = truncate(item.name || item.id, 42);
            const idText = truncate(item.id, 24);
            const detailText = item.detail ? truncate(item.detail, 56) : '';
            const itemColor = selected ? 'cyan' : item.enabled === false ? 'gray' : 'white';

            return (
              <Box key={item.id} flexDirection="column">
                <Box>
                  <Text color={selected ? 'cyan' : 'white'}>{selected ? '>' : ' '} </Text>
                  <Text dimColor>{stateMarker} </Text>
                  <Text color={itemColor} bold={selected}>
                    {titleText}
                  </Text>
                  <Text dimColor> ({idText})</Text>
                </Box>
                {(item.description || detailText) ? (
                  <Box paddingLeft={4}>
                    <Text dimColor>
                      {truncate(item.description ?? detailText, 70)}
                      {item.description && detailText ? ` - ${detailText}` : ''}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down Navigate - Enter Select - Esc Cancel - * active, + enabled</Text>
      </Box>
    </Box>
  );
};
