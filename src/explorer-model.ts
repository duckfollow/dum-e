import { quoteIdentifier, type Driver, type Table } from "./model.ts";
export type ExplorerTarget = { schema: string; table?: Table };
export function objectName(target: ExplorerTarget) {
  return target.table ? `${target.schema}.${target.table.name}` : target.schema;
}
export function objectKind(target: ExplorerTarget, driver: Driver) {
  if (!target.table) return "SCHEMA";
  const kind = target.table.kind.toLowerCase();
  if (driver === "postgres" && kind === "materialized view")
    return "MATERIALIZED VIEW";
  if (driver === "postgres" && kind === "foreign table") return "FOREIGN TABLE";
  return kind.includes("view") ? "VIEW" : "TABLE";
}
export function mutationSql(
  target: ExplorerTarget,
  driver: Driver,
  action: "rename" | "drop",
  name = "",
) {
  if (!target.table && driver === "sqlite")
    throw Error(
      "SQLite does not support renaming or dropping the main schema.",
    );
  const kind = objectKind(target, driver);
  if (action === "rename" && driver === "sqlite" && kind === "VIEW")
    throw Error("SQLite views cannot be renamed with ALTER VIEW.");
  const identifier = target.table
    ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table.name)}`
    : quoteIdentifier(target.schema);
  if (action === "drop")
    return `DROP ${kind} ${identifier}${driver === "postgres" ? " RESTRICT" : ""};`;
  if (!name.trim() || name.includes("\0"))
    throw Error("Enter a non-empty name without null characters.");
  if (driver === "postgres" && new TextEncoder().encode(name).length > 63)
    throw Error("PostgreSQL names must fit within 63 UTF-8 bytes.");
  return `ALTER ${kind} ${identifier} RENAME TO ${quoteIdentifier(name)};`;
}
