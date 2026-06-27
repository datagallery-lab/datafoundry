"use client";

import { chipClass } from "../../ui-tokens";

const EXAMPLE_PROMPTS = [
  {
    title: "查看表结构",
    description: "列出当前数据源的所有表及字段",
    prompt: "帮我查看数据源里有哪些表，并说明每张表的主要字段",
  },
  {
    title: "运行 SQL 查询",
    description: "用自然语言生成并执行只读 SQL",
    prompt: "查询最近 30 天的订单总数，按日期分组",
  },
  {
    title: "数据趋势分析",
    description: "探索指标变化与异常",
    prompt: "分析销售数据的月度趋势，找出波动最大的月份",
  },
] as const;

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
      aria-hidden
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.847-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

export function DataTaskWelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-subtle text-foreground">
        <DatabaseIcon className="h-7 w-7" />
      </div>
      <h2 className="text-center text-lg font-semibold text-foreground">
        数据分析工作台
      </h2>
      <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted">
        用自然语言提问，Agent 会自动检查表结构、执行只读 SQL，并在右侧控制台展示完整追溯链。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <span className={chipClass}>
          <SparkIcon className="h-3.5 w-3.5 text-muted-light" />
          SQL 查询
        </span>
        <span className={chipClass}>Schema 检查</span>
        <span className={chipClass}>数据追溯</span>
      </div>
      <div className="mt-8 grid w-full max-w-lg gap-3">
        {EXAMPLE_PROMPTS.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-card)]"
          >
            <div className="text-sm font-medium text-foreground">{item.title}</div>
            <p className="mt-0.5 text-xs text-muted-light">{item.description}</p>
            <p className="mt-2 font-mono text-[11px] leading-5 text-muted">
              「{item.prompt}」
            </p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-light">
        在下方输入框直接提问，或使用 <kbd className="rounded border border-border bg-surface-subtle px-1 py-0.5 font-mono text-[10px]">@</kbd> 指定数据源
      </p>
    </div>
  );
}

export function DatasourceChip({ datasourceId }: { datasourceId: string }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-[var(--shadow-card)]">
      <DatabaseIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-mono">{datasourceId}</span>
    </span>
  );
}

export function ChatInitializingState() {
  return (
    <div className="grid flex-1 place-items-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-surface-subtle ring-1 ring-border" />
        <p className="text-sm text-muted">正在初始化会话…</p>
      </div>
    </div>
  );
}
