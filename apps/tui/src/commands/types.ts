/**
 * Command system types
 */

import type { DisplayMessage } from '../state/tui-state.js';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute: (args: string[], context: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  client: unknown;
  datasourceId?: string | undefined;
  state: {
    threadId?: string | undefined;
    messages: DisplayMessage[];
  };
}
