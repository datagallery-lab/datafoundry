import { createWorkspaceTools } from "@mastra/core/workspace";
import { z } from "zod";

type WorkspaceToolInputFieldConfig = {
  booleans?: readonly string[];
  numbers?: readonly string[];
};

const workspaceToolInputFields: Readonly<Record<string, WorkspaceToolInputFieldConfig>> = {
  read_file: {
    booleans: ["showLineNumbers"],
    numbers: ["offset", "limit"],
  },
  write_file: {
    booleans: ["overwrite"],
  },
  edit_file: {
    booleans: ["replace_all"],
  },
  list_files: {
    booleans: ["showHidden", "dirsOnly", "respectGitignore"],
    numbers: ["maxDepth"],
  },
  mkdir: {
    booleans: ["recursive"],
  },
  grep: {
    booleans: ["caseSensitive", "includeHidden"],
    numbers: ["contextLines", "maxCount"],
  },
  execute_command: {
    booleans: ["background"],
    numbers: ["timeout", "tail"],
  },
};

type WorkspaceToolWithInputSchema = {
  inputSchema?: z.ZodType;
};

export const createCompatibleWorkspaceTools = async (
  workspace: Parameters<typeof createWorkspaceTools>[0],
  configContext?: Parameters<typeof createWorkspaceTools>[1],
): Promise<Awaited<ReturnType<typeof createWorkspaceTools>>> => {
  const tools = await createWorkspaceTools(workspace, configContext);

  for (const [toolName, fieldConfig] of Object.entries(workspaceToolInputFields)) {
    const tool = tools[toolName] as WorkspaceToolWithInputSchema | undefined;
    if (!tool?.inputSchema) {
      continue;
    }
    const inputSchema = tool.inputSchema;
    tool.inputSchema = z.preprocess(
      (input) => normalizeWorkspaceToolInput(input, fieldConfig),
      inputSchema,
    );
  }

  return tools;
};

const normalizeWorkspaceToolInput = (
  input: unknown,
  fieldConfig: WorkspaceToolInputFieldConfig,
): unknown => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const normalizedInput = { ...input } as Record<string, unknown>;
  for (const field of fieldConfig.booleans ?? []) {
    normalizedInput[field] = normalizeExplicitBoolean(normalizedInput[field]);
  }
  for (const field of fieldConfig.numbers ?? []) {
    normalizedInput[field] = normalizeExplicitNumber(normalizedInput[field]);
  }
  return normalizedInput;
};

const normalizeExplicitBoolean = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
};

const normalizeExplicitNumber = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return value;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
};
