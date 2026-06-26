"use client";

import {
  CopilotChatAssistantMessage,
  useAgent,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { useCallback, useState } from "react";
import {
  btnPrimaryClass,
  btnSecondaryClass,
  choiceOptionClass,
  choiceOptionChevronClass,
  choiceOptionIconClass,
  panelShellClass,
  sectionLabelClass,
} from "../../ui-tokens";
import {
  formatCollaborationResponseDisplay,
  useCollaborationResponses,
} from "./collaboration-responses";

type MastraInterrupt = {
  type?: string;
  toolCallId?: string;
  toolName?: "ask_user" | "submit_plan";
  suspendPayload?: Record<string, unknown>;
  args?: Record<string, unknown>;
};

type ChoiceOption = { label: string; value: string; description?: string };

function parseInterruptValue(value: unknown): MastraInterrupt | null {
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!raw || typeof raw !== "object") return null;
  return raw as MastraInterrupt;
}

function readQuestion(interrupt: MastraInterrupt): string {
  const payload = interrupt.suspendPayload;
  if (payload && typeof payload.question === "string") return payload.question;
  if (interrupt.args && typeof interrupt.args.question === "string") {
    return interrupt.args.question;
  }
  return "Agent 需要你补充信息";
}

function normalizeOption(item: unknown): ChoiceOption | null {
  if (typeof item === "string" && item.trim()) {
    const label = item.trim();
    return { label, value: label };
  }
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const label =
    typeof record.label === "string"
      ? record.label
      : typeof record.value === "string"
        ? record.value
        : null;
  if (!label) return null;
  const value =
    typeof record.value === "string" ? record.value : label;
  const description =
    typeof record.description === "string" ? record.description : undefined;
  return { label, value, description };
}

function readOptions(interrupt: MastraInterrupt): ChoiceOption[] {
  const sources = [interrupt.suspendPayload?.options, interrupt.args?.options];
  for (const raw of sources) {
    if (!Array.isArray(raw)) continue;
    const parsed = raw
      .map(normalizeOption)
      .filter((item): item is ChoiceOption => Boolean(item));
    if (parsed.length > 0) return parsed;
  }
  return [];
}

function looksLikeToolName(label: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/u.test(label.trim());
}

function ChoiceOptionList({
  options,
  disabled,
  onSelect,
}: {
  options: ChoiceOption[];
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mt-3 grid gap-2">
      {options.map((option, index) => {
        const mono = looksLikeToolName(option.label);

        return (
          <button
            key={`${option.value}-${index}`}
            type="button"
            disabled={disabled}
            className={[
              "hitl-choice-option group",
              choiceOptionClass,
              disabled ? "pointer-events-none opacity-60" : "",
            ].join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled) onSelect(option.value);
            }}
          >
            <span className={choiceOptionIconClass}>{index + 1}</span>
            <span className="min-w-0 flex-1 text-left">
              <span
                className={[
                  "block text-sm font-medium text-foreground",
                  mono ? "font-mono tracking-tight" : "",
                ].join(" ")}
              >
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className={["h-4 w-4", choiceOptionChevronClass].join(" ")}
              fill="none"
            >
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function readPlan(interrupt: MastraInterrupt): string {
  const payload = interrupt.suspendPayload;
  if (payload && typeof payload.plan === "string") return payload.plan;
  if (interrupt.args && typeof interrupt.args.plan === "string") return interrupt.args.plan;
  return "";
}

function PlanMarkdown({ content }: { content: string }) {
  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-lg bg-surface-subtle p-3 text-sm leading-6 text-foreground [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
      <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
    </div>
  );
}

function AskUserPrompt({
  interrupt,
  resolve,
  threadId,
  agentId,
}: {
  interrupt: MastraInterrupt;
  resolve: (response: unknown) => void;
  threadId: string;
  agentId: string;
}) {
  const { recordResponse } = useCollaborationResponses();
  const { agent } = useAgent({ agentId });
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const question = readQuestion(interrupt);
  const options = readOptions(interrupt);

  const submit = useCallback(
    (value: unknown) => {
      if (submitted) return;
      setSubmitted(true);
      const assistantMessageId = [...(agent.messages ?? [])]
        .reverse()
        .find((item) => item.role === "assistant")?.id;
      if (interrupt.toolCallId) {
        recordResponse({
          threadId,
          toolCallId: interrupt.toolCallId,
          toolName: "ask_user",
          question,
          displayText: formatCollaborationResponseDisplay("ask_user", value, options),
          assistantMessageId,
        });
      }
      resolve(value);
    },
    [
      agent.messages,
      interrupt.toolCallId,
      options,
      question,
      recordResponse,
      resolve,
      submitted,
      threadId,
    ],
  );

  if (options.length > 0) {
    return (
      <div className={panelShellClass}>
        <div className={sectionLabelClass}>用户协作</div>
        <p className="mt-1.5 text-sm font-medium leading-6 text-foreground">{question}</p>
        <ChoiceOptionList
          options={options}
          disabled={submitted}
          onSelect={(value) => submit(value)}
        />
      </div>
    );
  }

  return (
    <div className={panelShellClass}>
      <div className={sectionLabelClass}>用户协作</div>
      <p className="mt-1.5 text-sm font-medium text-foreground">{question}</p>
      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        rows={3}
        disabled={submitted}
        className="mt-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary-light/50 disabled:opacity-60"
        placeholder="输入你的回答…"
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className={btnPrimaryClass}
          disabled={submitted || !answer.trim()}
          onClick={() => submit(answer.trim())}
        >
          提交回答
        </button>
      </div>
    </div>
  );
}

function SubmitPlanPrompt({
  interrupt,
  resolve,
  threadId,
  agentId,
}: {
  interrupt: MastraInterrupt;
  resolve: (response: unknown) => void;
  threadId: string;
  agentId: string;
}) {
  const { recordResponse } = useCollaborationResponses();
  const { agent } = useAgent({ agentId });
  const [submitted, setSubmitted] = useState(false);
  const title =
    typeof interrupt.args?.title === "string"
      ? interrupt.args.title
      : "执行计划审批";
  const plan = readPlan(interrupt);

  const submit = (response: unknown) => {
    if (submitted) return;
    setSubmitted(true);
    const assistantMessageId = [...(agent.messages ?? [])]
      .reverse()
      .find((item) => item.role === "assistant")?.id;
    if (interrupt.toolCallId) {
      recordResponse({
        threadId,
        toolCallId: interrupt.toolCallId,
        toolName: "submit_plan",
        question: title,
        plan,
        displayText: formatCollaborationResponseDisplay("submit_plan", response),
        assistantMessageId,
      });
    }
    resolve(response);
  };

  return (
    <div className={panelShellClass}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {plan ? (
        <PlanMarkdown content={plan} />
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={`hitl-action-btn-secondary ${btnSecondaryClass}`}
          disabled={submitted}
          onClick={() => submit({ action: "rejected", feedback: "需要调整计划" })}
        >
          拒绝
        </button>
        <button
          type="button"
          className={btnPrimaryClass}
          disabled={submitted}
          onClick={() => submit({ action: "approved" })}
        >
          批准
        </button>
      </div>
    </div>
  );
}

/** CopilotKit interrupt UI for Mastra ask_user / submit_plan suspension. */
export function CollaborationInterruptHandler({
  agentId,
  threadId,
}: {
  agentId: string;
  threadId: string;
}) {
  const { agent } = useAgent({ agentId });

  useInterrupt({
    agentId,
    enabled: (event) => {
      if (agent.threadId !== threadId) return false;
      const interrupt = parseInterruptValue(event.value);
      return (
        interrupt?.toolName === "ask_user" || interrupt?.toolName === "submit_plan"
      );
    },
    render: ({ event, resolve }) => {
      if (agent.threadId !== threadId) {
        return <></>;
      }

      const interrupt = parseInterruptValue(event.value);
      if (!interrupt?.toolName) {
        return <></>;
      }

      if (interrupt.toolName === "submit_plan") {
        return (
          <SubmitPlanPrompt
            interrupt={interrupt}
            resolve={resolve}
            threadId={threadId}
            agentId={agentId}
          />
        );
      }

      return (
        <AskUserPrompt
          interrupt={interrupt}
          resolve={resolve}
          threadId={threadId}
          agentId={agentId}
        />
      );
    },
  });

  return null;
}
