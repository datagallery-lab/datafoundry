import type { BaseEvent } from "@ag-ui/core";

export type AgentRunContext = {
  active_skill_id?: string;
  user_id: string;
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
};

export type AgentRunContextInput = AgentRunContext;

export interface AgUiEventEmitter {
  emit(event: BaseEvent): void;
}
