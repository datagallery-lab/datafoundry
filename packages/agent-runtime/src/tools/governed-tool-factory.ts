import type { ContextPackage } from "../context/inventory/context-package.js";
import type { ToolObservationDispatcher } from "../context/tool-observation/tool-observation-dispatcher.js";
import { toolObservationModelFromPackage } from "../context/tool-observation/tool-observation-projection-items.js";

type ToolExecution = (...args: any[]) => unknown | Promise<unknown>;

type ExecutableTool = {
  execute?: ToolExecution | undefined;
};

export type GovernedToolObservationHandler = (input: {
  contextPackage: ContextPackage;
  rawResult: unknown;
  toolName: string;
}) => void | Promise<void>;

export type GovernedToolErrorHandler = (input: {
  error: unknown;
  rawResult: unknown;
  toolName: string;
}) => void | Promise<void>;

export class GovernedToolFactory {
  constructor(
    private readonly dispatcher: ToolObservationDispatcher,
    private readonly onResult?: GovernedToolObservationHandler,
    private readonly onError?: GovernedToolErrorHandler
  ) {}

  /** Wrap every registered tool at its execution boundary. */
  governTools<TTools extends Record<string, ExecutableTool>>(tools: TTools): TTools {
    return Object.fromEntries(
      Object.entries(tools).map(([toolName, tool]) => [toolName, this.governTool(toolName, tool)])
    ) as TTools;
  }

  /** Wrap one tool so its raw result cannot bypass context governance. */
  governTool<TTool extends ExecutableTool>(toolName: string, tool: TTool): TTool {
    this.dispatcher.assertAdapterRegistered(toolName);
    if (!tool.execute) {
      throw new Error(`TOOL_EXECUTE_REQUIRED:${toolName}`);
    }
    const execute = tool.execute;
    return {
      ...tool,
      execute: async (...args: any[]): Promise<unknown> => {
        const rawResult = await execute(...args);
        if (rawResult === undefined) {
          return undefined;
        }
        try {
          const contextPackage = this.dispatcher.dispatch(toolName, rawResult);
          await this.onResult?.({ contextPackage, rawResult, toolName });
          return toolObservationModelFromPackage(contextPackage);
        } catch (error) {
          await this.onError?.({ error, rawResult, toolName });
          throw error;
        }
      }
    } as TTool;
  }
}
