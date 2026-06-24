import { asRecord, BaseToolObservationAdapter, pickFields } from "./base-tool-observation-adapter.js";

export class ReadFileToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "read_file";
  readonly resultType = "workspace-read-file";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class WriteFileToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "write_file";
  readonly resultType = "workspace-write-file";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "size", "bytesWritten", "success", "message"]);
  }
}

export class EditFileToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "edit_file";
  readonly resultType = "workspace-edit-file";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "changes", "diff", "success", "message"]);
  }
}

export class ListFilesToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "list_files";
  readonly resultType = "workspace-list-files";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class GrepToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "grep";
  readonly resultType = "workspace-grep";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}

export class FileStatToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "file_stat";
  readonly resultType = "workspace-file-stat";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "name", "size", "type", "mimeType", "modifiedAt", "createdAt"]);
  }
}

export class MkdirToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "mkdir";
  readonly resultType = "workspace-mkdir";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["path", "created", "success", "message"]);
  }
}

export class ExecuteCommandToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "execute_command";
  readonly resultType = "workspace-execute-command";

  protected project(raw: unknown): unknown {
    return pickFields(raw, ["command", "stdout", "stderr", "exitCode", "success", "timedOut"]);
  }
}
