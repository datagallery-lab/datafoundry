import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './Header.js';
import { ChatArea } from './ChatArea.js';
import { ActivityPanel } from './ActivityPanel.js';
import { InputBox } from './InputBox.js';
import { KeybindingsHelp } from './KeybindingsHelp.js';
import { getStatusBarShortcuts } from './keybindings.js';
import { AssistantTextStreamBuffer, type AssistantTextFlush } from './assistant-stream-buffer.js';
import { store, type TuiAppState } from '../state/index.js';
import { getMessageTextContent } from '../state/message-history.js';
import type { AgentClient, AgentMessage, RunAgentInput } from '../protocol/types.js';
import { classifyError, formatErrorMessage, errorLogger } from '../protocol/error-handler.js';
import { commandProcessor } from '../commands/index.js';
import type { CommandContext } from '../commands/types.js';

interface AppProps {
  client: AgentClient;
  datasourceId: string | undefined;
}

type TabType = 'chat' | 'stats' | 'config';
const MAX_VISIBLE_CHAT_MESSAGES = 40;

const formatDirectory = (directory: string): string => {
  const homeDirectory = process.env.HOME;
  if (!homeDirectory) return directory;
  if (directory === homeDirectory) return '~';
  if (directory.startsWith(`${homeDirectory}/`)) {
    return `~/${directory.slice(homeDirectory.length + 1)}`;
  }
  return directory;
};

const resolveModelName = (state: TuiAppState): string => {
  const model = state.workspaceConfig.llm.find((item) => item.enabled) ?? state.workspaceConfig.llm[0];
  const modelName = model?.settings?.modelName;
  const provider = model?.settings?.provider;

  if (modelName && provider && !provider.includes('服务端')) {
    return `${modelName} (${provider})`;
  }

  return modelName || model?.name || 'server default';
};

export const App: React.FC<AppProps> = ({ client, datasourceId }) => {
  const { exit } = useApp();
  const [state, setState] = useState<TuiAppState>(store.getState());
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [inputFocused, setInputFocused] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = store.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  // Initialize connection monitoring if client supports it
  useEffect(() => {
    if ('startConnectionMonitoring' in client && typeof client.startConnectionMonitoring === 'function') {
      client.startConnectionMonitoring();
    }

    return () => {
      if ('stopConnectionMonitoring' in client && typeof client.stopConnectionMonitoring === 'function') {
        client.stopConnectionMonitoring();
      }
    };
  }, [client]);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Ignore input when typing in the input box
    if (inputFocused) return;

    // Ctrl+L - Clear screen (reset chat messages)
    if (key.ctrl && input === 'l') {
      // Clear messages but keep thread and session
      const currentState = store.getState();
      store.reset();
      if (currentState.threadId) {
        store.setThreadId(currentState.threadId);
      }
      return;
    }

    // Ctrl+T - Toggle tab (cycle through tabs)
    if (key.ctrl && input === 't') {
      const tabs: TabType[] = ['chat', 'stats', 'config'];
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex = (currentIndex + 1) % tabs.length;
      setActiveTab(tabs[nextIndex]);
      return;
    }

    // Ctrl+N - New session (reset and create new thread)
    if (key.ctrl && input === 'n') {
      store.reset();
      const newThreadId = `thread-${Date.now()}`;
      store.setThreadId(newThreadId);
      setActiveTab('chat');
      return;
    }

    // Tab navigation shortcuts
    if (key.tab) {
      // Cycle through tabs
      const tabs: TabType[] = ['chat', 'stats', 'config'];
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex = (currentIndex + 1) % tabs.length;
      setActiveTab(tabs[nextIndex]);
    } else if (input === '1') {
      setActiveTab('chat');
    } else if (input === '2') {
      setActiveTab('stats');
    } else if (input === '3') {
      setActiveTab('config');
    }
  });

  // Handle user input submission
  const handleSubmit = async (input: string) => {
    if (!input.trim()) return;

    const trimmedInput = input.trim();

    // Check if input is a command (starts with /)
    if (commandProcessor.isCommand(trimmedInput)) {
      // Handle command execution
      await handleCommandExecution(trimmedInput);
      return;
    }

    // Handle as natural language query to agent
    await handleAgentQuery(trimmedInput);
  };

  // Handle command execution
  const handleCommandExecution = async (input: string) => {
    // Add user message to chat history
    store.addUserMessage(input);
    store.clearInputBuffer();

    try {
      // Prepare command context
      const currentState = store.getState();
      const commandContext: CommandContext = {
        client,
        datasourceId,
        state: {
          ...(currentState.threadId !== undefined && { threadId: currentState.threadId }),
          messages: currentState.messages,
        },
      };

      // Execute command
      const result = await commandProcessor.executeCommand(input, commandContext);

      // Handle command result
      if (result.success) {
        // Check for special actions
        if (result.data && typeof result.data === 'object') {
          const action = (result.data as { action?: string }).action;

          if (action === 'clear_history') {
            // Clear messages but keep thread
            store.getState().messages = [];
            setState(store.getState());
          } else if (action === 'reset_session') {
            // Reset entire session
            store.setThreadId(null);
            store.getState().messages = [];
            setState(store.getState());
          } else if (action === 'exit_application') {
            store.addAssistantMessage(result.message, false);
            if ('dispose' in client && typeof client.dispose === 'function') {
              client.dispose();
            }
            exit();
            return;
          }
        }

        // Add command result as system message
        store.addAssistantMessage(result.message, false);
      } else {
        // Add error message
        store.addAssistantMessage(`Command error: ${result.message}`, false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      store.addAssistantMessage(`Command execution failed: ${errorMessage}`, false);
    }
  };

  // Handle agent query execution
  const handleAgentQuery = async (input: string) => {
    // Add user message to chat history
    store.addUserMessage(input);
    store.clearInputBuffer();

    // Prepare stable run input material. Retry attempts should not append
    // duplicate chat messages or send retry UI text back as model history.
    const currentState = store.getState();
    const threadId = currentState.threadId || `thread-${Date.now()}`;
    if (!currentState.threadId) {
      store.setThreadId(threadId);
    }

    const messages: AgentMessage[] = currentState.messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: getMessageTextContent(msg),  // Extract text from elements
    }));

    const createRunInput = (): RunAgentInput => {
      const runId = `run-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      return {
        threadId,
        runId,
        messages,
        tools: [],
        context: datasourceId ? [
          {
            description: 'datasource_id',
            value: datasourceId,
          }
        ] : [],
        state: {
          ...(datasourceId ? { datasourceId, selectedDatasourceId: datasourceId } : {}),
          runId,
          runStatus: 'running',
          sessionId: threadId,
        },
        forwardedProps: datasourceId ? { datasourceId } : {},
      };
    };

    const runAttempt = async (attempt: number): Promise<void> => {
      const runInput = createRunInput();
      const runId = runInput.runId;

      // Set run status to running
      store.handleLiveRunEvent({ type: 'RUN_STARTED' });

      if (attempt === 0) {
        store.addAssistantMessage('', true);
      }

      setRetryCount(attempt);
      let receivedText = false;
      const textBuffer = new AssistantTextStreamBuffer();
      let textFlushTimer: ReturnType<typeof setTimeout> | undefined;

      const applyTextFlush = (flush: AssistantTextFlush | null) => {
        if (!flush) return;
        if (flush.type === 'text') {
          store.updateAssistantMessage(flush.content, flush.isStreaming);
        } else {
          store.finalizeAssistantMessage();
        }
      };

      const flushTextBuffer = (isStreaming = true) => {
        if (textFlushTimer) {
          clearTimeout(textFlushTimer);
          textFlushTimer = undefined;
        }

        applyTextFlush(textBuffer.flush(isStreaming));
      };

      const startNextTextSegment = () => {
        flushTextBuffer();
        textBuffer.markSegmentBoundary();
      };

      const scheduleTextFlush = () => {
        if (textFlushTimer) return;
        textFlushTimer = setTimeout(() => {
          textFlushTimer = undefined;
          flushTextBuffer();
        }, 60);
      };

      try {
        // Stream events from the agent
        for await (const event of client.runAgent(runInput)) {
          // Handle specific event types for message streaming
          if (event.type === 'TEXT_MESSAGE_CONTENT' || event.type === 'TEXT_MESSAGE_CHUNK') {
            const delta = (event as { delta?: unknown }).delta;
            if (typeof delta === 'string') {
              if (!textBuffer.append(delta)) {
                continue;
              }

              if (!receivedText) {
                store.updateAssistantMessage('', true);
                receivedText = true;
              }
              scheduleTextFlush();
            }
          } else if (event.type === 'TEXT_MESSAGE_END') {
            flushTextBuffer(false);
          } else if (event.type === 'RUN_FINISHED') {
            flushTextBuffer(false);
            store.handleLiveRunEvent(event as { type?: string; [key: string]: unknown });
          } else if (event.type === 'RUN_ERROR') {
            flushTextBuffer();
            const message = (event as { message?: unknown }).message;
            const errorMessage = typeof message === 'string' ? message : 'Agent run failed';

            // Classify and log the error
            const classifiedError = classifyError(new Error(errorMessage));
            errorLogger.log(classifiedError, { threadId, runId });

            // Display user-friendly error message
            const friendlyMessage = formatErrorMessage(classifiedError);
            store.updateAssistantMessage(`Error: ${friendlyMessage}`, false);
          } else if (event.type === 'TOOL_CALL_START') {
            startNextTextSegment();
            store.handleLiveRunEvent(event as { type?: string; [key: string]: unknown });
          } else {
            // Feed non-text events into the state reducer. Text chunks are
            // rendered through the buffered assistant message path above.
            store.handleLiveRunEvent(event as { type?: string; [key: string]: unknown });
          }
        }
        flushTextBuffer(false);

        // Ensure run is marked as finished
        const finalState = store.getState();
        if (finalState.runStatus === 'running') {
          store.handleLiveRunEvent({ type: 'RUN_FINISHED' });
        }

        // Clear any previous errors on success
        store.setConnectionStatus('connected');
        setRetryCount(0);
      } catch (error) {
        flushTextBuffer();

        // Classify the error
        const classifiedError = classifyError(error);

        // Log the error with context
        errorLogger.log(classifiedError, {
          threadId,
          runId,
          retryCount: attempt,
          datasourceId,
        });

        // Update connection status
        if (classifiedError.category === 'network') {
          store.setConnectionStatus('error', classifiedError.userMessage);
        } else {
          store.setConnectionStatus('connected', classifiedError.userMessage);
        }

        // Format user-friendly error message
        const friendlyMessage = formatErrorMessage(classifiedError);

        // Handle retryable errors
        if (classifiedError.retryable && attempt < 3) {
          const nextAttempt = attempt + 1;
          setRetryCount(nextAttempt);

          // Show retry message in the existing assistant bubble.
          store.updateAssistantMessage(
            `${friendlyMessage}\n\nRetrying (${nextAttempt}/3)...`,
            true,
          );

          await new Promise(resolve => setTimeout(resolve, 2000 * nextAttempt));
          await runAttempt(nextAttempt);
        } else {
          // Non-retryable or max retries reached
          store.handleLiveRunEvent({
            type: 'RUN_ERROR',
            message: friendlyMessage,
          });

          // Add error message to chat with category indicator
          const categoryEmoji = {
            network: '🌐',
            config: '⚙️',
            api: '🔌',
            validation: '✏️',
            stream: '📡',
            unknown: '❓',
          }[classifiedError.category];

          store.updateAssistantMessage(
            `${categoryEmoji} ${friendlyMessage}`,
            false,
          );
          setRetryCount(0);
        }
      }
    };

    await runAttempt(0);
  };

  // Handle input change (no-op - InputBox manages its own local state)
  const handleInputChange = (value: string) => {
    // InputBox manages its own state, we don't need to sync to store on every keystroke
    // This avoids unnecessary re-renders and flickering
  };

  // Calculate responsive widths (70% / 30%)
  const getContentWidth = () => {
    // For terminal, use character-based width calculation
    // This is a simplified approach - actual width depends on terminal size
    return { chatWidth: 70, panelWidth: 30 };
  };

  const { chatWidth, panelWidth } = getContentWidth();
  const visibleMessages = state.messages.slice(-MAX_VISIBLE_CHAT_MESSAGES);
  const visibleArtifacts = state.runStatus === 'running'
    ? []
    : state.artifacts.slice(-3);
  const modelName = resolveModelName(state);
  const directory = formatDirectory(process.env.PWD || process.cwd());
  const liveActivity = state.runStatus === 'running'
    ? {
        plan: state.plan,
        toolCalls: state.toolCalls.slice(-2),
        events: [],
      }
    : {
        plan: [],
        toolCalls: [],
        events: [],
      };
  const showLiveActivity = false;

  // Render tab navigation
  const renderTabs = () => {
    const tabs: Array<{ key: TabType; label: string; shortcut: string }> = [
      { key: 'chat', label: 'Chat', shortcut: '1' },
      { key: 'stats', label: 'Stats', shortcut: '2' },
      { key: 'config', label: 'Config', shortcut: '3' },
    ];

    return (
      <Box marginBottom={1}>
        {tabs.map((tab, index) => (
          <React.Fragment key={tab.key}>
            {index > 0 && <Text color="gray"> | </Text>}
            <Text
              color={activeTab === tab.key ? 'cyan' : 'white'}
              bold={activeTab === tab.key}
              dimColor={activeTab !== tab.key}
            >
              [{tab.shortcut}] {tab.label}
            </Text>
          </React.Fragment>
        ))}
      </Box>
    );
  };

  // Render stats panel content
  const renderStatsPanel = () => {
    const messageCount = state.messages.length;
    const userMessages = state.messages.filter(m => m.role === 'user').length;
    const assistantMessages = state.messages.filter(m => m.role === 'assistant').length;
    const toolCallCount = state.toolCalls.length;
    const eventCount = state.events.length;
    const errorLogs = errorLogger.getRecentLogs(5);

    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">Session Statistics</Text>
        <Text> </Text>
        <Text>Total Messages: {messageCount}</Text>
        <Text>User Messages: {userMessages}</Text>
        <Text>Assistant Messages: {assistantMessages}</Text>
        <Text>Tool Calls: {toolCallCount}</Text>
        <Text>Events: {eventCount}</Text>
        <Text> </Text>
        <Text bold color="yellow">Connection</Text>
        <Text>Status: {state.connectionStatus}</Text>
        <Text>Run Status: {state.runStatus}</Text>
        {state.lastError && (
          <>
            <Text> </Text>
            <Text bold color="red">Last Error</Text>
            <Text color="red">{state.lastError}</Text>
          </>
        )}
        {errorLogs.length > 0 && (
          <>
            <Text> </Text>
            <Text bold color="red">Recent Errors</Text>
            {errorLogs.map((log, idx) => (
              <Box key={idx} flexDirection="column" marginTop={1}>
                <Text dimColor>
                  {log.timestamp.toLocaleTimeString()} - {log.error.category}
                </Text>
                <Text color="red">{log.error.userMessage}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    );
  };

  // Render config panel content
  const renderConfigPanel = () => {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">Configuration</Text>
        <Text> </Text>
        <Text>Thread ID: {state.threadId || 'Not set'}</Text>
        {datasourceId && <Text>Datasource ID: {datasourceId}</Text>}
        <Text> </Text>
        <Text bold color="yellow">Settings</Text>
        <Text dimColor>No configurable settings yet</Text>
        <Text> </Text>
        <KeybindingsHelp compact />
      </Box>
    );
  };

  // Render status bar with shortcuts
  const renderStatusBar = () => {
    const shortcuts = getStatusBarShortcuts();

    return (
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
      >
        <Text dimColor>
          {shortcuts.map(s => `${s.key}: ${s.action}`).join(' | ')}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header: Session info and status */}
      <Header
        threadId={state.threadId}
        connectionStatus={state.connectionStatus}
        runStatus={state.runStatus}
        lastError={state.lastError}
        modelName={modelName}
        directory={directory}
      />

      {/* Tab Navigation */}
      <Box paddingX={1}>
        {renderTabs()}
      </Box>

      {/* Main content area */}
      <Box flexDirection="row" flexGrow={1}>
        {activeTab === 'chat' ? (
          <>
            {/* Chat area: Message history (70% width) */}
            <Box
              flexDirection="column"
              width={showLiveActivity ? `${chatWidth}%` : '100%'}
              paddingX={1}
            >
              <ChatArea
                messages={visibleMessages}
                artifacts={visibleArtifacts}
                totalMessageCount={state.messages.length}
                toolCalls={state.toolCalls}
              />
            </Box>

            {/* Activity panel: Plan and tool call progress (30% width) */}
            {showLiveActivity && (
              <Box
                flexDirection="column"
                width={`${panelWidth}%`}
                borderStyle="single"
                borderColor="cyan"
                paddingX={1}
              >
                <ActivityPanel
                  plan={liveActivity.plan}
                  toolCalls={liveActivity.toolCalls}
                  events={liveActivity.events}
                />
              </Box>
            )}
          </>
        ) : activeTab === 'stats' ? (
          <Box flexDirection="column" flexGrow={1}>
            {renderStatsPanel()}
          </Box>
        ) : (
          <Box flexDirection="column" flexGrow={1}>
            {renderConfigPanel()}
          </Box>
        )}
      </Box>

      {/* Status bar with keyboard shortcuts */}
      {activeTab !== 'chat' && renderStatusBar()}

      {/* Input box at the bottom */}
      <InputBox
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        disabled={state.connectionStatus !== 'connected' || state.runStatus === 'running'}
      />
    </Box>
  );
};
