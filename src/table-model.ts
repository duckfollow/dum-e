import type { Table } from "./model";
export type TableView = "data" | "structure" | "indexes" | "relations" | "sql";
export interface ColumnInfo {
  ordinal: number;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
  generated: string | null;
  identity: string | null;
  comment: string | null;
  typeDetail: string | null;
  enumValues: string[];
}
export interface IndexPart {
  expression: string;
  role: "key" | "included" | "auxiliary";
  descending: boolean | null;
}
export interface IndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  method: string;
  parts: IndexPart[];
  predicate: string | null;
  partial: boolean;
  definition: string | null;
  valid: boolean | null;
  origin: string;
}
export interface ConstraintInfo {
  name: string | null;
  kind: string;
  columns: string[];
  definition: string;
}
export interface Relation {
  id: string;
  name: string | null;
  fromTable: Table;
  toTable: Table;
  columns: { from: string; to: string | null }[];
  onUpdate: string;
  onDelete: string;
  validated: boolean | null;
  deferrable: boolean | null;
}
export interface TableDetails {
  table: Table;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  relations: Relation[];
  definition: string | null;
  definitionKind: string;
  comment: string | null;
  strict: boolean | null;
  withoutRowid: boolean | null;
  rowidAlias: string | null;
  foreignKeysEnforced: boolean | null;
  notes: string[];
}
export const tableKey = (table: Pick<Table, "schema" | "name">) =>
  JSON.stringify([table.schema, table.name]);
export const sameTable = (
  a: Pick<Table, "schema" | "name">,
  b: Pick<Table, "schema" | "name">,
) => a.schema === b.schema && a.name === b.name;
export const qualified = (table: Pick<Table, "schema" | "name">) =>
  `${table.schema}.${table.name}`;
export function pairsLabel(relation: Relation) {
  return relation.columns
    .map((c) => `${c.from} → ${c.to ?? "(parent PK unavailable)"}`)
    .join(", ");
}
export interface GraphNode {
  id: string;
  table: Table;
  role: "selected" | "incoming" | "outgoing" | "overview";
  x: number;
  y: number;
}
export interface FocusGraph {
  nodes: GraphNode[];
  edges: Relation[];
  omitted: number;
  omittedEdges?: number;
  width: number;
  height: number;
}
export function focusGraph(
  selected: Table,
  relations: Relation[],
  limit = 25,
): FocusGraph {
  const selectedKey = tableKey(selected),
    others = new Map<string, { table: Table; outgoing: boolean }>();
  const relevant = relations.filter(
    (r) => sameTable(r.fromTable, selected) || sameTable(r.toTable, selected),
  );
  for (const relation of relevant)
    for (const table of [relation.fromTable, relation.toTable]) {
      const key = tableKey(table);
      if (key === selectedKey) continue;
      const previous = others.get(key);
      others.set(key, {
        table,
        outgoing:
          !!previous?.outgoing || sameTable(relation.fromTable, selected),
      });
    }
  const all = [...others.values()].sort((a, b) =>
    qualified(a.table).localeCompare(qualified(b.table)),
  );
  const visible = all.slice(0, Math.max(0, limit - 1)),
    left = visible.filter((t) => !t.outgoing),
    right = visible.filter((t) => t.outgoing);
  const height = Math.max(360, Math.max(left.length, right.length) * 132 + 96);
  const nodes: GraphNode[] = [
    {
      id: selectedKey,
      table: selected,
      role: "selected",
      x: 360,
      y: height / 2 - 48,
    },
  ];
  for (const [items, role, x] of [
    [left, "incoming", 32],
    [right, "outgoing", 688],
  ] as const)
    items.forEach((item, i) =>
      nodes.push({
        id: tableKey(item.table),
        table: item.table,
        role,
        x,
        y: 48 + i * 132,
      }),
    );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: relevant.filter(
      (r) => ids.has(tableKey(r.fromTable)) && ids.has(tableKey(r.toTable)),
    ),
    omitted: all.length - visible.length,
    width: 960,
    height,
  };
}
