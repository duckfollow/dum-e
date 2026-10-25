import type { Cell, QueryResult } from "./model";
import type { RowEdit } from "./cell-editing-model";
export interface InsertRow {
  id: string;
  values: Record<string, Cell>;
}
export interface GridDraft {
  edits: Record<number, RowEdit>;
  deleted: number[];
  inserted: InsertRow[];
}
export interface Mutation extends RowEdit {
  operation: "insert" | "update" | "delete";
}
export const emptyDraft = (): GridDraft => ({
  edits: {},
  deleted: [],
  inserted: [],
});
export function mutationCount(draft: GridDraft) {
  return (
    Object.keys(draft.edits).filter((i) => !draft.deleted.includes(Number(i)))
      .length +
    draft.deleted.length +
    draft.inserted.length
  );
}
export function mutations(draft: GridDraft, result: QueryResult): Mutation[] {
  return [
    ...Object.entries(draft.edits)
      .filter(([i]) => !draft.deleted.includes(Number(i)))
      .map(([, edit]) => ({ ...edit, operation: "update" as const })),
    ...draft.deleted.map((i) => ({
      operation: "delete" as const,
      original: result.rows[i],
      changes: {},
    })),
    ...draft.inserted.map((row) => ({
      operation: "insert" as const,
      original: [],
      changes: row.values,
    })),
  ];
}
export function deleteRows(
  draft: GridDraft,
  indices: number[],
  newIds: string[],
): GridDraft {
  return {
    ...draft,
    deleted: [...new Set([...draft.deleted, ...indices])],
    inserted: draft.inserted.filter((row) => !newIds.includes(row.id)),
  };
}

export function snapshotRows(result: QueryResult, indices: number[]) {
  return indices.flatMap((index) =>
    result.rows[index] ? [{ index, values: result.rows[index] }] : [],
  );
}
