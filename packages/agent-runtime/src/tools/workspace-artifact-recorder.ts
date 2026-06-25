import type { ArtifactSummary } from "@open-data-agent/contracts";
import type { CreateArtifactInput } from "@open-data-agent/artifacts";
import fs from "node:fs";
import path from "node:path";

import { createCustomEvent } from "../events.js";
import type { AgentRunContext, AgUiEventEmitter } from "../types.js";

type ExecutableTool = {
  execute?: (...args: unknown[]) => unknown | Promise<unknown>;
};

type FileSnapshotEntry = {
  size: number;
  mtimeMs: number;
};

export type WorkspaceArtifactRecorderInput = {
  tools: Record<string, ExecutableTool>;
  runDir: string;
  runContext: AgentRunContext;
  emitter: AgUiEventEmitter;
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
        toolName === "execute_command" ? await snapshotDirectory(input.runDir) : undefined;
      const result = await execute(...args);

      try {
        if (toolName === "execute_command") {
          const afterSnapshot = await snapshotDirectory(input.runDir);
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
  runDir: string;
  runContext: AgentRunContext;
  emitter: AgUiEventEmitter;
  createArtifact: (input: CreateArtifactInput) => Promise<ArtifactSummary>;
  toolName: string;
  relativePath: string;
}): Promise<void> => {
  const absolutePath = path.resolve(input.runDir, input.relativePath);
  if (!absolutePath.startsWith(`${input.runDir}${path.sep}`) && absolutePath !== input.runDir) {
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

  const artifact = await input.createArtifact({
    user_id: input.runContext.user_id,
    session_id: input.runContext.session_id,
    run_id: input.runContext.run_id,
    type: "file",
    name: input.relativePath,
    preview_json,
  });

  input.emitter.emit(createCustomEvent("artifact", artifact));
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
