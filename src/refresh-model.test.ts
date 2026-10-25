import { test } from "node:test";
import assert from "node:assert/strict";
import { reconciledResult, refreshedTab } from "./refresh-model.ts";
import type { QueryTab, QueryResult } from "./model.ts";
const result: QueryResult = {
  columns: [
    { name: "id", dataType: "INT" },
    { name: "value", dataType: "TEXT" },
  ],
  rows: [
    ["1", "a"],
    ["2", "b"],
  ],
  elapsedMs: 3,
  truncated: false,
};
const tab: QueryTab = {
  id: "t",
  profileId: "p",
  sql: "SELECT * FROM t",
  page: 0,
  title: "t",
  result,
};
test("unchanged auto refresh preserves tab and result despite timing changes", () => {
  assert.equal(
    refreshedTab(
      tab,
      { ...result, rows: result.rows.map((r) => [...r]), elapsedMs: 99 },
      tab.sql,
      0,
    ),
    tab,
  );
});
test("changed data preserves unaffected rows and stable timing", () => {
  const updated = refreshedTab(
    tab,
    {
      ...result,
      rows: [
        ["1", "a"],
        ["2", "new"],
      ],
      elapsedMs: 42,
    },
    tab.sql,
    0,
  );
  assert.notEqual(updated, tab);
  assert.equal(updated.result!.rows[0], result.rows[0]);
  assert.deepEqual(updated.result!.rows[1], ["2", "new"]);
  assert.equal(updated.result!.elapsedMs, 3);
});
test("in-flight refresh cannot overwrite a changed query or page", () => {
  const edited = { ...tab, sql: "SELECT 2" };
  assert.equal(refreshedTab(edited, result, tab.sql, 0), edited);
  const paged = { ...tab, page: 1 };
  assert.equal(refreshedTab(paged, result, tab.sql, 0), paged);
});
test("empty results and changed columns replace stale rows; errors clear after success", () => {
  const empty = refreshedTab(tab, { ...result, rows: [] }, tab.sql, 0);
  assert.deepEqual(empty.result!.rows, []);
  const changed = refreshedTab(
    tab,
    {
      ...result,
      columns: [{ name: "renamed", dataType: "TEXT" }],
      rows: [["1"]],
    },
    tab.sql,
    0,
  );
  assert.equal(changed.result!.columns[0].name, "renamed");
  assert.equal(
    refreshedTab({ ...tab, error: "failed" }, result, tab.sql, 0).error,
    undefined,
  );
});

test("manual refresh preserves rows while updating actual execution timing", () => {
  const next = reconciledResult(result, {
    ...result,
    rows: result.rows.map((row) => [...row]),
    elapsedMs: 42,
  });
  assert.equal(next.rows[0], result.rows[0]);
  assert.equal(next.rows[1], result.rows[1]);
  assert.equal(next.elapsedMs, 42);
  assert.equal(
    reconciledResult(result, {
      ...result,
      rows: result.rows.map((row) => [...row]),
    }),
    result,
  );
});
