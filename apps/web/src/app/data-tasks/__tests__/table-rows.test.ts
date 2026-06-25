import { describe, expect, it } from "vitest";

import { normalizeSqlTable, resolveColumnValue } from "../table-rows";

describe("table-rows", () => {
  it("reads object rows by column alias", () => {
    const rows = [{ total_orders: 42 }];
    const { columns, rows: normalized } = normalizeSqlTable(
      ["COUNT(*) as total_orders"],
      rows,
    );

    expect(columns).toEqual(["COUNT(*) as total_orders"]);
    expect(normalized).toEqual([[42]]);
  });

  it("falls back to object keys when declared columns do not match", () => {
    const rows = [
      { order_id: "o_001", gmv: 1280 },
      { order_id: "o_002", gmv: 640 },
    ];
    const { columns, rows: normalized } = normalizeSqlTable(
      ["COUNT(*) as total_orders"],
      rows,
    );

    expect(columns).toEqual(["order_id", "gmv"]);
    expect(normalized).toEqual([
      ["o_001", 1280],
      ["o_002", 640],
    ]);
  });

  it("resolves alias keys directly", () => {
    expect(resolveColumnValue({ total_orders: 7 }, "COUNT(*) as total_orders")).toBe(7);
  });
});
