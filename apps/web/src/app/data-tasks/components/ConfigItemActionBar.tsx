import React from "react";

type ConfigItemActionLabels = {
  delete: string;
  reindex: string;
  saveBeforeDatasourceActions: string;
  saveBeforeSchemaSyncTitle: string;
  saveBeforeTestTitle: string;
  syncSchema: string;
  testConnection: string;
  testing: string;
  validateSemantics: string;
};

type ConfigItemActionBarProps = {
  blockPersistedActions?: boolean;
  labels: ConfigItemActionLabels;
  onDelete?: () => void | Promise<void>;
  onIntrospect?: () => void | Promise<void>;
  onReindex?: () => void | Promise<void>;
  onTest?: () => void | Promise<void>;
  onValidateSkill?: () => void | Promise<void>;
  testBusy?: boolean;
};

export function ConfigItemActionBar({
  blockPersistedActions = false,
  labels,
  onDelete,
  onIntrospect,
  onReindex,
  onTest,
  onValidateSkill,
  testBusy = false,
}: ConfigItemActionBarProps) {
  const persistedActionDisabled = blockPersistedActions || testBusy;
  const showSaveNotice = blockPersistedActions && Boolean(onTest || onIntrospect);

  return (
    <section className="rounded-xl border border-border bg-white px-5 py-4">
      <div className="flex flex-wrap gap-2">
        {onTest ? (
          <ConfigActionButton
            disabled={persistedActionDisabled}
            label={testBusy ? labels.testing : labels.testConnection}
            onClick={() => void onTest()}
            title={
              blockPersistedActions
                ? labels.saveBeforeTestTitle
                : undefined
            }
          />
        ) : null}
        {onIntrospect ? (
          <ConfigActionButton
            disabled={persistedActionDisabled}
            label={labels.syncSchema}
            onClick={() => void onIntrospect()}
            title={
              blockPersistedActions
                ? labels.saveBeforeSchemaSyncTitle
                : undefined
            }
          />
        ) : null}
        {onReindex ? (
          <ConfigActionButton label={labels.reindex} onClick={() => void onReindex()} />
        ) : null}
        {onValidateSkill ? (
          <ConfigActionButton
            label={labels.validateSemantics}
            onClick={() => void onValidateSkill()}
          />
        ) : null}
        {onDelete ? (
          <ConfigActionButton
            label={labels.delete}
            onClick={() => void onDelete()}
            tone="danger"
          />
        ) : null}
      </div>
      {showSaveNotice ? (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {labels.saveBeforeDatasourceActions}
        </p>
      ) : null}
    </section>
  );
}

function ConfigActionButton({
  disabled = false,
  label,
  onClick,
  title,
  tone = "default",
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  title?: string;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={[
        "h-8 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
          : "border border-border bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
