import type { Table } from "./model";
import {
  tableKey,
  qualified,
  type Relation,
  type FocusGraph,
} from "./table-model.ts";
export interface DatabaseRelationsData {
  tables: Table[];
  relations: Relation[];
  notes: string[];
}
export function filterOverview(
  data: DatabaseRelationsData,
  schema: string,
  search: string,
  connectedOnly: boolean,
) {
  const needle = search.trim().toLocaleLowerCase();
  const seeds = new Set(
    data.tables
      .filter(
        (t) =>
          (!schema || t.schema === schema) &&
          (!needle || qualified(t).toLocaleLowerCase().includes(needle)),
      )
      .map(tableKey),
  );
  const relations = data.relations.filter(
    (r) => seeds.has(tableKey(r.fromTable)) || seeds.has(tableKey(r.toTable)),
  );
  const linked = new Set(
    relations.flatMap((r) => [tableKey(r.fromTable), tableKey(r.toTable)]),
  );
  const ids = new Set([...seeds, ...linked]);
  const tables = data.tables.filter(
    (t) => ids.has(tableKey(t)) && (!connectedOnly || linked.has(tableKey(t))),
  );
  return { tables, relations, seeds };
}
export function overviewGraph(
  tables: Table[],
  relations: Relation[],
  limit = 200,
): FocusGraph {
  const objects = new Map(tables.map((t) => [tableKey(t), t]));
  const adjacent = new Map(
    [...objects.keys()].map((k) => [k, new Set<string>()]),
  );
  for (const r of relations) {
    const a = tableKey(r.fromTable),
      b = tableKey(r.toTable);
    if (objects.has(a) && objects.has(b)) {
      adjacent.get(a)!.add(b);
      adjacent.get(b)!.add(a);
    }
  }
  const sorted = [...objects.keys()].sort(
    (a, b) =>
      adjacent.get(b)!.size - adjacent.get(a)!.size || a.localeCompare(b),
  );
  const seen = new Set<string>(),
    order: string[] = [];
  for (const root of sorted) {
    if (seen.has(root)) continue;
    const queue = [root];
    seen.add(root);
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      order.push(k);
      for (const next of [...adjacent.get(k)!].sort()) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  const visible = order.slice(0, Math.max(0, limit)),
    ids = new Set(visible);
  const cols = Math.max(1, Math.min(5, visible.length));
  const edges = relations
    .filter(
      (r) => ids.has(tableKey(r.fromTable)) && ids.has(tableKey(r.toTable)),
    )
    .slice(0, 1000);
  return {
    nodes: visible.map((id, i) => ({
      id,
      table: objects.get(id)!,
      role: "overview" as const,
      x: 32 + (i % cols) * 328,
      y: 112 + Math.floor(i / cols) * 168,
    })),
    edges,
    omitted: tables.length - visible.length,
    omittedEdges: relations.length - edges.length,
    width: Math.max(400, cols * 328 + 64),
    height: Math.max(360, Math.ceil(visible.length / cols) * 168 + 168),
  };
}
