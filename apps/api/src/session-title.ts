import { Agent } from "@mastra/core/agent";
import { createCustomEvent } from "@open-data-agent/agent-runtime";
import type { MetadataStore, SessionRecord } from "@open-data-agent/metadata";
import type { BaseEvent } from "@ag-ui/client";

const TITLE_TIMEOUT_MS = 5000;
const TITLE_MAX_CHARS = 32;

export type SessionTitleTaskInput = {
  emit(event: BaseEvent): void;
  metadataStore: MetadataStore;
  model: unknown;
  modelTemperature?: number | undefined;
  sessionId: string;
  userId: string;
  userInput: string;
};

/** Start an asynchronous session title task without blocking the agent run. */
export const startSessionTitleTask = (input: SessionTitleTaskInput): void => {
  void generateAndPersistSessionTitle(input).catch(() => undefined);
};

const generateAndPersistSessionTitle = async (input: SessionTitleTaskInput): Promise<void> => {
  const current = input.metadataStore.sessions.get({
    user_id: input.userId,
    session_id: input.sessionId
  });
  if (current.title_source === "user" || (current.title && current.title.trim().length > 0)) {
    return;
  }

  const title = await generateLlmTitle(input).catch(() => fallbackTitle(input.userInput));
  const source: SessionRecord["title_source"] = title.source;
  const updated = input.metadataStore.sessions.updateAutoTitleIfAllowed({
    user_id: input.userId,
    session_id: input.sessionId,
    title: title.title,
    title_source: source === "llm" ? "llm" : "fallback"
  });
  if (!updated) {
    return;
  }
  input.emit(createCustomEvent("session.title", sessionTitleDto(updated)));
};

const generateLlmTitle = async (
  input: SessionTitleTaskInput
): Promise<{ source: "llm"; title: string }> => {
  const agent = new Agent({
    id: "session-title-generator",
    name: "Session Title Generator",
    instructions: [
      "你为数据分析 Agent 的新会话生成左侧会话列表标题。",
      "只根据用户第一条请求生成 3 到 8 个中文字符或短词。",
      "不要使用标点、引号、Markdown、前后缀说明。",
      "不要包含用户隐私、凭证、环境变量或内部实现细节。",
      "如果用户请求主要是英文，可以生成简短英文标题。"
    ].join("\n"),
    model: input.model as never,
    defaultOptions: {
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: 32,
        temperature: input.modelTemperature ?? 0.2
      },
      providerOptions: {
        openai: {
          systemMessageMode: "system"
        }
      }
    }
  });
  const output = await agent.generate(buildTitlePrompt(input.userInput), {
    abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
  });
  const title = sanitizeTitle(output.text) || fallbackTitle(input.userInput).title;
  return { source: "llm", title };
};

const buildTitlePrompt = (userInput: string): string => [
  "为下面这条用户请求生成一个会话短标题。",
  "",
  "<user_request>",
  userInput.slice(0, 1000),
  "</user_request>"
].join("\n");

const fallbackTitle = (userInput: string): { source: "fallback"; title: string } => ({
  source: "fallback",
  title: sanitizeTitle(userInput) || "新会话"
});

const sanitizeTitle = (value: string): string => value
  .replace(/[`*_#>\[\](){}"“”'‘’]/gu, "")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, TITLE_MAX_CHARS);

export const sessionTitleDto = (session: SessionRecord): Record<string, unknown> => ({
  sessionId: session.id,
  title: session.title ?? "",
  titleSource: session.title_source ?? "fallback",
  updatedAt: session.updated_at
});
