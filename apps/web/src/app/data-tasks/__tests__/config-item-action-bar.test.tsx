import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfigItemActionBar } from "../components/ConfigItemActionBar";

describe("ConfigItemActionBar", () => {
  it("blocks connection tests and schema sync while the edit draft is dirty", () => {
    const html = renderToStaticMarkup(
      createElement(ConfigItemActionBar, {
        blockPersistedActions: true,
        labels: {
          delete: "Delete",
          reindex: "Reindex",
          saveBeforeDatasourceActions: "Save changes before testing the connection or syncing the schema.",
          saveBeforeSchemaSyncTitle: "Save changes before syncing this schema.",
          saveBeforeTestTitle: "Save changes before testing this connection.",
          syncSchema: "Sync schema",
          testConnection: "Test connection",
          testing: "Testing...",
          validateSemantics: "Validate semantics",
        },
        onIntrospect: vi.fn(),
        onTest: vi.fn(),
      }),
    );

    expect(html.match(/disabled=""/gu)).toHaveLength(2);
    expect(html).toContain("Save changes before testing the connection or syncing the schema.");
    expect(html).toContain("Save changes before testing this connection.");
    expect(html).toContain("Save changes before syncing this schema.");
  });
});
