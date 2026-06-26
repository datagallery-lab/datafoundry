/**
 * Built-in commands for the TUI
 */

import type { Command, CommandResult } from './types.js';

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
      message: `Available commands:\n${commandList}\n\nTip: Type a message without '/' to chat with the agent.`,
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
  return [helpCommand, clearCommand, statusCommand, resetCommand, exitCommand];
}

export const builtinCommands = getAllCommands();
