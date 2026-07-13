import assert from "node:assert/strict";
import test from "node:test";

import { applyTableResultMask } from "../packages/data-gateway/dist/table-result-policy.js";

test("field masking follows PostgreSQL source columns through direct aliases", () => {
  const masked = applyTableResultMask({
    columns: ["id", "exposed"],
    rows: [[1, "private-value"]],
    row_count: 1,
    column_origins: [
      { schema: "analytics", table: "orders", column: "id" },
      { schema: "analytics", table: "orders", column: "secret" },
    ],
  }, ["secret"]);

  assert.deepEqual(masked, {
    columns: ["id", "exposed"],
    rows: [[1, "[MASKED]"]],
    row_count: 1,
  });
});

test("PostgreSQL derived columns are masked fail-closed when a field policy exists", () => {
  const masked = applyTableResultMask({
    columns: ["id", "derived_metric"],
    rows: [[1, 99]],
    row_count: 1,
    column_origins: [
      { schema: "analytics", table: "orders", column: "id" },
      null,
    ],
  }, ["secret"]);

  assert.deepEqual(masked.rows, [[1, "[MASKED]"]]);
});

test("adapters without column lineage keep output-name masking semantics", () => {
  const masked = applyTableResultMask({
    columns: ["id", "secret"],
    rows: [[1, "private-value"]],
    row_count: 1,
  }, ["secret"]);

  assert.deepEqual(masked.rows, [[1, "[MASKED]"]]);
});

test("adapter-only column origins never cross the public result boundary", () => {
  const result = applyTableResultMask({
    columns: ["id"],
    rows: [[1]],
    row_count: 1,
    column_origins: [
      { schema: "analytics", table: "orders", column: "id" },
    ],
  }, []);

  assert.deepEqual(result, {
    columns: ["id"],
    rows: [[1]],
    row_count: 1,
  });
  assert.equal("column_origins" in result, false);
});
