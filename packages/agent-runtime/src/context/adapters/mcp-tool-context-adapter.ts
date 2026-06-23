import { asRecord, BaseToolContextAdapter } from "./base-tool-context-adapter.js";

export class McpToolContextAdapter extends BaseToolContextAdapter {
  readonly resultType: string;

  constructor(readonly toolName: string) {
    super();
    this.resultType = `mcp-${toolName}`;
  }

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}
