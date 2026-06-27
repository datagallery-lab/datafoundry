import type { BaseEvent } from "@ag-ui/core";

/** Per-run @ mention focus (R-019). Each kind lists focused IDs (subset of enabled*Ids). */
export type PerRunMention = {
  db: string[];
  kb: string[];
  mcp: string[];
  skill: string[];
};

export type AgentRunContext = {
  active_skill_id?: string;
  user_id: string;
  workspace_id?: string;
  session_id: string;
  run_id: string;
  user_input: string;
  chat_mode: string;
  selected_datasource_id: string;
  enabled_datasource_ids: string[];
  enabled_knowledge_ids?: string[];
  enabled_mcp_server_ids?: string[];
  requested_llm_profile_id?: string;
  model_name?: string;
  /** Per-run @ mentions (R-019) — focus signal, not a narrowing of enabled*Ids. */
  mentioned?: PerRunMention;
  /** Per-run pinned session-relative paths (R-024). */
  pinned_paths?: string[];
};

export type AgentRunContextInput = AgentRunContext;

export interface AgUiEventEmitter {
  emit(event: BaseEvent): void;
}
