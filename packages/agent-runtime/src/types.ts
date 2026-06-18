import type { BaseEvent } from "@ag-ui/core";

export type AgentRunContext = {
  user_id: string;
  session_id: string;
  run_id: string;
  user_input: string;
  chat_mode: string;
  selected_datasource_id: string;
  model_name?: string;
};

export type AgentRunContextInput = AgentRunContext;

export interface AgUiEventEmitter {
  emit(event: BaseEvent): void;
}
