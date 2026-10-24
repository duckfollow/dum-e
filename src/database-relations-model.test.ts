import test from "node:test";
import assert from "node:assert/strict";
import { filterOverview, overviewGraph } from "./database-relations-model.ts";
import { tableKey, type Relation } from "./table-model.ts";
const table = (schema: string, name: string) => ({
  schema,
  name,
  kind: "table",
});
const fk = (
  id: string,
  fromTable: ReturnType<typeof table>,
  toTable: ReturnType<typeof table>,
): Relation => ({
  id,
  fromTable,
  toTable,
  name: id,
  columns: [
    { from: "tenant", to: "tenant" },
    { from: "parent", to: "id" },
  ],
  onDelete: "RESTRICT",
  onUpdate: "NO ACTION",
  validated: true,
  deferrable: false,
});
test("database graph includes isolated objects, qualified identities and composite/self links", () => {
  const a = table("shop", "orders"),
    b = table("auth", "users"),
    isolated = table("shop", "notes");
  const relations = [fk("parent", a, b), fk("self", a, a), fk("second", a, b)];
  const graph = overviewGraph([a, b, isolated], relations);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.edges[0].columns.length, 2);
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, 3);
  assert.deepEqual(overviewGraph([a, b, isolated], relations), graph);
});
test("schema and search filters retain external one-hop neighbors without pulling in the whole database", () => {
  const a = table("shop", "orders"),
    b = table("auth", "users"),
    c = table("audit", "events"),
    d = table("shop", "notes");
  const data = {
    tables: [a, b, c, d],
    relations: [fk("ab", a, b), fk("bc", b, c)],
    notes: [],
  };
  const scoped = filterOverview(data, "shop", "", false);
  assert.deepEqual(scoped.tables, [a, b, d]);
  assert.deepEqual(
    scoped.relations.map((r) => r.id),
    ["ab"],
  );
  const search = filterOverview(data, "", "orders", false);
  assert.deepEqual(search.tables, [a, b]);
  assert.deepEqual(filterOverview(data, "", "notes", true).tables, []);
  assert.deepEqual(filterOverview(data, "", "notes", false).tables, [d]);
});
test("large diagrams are bounded but full metadata remains searchable and no edge dangles", () => {
  const tables = Array.from({ length: 250 }, (_, i) =>
    table(i % 2 ? "a" : "b", `table_${i}`),
  );
  const relations = tables.slice(1).map((t, i) => fk(String(i), tables[0], t));
  const graph = overviewGraph(tables, relations);
  assert.equal(graph.nodes.length, 200);
  assert.equal(graph.omitted, 50);
  assert.ok(graph.omittedEdges! > 0);
  const ids = new Set(graph.nodes.map((n) => tableKey(n.table)));
  assert.ok(
    graph.edges.every(
      (r) => ids.has(tableKey(r.fromTable)) && ids.has(tableKey(r.toTable)),
    ),
  );
  assert.equal(tables.length, 250);
  assert.equal(relations.length, 249);
  assert.equal(
    filterOverview({ tables, relations, notes: [] }, "", "table_249", false)
      .tables.length,
    2,
  );
  const duplicateNames = overviewGraph(
    [table("a.b", "c"), table("a", "b.c")],
    [],
  );
  assert.equal(duplicateNames.nodes.length, 2);
  assert.equal(overviewGraph([], []).nodes.length, 0);
});
