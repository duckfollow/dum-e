import type { Cell, QueryResult } from "./model";
import type { ColumnInfo, TableDetails } from "./table-model";
export interface RowEdit {
  original: Cell[];
  changes: Record<string, Cell>;
}
export function editableType(type: string) {
  return /^(text|character varying|character|varchar|char|integer|int|int2|int4|int8|smallint|bigint|real|double precision|float|float4|float8|numeric|decimal|boolean|bool)(\(.*\))?$/i.test(
    type,
  );
}
export function editableColumn(column: ColumnInfo) {
  return !column.generated && !column.identity && editableType(column.dataType);
}
export function editableRow(
  details: TableDetails,
  result: QueryResult,
  row: Cell[],
) {
  const keys = details.columns.flatMap((c, i) =>
    c.primaryKeyPosition > 0 ? [i] : [],
  );
  return (
    details.table.kind === "table" &&
    keys.length > 0 &&
    row.length === details.columns.length &&
    details.columns.every(
      (c, i) =>
        c.name === result.columns[i]?.name &&
        !/^(json|jsonb)$/i.test(c.dataType),
    ) &&
    keys.every((i) => row[i] !== null) &&
    row.every((v) => v === null || typeof v !== "object")
  );
}
export function parseCell(
  text: string,
  column: ColumnInfo,
  isNull: boolean,
): Cell {
  if (isNull) {
    if (!column.nullable) throw Error("This column does not allow NULL.");
    return null;
  }
  if (/^(bool|boolean)$/i.test(column.dataType)) {
    if (!["true", "false", "1", "0"].includes(text))
      throw Error("Choose true or false.");
    return text === "true" || text === "1";
  }
  if (/^(smallint|bigint|integer|int[248]?)$/i.test(column.dataType)) {
    if (!/^[+-]?\d+$/.test(text)) throw Error("Enter a whole number.");
    return BigInt(text).toString();
  }
  if (
    /^(real|double precision|float[48]?|numeric|decimal)/i.test(column.dataType)
  ) {
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text))
      throw Error("Enter a number.");
    return text;
  }
  return text;
}
export function stageCell(
  edits: Record<number, RowEdit>,
  row: number,
  column: string,
  value: Cell,
  original: Cell[],
  index: number,
) {
  const next = { ...edits },
    changes = { ...next[row]?.changes, [column]: value };
  if (value === original[index]) delete changes[column];
  if (Object.keys(changes).length) next[row] = { original, changes };
  else delete next[row];
  return next;
}
