import type { ContextPackage } from "../context/inventory/context-package.js";
import type { ToolObservationDispatcher } from "../context/tool-observation/tool-observation-dispatcher.js";
import { toolObservationModelFromPackage } from "../context/tool-observation/tool-observation-projection-items.js";
import { createToolCallResult } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";

type ToolExecution = (...args: any[]) => unknown | Promise<unknown>;

type MastraToolExecuteOptions = {
  agent?: { toolCallId?: string };
};

type ExecutableTool = {
  execute?: ToolExecution | undefined;
};

export type GovernedToolObservationHandler = (input: {
  contextPackage: ContextPackage;
  rawResult: unknown;
  toolName: string;
  toolCallId?: string;
  toolInput?: unknown;
}) => void | Promise<void>;

export type GovernedToolErrorHandler = (input: {
  error: unknown;
  rawResult: unknown;
  toolName: string;
  toolCallId?: string;
  toolInput?: unknown;
}) => void | Promise<void>;

export type GovernedToolFactoryOptions = {
  /** When set, the boundary emits an authoritative TOOL_CALL_RESULT for every governed tool. */
  emitter?: AgUiEventEmitter;
  /**
   * Tool names whose TOOL_CALL_RESULT is produced by another authority (e.g. HITL tools
   * resolved on interaction resume). The boundary must not emit results for these to avoid
   * clobbering the suspend/resume contract.
   */
  externallyResolvedToolNames?: Set<string>;
};

export class GovernedToolFactory {
  private readonly emitter: AgUiEventEmitter | undefined;
  private readonly externallyResolvedToolNames: Set<string>;

  constructor(
    private readonly dispatcher: ToolObservationDispatcher,
    private readonly onResult?: GovernedToolObservationHandler,
    private readonly onError?: GovernedToolErrorHandler,
    options: GovernedToolFactoryOptions = {}
  ) {
    this.emitter = options.emitter;
    this.externallyResolvedToolNames = options.externallyResolvedToolNames ?? new Set<string>();
  }

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
        const options = args[1] as MastraToolExecuteOptions | undefined;
        const toolCallId = toolCallIdFromOptions(options);
        const toolInput = args[0];
        try {
          const rawResult = await execute(...args);
          if (rawResult === undefined) {
            return undefined;
          }
          const contextPackage = this.dispatcher.dispatch(toolName, rawResult);
          const observation = toolObservationModelFromPackage(contextPackage);
          await this.onResult?.({
            contextPackage,
            rawResult,
            toolName,
            ...(toolCallId ? { toolCallId } : {}),
            ...(toolInput !== undefined ? { toolInput } : {})
          });
          this.emitToolCallResult(toolCallId, toolName, serializeToolResultContent(observation));
          return observation;
        } catch (error) {
          await this.onError?.({
            error,
            rawResult: undefined,
            toolName,
            ...(toolCallId ? { toolCallId } : {}),
            ...(toolInput !== undefined ? { toolInput } : {})
          });
          this.emitToolCallResult(
            toolCallId,
            toolName,
            JSON.stringify({
              error: stringifyToolError(error),
              isError: true,
            }),
          );
          throw error;
        }
      }
    } as TTool;
  }

  /**
   * Emit the authoritative TOOL_CALL_RESULT for a governed tool. No-op when no emitter is
   * wired, when the runtime did not supply a toolCallId, or when another authority owns the
   * result (see externallyResolvedToolNames).
   */
  private emitToolCallResult(
    toolCallId: string | undefined,
    toolName: string,
    content: string,
  ): void {
    if (!this.emitter || !toolCallId) {
      return;
    }
    if (this.externallyResolvedToolNames.has(toolName)) {
      return;
    }
    this.emitter.emit(createToolCallResult(toolCallId, toolName, content));
  }
}

const toolCallIdFromOptions = (options?: MastraToolExecuteOptions): string | undefined =>
  typeof options?.agent?.toolCallId === "string" && options.agent.toolCallId.length > 0
    ? options.agent.toolCallId
    : undefined;

const serializeToolResultContent = (observation: unknown): string =>
  typeof observation === "string" ? observation : JSON.stringify(observation);

const stringifyToolError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
