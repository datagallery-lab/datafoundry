/**
 * Built-in commands for the TUI
 */

import type { Command, CommandResult } from './types.js';
import type { WorkspaceConfigItem } from '../state/data-task-state.js';

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
    const { state, datasourceId, activeSkillId } = context;
    const userMessages = state.messages.filter(m => m.role === 'user').length;
    const assistantMessages = state.messages.filter(m => m.role === 'assistant').length;

    const status = [
      `Thread ID: ${state.threadId || 'Not set'}`,
      `Messages: ${state.messages.length} (${userMessages} user, ${assistantMessages} assistant)`,
      datasourceId ? `Datasource: ${datasourceId}` : 'Datasource: None',
      activeSkillId ? `Skill: ${activeSkillId}` : 'Skill: None',
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

type ResourceChoice = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  active: boolean;
  detail: string;
};

type ChoiceLoadResult = {
  choices: ResourceChoice[];
  warning?: string | undefined;
};

const SELECT_ACTIONS = new Set(['select', 'switch', 'use']);
const LIST_ACTIONS = new Set(['list', 'ls', 'show']);
const CURRENT_ACTIONS = new Set(['current', 'active']);

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const datasourceIdForItem = (item: WorkspaceConfigItem): string => {
  return item.settings?.datasourceId?.trim() || item.id;
};

const firstEnabledDatasourceId = (items: WorkspaceConfigItem[]): string | undefined => {
  const item = items.find((candidate) => candidate.enabled) ?? items[0];
  return item ? datasourceIdForItem(item) : undefined;
};

const firstEnabledSkillId = (items: WorkspaceConfigItem[]): string | undefined => {
  return items.find((item) => item.enabled)?.id ?? items[0]?.id;
};

const localDatasourceChoices = (
  items: WorkspaceConfigItem[],
  activeDatasourceId?: string | undefined,
): ResourceChoice[] => {
  const activeId = activeDatasourceId ?? firstEnabledDatasourceId(items);
  return items.map((item) => {
    const id = datasourceIdForItem(item);
    const type = item.settings?.type ?? 'unknown';
    const status = item.status ?? (item.enabled ? 'enabled' : 'disabled');
    const detailParts = [
      `type=${type}`,
      `status=${status}`,
      item.builtin ? 'builtin' : undefined,
    ].filter(Boolean);
    return {
      id,
      name: item.name,
      description: item.description,
      enabled: item.enabled,
      active: id === activeId,
      detail: detailParts.join(', '),
    };
  });
};

const localSkillChoices = (
  items: WorkspaceConfigItem[],
  activeSkillId?: string | undefined,
): ResourceChoice[] => {
  const activeId = activeSkillId ?? firstEnabledSkillId(items);
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
      enabled: item.enabled,
      active: item.id === activeId,
      detail: detailParts.join(', '),
    };
  });
};

const loadDatasourceChoices = async (
  context: Parameters<Command['execute']>[1],
): Promise<ChoiceLoadResult> => {
  if (!context.configClient) {
    return {
      choices: localDatasourceChoices(context.workspaceConfig.db, context.datasourceId),
    };
  }

  try {
    const datasources = await context.configClient.listDatasources();
    return {
      choices: datasources.map((item) => {
        const enabled = item.defaultEnabled !== false;
        const detailParts = [
          `type=${item.type}`,
          item.connectionStatus ? `status=${item.connectionStatus}` : undefined,
          item.builtin ? 'builtin' : undefined,
        ].filter(Boolean);
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          enabled,
          active: item.id === context.datasourceId,
          detail: detailParts.join(', '),
        };
      }),
    };
  } catch (error) {
    return {
      choices: localDatasourceChoices(context.workspaceConfig.db, context.datasourceId),
      warning: `Backend datasource list failed: ${formatError(error)}`,
    };
  }
};

const loadSkillChoices = async (
  context: Parameters<Command['execute']>[1],
): Promise<ChoiceLoadResult> => {
  if (!context.configClient) {
    return {
      choices: localSkillChoices(context.workspaceConfig.skill, context.activeSkillId),
    };
  }

  try {
    const skills = await context.configClient.listSkills();
    return {
      choices: skills.map((item) => {
        const enabled = item.defaultEnabled !== false;
        const detailParts = [
          `format=${item.packageFormat}`,
          item.validationStatus ? `validation=${item.validationStatus}` : undefined,
          item.builtin ? 'builtin' : undefined,
        ].filter(Boolean);
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          enabled,
          active: item.id === context.activeSkillId,
          detail: detailParts.join(', '),
        };
      }),
    };
  } catch (error) {
    return {
      choices: localSkillChoices(context.workspaceConfig.skill, context.activeSkillId),
      warning: `Backend skill list failed: ${formatError(error)}`,
    };
  }
};

const findChoice = (
  choices: ResourceChoice[],
  requestedId: string,
): ResourceChoice | undefined => {
  return choices.find((item) => item.id === requestedId)
    ?? choices.find((item) => item.name === requestedId)
    ?? choices.find((item) => item.id.toLowerCase() === requestedId.toLowerCase());
};

const formatChoiceList = (
  title: string,
  choices: ResourceChoice[],
  usage: string,
  warning?: string | undefined,
): string => {
  const lines = [title, ''];
  if (warning) {
    lines.push(warning, '');
  }
  if (choices.length === 0) {
    lines.push('No items available.', '', usage);
    return lines.join('\n');
  }

  choices.forEach((choice) => {
    const marker = choice.active ? '*' : choice.enabled ? '+' : ' ';
    lines.push(`  ${marker} ${choice.id} - ${choice.name}`);
    if (choice.description) {
      lines.push(`    ${choice.description}`);
    }
    if (choice.detail) {
      lines.push(`    ${choice.detail}`);
    }
    lines.push('');
  });
  lines.push('Legend: * active, + enabled');
  lines.push(usage);
  return lines.join('\n');
};

const formatDatasourceNameList = (choices: ResourceChoice[]): string => {
  const lines: string[] = [];
  if (choices.length === 0) {
    lines.push('No data sources configured.');
    return lines.join('\n');
  }
  choices.forEach((choice) => lines.push(choice.name));
  return lines.join('\n');
};

const selectedMessage = (kind: string, choice: ResourceChoice): string => {
  return `${kind} selected: ${choice.name} (${choice.id})`;
};

export const datasourceCommand: Command = {
  name: 'datasource',
  description: 'List or select available data sources',
  aliases: ['ds'],
  execute: async (args, context) => {
    const rawAction = args[0]?.trim();
    const action = rawAction?.toLowerCase() ?? 'list';

    if (action === 'help') {
      return {
        success: true,
        message: [
          '/datasource - List or select data sources',
          '',
          'Usage:',
          '  /datasource',
          '  /datasource list',
          '  /datasource current',
          '  /datasource select <id>',
          '  /datasource <id>',
        ].join('\n'),
      };
    }

    const result = await loadDatasourceChoices(context);
    const choices = result.choices;

    if (LIST_ACTIONS.has(action)) {
      return {
        success: true,
        message: formatDatasourceNameList(choices),
        data: { datasources: choices },
      };
    }

    if (CURRENT_ACTIONS.has(action)) {
      const active = choices.find((choice) => choice.active);
      return {
        success: true,
        message: active ? active.name : 'No active datasource selected.',
        data: active ? { datasourceId: active.id, datasource: active } : undefined,
      };
    }

    const requestedId = SELECT_ACTIONS.has(action) ? args[1] : rawAction;
    if (!requestedId) {
      return {
        success: false,
        message: 'Usage: /datasource select <id>',
      };
    }

    const choice = findChoice(choices, requestedId);
    if (!choice) {
      return {
        success: false,
        message: `Datasource not found: ${requestedId}. Use /datasource list to see available data sources.`,
      };
    }

    return {
      success: true,
      message: choice.name,
      data: {
        action: 'select_datasource',
        datasourceId: choice.id,
        label: choice.name,
      },
    };
  },
};

export const skillCommand: Command = {
  name: 'skill',
  description: 'List or select available skills',
  aliases: ['skills'],
  execute: async (args, context) => {
    const rawAction = args[0]?.trim();
    const action = rawAction?.toLowerCase() ?? 'list';

    if (action === 'help') {
      return {
        success: true,
        message: [
          '/skill - List or select skills',
          '',
          'Usage:',
          '  /skill',
          '  /skill list',
          '  /skill show',
          '  /skill current',
          '  /skill select <id>',
          '  /skill <id>',
          '  /<skill-id>',
        ].join('\n'),
      };
    }

    if (!rawAction || action === 'list' || action === 'picker') {
      return {
        success: true,
        message: 'Loading skills...',
        data: { action: 'open_skill_picker' },
      };
    }

    const result = await loadSkillChoices(context);
    const choices = result.choices;

    if (action === 'show' || action === 'ls') {
      return {
        success: true,
        message: formatChoiceList(
          'Available Skills:',
          choices,
          'Use /skill select <id> or /skill <id> to choose.',
          result.warning,
        ),
        data: { skills: choices },
      };
    }

    if (CURRENT_ACTIONS.has(action)) {
      const active = choices.find((choice) => choice.active);
      return {
        success: true,
        message: active
          ? `Active skill: ${active.name} (${active.id})`
          : 'No active skill selected.',
        data: active ? { skillId: active.id, skill: active } : undefined,
      };
    }

    const requestedId = SELECT_ACTIONS.has(action) ? args[1] : rawAction;
    if (!requestedId) {
      return {
        success: true,
        message: 'Loading skills...',
        data: { action: 'open_skill_picker' },
      };
    }

    const choice = findChoice(choices, requestedId);
    if (!choice) {
      return {
        success: false,
        message: `Skill not found: ${requestedId}. Use /skill list to see available skills.`,
      };
    }

    return {
      success: true,
      message: selectedMessage('Skill', choice),
      data: {
        action: 'select_skill',
        skillId: choice.id,
        label: choice.name,
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
    datasourceCommand,
    skillCommand,
    resetCommand,
    resumeCommand,
    exitCommand,
  ];
}

export const builtinCommands = getAllCommands();
