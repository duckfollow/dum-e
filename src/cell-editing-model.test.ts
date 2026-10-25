import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editableColumn,
  editableRow,
  parseCell,
  stageCell,
} from "./cell-editing-model.ts";
import type { ColumnInfo, TableDetails } from "./table-model.ts";
const column = (extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name: "id",
  ordinal: 1,
  dataType: "bigint",
  nullable: false,
  defaultValue: null,
  primaryKeyPosition: 1,
  generated: null,
  identity: null,
  comment: null,
  typeDetail: null,
  enumValues: [],
  ...extra,
});
test("cell parser preserves large numbers, text and explicit NULL", () => {
  assert.equal(
    parseCell("9007199254740993", column(), false),
    "9007199254740993",
  );
  assert.equal(parseCell("NULL", column({ dataType: "text" }), false), "NULL");
  assert.equal(parseCell("", column({ nullable: true }), true), null);
  assert.equal(parseCell("0", column({ dataType: "boolean" }), false), false);
  assert.throws(() => parseCell("", column(), true));
  assert.throws(() => parseCell("1.5", column(), false));
  assert.throws(() =>
    parseCell("Infinity", column({ dataType: "numeric" }), false),
  );
});
test("reverting a cell removes its pending edit without losing other cells", () => {
  const original = ["1", "before"];
  let edits = stageCell({}, 0, "name", "after", original, 1);
  edits = stageCell(edits, 0, "id", "2", original, 0);
  edits = stageCell(edits, 0, "name", "before", original, 1);
  assert.deepEqual(edits[0].changes, { id: "2" });
  assert.deepEqual(stageCell(edits, 0, "id", "1", original, 0), {});
});
test("editing requires exact column shape, complete keys and lossless rows", () => {
  const details = {
    table: { schema: "main", name: "t", kind: "table" },
    columns: [column(), column({ name: "part", primaryKeyPosition: 2 })],
  } as TableDetails;
  const result = {
    columns: [
      { name: "id", dataType: "INTEGER" },
      { name: "part", dataType: "INTEGER" },
    ],
    rows: [],
    elapsedMs: 0,
    truncated: false,
  };
  assert.equal(editableRow(details, result, ["1", "2"]), true);
  assert.equal(editableRow(details, result, ["1", null]), false);
  assert.equal(editableRow(details, result, ["1", { binaryBytes: 2 }]), false);
  assert.equal(
    editableRow(
      { ...details, table: { ...details.table, kind: "view" } },
      result,
      ["1", "2"],
    ),
    false,
  );
  assert.equal(
    editableRow(
      details,
      { ...result, columns: [...result.columns].reverse() },
      ["1", "2"],
    ),
    false,
  );
  assert.equal(editableColumn(column({ generated: "stored" })), false);
  assert.equal(editableColumn(column({ dataType: "bytea" })), false);
});

test("JSON scalar previews are read-only, including JSON null", () => {
  const details = {
    table: { schema: "public", name: "t", kind: "table" },
    columns: [
      column(),
      column({ name: "payload", dataType: "jsonb", primaryKeyPosition: 0 }),
    ],
  } as TableDetails;
  const result = {
    columns: [
      { name: "id", dataType: "INT8" },
      { name: "payload", dataType: "JSONB" },
    ],
    rows: [],
    elapsedMs: 0,
    truncated: false,
  };
  assert.equal(editableRow(details, result, ["1", null]), false);
  assert.equal(editableRow(details, result, ["1", "a scalar"]), false);
});

test("unusual column names are staged as own properties", () => {
  const edit = stageCell({}, 0, "__proto__", "after", ["before"], 0);
  assert.equal(Object.hasOwn(edit[0].changes, "__proto__"), true);
  assert.equal(edit[0].changes["__proto__"], "after");
  assert.equal(JSON.stringify(edit[0].changes), '{"__proto__":"after"}');
});
