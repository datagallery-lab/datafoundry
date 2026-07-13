import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePostgreSqlTableReferences,
  SqlTableReferenceParseError,
} from "../packages/data-gateway/dist/sql-table-references.js";

test("returns qualified physical table identifier parts", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences("SELECT * FROM analytics.orders"),
    [{ parts: ["analytics", "orders"] }],
  );
});

test("decodes quoted identifiers and applies PostgreSQL folding to unquoted identifiers", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(
      'SELECT * FROM Analytics."Order""Items" JOIN "Sales".DailyTotals d ON true',
    ),
    [
      { parts: ["analytics", 'Order"Items'] },
      { parts: ["Sales", "dailytotals"] },
    ],
  );
});

test("excludes CTE references while retaining physical tables used by CTEs", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      WITH RECURSIVE recent_orders AS (
        SELECT * FROM app.orders
        UNION ALL
        SELECT child.*
        FROM app.order_children child
        JOIN recent_orders parent ON parent.id = child.parent_id
      ), totals AS (
        SELECT count(*) FROM recent_orders
      )
      SELECT *
      FROM totals
      JOIN public.customers c ON true
    `),
    [
      { parts: ["app", "orders"] },
      { parts: ["app", "order_children"] },
      { parts: ["public", "customers"] },
    ],
  );
});

test("uses PostgreSQL's sequential visibility for non-recursive CTEs", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      WITH first_cte AS (
        SELECT * FROM future_cte
      ), future_cte AS (
        SELECT * FROM first_cte
      ), orders AS (
        SELECT * FROM orders
      )
      SELECT * FROM future_cte JOIN orders ON true
    `),
    [
      { parts: ["future_cte"] },
      { parts: ["orders"] },
    ],
  );
});

test("finds relations in subqueries, JOINs, comma FROM items, and ONLY", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      SELECT c.id
      FROM ONLY (crm.customers) AS c
      LEFT JOIN (
        SELECT e.customer_id
        FROM audit.events e, warehouse.snapshots s
        WHERE EXISTS (SELECT 1 FROM security.allowed_accounts a)
      ) AS activity ON activity.customer_id = c.id
    `),
    [
      { parts: ["crm", "customers"] },
      { parts: ["audit", "events"] },
      { parts: ["warehouse", "snapshots"] },
      { parts: ["security", "allowed_accounts"] },
    ],
  );
});

test("returns no references for SELECT statements without FROM", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences("SELECT 'FROM hidden', $$JOIN secret$$, now()"),
    [],
  );
});

test("distinguishes standard strings from escape strings when locating FROM", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences("SELECT '\\' AS slash FROM public.orders"),
    [{ parts: ["public", "orders"] }],
  );
  assert.deepEqual(
    parsePostgreSqlTableReferences("SELECT E'fake\\' FROM hidden' FROM public.orders"),
    [{ parts: ["public", "orders"] }],
  );
});

test("matches quoted CTE names exactly and parses parenthesized joined tables", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      WITH "Recent" AS (SELECT * FROM source.events)
      SELECT *
      FROM "Recent"
      JOIN (public.accounts a JOIN public.teams t USING (team_id)) grouped ON true
      JOIN recent lower_case_name ON true
    `),
    [
      { parts: ["source", "events"] },
      { parts: ["public", "accounts"] },
      { parts: ["public", "teams"] },
      { parts: ["recent"] },
    ],
  );
});

test("deduplicates physical relation references in first-seen order", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(
      "SELECT * FROM public.orders o JOIN public.orders prior ON prior.id = o.id",
    ),
    [{ parts: ["public", "orders"] }],
  );
});

test("finds TABLE query operands at top level, in CTEs, and across set operations", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      WITH current_orders AS (TABLE analytics.orders)
      SELECT * FROM current_orders
      UNION ALL TABLE private.archived_orders
      UNION (TABLE audit.order_events)
    `),
    [
      { parts: ["analytics", "orders"] },
      { parts: ["private", "archived_orders"] },
      { parts: ["audit", "order_events"] },
    ],
  );
});

test("does not confuse a column named table with a TABLE query operand", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences('SELECT "table" FROM public.orders'),
    [{ parts: ["public", "orders"] }],
  );
});

test("finds TABLE queries used as scalar and FROM subqueries", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      SELECT (TABLE private.secret_values)
      FROM (TABLE analytics.orders) AS current_orders
    `),
    [
      { parts: ["private", "secret_values"] },
      { parts: ["analytics", "orders"] },
    ],
  );
});

test("does not confuse an unquoted column named table with a TABLE subquery", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      SELECT coalesce(nested.table, 0)
      FROM (SELECT 1 AS table) AS nested
      JOIN analytics.orders AS orders ON true
    `),
    [{ parts: ["analytics", "orders"] }],
  );
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      SELECT coalesce(table, 0)
      FROM analytics.orders
    `),
    [{ parts: ["analytics", "orders"] }],
  );
});

test("does not confuse qualified keyword columns with query structure", () => {
  assert.deepEqual(
    parsePostgreSqlTableReferences(`
      SELECT nested.from, nested.union, nested.intersect, nested.except
      FROM (
        SELECT 1 AS from, 2 AS union, 3 AS intersect, 4 AS except, 5 AS join
      ) AS nested
      JOIN analytics.orders AS orders ON nested.join = orders.id
    `),
    [{ parts: ["analytics", "orders"] }],
  );
});

test("fails closed for table functions and complex FROM constructors", () => {
  for (const sql of [
    "SELECT * FROM generate_series(1, 5)",
    "SELECT * FROM LATERAL jsonb_array_elements(payload)",
    "SELECT * FROM JSON_TABLE(payload, '$[*]' COLUMNS (id int PATH '$.id'))",
    "SELECT * FROM ROWS FROM(generate_series(1, 5))",
    "SELECT * FROM (VALUES (1), (2)) AS rows(id)",
  ]) {
    assert.throws(
      () => parsePostgreSqlTableReferences(sql),
      (error) => error instanceof SqlTableReferenceParseError,
      sql,
    );
  }
});

test("fails closed for malformed or unclosed SQL", () => {
  for (const sql of [
    "SELECT * FROM",
    "SELECT * FROM public.",
    "SELECT * FROM orders JOIN",
    "SELECT * FROM (SELECT * FROM orders",
    'SELECT * FROM "orders',
    "SELECT * FROM orders /* missing end",
    "WITH recent AS SELECT * FROM orders SELECT * FROM recent",
    "SELECT * FROM orders; SELECT * FROM customers",
    "SELECT 1 UNION ALL TABLE",
  ]) {
    assert.throws(
      () => parsePostgreSqlTableReferences(sql),
      (error) => error instanceof SqlTableReferenceParseError,
      sql,
    );
  }
});
