import type { ContextOrchestrator } from "./context-orchestrator.js";
import type { ContextPackage } from "./context-package.js";
import type { AgentRunContext } from "../types.js";

export class ToolResultDispatcher {
  private readonly governedObjects = new WeakSet<object>();

  constructor(
    private readonly orchestrator: ContextOrchestrator,
    private readonly runContext: AgentRunContext
  ) {}

  /** Govern one raw tool result through its exact adapter. */
  dispatch(toolName: string, rawResult: unknown): ContextPackage {
    const contextPackage = this.orchestrator.packageToolResult({
      toolName,
      rawResult,
      runContext: this.runContext
    });
    this.markGoverned(contextPackage.model);
    return contextPackage;
  }

  /** Fail during tool registration when an exact adapter is missing. */
  assertAdapterRegistered(toolName: string): void {
    if (!this.orchestrator.hasToolAdapter(toolName)) {
      throw new Error(`CONTEXT_ADAPTER_REQUIRED:${toolName}`);
    }
  }

  /** Return whether a value was emitted by this dispatcher's governed path. */
  isGoverned(value: unknown): boolean {
    return isObject(value) && this.governedObjects.has(value);
  }

  private markGoverned(value: unknown): void {
    if (isObject(value)) {
      this.governedObjects.add(value);
    }
  }
}

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
