import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import { CommandHistory, CommandCompletion, DEFAULT_COMMANDS } from './keybindings.js';

interface InputBoxProps {
  value?: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  commands?: string[];
}

export const InputBox: React.FC<InputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  disabled = false,
  commands = DEFAULT_COMMANDS,
}) => {
  const [localValue, setLocalValue] = useState('');
  const [completionHint, setCompletionHint] = useState<string>('');
  const { isRawModeSupported } = useStdin();

  // Use refs to maintain history and completion across renders
  const historyRef = useRef(new CommandHistory());
  const completionRef = useRef(new CommandCompletion(commands));

  const inputIsActive = Boolean(
    isRawModeSupported &&
      typeof process.stdin.setRawMode === 'function',
  );

  // Update completion commands when they change
  useEffect(() => {
    completionRef.current.setCommands(commands);
  }, [commands]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      // Handle Enter key
      if (key.return) {
        const submittedValue = localValue.trim();
        if (submittedValue) {
          if (disabled && !submittedValue.startsWith('/')) {
            return;
          }

          // Add to history
          historyRef.current.add(submittedValue);

          onSubmit(submittedValue);
          setLocalValue('');
          onChange('');
          setCompletionHint('');

          // Reset history navigation
          historyRef.current.reset();
          completionRef.current.reset();
        }
        return;
      }

      // Handle backspace
      if (key.backspace || key.delete) {
        const newValue = localValue.slice(0, -1);
        setLocalValue(newValue);
        setCompletionHint('');
        completionRef.current.reset();
        return;
      }

      // Handle up arrow - previous command in history
      if (key.upArrow) {
        const prevCommand = historyRef.current.previous();
        if (prevCommand !== null) {
          setLocalValue(prevCommand);
          setCompletionHint('');
          completionRef.current.reset();
        }
        return;
      }

      // Handle down arrow - next command in history
      if (key.downArrow) {
        const nextCommand = historyRef.current.next();
        if (nextCommand !== null) {
          setLocalValue(nextCommand);
          setCompletionHint('');
          completionRef.current.reset();
        }
        return;
      }

      // Handle Tab - command completion
      if (key.tab) {
        const completion = completionRef.current.complete(localValue);
        if (completion !== null) {
          setLocalValue(completion);
          setCompletionHint('');
        } else {
          // Show available completions as hint
          const completions = completionRef.current.getCompletions(localValue);
          if (completions.length > 0) {
            setCompletionHint(completions.join(', '));
          }
        }
        return;
      }

      // Handle Ctrl+C (let ink handle it)
      if (key.ctrl && input === 'c') {
        return;
      }

      // Handle Ctrl+U - clear input
      if (key.ctrl && input === 'u') {
        setLocalValue('');
        onChange('');
        setCompletionHint('');
        completionRef.current.reset();
        return;
      }

      // Handle Ctrl+W - delete word
      if (key.ctrl && input === 'w') {
        const words = localValue.trimEnd().split(' ');
        words.pop();
        const newValue = words.join(' ');
        setLocalValue(newValue);
        setCompletionHint('');
        completionRef.current.reset();
        return;
      }

      // Ignore other control keys
      if (key.ctrl || key.meta || key.escape) {
        return;
      }

      // Add character to input
      const newValue = localValue + input;
      setLocalValue(newValue);

      // Update completion hint
      const completions = completionRef.current.getCompletions(newValue);
      if (completions.length > 0) {
        setCompletionHint(`Tab: ${completions.slice(0, 3).join(', ')}${completions.length > 3 ? '...' : ''}`);
      } else {
        setCompletionHint('');
      }

      completionRef.current.reset();
    },
    { isActive: inputIsActive }
  );

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      minHeight={4}
      borderStyle="single"
      borderColor={disabled ? 'gray' : 'blue'}
      paddingX={1}
    >
      {/* Input prompt */}
      <Box>
        <Text bold color={disabled ? 'gray' : 'blue'}>
          {disabled ? '⊗' : '>'}{' '}
        </Text>
        <Text color={disabled ? 'gray' : 'white'}>
          {localValue}
          {!disabled && <Text inverse> </Text>}
        </Text>
      </Box>

      {/* Completion hint */}
      {!disabled && completionHint && (
        <Box paddingLeft={2}>
          <Text dimColor color="cyan">
            {completionHint}
          </Text>
        </Box>
      )}

      {/* Help text */}
      <Box justifyContent="space-between">
        <Text dimColor>
          {disabled
            ? 'Input visible | wait to send messages | /exit works'
            : '↑/↓ History | Tab Complete | Enter Send | Ctrl+U Clear'}
        </Text>
        <Text dimColor>Ctrl+C Exit</Text>
      </Box>
    </Box>
  );
};
