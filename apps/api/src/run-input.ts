import type { RunAgentInput } from "@ag-ui/client";

export const extractDatasourceId = (input: RunAgentInput): string | undefined => {
  const forwardedProps = isRecord(input.forwardedProps) ? input.forwardedProps : {};
  const state = isRecord(input.state) ? input.state : {};
  const contextDatasourceId = input.context.find((item) => item.description === "datasource_id")?.value;
  const forwardedDatasourceId = stringFromRecord(forwardedProps, "datasourceId") ?? stringFromRecord(forwardedProps, "datasource_id");
  const stateDatasourceId = stringFromRecord(state, "datasourceId") ?? stringFromRecord(state, "datasource_id");

  return forwardedDatasourceId ?? stateDatasourceId ?? contextDatasourceId;
};

export const extractLastUserText = (input: RunAgentInput): string | undefined => {
  const userMessage = [...input.messages].reverse().find((message) => message.role === "user");
  const content = userMessage?.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const stringFromRecord = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
