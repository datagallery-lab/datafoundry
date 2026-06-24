// Agent run execution limits. Context shaping limits live in context/inventory/context-limits.ts.

// ReAct agents routinely run dozens of steps; 6 was far too tight for iterative analysis.
export const AGENT_MAX_STEPS = 50;

// Per-datasource SQL execution budget. Counted per schema capability (one datasource),
// so multi-datasource analysis is not starved by a single source's iteration.
// Total SQL across a run is still bounded by AGENT_MAX_STEPS.
export const SQL_MAX_EXECUTION_COUNT = 20;
