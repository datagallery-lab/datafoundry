// Context shaping limits. Keep run-level execution limits outside the context layer.

// Schema context limits
export const SCHEMA_MAX_TABLES = 20;
export const SCHEMA_MAX_COLUMNS_PER_TABLE = 50;

// SQL context limits
export const SQL_MAX_MODEL_ROWS = 20;
export const SQL_MAX_ACTIVITY_ROWS = 20;
export const SQL_MAX_CELL_CHARS = 500;
export const SQL_MAX_SQL_CHARS = 4000;

// Per-source hard context budget. Source adapters must shape data below these limits.
export const CONTEXT_MAX_TOKENS = 32000;
export const CONTEXT_MAX_CHARS = 32000;
