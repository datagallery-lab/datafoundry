import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { randomUUID } from 'node:crypto';
import { StatusFooter } from './Header.js';
import { ChatArea, type ChatAreaRef } from './ChatArea.js';
import { OutputsView } from './OutputsView.js';
import { ActivityPanel } from './ActivityPanel.js';
import { EnhancedInputBox } from './components/EnhancedInputBox.js';
import { WorkspaceFrame, chatViewportRows } from './workspace-layout.js';
import { KeybindingsHelp } from './KeybindingsHelp.js';
import { SessionPicker } from './SessionPicker.js';
import { ResourcePicker, type ResourcePickerItem } from './ResourcePicker.js';
import { HomeSplash } from './HomeSplash.js';
import { DEFAULT_COMMANDS, getStatusBarShortcuts } from './keybindings.js';
import { AssistantTextStreamBuffer, type AssistantTextFlush } from './assistant-stream-buffer.js';
import { createWheelScrollDecoder } from '../input/mouse-wheel.js';
import {
  restoreSessionConversation,
  store,
  type TuiAppState,
} from '../state/index.js';
import {
  persistWorkspaceConfig,
  type WorkspaceConfigItem,
} from '../state/data-task-state.js';
import { getMessageTextContent } from '../state/message-history.js';
import type { AgentClient, AgentMessage, RunAgentInput } from '../protocol/types.js';
import { classifyError, formatErrorMessage, errorLogger } from '../protocol/error-handler.js';
import { commandProcessor } from '../commands/index.js';
import type { CommandContext, CommandResult } from '../commands/types.js';
import { ConfigClientError, type ConfigClient, type SessionListItem, type Skill } from '../config/index.js';

interface AppProps {
  client: AgentClient;
  configClient?: ConfigClient | undefined;
  datasourceId: string | undefined;
  initialResume?: {
    enabled: boolean;
    sessionId?: string | undefined;
  } | undefined;
}

type TabType = 'chat' | 'stats' | 'config' | 'outputs';
type CommandNotice = {
  message: string;
  kind: 'info' | 'error';
};

const SCROLL_FRAME_MS = 16;
const SCROLL_ROWS_PER_FRAME = 1;
const MAX_PENDING_SCROLL_ROWS = 120;

const createThreadId = (): string => {
  try {
    return randomUUID();
  } catch {
    return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

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

const datasourceIdForItem = (item: WorkspaceConfigItem): string => {
  return item.settings?.datasourceId?.trim() || item.id;
};

const firstEnabledDatasourceId = (state: TuiAppState): string | undefined => {
  const item = state.workspaceConfig.db.find((candidate) => candidate.enabled)
    ?? state.workspaceConfig.db[0];
  return item ? datasourceIdForItem(item) : undefined;
};

const firstEnabledSkillId = (state: TuiAppState): string | undefined => {
  return state.workspaceConfig.skill.find((item) => item.enabled)?.id
    ?? state.workspaceConfig.skill[0]?.id;
};

const uniqueStrings = (values: Array<string | undefined>): string[] => {
  return [...new Set(values.filter((value): value is string => !!value))];
};

const enabledItemIds = (items: WorkspaceConfigItem[]): string[] => {
  return items.filter((item) => item.enabled).map((item) => item.id);
};

const buildTuiRunConfig = (
  state: TuiAppState,
  activeDatasourceId: string | undefined,
  activeSkillId: string | undefined,
): Record<string, unknown> => {
  const enabledDatasourceIds = activeDatasourceId
    ? [activeDatasourceId]
    : uniqueStrings(state.workspaceConfig.db
        .filter((item) => item.enabled)
        .map((item) => datasourceIdForItem(item)));
  const enabledSkillIds = uniqueStrings([
    ...(activeSkillId ? [activeSkillId] : []),
    ...enabledItemIds(state.workspaceConfig.skill),
  ]);

  return {
    enabledDatasourceIds,
    enabledKnowledgeIds: enabledItemIds(state.workspaceConfig.kb),
    enabledMcpServerIds: enabledItemIds(state.workspaceConfig.mcp),
    enabledSkillIds,
    ...(activeDatasourceId ? { activeDatasourceId } : {}),
    ...(activeSkillId ? { activeSkillId } : {}),
    mentioned: {
      db: activeDatasourceId ? [activeDatasourceId] : [],
      kb: [],
      mcp: [],
      skill: activeSkillId ? [activeSkillId] : [],
    },
  };
};

const formatSessionApiError = (error: unknown): string => {
  if (
    error instanceof ConfigClientError &&
    error.statusCode === 404 &&
    error.message.includes('Unknown API resource: sessions')
  ) {
    return 'The connected API process does not support /api/v1/sessions. Rebuild/restart the API server, then retry /resume.';
  }
  return error instanceof Error ? error.message : String(error);
};

const formatSkillApiError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const localSkillPickerItems = (
  items: WorkspaceConfigItem[],
  activeSkillId?: string | undefined,
): ResourcePickerItem[] => {
  return items.map((item) => {
    const format = item.settings?.packageFormat ?? 'unknown';
    const detailParts = [
      `format=${format}`,
      item.enabled ? 'enabled' : 'disabled',
      item.builtin ? 'builtin' : undefined,
    ].filter(Boolean);

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      detail: detailParts.join(', '),
      enabled: item.enabled,
      active: item.id === activeSkillId,
    };
  });
};

const apiSkillPickerItems = (
  skills: Skill[],
  activeSkillId?: string | undefined,
): ResourcePickerItem[] => {
  return skills.map((skill) => {
    const enabled = skill.defaultEnabled !== false;
    const detailParts = [
      `format=${skill.packageFormat}`,
      skill.validationStatus ? `validation=${skill.validationStatus}` : undefined,
      skill.builtin ? 'builtin' : undefined,
    ].filter(Boolean);

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      detail: detailParts.join(', '),
      enabled,
      active: skill.id === activeSkillId,
    };
  });
};

const findSkillPickerItem = (
  items: ResourcePickerItem[],
  requestedId: string,
): ResourcePickerItem | undefined => {
  return items.find((item) => item.id === requestedId)
    ?? items.find((item) => item.name === requestedId)
    ?? items.find((item) => item.id.toLowerCase() === requestedId.toLowerCase());
};

export const App: React.FC<AppProps> = ({
  client,
  configClient,
  datasourceId,
  initialResume,
}) => {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const [state, setState] = useState<TuiAppState>(store.getState());
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [inputFocused, setInputFocused] = useState(false);
  const [commandNotice, setCommandNotice] = useState<CommandNotice | null>(null);
  const [activeDatasourceId, setActiveDatasourceId] = useState<string | undefined>(
    () => datasourceId || firstEnabledDatasourceId(store.getState()),
  );
  const [activeSkillId, setActiveSkillId] = useState<string | undefined>(
    () => firstEnabledSkillId(store.getState()),
  );
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [pickerSessions, setPickerSessions] = useState<SessionListItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>(undefined);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillPickerItems, setSkillPickerItems] = useState<ResourcePickerItem[]>([]);
  const [skillShortcutItems, setSkillShortcutItems] = useState<ResourcePickerItem[]>(
    () => localSkillPickerItems(store.getState().workspaceConfig.skill, activeSkillId),
  );
  const [skillPickerLoading, setSkillPickerLoading] = useState(false);
  const [skillPickerError, setSkillPickerError] = useState<string | undefined>(undefined);
  const [skillPickerWarning, setSkillPickerWarning] = useState<string | undefined>(undefined);
  const [retryCount, setRetryCount] = useState(0);
  const chatAreaRef = useRef<ChatAreaRef>(null);
  const activeTabRef = useRef(activeTab);
  const applyChatScrollDeltaRef = useRef<(delta: number) => void>(() => {});
  const startupResumeAttempted = useRef(false);
  const terminalRows = stdout.rows ?? 40;
  const terminalColumns = stdout.columns ?? 100;
  const modelName = resolveModelName(state);
  const directory = formatDirectory(process.env.PWD || process.cwd());
  const startup = {
    threadId: state.threadId,
    connectionStatus: state.connectionStatus,
    runStatus: state.runStatus,
    modelName,
    directory,
  };
  const visibleMessages = state.messages;
  const transcriptStartup = state.messages.length === 0 ? startup : undefined;
  const chatViewportRowCount = chatViewportRows(terminalRows, {
    commandNotice: Boolean(commandNotice),
    activeTab,
  });
  const pickerOpen = sessionPickerOpen || skillPickerOpen;
  const inputCommands = useMemo(
    () => uniqueStrings([
      ...DEFAULT_COMMANDS,
      ...skillShortcutItems.map((item) => `/${item.id}`),
    ]),
    [skillShortcutItems],
  );

  useEffect(() => {
    if (!activeDatasourceId) {
      setActiveDatasourceId(firstEnabledDatasourceId(state));
    }
    if (!activeSkillId) {
      setActiveSkillId(firstEnabledSkillId(state));
    }
  }, [activeDatasourceId, activeSkillId, state.workspaceConfig]);

  const scrollChatBy = (delta: number): void => {
    if (activeTab !== 'chat' || delta === 0) return;
    chatAreaRef.current?.scrollBy(delta);
  };

  const jumpToLatest = (): void => {
    chatAreaRef.current?.scrollToBottom();
  };

  activeTabRef.current = activeTab;
  applyChatScrollDeltaRef.current = (delta: number): void => {
    if (activeTabRef.current !== 'chat' || delta === 0) return;
    chatAreaRef.current?.scrollBy(delta);
  };

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = store.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localItems = localSkillPickerItems(state.workspaceConfig.skill, activeSkillId);
    setSkillShortcutItems(localItems);

    if (!configClient) {
      return () => {
        cancelled = true;
      };
    }

    configClient.listSkills()
      .then((skills) => {
        if (!cancelled) {
          setSkillShortcutItems(apiSkillPickerItems(skills, activeSkillId));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillShortcutItems(localItems);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [configClient, state.workspaceConfig.skill, activeSkillId]);

  useEffect(() => {
    const decoder = createWheelScrollDecoder();
    let pendingRows = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(): void {
      if (timer !== null) return;
      timer = setTimeout(flush, SCROLL_FRAME_MS);
    }

    function flush(): void {
      timer = null;

      if (pendingRows === 0) return;
      const direction = Math.sign(pendingRows);
      const rows = Math.min(Math.abs(pendingRows), SCROLL_ROWS_PER_FRAME);
      const delta = direction * rows;

      pendingRows -= delta;
      applyChatScrollDeltaRef.current(delta);

      if (pendingRows !== 0) {
        schedule();
      }
    }

    const onData = (chunk: Buffer | string) => {
      const deltas = decoder.push(chunk.toString());
      if (deltas.length === 0) return;

      for (const delta of deltas) {
        pendingRows = Math.max(
          -MAX_PENDING_SCROLL_ROWS,
          Math.min(MAX_PENDING_SCROLL_ROWS, pendingRows + delta),
        );
      }

      if (timer === null) {
        flush();
      }
    };

    stdin.prependListener('data', onData);
    return () => {
      stdin.off('data', onData);
      decoder.reset();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [stdin]);

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

  useEffect(() => {
    if (!initialResume?.enabled || startupResumeAttempted.current) return;
    if (state.connectionStatus !== 'connected') return;
    startupResumeAttempted.current = true;
    void restoreHistoricalSession(initialResume.sessionId, true);
  }, [initialResume?.enabled, initialResume?.sessionId, state.connectionStatus]);

  async function restoreHistoricalSession(
    requestedSessionId?: string | undefined,
    startup = false,
  ): Promise<void> {
    if (store.getState().runStatus === 'running') {
      setCommandNotice({
        kind: 'error',
        message: 'Cannot resume another session while a run is active.',
      });
      return;
    }

    if (!configClient) {
      setCommandNotice({
        kind: 'error',
        message: 'Session resume requires a live backend; it is not available in demo mode.',
      });
      return;
    }

    setCommandNotice({
      kind: 'info',
      message: requestedSessionId
        ? `Loading session ${requestedSessionId}...`
        : 'Loading latest session...',
    });

    try {
      let sessionId = requestedSessionId;
      if (!sessionId) {
        const response = await configClient.listSessions({ limit: 1 });
        sessionId = response.sessions[0]?.threadId ?? response.sessions[0]?.id;
        if (!sessionId) {
          setCommandNotice({
            kind: startup ? 'info' : 'error',
            message: 'No server sessions found.',
          });
          return;
        }
      }

      const conversation = await configClient.getSessionConversation(sessionId);
      const restored = restoreSessionConversation(conversation);
      store.restoreSession(restored);
      chatAreaRef.current?.reset();
      setActiveTab('chat');
      setCommandNotice({
        kind: 'info',
        message: `Resumed session ${restored.title ? `"${restored.title}" ` : ''}(${restored.threadId}).`,
      });
    } catch (error) {
      setCommandNotice({
        kind: 'error',
        message: `Resume failed: ${formatSessionApiError(error)}`,
      });
    }
  }

  async function openSessionPicker(): Promise<void> {
    if (store.getState().runStatus === 'running') {
      setCommandNotice({
        kind: 'error',
        message: 'Cannot resume another session while a run is active.',
      });
      return;
    }

    if (!configClient) {
      setCommandNotice({
        kind: 'error',
        message: 'Session resume requires a live backend; it is not available in demo mode.',
      });
      return;
    }

    setCommandNotice(null);
    setSessionPickerOpen(true);
    setSkillPickerOpen(false);
    setPickerLoading(true);
    setPickerError(undefined);
    setPickerSessions([]);

    try {
      const response = await configClient.listSessions({ limit: 50 });
      setPickerSessions(response.sessions);
    } catch (error) {
      setPickerError(formatSessionApiError(error));
    } finally {
      setPickerLoading(false);
    }
  }

  async function openSkillPicker(): Promise<void> {
    setCommandNotice(null);
    setSkillPickerOpen(true);
    setSessionPickerOpen(false);
    setSkillPickerLoading(true);
    setSkillPickerError(undefined);
    setSkillPickerWarning(undefined);
    setSkillPickerItems([]);

    const localItems = localSkillPickerItems(
      store.getState().workspaceConfig.skill,
      activeSkillId,
    );

    if (!configClient) {
      setSkillPickerItems(localItems);
      setSkillPickerLoading(false);
      return;
    }

    try {
      const skills = await configClient.listSkills();
      const items = apiSkillPickerItems(skills, activeSkillId);
      setSkillPickerItems(items);
      setSkillShortcutItems(items);
    } catch (error) {
      setSkillPickerItems(localItems);
      setSkillShortcutItems(localItems);
      if (localItems.length > 0) {
        setSkillPickerWarning(`Backend skill list failed: ${formatSkillApiError(error)}`);
      } else {
        setSkillPickerError(`Failed to load skills: ${formatSkillApiError(error)}`);
      }
    } finally {
      setSkillPickerLoading(false);
    }
  }

  async function resolveSkillShortcut(commandName: string): Promise<ResourcePickerItem | undefined> {
    const cachedChoice = findSkillPickerItem(skillShortcutItems, commandName);
    if (cachedChoice) {
      return cachedChoice;
    }

    const localItems = localSkillPickerItems(
      store.getState().workspaceConfig.skill,
      activeSkillId,
    );
    const localChoice = findSkillPickerItem(localItems, commandName);
    if (localChoice) {
      return localChoice;
    }

    if (!configClient) {
      return undefined;
    }

    try {
      const skills = await configClient.listSkills();
      const items = apiSkillPickerItems(skills, activeSkillId);
      setSkillShortcutItems(items);
      return findSkillPickerItem(items, commandName);
    } catch {
      setSkillShortcutItems(localItems);
      return undefined;
    }
  }

  async function executeCommandOrSkillShortcut(
    input: string,
    commandContext: CommandContext,
  ): Promise<CommandResult> {
    const { commandName } = commandProcessor.parseCommand(input);
    if (commandName && !commandProcessor.hasCommand(commandName)) {
      const skill = await resolveSkillShortcut(commandName);
      if (skill) {
        return {
          success: true,
          message: `Skill selected: ${skill.name} (${skill.id})`,
          data: {
            action: 'select_skill',
            skillId: skill.id,
            label: skill.name,
          },
        };
      }
    }

    return commandProcessor.executeCommand(input, commandContext);
  }

  function selectDatasourceForSession(nextDatasourceId: string): void {
    setActiveDatasourceId(nextDatasourceId);

    const currentConfig = store.getState().workspaceConfig;
    let found = false;
    const nextDb = currentConfig.db.map((item) => {
      const itemDatasourceId = datasourceIdForItem(item);
      const selected = item.id === nextDatasourceId || itemDatasourceId === nextDatasourceId;
      if (selected) {
        found = true;
      }
      return { ...item, enabled: selected };
    });

    if (found) {
      const nextConfig = { ...currentConfig, db: nextDb };
      store.setWorkspaceConfig(nextConfig);
      persistWorkspaceConfig(nextConfig);
    }
  }

  function selectSkillForSession(nextSkillId: string): void {
    setActiveSkillId(nextSkillId);

    const currentConfig = store.getState().workspaceConfig;
    let found = false;
    const nextSkills = currentConfig.skill.map((item) => {
      const selected = item.id === nextSkillId;
      if (selected) {
        found = true;
      }
      return { ...item, enabled: selected };
    });

    if (found) {
      const nextConfig = { ...currentConfig, skill: nextSkills };
      store.setWorkspaceConfig(nextConfig);
      persistWorkspaceConfig(nextConfig);
    }
  }

  const clearScreen = (): void => {
    store.clearMessages();
    chatAreaRef.current?.reset();
  };

  const startNewSession = (): void => {
    store.startNewSession(createThreadId());
    chatAreaRef.current?.reset();
    setActiveTab('chat');
  };

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Ignore input when typing in the input box
    if (pickerOpen || inputFocused) return;

    if (activeTab === 'chat' && key.pageUp) {
      scrollChatBy(Math.max(3, Math.floor(chatViewportRowCount * 0.8)));
      return;
    }

    if (activeTab === 'chat' && key.pageDown) {
      scrollChatBy(-Math.max(3, Math.floor(chatViewportRowCount * 0.8)));
      return;
    }

    if (activeTab === 'chat' && key.home) {
      chatAreaRef.current?.scrollToTop();
      return;
    }

    if (activeTab === 'chat' && key.end) {
      jumpToLatest();
      return;
    }

    // Ctrl+L - Clear screen (reset chat messages)
    if (key.ctrl && input === 'l') {
      clearScreen();
      return;
    }

    // Ctrl+N - New session (reset and create new thread)
    if (key.ctrl && input === 'n') {
      startNewSession();
      return;
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
    store.clearInputBuffer();
    setCommandNotice(null);

    try {
      // Prepare command context
      const currentState = store.getState();
      const commandContext: CommandContext = {
        client,
        ...(configClient ? { configClient } : {}),
        ...(activeDatasourceId ? { datasourceId: activeDatasourceId } : {}),
        ...(activeSkillId ? { activeSkillId } : {}),
        workspaceConfig: currentState.workspaceConfig,
        state: {
          ...(currentState.threadId !== undefined && { threadId: currentState.threadId }),
          messages: currentState.messages,
        },
      };

      // Execute command
      const result = await executeCommandOrSkillShortcut(input, commandContext);

      // Handle command result
      if (result.success) {
        // Check for special actions
        if (result.data && typeof result.data === 'object') {
          const commandData = result.data as {
            action?: string;
            tab?: unknown;
            sessionId?: unknown;
            datasourceId?: unknown;
            skillId?: unknown;
          };
          const action = commandData.action;

          if (action === 'clear_history') {
            store.clearMessages();
            chatAreaRef.current?.reset();
          } else if (action === 'reset_session') {
            store.startNewSession(createThreadId());
            chatAreaRef.current?.reset();
            setActiveTab('chat');
          } else if (action === 'exit_application') {
            if ('dispose' in client && typeof client.dispose === 'function') {
              client.dispose();
            }
            exit();
            return;
          } else if (action === 'switch_tab') {
            const tab = commandData.tab;
            if (tab === 'chat' || tab === 'stats' || tab === 'config' || tab === 'outputs') {
              setActiveTab(tab);
            }
          } else if (action === 'resume_session') {
            const sessionId = typeof commandData.sessionId === 'string'
              ? commandData.sessionId
              : undefined;
            await restoreHistoricalSession(sessionId);
            return;
          } else if (action === 'open_picker' || action === 'list_sessions') {
            await openSessionPicker();
            return;
          } else if (action === 'open_skill_picker') {
            await openSkillPicker();
            return;
          } else if (action === 'select_datasource') {
            if (typeof commandData.datasourceId === 'string') {
              selectDatasourceForSession(commandData.datasourceId);
            }
          } else if (action === 'select_skill') {
            if (typeof commandData.skillId === 'string') {
              selectSkillForSession(commandData.skillId);
            }
          }
        }

        setCommandNotice({ message: result.message, kind: 'info' });
      } else {
        setCommandNotice({
          message: `Command error: ${result.message}`,
          kind: 'error',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setCommandNotice({
        message: `Command execution failed: ${errorMessage}`,
        kind: 'error',
      });
    }
  };

  // Handle agent query execution
  const handleAgentQuery = async (input: string) => {
    setCommandNotice(null);
    store.addUserMessage(input);
    store.clearInputBuffer();
    // Reset after the message enters history so the startup banner no longer
    // contributes to the viewport slice.
    chatAreaRef.current?.scrollToBottom();

    // Prepare stable run input material. Retry attempts should not append
    // duplicate chat messages or send retry UI text back as model history.
    const currentState = store.getState();
    const threadId = currentState.threadId || createThreadId();
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
      const runConfig = buildTuiRunConfig(currentState, activeDatasourceId, activeSkillId);
      const context: NonNullable<RunAgentInput['context']> = [
        ...(activeDatasourceId
          ? [
              {
                description: 'datasource_id',
                value: activeDatasourceId,
              },
            ]
          : []),
        {
          description: 'run_config',
          value: JSON.stringify(runConfig),
        },
      ];

      return {
        threadId,
        runId,
        messages,
        tools: [],
        context,
        state: {
          ...(activeDatasourceId
            ? {
                datasourceId: activeDatasourceId,
                selectedDatasourceId: activeDatasourceId,
              }
            : {}),
          runId,
          runStatus: 'running',
          sessionId: threadId,
          run_config: runConfig,
        },
        forwardedProps: {
          ...(activeDatasourceId ? { datasourceId: activeDatasourceId } : {}),
          run_config: runConfig,
        },
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
          activeDatasourceId,
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
  const visibleArtifacts = state.artifacts;
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
  const isHomeScreen = activeTab === 'chat'
    && visibleMessages.length === 0
    && state.messages.length === 0
    && !commandNotice
    && !showLiveActivity;

  // Render tab navigation
  const renderTabs = () => {
    const tabs: Array<{ key: TabType; label: string }> = [
      { key: 'chat', label: 'Chat' },
      { key: 'stats', label: 'Stats' },
      { key: 'config', label: 'Config' },
      { key: 'outputs', label: 'Outputs' },
    ];

    return (
      <Box marginBottom={0}>
        {tabs.map((tab, index) => (
          <React.Fragment key={tab.key}>
            {index > 0 && <Text color="gray"> | </Text>}
            <Text
              color={activeTab === tab.key ? 'cyan' : 'white'}
              bold={activeTab === tab.key}
              dimColor={activeTab !== tab.key}
            >
              {tab.label}
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
        {activeDatasourceId && <Text>Datasource ID: {activeDatasourceId}</Text>}
        {activeSkillId && <Text>Skill ID: {activeSkillId}</Text>}
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
    <>
      {sessionPickerOpen ? (
        <Box flexDirection="column">
          <SessionPicker
            sessions={pickerSessions}
            loading={pickerLoading}
            error={pickerError}
            onSelect={(sessionId) => {
              setSessionPickerOpen(false);
              void restoreHistoricalSession(sessionId);
            }}
            onCancel={() => {
              setSessionPickerOpen(false);
            }}
          />
        </Box>
      ) : skillPickerOpen ? (
        <Box flexDirection="column">
          <ResourcePicker
            title="Select a skill"
            items={skillPickerItems}
            loading={skillPickerLoading}
            error={skillPickerError}
            warning={skillPickerWarning}
            emptyMessage="No skills configured."
            onSelect={(item) => {
              setSkillPickerOpen(false);
              selectSkillForSession(item.id);
              setCommandNotice({
                kind: 'info',
                message: `Skill selected: ${item.name} (${item.id}).`,
              });
            }}
            onCancel={() => {
              setSkillPickerOpen(false);
            }}
          />
        </Box>
      ) : (
        <WorkspaceFrame
          rows={terminalRows}
          scrollable={
            <Box flexDirection="row" flexGrow={1} overflowY="hidden">
              {activeTab === 'chat' ? (
                isHomeScreen ? (
                  <Box flexDirection="column" flexGrow={1} paddingX={1} overflowY="hidden">
                    <HomeSplash
                      rows={Math.max(12, terminalRows - 1)}
                      columns={terminalColumns}
                      startup={startup}
                      input={(promptWidth) => (
                        <EnhancedInputBox
                          onChange={handleInputChange}
                          onSubmit={handleSubmit}
                          onFocusChange={setInputFocused}
                          onClearScreen={clearScreen}
                          onNewSession={startNewSession}
                          disabled={state.connectionStatus !== 'connected' || state.runStatus === 'running'}
                          commands={inputCommands}
                          modelName={modelName}
                          datasourceId={activeDatasourceId}
                          skillId={activeSkillId}
                          inputWidth={promptWidth}
                        />
                      )}
                    />
                  </Box>
                ) : (
                  <>
                    <Box
                      flexDirection="column"
                      width={showLiveActivity ? `${chatWidth}%` : '100%'}
                      flexGrow={1}
                      paddingX={1}
                      overflowY="hidden"
                    >
                      <ChatArea
                        ref={chatAreaRef}
                        messages={visibleMessages}
                        artifacts={visibleArtifacts}
                        totalMessageCount={state.messages.length}
                        toolCalls={state.toolCalls}
                        viewportRows={chatViewportRowCount}
                        columns={terminalColumns}
                        startup={transcriptStartup}
                      />
                    </Box>

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
                )
              ) : activeTab === 'stats' ? (
                <Box flexDirection="column" flexGrow={1} overflowY="hidden">
                  {renderStatsPanel()}
                </Box>
              ) : activeTab === 'config' ? (
                <Box flexDirection="column" flexGrow={1} overflowY="hidden">
                  {renderConfigPanel()}
                </Box>
              ) : (
                <Box flexDirection="column" flexGrow={1} overflowY="hidden">
                  <OutputsView
                    artifacts={visibleArtifacts}
                    events={state.events}
                  />
                </Box>
              )}
            </Box>
          }
          bottom={
            <>
              {activeTab !== 'chat' && renderStatusBar()}

              {commandNotice && (
                <Box paddingX={1} flexShrink={0}>
                  <Text color={commandNotice.kind === 'error' ? 'red' : 'cyan'}>
                    {commandNotice.message}
                  </Text>
                </Box>
              )}

              {activeTab !== 'chat' && (
                <Box paddingX={1}>
                  {renderTabs()}
                </Box>
              )}

              {!isHomeScreen && (
                <EnhancedInputBox
                  onChange={handleInputChange}
                  onSubmit={handleSubmit}
                  onFocusChange={setInputFocused}
                  onClearScreen={clearScreen}
                  onNewSession={startNewSession}
                  disabled={state.connectionStatus !== 'connected' || state.runStatus === 'running'}
                  commands={inputCommands}
                  modelName={modelName}
                  datasourceId={activeDatasourceId}
                  skillId={activeSkillId}
                  inputWidth={terminalColumns}
                />
              )}

              {(isHomeScreen || activeTab !== 'chat') && (
                <StatusFooter
                  connectionStatus={state.connectionStatus}
                  runStatus={state.runStatus}
                  modelName={modelName}
                  directory={directory}
                />
              )}
            </>
          }
        />
      )}
    </>
  );
};
