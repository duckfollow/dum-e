import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyDraft,
  deleteRows,
  mutationCount,
  mutations,
  snapshotRows,
} from "./grid-editing-model.ts";
import type { QueryResult } from "./model.ts";
const result: QueryResult = {
  columns: [
    { name: "id", dataType: "INT" },
    { name: "name", dataType: "TEXT" },
  ],
  rows: [
    ["1", "a"],
    ["2", "b"],
  ],
  elapsedMs: 1,
  truncated: false,
};
test("mixed edits produce one operation per row and preserve original snapshots", () => {
  const draft = {
    ...emptyDraft(),
    edits: {
      0: { original: result.rows[0], changes: { name: "changed" } },
      1: { original: result.rows[1], changes: { name: "unused" } },
    },
    inserted: [{ id: "new", values: { name: "created" } }],
  };
  const next = deleteRows(draft, [1], []);
  assert.equal(mutationCount(next), 3);
  assert.deepEqual(mutations(next, result), [
    { operation: "update", original: ["1", "a"], changes: { name: "changed" } },
    { operation: "delete", original: ["2", "b"], changes: {} },
    { operation: "insert", original: [], changes: { name: "created" } },
  ]);
  assert.equal(Object.keys(draft.edits).length, 2);
});
test("removing an unsaved row never sends a database delete", () => {
  const draft = { ...emptyDraft(), inserted: [{ id: "new", values: {} }] };
  const next = deleteRows(draft, [], ["new"]);
  assert.equal(mutationCount(next), 0);
  assert.deepEqual(mutations(next, result), []);
});
test("repeated row deletion is deduplicated and DEFAULT inserts omit values", () => {
  const draft = deleteRows(deleteRows(emptyDraft(), [0], []), [0], []);
  assert.equal(mutationCount(draft), 1);
  assert.deepEqual(
    mutations({ ...draft, inserted: [{ id: "n", values: {} }] }, result).at(-1),
    { operation: "insert", original: [], changes: {} },
  );
});

test("a new incoming row cannot index past a pending draft snapshot", () => {
  assert.deepEqual(snapshotRows(result, [0, 1, 2]), [
    { index: 0, values: result.rows[0] },
    { index: 1, values: result.rows[1] },
  ]);
  const next = { ...result, rows: [...result.rows, ["3", "new"]] };
  assert.equal(snapshotRows(next, [0, 1, 2]).length, 3);
});
test("undoing deletion restores prior unsaved cell edits", () => {
  const draft = {
    ...emptyDraft(),
    edits: { 0: { original: result.rows[0], changes: { name: "pending" } } },
  };
  const deleted = deleteRows(draft, [0], []);
  assert.equal(mutations(deleted, result)[0].operation, "delete");
  const restored = { ...deleted, deleted: [] };
  assert.deepEqual(mutations(restored, result), [
    {
      operation: "update",
      original: result.rows[0],
      changes: { name: "pending" },
    },
  ]);
});
