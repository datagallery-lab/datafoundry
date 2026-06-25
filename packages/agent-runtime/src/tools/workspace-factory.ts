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
  runDir: string;
  workspace: Workspace;
};

/** Resolve the application-level workspace root. */
export const resolveWorkspaceRoot = (injectedRoot?: string): string =>
  path.resolve(injectedRoot ?? process.env.WORKSPACE_ROOT ?? path.join(os.tmpdir(), "open-data-agent-workspace"));

/** Create a filesystem-confined Workspace bound to one trusted run identity. */
export const createRunWorkspace = (input: WorkspaceFactoryInput): RunWorkspace => {
  const runDir = resolveRunWorkspaceDir(input);
  const detection = LocalSandbox.detectIsolation();
  const commandExecutionEnabled = detection.available && process.env.WORKSPACE_COMMAND_ENABLED !== "false";
  const sandbox = commandExecutionEnabled
    ? new LocalSandbox({
        workingDirectory: runDir,
        isolation: detection.backend,
        timeout: readPositiveInteger(process.env.WORKSPACE_COMMAND_TIMEOUT_MS, 30000),
        nativeSandbox: {
          allowNetwork: false,
          allowSystemBinaries: true,
          readWritePaths: [runDir]
        }
      })
    : undefined;
  const maxOutputTokens = readPositiveInteger(process.env.WORKSPACE_MAX_OUTPUT_TOKENS, 3000);
  const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath: runDir, contained: true }),
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
    workspace
  };
};

export const resolveRunWorkspaceDir = (input: WorkspaceFactoryInput): string => {
  const root = resolveWorkspaceRoot(input.workspaceRoot);
  const segments = [
    safePathSegment(input.runContext.user_id, "user_id"),
    safePathSegment(input.runContext.session_id, "session_id"),
    safePathSegment(input.runContext.run_id, "run_id")
  ];
  const runDir = path.resolve(root, ...segments);

  if (!runDir.startsWith(`${root}${path.sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }

  return runDir;
};

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
