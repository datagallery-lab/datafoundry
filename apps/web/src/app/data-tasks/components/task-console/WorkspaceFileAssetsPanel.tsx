"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { configApi } from "../../../../lib/config-api";
import type { FileAssetRefDto } from "../../../../lib/config-api";
import { filterWorkspaceAssetFiles, hasCapability } from "../../data-task-state";
import { btnSecondaryClass, panelShellClass, panelTitleClass, sectionLabelClass } from "../../ui-tokens";

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type WorkspaceFileAssetsPanelProps = {
  onFilesChange?: (files: FileAssetRefDto[]) => void;
};

export function WorkspaceFileAssetsPanel({ onFilesChange }: WorkspaceFileAssetsPanelProps) {
  const [files, setFiles] = useState<FileAssetRefDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!hasCapability("files")) {
      setFiles([]);
      onFilesChange?.([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await configApi.listWorkspaceFiles({
        scope: "workspace",
        origin: ["uploaded", "saved"],
      });
      const workspaceFiles = filterWorkspaceAssetFiles(response.files ?? []);
      setFiles(workspaceFiles);
      onFilesChange?.(workspaceFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file assets");
    } finally {
      setLoading(false);
    }
  }, [onFilesChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!hasCapability("files")) {
    return null;
  }

  const handleUpload = async (selected: FileList | null) => {
    if (!selected?.length) return;
    setLoading(true);
    setError(null);
    try {
      await configApi.uploadWorkspaceFiles([...selected]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleDownload = async (file: FileAssetRefDto) => {
    try {
      const { blob, filename } = await configApi.downloadWorkspaceFile(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDelete = async (file: FileAssetRefDto) => {
    const confirmed = window.confirm(`Delete workspace file "${file.filename}"? This cannot be undone.`);
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      await configApi.deleteWorkspaceFile(file.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={panelShellClass}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={panelTitleClass}>Workspace File Assets</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className={`${btnSecondaryClass} disabled:opacity-60`}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className={`${btnSecondaryClass} disabled:opacity-60`}
          >
            Upload
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files)}
          />
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-4 text-muted-light">
        Manage reusable workspace files for later @file selection or run_config.fileIds injection. These are separate from chat attachments.
      </p>
      {error ? (
        <p className="mb-3 rounded-lg bg-step-error/10 px-2.5 py-2 text-xs text-step-error">
          {error}
        </p>
      ) : null}
      {loading && files.length === 0 ? (
        <p className="text-xs text-muted-light">Loading...</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-light">No reusable workspace files yet. Upload a file to add one.</p>
      ) : (
        <div className="grid gap-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-foreground">
                  {file.filename}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted-light">
                  <span>{formatBytes(file.sizeBytes)}</span>
                  {file.mimeType ? <span>{file.mimeType}</span> : null}
                  {file.source ? <span>{file.source}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownload(file)}
                  className={btnSecondaryClass}
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(file)}
                  disabled={loading}
                  className={`${btnSecondaryClass} text-step-error hover:border-step-error/40 hover:text-step-error disabled:opacity-60`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2">
        <span className={sectionLabelClass}>{files.length} files</span>
      </div>
    </section>
  );
}
