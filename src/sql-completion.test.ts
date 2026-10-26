import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { sql, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { tableCompletionSource } from "./sql-completion.ts";
const tables = [
  { schema: "shop_demo", name: "customers", kind: "table" },
  { schema: "public", name: "customers", kind: "table" },
  { schema: "odd.schema", name: 'Order "Items"', kind: "table" },
  { schema: "main", name: "ลูกค้า", kind: "table" },
];
async function complete(doc: string, pos = doc.length, sqlite = false) {
  const state = EditorState.create({
    doc,
    extensions: [sql({ dialect: sqlite ? SQLite : PostgreSQL })],
  });
  const result = await tableCompletionSource(tables)(
    new CompletionContext(state, pos, true),
  );
  return { state, result };
}
function apply(state: EditorState, result: CompletionResult, index = 0) {
  const option = result.options[index];
  const view = {
    state,
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      this.state = this.state.update(spec).state;
    },
  };
  assert.equal(typeof option.apply, "function");
  (option.apply as Function)(
    view as unknown as EditorView,
    option,
    result.from,
    state.selection.main.head || state.doc.length,
  );
  return view.state.doc.toString();
}
test("duplicate table names keep both schemas and insert qualified quoted SQL", async () => {
  const { state, result } = await complete("SELECT * FROM cust");
  assert.ok(result);
  assert.deepEqual(
    result.options.map((o) => [o.label, o.detail]),
    [
      ["customers", "shop_demo"],
      ["customers", "public"],
    ],
  );
  assert.equal(apply(state, result), 'SELECT * FROM "shop_demo"."customers"');
});
test("typed schemas and quoted names do not duplicate qualifiers or quotes", async () => {
  for (const doc of [
    "SELECT * FROM shop_demo.cu",
    'SELECT * FROM "shop_demo"."cu',
    'SELECT * FROM "shop_demo".',
  ]) {
    const { state, result } = await complete(doc);
    assert.ok(result);
    assert.equal(result.options.length, 1);
    assert.equal(apply(state, result), 'SELECT * FROM "shop_demo"."customers"');
  }
  const { state, result } = await complete('SELECT * FROM "odd.schema"."Ord');
  assert.ok(result);
  assert.equal(
    apply(state, result),
    'SELECT * FROM "odd.schema"."Order ""Items"""',
  );
});
test("supports SQLite and Unicode; ignores comments, strings and aliases", async () => {
  const { state, result } = await complete(
    "SELECT * FROM ลูก",
    undefined,
    true,
  );
  assert.ok(result);
  assert.equal(apply(state, result), 'SELECT * FROM "main"."ลูกค้า"');
  for (const doc of [
    "SELECT 'cust",
    "-- cust",
    "/* cust",
    "SELECT c.cust",
    "SELECT * FROM unknown.cu",
  ]) {
    const { result } = await complete(doc);
    assert.ok(!result || result.options.length === 0, doc);
  }
});
