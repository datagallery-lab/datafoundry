/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import type { DatasourceSchemaDto } from "../../../lib/config-api";
import { DatasourceExplorerPanel } from "../components/DatasourceExplorerPanel";

vi.mock("../components/DatasourceTypeIcon", () => ({
  DatasourceTypeIcon: () => null,
}));

describe("datasource schema request ordering", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("ignores an older schema response after the datasource changes", async () => {
    let resolveOldSchema: ((value: DatasourceSchemaDto) => void) | undefined;
    vi.spyOn(configApi, "getDatasourceSchema").mockImplementation((id) => {
      if (id === "old-pg") {
        return new Promise((resolve) => {
          resolveOldSchema = resolve;
        });
      }
      return Promise.resolve({
        datasourceId: "new-pg",
        tables: [{ name: "new_orders", columns: [{ name: "id" }] }],
      });
    });

    await renderExplorer("old-pg");
    await renderExplorer("new-pg");
    expect(host.textContent).toContain("new_orders");

    await act(async () => {
      resolveOldSchema?.({
        datasourceId: "old-pg",
        tables: [{ name: "old_orders", columns: [{ name: "id" }] }],
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain("new_orders");
    expect(host.textContent).not.toContain("old_orders");
  });

  async function renderExplorer(id: string) {
    await act(async () => {
      root.render(
        createElement(DatasourceExplorerPanel, {
          item: {
            id,
            name: id,
            description: "",
            enabled: true,
            settings: { type: "postgresql", schema: "finance" },
          },
          onBack: vi.fn(),
          onEdit: vi.fn(),
        }),
      );
      await Promise.resolve();
    });
  }
});
