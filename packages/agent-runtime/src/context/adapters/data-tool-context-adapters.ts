import { asRecord, BaseToolContextAdapter } from "./base-tool-context-adapter.js";

export class ListDataSourcesContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "list_data_sources";
  readonly resultType = "data-list-sources";

  protected project(raw: unknown): unknown {
    return Array.isArray(raw) ? { datasources: raw } : asRecord(raw);
  }
}

export class PreviewTableContextAdapter extends BaseToolContextAdapter {
  readonly toolName = "preview_table";
  readonly resultType = "data-preview-table";

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}
