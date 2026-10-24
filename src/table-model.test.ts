import test from "node:test";
import assert from "node:assert/strict";
import {
  focusGraph,
  tableKey,
  pairsLabel,
  type Relation,
} from "./table-model.ts";
import type { Table } from "./model.ts";
const table = (schema: string, name: string): Table => ({
  schema,
  name,
  kind: "table",
});
const relation = (id: string, fromTable: Table, toTable: Table): Relation => ({
  id,
  name: null,
  fromTable,
  toTable,
  columns: [
    { from: "tenant_id", to: "tenant_id" },
    { from: "owner_id", to: "id" },
  ],
  onUpdate: "NO ACTION",
  onDelete: "CASCADE",
  validated: true,
  deferrable: false,
});
test("qualified graph identities cannot collide when names contain dots or delimiters", () => {
  assert.notEqual(tableKey(table("a.b", "c")), tableKey(table("a", "b.c")));
});
test("focused graph preserves composite pairing, edge direction, duplicate FKs, and self references", () => {
  const a = table("public", "items"),
    b = table("public", "crew"),
    c = table("audit", "items");
  const relations = [
    relation("one", a, b),
    relation("two", a, b),
    relation("self", a, a),
    relation("incoming", c, a),
  ];
  const graph = focusGraph(a, relations);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.nodes.find((n) => n.table === c)?.role, "incoming");
  assert.equal(graph.nodes.find((n) => n.table === b)?.role, "outgoing");
  assert.equal(graph.edges[0].fromTable, a);
  assert.equal(
    pairsLabel(relations[0]),
    "tenant_id → tenant_id, owner_id → id",
  );
});
test("graph limits leave the complete relationship list untouched and never dangle an edge", () => {
  const a = table("main", "a");
  const relations = Array.from({ length: 30 }, (_, i) =>
    relation(String(i), a, table("main", `target-${i}`)),
  );
  const graph = focusGraph(a, relations, 5);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.omitted, 26);
  assert.equal(relations.length, 30);
  const keys = new Set(graph.nodes.map((n) => n.id));
  assert.ok(
    graph.edges.every(
      (e) => keys.has(tableKey(e.fromTable)) && keys.has(tableKey(e.toTable)),
    ),
  );
});
test("no FK means a single selected node; unrelated tables are never inferred as relations", () => {
  const a = table("main", "a"),
    b = table("main", "a_id");
  assert.equal(focusGraph(a, []).nodes.length, 1);
  assert.equal(focusGraph(a, [relation("unrelated", b, b)]).edges.length, 0);
});
