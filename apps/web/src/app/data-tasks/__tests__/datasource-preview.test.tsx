/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { DatasourceExplorerPanel } from "../components/DatasourceExplorerPanel";

vi.mock("../components/DatasourceTypeIcon", () => ({
  DatasourceTypeIcon: () => null,
}));

describe("datasource table preview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.spyOn(configApi, "getDatasourceSchema").mockResolvedValue({
      datasourceId: "sales-pg",
      tables: [
        {
          name: "orders",
          columns: [{ name: "order_id", type: "uuid" }],
        },
      ],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("passes the configured PostgreSQL schema to the preview request", async () => {
    const previewSpy = vi.spyOn(configApi, "getDatasourceTablePreview").mockResolvedValue({
      columns: [{ name: "order_id", type: "uuid" }],
      rows: [{ order_id: "order-1" }],
      total: 1,
      hasMore: false,
    });

    await mountExplorer();
    await clickButton("Data");
    await clickButton("Load 50 rows");

    expect(previewSpy).toHaveBeenCalledWith("sales-pg", "orders", {
      schema: "finance",
      limit: 50,
      offset: 0,
    });
  });

  it("ignores a preview response after the selected table changes", async () => {
    vi.mocked(configApi.getDatasourceSchema).mockResolvedValue({
      datasourceId: "sales-pg",
      tables: [
        { name: "orders", columns: [{ name: "order_id", type: "uuid" }] },
        { name: "customers", columns: [{ name: "customer_id", type: "uuid" }] },
      ],
    });
    let resolveOrders: ((value: {
      columns: Array<{ name: string; type?: string }>;
      rows: Array<Record<string, unknown>>;
    }) => void) | undefined;
    vi.spyOn(configApi, "getDatasourceTablePreview").mockImplementation(
      () => new Promise((resolve) => {
        resolveOrders = resolve;
      }),
    );

    await mountExplorer();
    await clickButton("Data");
    await clickButton("Load 50 rows");
    await clickButtonContaining("customers");

    await act(async () => {
      resolveOrders?.({
        columns: [{ name: "order_id", type: "uuid" }],
        rows: [{ order_id: "order-1" }],
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain("customers");
    expect(host.textContent).not.toContain("order-1");
  });

  async function mountExplorer() {
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
  }

  async function clickButton(label: string) {
    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button, `button ${label}`).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  }

  async function clickButtonContaining(label: string) {
    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes(label),
    );
    expect(button, `button containing ${label}`).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  }
});
