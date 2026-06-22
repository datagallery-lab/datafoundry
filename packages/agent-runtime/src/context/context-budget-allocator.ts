// ContextBudgetAllocator - allocates budget by source/tool/run
// Stage 4: adds token counting via TokenCounter (async download + cache)

import type { AgentRunContext } from "../types.js";
import {
  CONTEXT_MAX_CHARS,
  CONTEXT_MAX_TOKENS,
  SCHEMA_MAX_COLUMNS_PER_TABLE,
  SCHEMA_MAX_TABLES,
  SQL_MAX_ACTIVITY_ROWS,
  SQL_MAX_CELL_CHARS,
  SQL_MAX_MODEL_ROWS,
  SQL_MAX_SQL_CHARS
} from "./defaults.js";
import { TokenCounter } from "./token-counter.js";

export type ContextBudget = {
  maxTokens?: number;
  maxRows?: number;
  maxChars?: number;
  sourceLimits?: Record<string, number>;
};

export type AllocateRequest = {
  runContext: AgentRunContext;
  sourceType: string;
  toolName?: string;
};

export class ContextBudgetAllocator {
  private tokenCounter: TokenCounter;

  constructor() {
    this.tokenCounter = new TokenCounter();
  }

  allocate(request: AllocateRequest): ContextBudget {
    const sourceLimits = request.toolName === "inspect_schema"
      ? {
          maxColumnsPerTable: SCHEMA_MAX_COLUMNS_PER_TABLE,
          maxTables: SCHEMA_MAX_TABLES
        }
      : request.toolName === "run_sql_readonly"
        ? {
            maxActivityRows: SQL_MAX_ACTIVITY_ROWS,
            maxCellChars: SQL_MAX_CELL_CHARS,
            maxModelRows: SQL_MAX_MODEL_ROWS,
            maxSqlChars: SQL_MAX_SQL_CHARS
          }
        : {};

    return {
      maxTokens: CONTEXT_MAX_TOKENS,
      maxChars: CONTEXT_MAX_CHARS,
      sourceLimits
    };
  }

  async countTokens(text: string, modelName?: string): Promise<number> {
    return this.tokenCounter.countTokens(text, modelName);
  }

  // Sync version - uses cached tokenizer or falls back to estimation
  countTokensSync(text: string, modelName?: string): number {
    return this.tokenCounter.countTokensSync(text, modelName);
  }
}
