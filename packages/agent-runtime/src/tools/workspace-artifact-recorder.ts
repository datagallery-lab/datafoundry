import type { ArtifactSummary, ArtifactType } from "@datafoundry/contracts";
import type { CreateArtifactInput } from "@datafoundry/artifacts";
import fs from "node:fs";
import path from "node:path";

import { createArtifactEvent } from "../events.js";
import type { AgentRunContext, AgUiEventEmitter } from "../types.js";

type ExecutableTool = {
  execute?: (...args: unknown[]) => unknown | Promise<unknown>;
};

type FileSnapshotEntry = {
  size: number;
  mtimeMs: number;
};

/**
 * Create a file-backed (downloadable / promotable) artifact from an absolute path.
 * The returned summary carries `file_id` / `download_url` so the frontend renders
 * preview, download and "add to workspace" actions — mirroring SQL result artifacts.
 */
export type CreateFileBackedArtifact = (input: {
  type: ArtifactType;
  name: string;
  source_path: string;
  preview_json?: unknown;
}) => Promise<ArtifactSummary & { download_url?: string; file_id?: string }>;

export type WorkspaceArtifactRecorderInput = {
  tools: Record<string, ExecutableTool>;
  /**
   * The agent's writable session directory (the filesystem basePath for
   * write_file / edit_file and the cwd for execute_command). Relative tool paths
   * resolve against this directory.
   */
  sessionDir: string;
  runContext: AgentRunContext;
  emitter: AgUiEventEmitter;
  /**
   * Preferred path: register the produced file as a durable, downloadable artifact
   * (file asset backed). When absent or it throws, we fall back to a preview-only
   * artifact via `createArtifact`.
   */
  createFileArtifact?: CreateFileBackedArtifact;
  createArtifact: (input: CreateArtifactInput) => Promise<ArtifactSummary>;
};

const FILE_PRODUCING_TOOLS = new Set(["write_file", "edit_file", "execute_command"]);
const TEXT_PREVIEW_MAX_BYTES = 8192;

const readTextPreview = async (
  absolutePath: string,
  size: number,
): Promise<string | undefined> => {
  if (size <= 0 || size > TEXT_PREVIEW_MAX_BYTES) return undefined;
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    if (buffer.includes(0)) return undefined;
    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
};

export const wrapWorkspaceToolsWithArtifactRecording = (
  input: WorkspaceArtifactRecorderInput,
): Record<string, ExecutableTool> => {
  return Object.fromEntries(
    Object.entries(input.tools).map(([toolName, tool]) => [
      toolName,
      wrapToolWithArtifactRecording(toolName, tool, input),
    ]),
  );
};

const wrapToolWithArtifactRecording = (
  toolName: string,
  tool: ExecutableTool,
  input: WorkspaceArtifactRecorderInput,
): ExecutableTool => {
  if (!tool.execute || !FILE_PRODUCING_TOOLS.has(toolName)) {
    return tool;
  }

  const execute = tool.execute;
  return {
    ...tool,
    execute: async (...args: unknown[]) => {
      const beforeSnapshot =
        toolName === "execute_command" ? await snapshotDirectory(input.sessionDir) : undefined;
      const result = await execute(...args);

      try {
        if (toolName === "execute_command") {
          const afterSnapshot = await snapshotDirectory(input.sessionDir);
          const changedPaths = diffSnapshots(beforeSnapshot ?? new Map(), afterSnapshot);
          for (const relativePath of changedPaths) {
            await recordFileArtifact({
              ...input,
              toolName,
              relativePath,
            });
          }
        } else {
          const relativePath = extractPathFromArgs(args[0]);
          if (relativePath) {
            await recordFileArtifact({
              ...input,
              toolName,
              relativePath,
            });
          }
        }
      } catch (error) {
        console.warn(
          `[workspace-artifact-recorder] failed to record artifact for ${toolName}:`,
          error instanceof Error ? error.message : error,
        );
      }

      return result;
    },
  };
};

const extractPathFromArgs = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const pathValue = (value as Record<string, unknown>).path;
  return typeof pathValue === "string" && pathValue.length > 0 ? pathValue : undefined;
};

const recordFileArtifact = async (input: {
  sessionDir: string;
  runContext: AgentRunContext;
  emitter: AgUiEventEmitter;
  createFileArtifact?: CreateFileBackedArtifact;
  createArtifact: (input: CreateArtifactInput) => Promise<ArtifactSummary>;
  toolName: string;
  relativePath: string;
}): Promise<void> => {
  const absolutePath = path.resolve(input.sessionDir, input.relativePath);
  if (
    !absolutePath.startsWith(`${input.sessionDir}${path.sep}`) &&
    absolutePath !== input.sessionDir
  ) {
    throw new Error("WORKSPACE_ARTIFACT_PATH_ESCAPE");
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    return;
  }
  if (!stat.isFile()) return;

  const textPreview = await readTextPreview(absolutePath, stat.size);
  const preview_json = {
    path: input.relativePath,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    tool: input.toolName,
    run_dir_relative: true,
    ...(textPreview !== undefined ? { content: textPreview, content_type: "text" as const } : {}),
  };

  // Prefer a file-backed artifact so the produced file is downloadable and can be
  // promoted to the workspace, matching the SQL result artifact experience. Fall back
  // to a preview-only artifact when no file asset service is wired or registration fails.
  if (input.createFileArtifact) {
    try {
      const artifact = await input.createFileArtifact({
        type: "file",
        name: input.relativePath,
        source_path: absolutePath,
        preview_json,
      });
      input.emitter.emit(createArtifactEvent(artifact));
      return;
    } catch (error) {
      console.warn(
        `[workspace-artifact-recorder] file-backed artifact failed for ${input.toolName}, falling back to preview:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const artifact = await input.createArtifact({
    user_id: input.runContext.user_id,
    session_id: input.runContext.session_id,
    run_id: input.runContext.run_id,
    type: "file",
    name: input.relativePath,
    preview_json,
  });

  input.emitter.emit(createArtifactEvent(artifact));
};

const snapshotDirectory = async (
  dir: string,
): Promise<Map<string, FileSnapshotEntry>> => {
  const snapshot = new Map<string, FileSnapshotEntry>();

  const walk = async (currentDir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const stat = await fs.promises.stat(fullPath);
        snapshot.set(path.relative(dir, fullPath), {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Ignore unreadable files during snapshot.
      }
    }
  };

  await walk(dir);
  return snapshot;
};

const diffSnapshots = (
  before: Map<string, FileSnapshotEntry>,
  after: Map<string, FileSnapshotEntry>,
): string[] => {
  const changed: string[] = [];
  for (const [relativePath, afterMeta] of after) {
    const beforeMeta = before.get(relativePath);
    if (
      !beforeMeta ||
      beforeMeta.mtimeMs !== afterMeta.mtimeMs ||
      beforeMeta.size !== afterMeta.size
    ) {
      changed.push(relativePath);
    }
  }
  return changed;
};
