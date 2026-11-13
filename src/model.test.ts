import { formatArrayPreview } from "./array-preview.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  tableSql,
  quoteIdentifier,
  exportCsv,
  exportJson,
  filteredRows,
  type QueryResult,
} from "./model.ts";
const result: QueryResult = {
  columns: [
    { name: "value", dataType: "TEXT" },
    { name: "value", dataType: "INT8" },
  ],
  rows: [
    [null, "9007199254740993"],
    ['=HYPERLINK("bad")', "12"],
    ['line\n"quoted"', "2"],
  ],
  elapsedMs: 1,
  truncated: false,
};
test("quoted identifiers cannot turn table browsing into SQL injection", () => {
  assert.equal(quoteIdentifier('a";DROP TABLE x;--'), '"a"";DROP TABLE x;--"');
  assert.equal(
    tableSql({ schema: "main", name: "order", kind: "table" }, 1),
    'SELECT *\nFROM "main"."order"\nLIMIT 201 OFFSET 200;',
  );
});
test("CSV escapes quotes and line breaks and protects spreadsheet formulas", () => {
  const text = exportCsv(result);
  assert.ok(text.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(text.includes('"line\n""quoted"""'));
  assert.ok(text.includes("9007199254740993"));
});
test("JSON preserves duplicate column names, nulls and large integer strings", () => {
  assert.deepEqual(JSON.parse(exportJson(result)).rows, result.rows);
  assert.equal(JSON.parse(exportJson(result)).columns.length, 2);
});
test("current-page filters and sorts keep exact original row references and integer order", () => {
  assert.deepEqual(
    filteredRows(result, "", { index: 1, asc: true }).map((r) => r.index),
    [2, 1, 0],
  );
  assert.equal(filteredRows(result, "quoted", null)[0].index, 2);
});

test("table preview applies quoted filters and sorting before pagination", () => {
  const table = { schema: "shop_demo", name: "orders", kind: "table" };
  const sql = tableSql(table, 1, {
    filter: { column: 'state"name', operator: "equals", value: "O'Reilly" },
    sort: { column: "amount", direction: "DESC", tieBreakers: ["id"] },
  });
  assert.match(
    sql,
    /WHERE "state""name" = 'O''Reilly'\nORDER BY "amount" DESC, "id"\nLIMIT 201 OFFSET 200;/,
  );
  assert.match(
    tableSql(table, 0, {
      filter: { column: "state", operator: "not-null", value: "" },
    }),
    /WHERE "state" IS NOT NULL/,
  );
  assert.ok(
    tableSql(
      table,
      0,
      { filter: { column: "state", operator: "equals", value: "$dum_e$" } },
      "postgres",
    ).includes("$ddum_e$$dum_e$$ddum_e$"),
  );
});

test("PostgreSQL preview sorts by source columns when projections are cast", () => {
  const table = { schema: "public", name: 'drug"table', kind: "table" };
  const sql = tableSql(
    table,
    0,
    {
      sort: {
        column: "active_drug_ids",
        direction: "DESC",
        tieBreakers: ["id"],
      },
    },
    "postgres",
  );
  assert.match(
    sql,
    /ORDER BY "drug""table"\."active_drug_ids" DESC, "drug""table"\."id"/,
  );
});

test("array display distinguishes quoted values, SQL NULL elements and nesting", () => {
  assert.deepEqual(formatArrayPreview('{"with,comma","NULL",NULL,""}', false), [
    { kind: "value", text: '"with,comma"' },
    { kind: "value", text: '"NULL"' },
    { kind: "null", text: "NULL" },
    { kind: "value", text: '""' },
  ]);
  assert.deepEqual(
    formatArrayPreview("{{t,NULL},{f,t}}", true)?.map((part) => part.text),
    ["[", "true", "NULL", "]", "[", "false", "true", "]"],
  );
  assert.deepEqual(formatArrayPreview("{}", false), []);
});
