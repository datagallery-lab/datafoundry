/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { DatasourceExplorerPanel } from "../components/DatasourceExplorerPanel";
import { DatasourceSchemaPreviewPopover } from "../components/SchemaBrowserPanel";

vi.mock("../../../i18n/locale-context", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("../components/DatasourceTypeIcon", () => ({
  DatasourceTypeIcon: () => null,
}));

describe("datasource schema comments", () => {
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

  it("shows PostgreSQL table and column comments in the explorer", async () => {
    vi.spyOn(configApi, "getDatasourceSchema").mockResolvedValue({
      datasourceId: "sales-pg",
      tables: [
        {
          name: "orders",
          description: "Customer order facts",
          columns: [
            {
              name: "order_id",
              type: "uuid",
              nullable: false,
              description: "Stable order identifier",
            },
          ],
        },
      ],
    });

    await act(async () => {
      root.render(
        createElement(DatasourceExplorerPanel, {
          item: {
            id: "sales-pg",
            name: "Sales PG",
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

    expect(host.textContent).toContain("Customer order facts");
    expect(host.textContent).toContain("Stable order identifier");

    const search = host.querySelector<HTMLInputElement>('input[placeholder="Search tables or fields"]');
    expect(search).not.toBeNull();
    await act(async () => {
      if (search) {
        search.value = "Stable order identifier";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(host.textContent).toContain("orders");
    expect(host.textContent).not.toContain("No matching objects.");
  });

  it("shows PostgreSQL table and column comments in the compact schema preview", async () => {
    vi.spyOn(configApi, "getDatasourceSchema").mockResolvedValue({
      datasourceId: "sales-pg",
      tables: [
        {
          name: "orders",
          description: "Customer order facts",
          columns: [
            {
              name: "order_id",
              type: "uuid",
              description: "Stable order identifier",
            },
          ],
        },
      ],
    });

    await act(async () => {
      root.render(
        createElement(DatasourceSchemaPreviewPopover, {
          datasourceId: "sales-pg",
          datasourceName: "Sales PG",
          onClose: vi.fn(),
        }),
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Customer order facts");
    expect(host.textContent).toContain("Stable order identifier");
  });
});
