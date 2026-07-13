import React from "react";

export function DatasourceCredentialClearControl({
  checked,
  helpText,
  label,
  onChange,
}: {
  checked: boolean;
  helpText: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 sm:col-span-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-amber-900">
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-amber-800">
          {helpText}
        </span>
      </span>
    </label>
  );
}
