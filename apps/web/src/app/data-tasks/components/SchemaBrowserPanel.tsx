"use client";

import { useEffect, useMemo, useState } from "react";
import { configApi } from "../../../lib/config-api";
import type { DatasourceSchemaDto } from "../../../lib/config-api";
import type { WorkspaceConfigItem } from "../data-task-state";
import { btnSecondaryClass, panelShellClass, panelTitleClass, sectionLabelClass } from "../ui-tokens";

type SchemaBrowserPanelProps = {
  datasources: WorkspaceConfigItem[];
};

function formatStats(table: DatasourceSchemaDto["tables"][number]): string {
  const stats = table.stats;
  if (!stats) return "";
  const parts = [
    stats.rowCount !== undefined ? `${stats.rowCount.toLocaleString()} 行` : "",
    stats.sizeBytes !== undefined ? `${stats.sizeBytes.toLocaleString()} B` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
  }
}

export function SchemaBrowserPanel({ datasources }: SchemaBrowserPanelProps) {
  const readyDatasources = useMemo(
    () => datasources.filter((item) => item.enabled),
    [datasources],
  );
  const [datasourceId, setDatasourceId] = useState<string>(readyDatasources[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [schema, setSchema] = useState<DatasourceSchemaDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (datasourceId || !readyDatasources[0]) return;
    setDatasourceId(readyDatasources[0].id);
  }, [datasourceId, readyDatasources]);

  const loadSchema = async () => {
    if (!datasourceId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await configApi.getDatasourceSchema(datasourceId, {
        q: query.trim() || undefined,
        includeStats: true,
      });
      setSchema(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schema 加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (value: string) => {
    await copyText(value);
    setCopied(value);
    window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1200);
  };

  if (readyDatasources.length === 0) {
    return null;
  }

  return (
    <section className={panelShellClass}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={panelTitleClass}>Schema 浏览器</h3>
        <button
          type="button"
          onClick={() => void loadSchema()}
          disabled={loading || !datasourceId}
          className={`${btnSecondaryClass} disabled:opacity-60`}
        >
          {loading ? "加载中…" : "刷新"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          value={datasourceId}
          onChange={(event) => setDatasourceId(event.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground"
        >
          {readyDatasources.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.id}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索表或字段"
          className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground"
        />
        <button
          type="button"
          onClick={() => void loadSchema()}
          disabled={loading || !datasourceId}
          className={`${btnSecondaryClass} disabled:opacity-60`}
        >
          搜索
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg bg-step-error/10 px-2.5 py-2 text-xs text-step-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2">
        {schema?.tables?.length ? (
          schema.tables.map((table) => {
            const tableName = table.table ?? table.name;
            return (
              <div key={tableName} className="rounded-lg border border-border bg-surface-subtle p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{tableName}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-light">
                      {table.sampleAvailable ? <span>可预览样本</span> : null}
                      {formatStats(table) ? <span>{formatStats(table)}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(tableName)}
                    className={btnSecondaryClass}
                  >
                    {copied === tableName ? "已复制" : "复制表名"}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {table.columns.map((column) => {
                    const columnRef = `${tableName}.${column.name}`;
                    return (
                      <button
                        key={columnRef}
                        type="button"
                        onClick={() => void handleCopy(columnRef)}
                        className="rounded-full border border-border bg-surface px-2 py-1 text-[11px] text-muted transition hover:border-primary-light/40 hover:text-foreground"
                        title={column.description}
                      >
                        {column.name}
                        {column.type ? <span className="text-muted-light"> · {column.type}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-muted-light">
            {schema ? "未找到匹配表或字段。" : "选择数据源后点击刷新，无需发起 Agent run 即可浏览 schema。"}
          </p>
        )}
      </div>
      <div className="mt-2">
        <span className={sectionLabelClass}>复制后的表名/字段名可粘贴到对话框中使用。</span>
      </div>
    </section>
  );
}
