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
  previewCast?: boolean;
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
  refreshSql?: string;
  editSource?: {
    table: Table;
    keys: [string, number][];
    columns: (string | null)[];
  };
}
export interface Connected {
  profile: Profile;
  tables: Table[];
  schemas?: string[];
}
export interface PreviewOptions {
  rowKeys?: { column: string; value: string }[][];
  filter?: {
    column: string;
    operator: "equals" | "is-null" | "not-null";
    value: string;
  };
  sort?: { column: string; direction: "ASC" | "DESC"; tieBreakers: string[] };
}
export interface QueryTab {
  savedScriptId?: string;
  id: string;
  profileId: string;
  title: string;
  sql: string;
  table?: Table;
  tableView?: TableView;
  previewOptions?: PreviewOptions;
  overview?: boolean;
  overviewSchema?: string;
  page: number;
  result?: QueryResult;
  execution?: ExecutionResult;
  refreshError?: string;
  error?: string;
}
export const PAGE_SIZE = 200;
export const quoteIdentifier = (s: string) => `"${s.replaceAll('"', '""')}"`;
export function tableSql(
  table: Table,
  page = 0,
  options?: PreviewOptions,
  driver: Driver = "sqlite",
) {
  const lines = [
    "SELECT *",
    `FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`,
  ];
  const literal = (value: string) => {
    if (value.includes("\0"))
      throw Error("Filter values cannot contain a NUL character.");
    if (driver !== "postgres") return `'${value.replaceAll("'", "''")}'`;
    let delimiter = "$dum_e$";
    while (value.includes(delimiter))
      delimiter = delimiter.replace("$d", "$dd");
    return `${delimiter}${value}${delimiter}`;
  };
  const predicates: string[] = [];
  if (options?.rowKeys?.length) {
    const matches = options.rowKeys.map(
      (key) =>
        `(${key.map(({ column, value }) => `${quoteIdentifier(column)} = ${literal(value)}`).join(" AND ")})`,
    );
    predicates.push(`(${matches.join(" OR ")})`);
  }
  const filter = options?.filter;
  if (filter) {
    const column = quoteIdentifier(filter.column);
    if (filter.operator === "equals") {
      predicates.push(`${column} = ${literal(filter.value)}`);
    } else {
      predicates.push(
        `${column} IS ${filter.operator === "not-null" ? "NOT " : ""}NULL`,
      );
    }
  }
  if (predicates.length) lines.push(`WHERE ${predicates.join(" AND ")}`);
  const sort = options?.sort;
  if (sort) {
    const direction = sort.direction === "DESC" ? "DESC" : "ASC";
    const orderColumn = (name: string) =>
      driver === "postgres"
        ? `${quoteIdentifier(table.name)}.${quoteIdentifier(name)}`
        : quoteIdentifier(name);
    const order = [
      `${orderColumn(sort.column)} ${direction}`,
      ...sort.tieBreakers
        .filter((name) => name !== sort.column)
        .map(orderColumn),
    ];
    lines.push(`ORDER BY ${order.join(", ")}`);
  }
  lines.push(`LIMIT ${PAGE_SIZE + 1} OFFSET ${Math.max(0, page) * PAGE_SIZE};`);
  return lines.join("\n");
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
