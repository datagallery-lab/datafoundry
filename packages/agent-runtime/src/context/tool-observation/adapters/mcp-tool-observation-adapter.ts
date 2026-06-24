import { asRecord, BaseToolObservationAdapter } from "./base-tool-observation-adapter.js";

export class McpToolObservationAdapter extends BaseToolObservationAdapter {
  readonly resultType: string;

  constructor(readonly toolName: string) {
    super();
    this.resultType = `mcp-${toolName}`;
  }

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}
