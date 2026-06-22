import { asRecord, BaseToolContextAdapter, pickFields } from "./base-tool-context-adapter.js";

export class ReadFileContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "read_file";
  readonly resultType = "workspace-read-file";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class WriteFileContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "write_file";
  readonly resultType = "workspace-write-file";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "size", "bytesWritten", "success", "message"]);
  }
}

export class EditFileContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "edit_file";
  readonly resultType = "workspace-edit-file";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "changes", "diff", "success", "message"]);
  }
}

export class ListFilesContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "list_files";
  readonly resultType = "workspace-list-files";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class GrepContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "grep";
  readonly resultType = "workspace-grep";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class FileStatContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "file_stat";
  readonly resultType = "workspace-file-stat";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "name", "size", "type", "mimeType", "modifiedAt", "createdAt"]);
  }
}

export class MkdirContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "mkdir";
  readonly resultType = "workspace-mkdir";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "created", "success", "message"]);
  }
}

export class ExecuteCommandContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "execute_command";
  readonly resultType = "workspace-execute-command";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["command", "stdout", "stderr", "exitCode", "success", "timedOut"]);
  }
}
