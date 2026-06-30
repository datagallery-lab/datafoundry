/**
 * Built-in commands for the TUI
 */

import type { Command, CommandResult } from './types.js';

type TabName = 'chat' | 'stats' | 'config' | 'outputs';

const TAB_LABELS: Record<TabName, string> = {
  chat: 'Chat',
  stats: 'Stats',
  config: 'Config',
  outputs: 'Outputs',
};

const TAB_NAMES = new Set<TabName>(['chat', 'stats', 'config', 'outputs']);

const isTabName = (value: string): value is TabName => {
  return TAB_NAMES.has(value as TabName);
};

const switchTabResult = (tab: TabName): CommandResult => ({
  success: true,
  message: `Switched to ${TAB_LABELS[tab]} tab.`,
  data: { action: 'switch_tab', tab },
});

export const helpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  aliases: ['h', '?'],
  execute: async (args, context) => {
    const commands = getAllCommands();
    const commandList = commands
      .map(cmd => {
        const aliases = cmd.aliases ? ` (${cmd.aliases.join(', ')})` : '';
        return `  /${cmd.name}${aliases} - ${cmd.description}`;
      })
      .join('\n');

    return {
      success: true,
      message: `Available commands:\n${commandList}\n\nTip: Type a message without '/' to chat with the agent. Use /tab <name> to switch views.`,
    };
  },
};

export const clearCommand: Command = {
  name: 'clear',
  description: 'Clear chat history',
  aliases: ['c'],
  execute: async (args, context) => {
    // This will be handled in App.tsx by clearing the store
    return {
      success: true,
      message: 'Chat history cleared.',
      data: { action: 'clear_history' },
    };
  },
};

export const statusCommand: Command = {
  name: 'status',
  description: 'Show current session status',
  aliases: ['s'],
  execute: async (args, context) => {
    const { state, datasourceId } = context;
    const userMessages = state.messages.filter(m => m.role === 'user').length;
    const assistantMessages = state.messages.filter(m => m.role === 'assistant').length;

    const status = [
      `Thread ID: ${state.threadId || 'Not set'}`,
      `Messages: ${state.messages.length} (${userMessages} user, ${assistantMessages} assistant)`,
      datasourceId ? `Datasource: ${datasourceId}` : 'Datasource: None',
    ].join('\n');

    return {
      success: true,
      message: status,
    };
  },
};

export const tabCommand: Command = {
  name: 'tab',
  description: 'Switch view tab (chat|stats|config|outputs)',
  aliases: ['view'],
  execute: async (args) => {
    const tab = args[0]?.toLowerCase();
    if (!tab || !isTabName(tab)) {
      return {
        success: false,
        message: 'Usage: /tab <chat|stats|config|outputs>',
      };
    }

    return switchTabResult(tab);
  },
};

const createSwitchTabCommand = (tab: TabName): Command => ({
  name: tab,
  description: `Switch to ${TAB_LABELS[tab]} tab`,
  execute: async () => switchTabResult(tab),
});

export const chatCommand = createSwitchTabCommand('chat');
export const statsCommand = createSwitchTabCommand('stats');
export const configCommand = createSwitchTabCommand('config');
export const outputsCommand = createSwitchTabCommand('outputs');

export const resetCommand: Command = {
  name: 'reset',
  description: 'Reset session and start fresh',
  aliases: ['r'],
  execute: async (args, context) => {
    return {
      success: true,
      message: 'Session reset. Starting fresh conversation.',
      data: { action: 'reset_session' },
    };
  },
};

export const resumeCommand: Command = {
  name: 'resume',
  description: 'Resume a server session with picker (/resume [latest|list|sessionId])',
  execute: async (args) => {
    const target = args[0]?.trim();
    if (!target || target === 'list') {
      return {
        success: true,
        message: 'Loading recent sessions...',
        data: { action: 'open_picker' },
      };
    }

    return {
      success: true,
      message: 'Loading session...',
      data: {
        action: 'resume_session',
        ...(target && target !== 'latest' ? { sessionId: target } : {}),
      },
    };
  },
};

export const exitCommand: Command = {
  name: 'exit',
  description: 'Exit the TUI application',
  execute: async () => {
    return {
      success: true,
      message: 'Exiting DataAgent TUI.',
      data: { action: 'exit_application' },
    };
  },
};

// Export all built-in commands
function getAllCommands(): Command[] {
  return [
    helpCommand,
    clearCommand,
    statusCommand,
    tabCommand,
    chatCommand,
    statsCommand,
    configCommand,
    outputsCommand,
    resetCommand,
    resumeCommand,
    exitCommand,
  ];
}

export const builtinCommands = getAllCommands();
