import os from "node:os";
import path from "node:path";

import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from "@mastra/core/workspace";

import type { AgentRunContext } from "../types.js";

export type WorkspaceFactoryInput = {
  runContext: AgentRunContext;
  skillPaths?: string[];
  workspaceRoot?: string | undefined;
};

export type RunWorkspace = {
  commandExecutionEnabled: boolean;
  isolation: "bwrap" | "none" | "seatbelt";
  /**
   * Persistent, cross-session workspace directory (the read-only asset area).
   * Owned by {user_id, workspace_id}; survives session destruction. Agent reads it via
   * the read-only list_workspace_files / read_workspace_file tools; files land here only
   * via promote_workspace_file or the REST promote endpoint.
   */
  runDir: string;
  /**
   * Per-session directory under `runDir/sessions/{session_id}`. The agent's filesystem
   * basePath — new files default here and are session-private across runs in the same session.
   */
  sessionDir: string;
  workspace: Workspace;
  /** Close the Mastra workspace without deleting session or workspace files. */
  destroy(): Promise<void>;
};

/** Resolve the application-level workspace root. */
export const resolveWorkspaceRoot = (injectedRoot?: string): string =>
  path.resolve(injectedRoot ?? process.env.WORKSPACE_ROOT ?? path.join(os.tmpdir(), "open-data-agent-workspace"));

/**
 * Resolve the persistent, cross-session workspace directory for {user_id, workspace_id}.
 * This is the read-only asset area: cross-session files live here (visible to all of the
 * user's sessions via the read-only workspace tools). New files do NOT default here —
 * they default to the session directory and are promoted here explicitly. It is NOT
 * destroyed between runs.
 */
export const resolveWorkspaceDir = (input: WorkspaceFactoryInput): string => {
  const root = resolveWorkspaceRoot(input.workspaceRoot);
  const segments = [
    safePathSegment(input.runContext.user_id, "user_id"),
    safePathSegment(input.runContext.workspace_id ?? "default", "workspace_id")
  ];
  const workspaceDir = path.resolve(root, ...segments);

  if (!workspaceDir.startsWith(`${root}${path.sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }

  return workspaceDir;
};

/**
 * Resolve the per-session directory (`{workspaceDir}/sessions/{session_id}`).
 * This is the agent's filesystem basePath — new files (write_file, execute_command,
 * uploads, attachments) default here and are session-private. Promoted files leave this
 * scope for the workspace root. The directory is retained across runs in the same
 * session; FileAsset remains the durable storage and dedupe layer.
 */
export const resolveSessionWorkspaceDir = (input: WorkspaceFactoryInput): string => {
  const workspaceDir = resolveWorkspaceDir(input);
  const sessionDir = path.resolve(
    workspaceDir,
    "sessions",
    safePathSegment(input.runContext.session_id, "session_id")
  );

  if (!sessionDir.startsWith(`${workspaceDir}${path.sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }

  return sessionDir;
};

/** Create a workspace bound to one trusted session identity. */
export const createRunWorkspace = (input: WorkspaceFactoryInput): RunWorkspace => {
  const runDir = resolveWorkspaceDir(input);
  const sessionDir = resolveSessionWorkspaceDir(input);
  const detection = LocalSandbox.detectIsolation();
  const commandExecutionEnabled = detection.available && process.env.WORKSPACE_COMMAND_ENABLED !== "false";
  const sandbox = commandExecutionEnabled
    ? new LocalSandbox({
        // execute_command runs with cwd at the per-session directory: command outputs
        // default to the session scope (only this session can see them). The seatbelt/
        // bwrap profile allows file-read* broadly (so the workspace root and other
        // cross-session assets remain readable) but restricts file-write* to sessionDir
        // — commands cannot mutate the cross-session workspace root unless a file is
        // explicitly promoted. See SBPL generation in @mastra/core.
        workingDirectory: sessionDir,
        isolation: detection.backend,
        timeout: readPositiveInteger(process.env.WORKSPACE_COMMAND_TIMEOUT_MS, 30000),
        nativeSandbox: {
          allowNetwork: false,
          allowSystemBinaries: true,
          readWritePaths: [sessionDir]
        }
      })
    : undefined;
  const maxOutputTokens = readPositiveInteger(process.env.WORKSPACE_MAX_OUTPUT_TOKENS, 3000);
  const workspace = new Workspace({
    // basePath is the per-session directory: write_file / edit_file / list_files default
    // to the session scope, so new files are session-private until promoted. The
    // persistent workspace root (runDir) stays cross-session readable via the dedicated
    // read-only list_workspace_files / read_workspace_file tools — LocalFilesystem's
    // containment is read+write symmetric, so we do NOT add runDir to allowedPaths (that
    // would also make it writable); cross-session reads go through the read-only tools.
    filesystem: new LocalFilesystem({ basePath: sessionDir, contained: true }),
    ...(sandbox ? { sandbox } : {}),
    ...(input.skillPaths?.length ? { bm25: true, skills: input.skillPaths } : {}),
    tools: {
      enabled: false,
      [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true, name: "read_file", maxOutputTokens },
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
        enabled: true,
        name: "write_file",
        requireReadBeforeWrite: true,
        maxOutputTokens
      },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { enabled: true, name: "edit_file", maxOutputTokens },
      [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { enabled: true, name: "list_files", maxOutputTokens },
      [WORKSPACE_TOOLS.FILESYSTEM.GREP]: { enabled: true, name: "grep", maxOutputTokens },
      [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: { enabled: true, name: "file_stat", maxOutputTokens },
      [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { enabled: true, name: "mkdir", maxOutputTokens },
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
        enabled: commandExecutionEnabled,
        name: "execute_command",
        requireApproval: false,
        maxOutputTokens
      }
    }
  });

  return {
    commandExecutionEnabled,
    isolation: commandExecutionEnabled ? detection.backend : "none",
    runDir,
    sessionDir,
    workspace,
    // Session directories are long-lived working copies for the same session. Durable
    // storage and dedupe still live in FileAsset; this only closes Mastra workspace state.
    destroy: async () => workspace.destroy()
  };
};

/** Backward-compatible name for callers that still treat the workspace as run-attached. */
export const resolveRunWorkspaceDir = resolveSessionWorkspaceDir;

const safePathSegment = (value: string, field: string): string => {
  if (!value || value === "." || value === ".." || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`INVALID_WORKSPACE_${field.toUpperCase()}`);
  }

  return value;
};

const readPositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
