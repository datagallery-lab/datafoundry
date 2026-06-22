// Agent Context Management - Centralized defaults
// All non-0,1,2,-1,Infinity magic numbers go here.

// Schema context limits
export const SCHEMA_MAX_TABLES = 20;
export const SCHEMA_MAX_COLUMNS_PER_TABLE = 50;

// SQL context limits
export const SQL_MAX_MODEL_ROWS = 20;
export const SQL_MAX_ACTIVITY_ROWS = 20;
export const SQL_MAX_CELL_CHARS = 500;
export const SQL_MAX_SQL_CHARS = 4000;
export const SQL_MAX_EXECUTION_COUNT = 3;

// Agent configuration
export const AGENT_MAX_STEPS = 6;

// Per-source hard context budget. Source adapters must shape data below these limits.
export const CONTEXT_MAX_TOKENS = 32000;
export const CONTEXT_MAX_CHARS = 32000;
