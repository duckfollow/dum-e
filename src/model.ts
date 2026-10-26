import type { TableView } from "./table-model";
export type Driver = "sqlite" | "postgres";
export interface Profile {
  id: string;
  name: string;
  driver: Driver;
  host: string;
  port: number;
  database: string;
  username: string;
  path: string;
  tls: boolean;
  rememberPassword: boolean;
}
export interface Table {
  schema: string;
  name: string;
  kind: string;
}
export interface Field {
  name: string;
  dataType: string;
}
export type Cell =
  null | string | number | boolean | Record<string, unknown> | unknown[];
export interface QueryResult {
  columns: Field[];
  rows: Cell[][];
  elapsedMs: number;
  truncated: boolean;
  affectedRows?: number;
  jsonRaw?: Record<number, Record<number, string>>;
}
export interface ExecutionResult {
  results: QueryResult[];
  error?: string;
  elapsedMs: number;
  omittedResults: number;
}
export interface Connected {
  profile: Profile;
  tables: Table[];
  schemas?: string[];
}
export interface QueryTab {
  savedScriptId?: string;
  id: string;
  profileId: string;
  title: string;
  sql: string;
  table?: Table;
  tableView?: TableView;
  overview?: boolean;
  overviewSchema?: string;
  page: number;
  result?: QueryResult;
  execution?: ExecutionResult;
  error?: string;
}
export const PAGE_SIZE = 200;
export const quoteIdentifier = (s: string) => `"${s.replaceAll('"', '""')}"`;
export function tableSql(table: Table, page = 0) {
  return `SELECT *\nFROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}\nLIMIT ${PAGE_SIZE + 1} OFFSET ${Math.max(0, page) * PAGE_SIZE};`;
}
export function cellText(value: Cell): string {
  return value === null
    ? "NULL"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
export function filteredRows(
  result: QueryResult,
  term: string,
  sort: { index: number; asc: boolean } | null,
): Array<{ values: Cell[]; index: number }> {
  const needle = term.toLocaleLowerCase();
  const rows = result.rows
    .map((values, index) => ({ values, index }))
    .filter(
      ({ values }) =>
        !needle ||
        values.some((v) => cellText(v).toLocaleLowerCase().includes(needle)),
    );
  if (sort)
    rows.sort((a, b) => {
      const x = a.values[sort.index],
        y = b.values[sort.index];
      let cmp = 0;
      if (x === null || y === null) cmp = x === y ? 0 : x === null ? 1 : -1;
      else if (/^-?\d+$/.test(String(x)) && /^-?\d+$/.test(String(y))) {
        const l = BigInt(String(x)),
          r = BigInt(String(y));
        cmp = l === r ? 0 : l < r ? -1 : 1;
      } else if (typeof x === "number" && typeof y === "number") cmp = x - y;
      else
        cmp = cellText(x).localeCompare(cellText(y), undefined, {
          numeric: true,
        });
      return sort.asc ? cmp : -cmp;
    });
  return rows;
}
export function exportCsv(result: QueryResult): string {
  const escape = (v: Cell) => {
    let text = v === null ? "" : cellText(v);
    if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [
    result.columns.map((c) => escape(c.name)).join(","),
    ...result.rows.map((row) => row.map(escape).join(",")),
  ].join("\r\n");
}
export function exportJson(result: QueryResult): string {
  return JSON.stringify(
    { columns: result.columns, rows: result.rows },
    null,
    2,
  );
}
export function newProfile(driver: Driver = "postgres"): Profile {
  return {
    id: crypto.randomUUID(),
    name: "",
    driver,
    host: "localhost",
    port: 5432,
    database: "postgres",
    username: "postgres",
    path: "",
    tls: true,
    rememberPassword: false,
  };
}
