import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DatasourceCredentialClearControl } from "../components/DatasourceCredentialClearControl";

describe("DatasourceCredentialClearControl", () => {
  it("exposes an explicit credential removal choice without changing blank-field semantics", () => {
    const html = renderToStaticMarkup(
      createElement(DatasourceCredentialClearControl, {
        checked: false,
        helpText: "Leave this unchecked and keep credential fields blank to preserve the saved credentials.",
        label: "Remove saved credentials on save",
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Remove saved credentials on save");
    expect(html).toContain("Leave this unchecked and keep credential fields blank to preserve the saved credentials.");
  });
});
