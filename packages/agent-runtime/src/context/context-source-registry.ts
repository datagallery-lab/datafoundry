// Registry for source-bound tool result adapters.

import type { ToolResultAdapter } from "./tool-result-adapter.js";

export class ContextSourceRegistry {
  private toolAdapters = new Map<string, ToolResultAdapter>();

  registerToolAdapter(adapter: ToolResultAdapter): void {
    if (this.toolAdapters.has(adapter.toolName)) {
      throw new Error(`CONTEXT_ADAPTER_ALREADY_REGISTERED:${adapter.toolName}`);
    }
    this.toolAdapters.set(adapter.toolName, adapter);
  }

  resolveByToolName(toolName: string): ToolResultAdapter | undefined {
    return this.toolAdapters.get(toolName);
  }
}
