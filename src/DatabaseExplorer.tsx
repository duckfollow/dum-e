import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Database,
  Table2,
  MoreHorizontal,
  X,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { api } from "./api";
import { tableSql, quoteIdentifier, type Connected, type Table } from "./model";
import type { TableDetails, TableView } from "./table-model";
import { mutationSql, objectName, type ExplorerTarget } from "./explorer-model";
import "./explorer-menu.css";
type Mutation = {
  target: ExplorerTarget;
  action: "rename" | "drop";
  name: string;
};
export function DatabaseExplorer({
  connection,
  tables,
  search,
  active,
  busy,
  onOpen,
  onOverview,
  onSql,
  onRefresh,
  onMutate,
  onNotice,
}: {
  connection: Connected;
  tables: Table[];
  search: string;
  active?: Table;
  busy: boolean;
  onOpen: (table: Table, view: TableView) => void;
  onOverview: (schema?: string) => void;
  onSql: (sql: string, title: string) => void;
  onRefresh: () => void;
  onMutate: (
    sql: string,
    target: ExplorerTarget,
    newName?: string,
  ) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [menu, setMenu] = useState<{
      target: ExplorerTarget;
      x: number;
      y: number;
    } | null>(null),
    [mutation, setMutation] = useState<Mutation | null>(null),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [details, setDetails] = useState<TableDetails | null>(null),
    [inspecting, setInspecting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    dialogRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLElement | null>(null);
  const driver = connection.profile.driver;
  const closeMenu = () => {
    setMenu(null);
    triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    setMenu(null);
  }, [busy]);
  useEffect(() => {
    if (!mutation) return;
    const old = document.activeElement as HTMLElement;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) {
        setMutation(null);
        old?.focus();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ) || [],
        );
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [!!mutation, working]);
  useEffect(() => {
    setDetails(null);
    setError("");
    if (!mutation?.target.table) return;
    let disposed = false;
    setInspecting(true);
    void api<TableDetails>("table_details", {
      id: connection.profile.id,
      table: mutation.target.table,
    })
      .then((d) => {
        if (!disposed) setDetails(d);
      })
      .catch((e) => {
        if (!disposed) setError(`Could not inspect dependencies: ${String(e)}`);
      })
      .finally(() => {
        if (!disposed) setInspecting(false);
      });
    return () => {
      disposed = true;
    };
  }, [mutation?.target.table, mutation?.action, connection.profile.id]);
  function show(
    target: ExplorerTarget,
    x: number,
    y: number,
    trigger: HTMLElement,
  ) {
    if (busy || working) return;
    triggerRef.current = trigger;
    setMenu({
      target,
      x: Math.max(8, Math.min(x, window.innerWidth - 252)),
      y: Math.max(8, Math.min(y, window.innerHeight - 400)),
    });
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`${label} copied`);
    } catch (e) {
      onNotice(`Could not copy: ${String(e)}`);
    }
  }
  function newTable(target: ExplorerTarget) {
    onSql(
      `CREATE TABLE ${quoteIdentifier(target.schema)}."new_table" (\n    id ${driver === "postgres" ? "BIGINT GENERATED ALWAYS AS IDENTITY" : "INTEGER"} PRIMARY KEY,\n    name TEXT NOT NULL\n);`,
      "New table",
    );
  }
  async function choose(action: string) {
    if (!menu) return;
    const target = menu.target;
    closeMenu();
    if (
      ["data", "structure", "relations", "indexes", "sql"].includes(action) &&
      target.table
    ) {
      onOpen(target.table, action as TableView);
      return;
    }
    if (action === "name") {
      await copy(
        target.table
          ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table.name)}`
          : quoteIdentifier(target.schema),
        "Qualified name",
      );
      return;
    }
    if (action === "select" && target.table) {
      await copy(tableSql(target.table), "SELECT SQL");
      return;
    }
    if (action === "definition" && target.table) {
      try {
        const d = await api<TableDetails>("table_details", {
          id: connection.profile.id,
          table: target.table,
        });
        if (!d.definition)
          throw Error("No definition is available for this object.");
        await copy(
          d.definition,
          driver === "sqlite" ? "Stored SQL" : "Definition preview",
        );
      } catch (e) {
        onNotice(String(e));
      }
      return;
    }
    if (action === "overview") {
      onOverview(target.schema);
      return;
    }
    if (action === "new") {
      newTable(target);
      return;
    }
    if (action === "editor") {
      onSql(
        "-- Use fully qualified object names in this tab.\n\nSELECT 1;",
        "SQL · " + target.schema,
      );
      return;
    }
    if (action === "refresh") {
      onRefresh();
      return;
    }
    setError("");
    setConfirm("");
    setMutation({
      target,
      action: action as "rename" | "drop",
      name: target.table?.name || target.schema,
    });
  }
  const incoming =
    details?.relations.filter(
      (r) =>
        r.toTable.schema === mutation?.target.schema &&
        r.toTable.name === mutation?.target.table?.name &&
        (r.fromTable.schema !== r.toTable.schema ||
          r.fromTable.name !== r.toTable.name),
    ) || [];
  const sqliteBlocked =
    driver === "sqlite" && mutation?.action === "drop" && incoming.length > 0;
  let sql = "",
    validation = "";
  if (mutation) {
    try {
      sql = mutationSql(
        mutation.target,
        driver,
        mutation.action,
        mutation.name,
      );
    } catch (e) {
      validation = String(e);
    }
  }
  async function apply() {
    if (!mutation || !sql || working || busy || inspecting || sqliteBlocked)
      return;
    if (mutation.action === "drop" && confirm !== objectName(mutation.target))
      return;
    setWorking(true);
    setError("");
    try {
      await onMutate(
        sql,
        mutation.target,
        mutation.action === "rename" ? mutation.name : undefined,
      );
      setMutation(null);
      triggerRef.current?.focus();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <div className="object-tree">
        {[
          ...new Set([
            ...(connection.schemas || []),
            ...tables.map((t) => t.schema),
          ]),
        ]
          .filter(
            (schema) =>
              !search ||
              schema.toLowerCase().includes(search.toLowerCase()) ||
              tables.some((t) => t.schema === schema),
          )
          .sort()
          .map((schema) => (
            <section key={schema}>
              <div
                className="schema-name explorer-row"
                onContextMenu={(e) => {
                  e.preventDefault();
                  show({ schema }, e.clientX, e.clientY, e.currentTarget);
                }}
              >
                <ChevronDown size={13} />
                <Database size={14} />
                {schema}
                <span>{tables.filter((t) => t.schema === schema).length}</span>
                <button
                  className="explorer-more"
                  aria-disabled={busy}
                  aria-label={`Manage schema ${schema}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    show({ schema }, rect.right, rect.bottom, e.currentTarget);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
              {tables
                .filter((t) => t.schema === schema)
                .map((table) => (
                  <div
                    key={JSON.stringify([schema, table.name])}
                    className="explorer-row"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      show(
                        { schema, table },
                        e.clientX,
                        e.clientY,
                        e.currentTarget.querySelector("button")!,
                      );
                    }}
                  >
                    <button
                      className={`table-item ${active?.name === table.name && active?.schema === schema ? "active" : ""}`}
                      onClick={() => onOpen(table, "data")}
                    >
                      <Table2 size={14} />
                      <span>{table.name}</span>
                      {table.kind.toLowerCase().includes("view") && (
                        <small>view</small>
                      )}
                    </button>
                    <button
                      className="explorer-more"
                      aria-disabled={busy}
                      aria-label={`Manage ${schema}.${table.name}`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        show(
                          { schema, table },
                          rect.right,
                          rect.bottom,
                          e.currentTarget,
                        );
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                ))}
            </section>
          ))}
        {!tables.length && <p className="sidebar-empty">No matching tables.</p>}
      </div>
      {menu && (
        <div
          className="explorer-menu"
          ref={menuRef}
          role="menu"
          aria-label={`Manage ${objectName(menu.target)}`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const items = Array.from(
                menuRef.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const i = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              items[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
                      items.length
              ]?.focus();
            }
          }}
        >
          <small>{objectName(menu.target)}</small>
          {(menu.target.table
            ? [
                ["data", "Open data"],
                ["structure", "Open structure"],
                ["relations", "Open relations"],
                ["indexes", "Open indexes"],
                ["sql", "View SQL definition"],
                ["name", "Copy qualified name"],
                ["select", "Copy SELECT"],
                ["definition", "Copy SQL definition"],
              ]
            : [
                ["overview", "Schema relations overview"],
                ["new", "New table…"],
                ["editor", "Open SQL editor"],
                ["name", "Copy schema name"],
              ]
          ).map(([id, label]) => (
            <button key={id} role="menuitem" onClick={() => void choose(id)}>
              {label}
            </button>
          ))}
          <button role="menuitem" onClick={() => void choose("refresh")}>
            Refresh
          </button>
          <hr />
          <button
            role="menuitem"
            disabled={
              driver === "sqlite" &&
              (!menu.target.table ||
                menu.target.table.kind.toLowerCase().includes("view"))
            }
            title="SQLite supports renaming tables, but not schemas or views."
            onClick={() => void choose("rename")}
          >
            Rename…
          </button>
          <button
            role="menuitem"
            className="danger"
            disabled={driver === "sqlite" && !menu.target.table}
            onClick={() => void choose("drop")}
          >
            Drop {menu.target.table ? "object" : "schema"}…
          </button>
        </div>
      )}
      {mutation && (
        <div className="explorer-dialog-backdrop">
          <div
            className="explorer-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="explorer-dialog-title"
          >
            <header>
              <h2 id="explorer-dialog-title">
                {mutation.action === "rename" ? "Rename" : "Drop"}{" "}
                {objectName(mutation.target)}
              </h2>
              <button
                disabled={working}
                aria-label="Close object dialog"
                onClick={() => setMutation(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              {mutation.action === "drop"
                ? "This permanently removes the object and its data."
                : "The name changes directly in the database."}{" "}
              Runs with your database permissions.
            </p>
            {mutation.action === "rename" ? (
              <label>
                New name
                <input
                  value={mutation.name}
                  disabled={working}
                  onChange={(e) =>
                    setMutation({ ...mutation, name: e.target.value })
                  }
                />
              </label>
            ) : (
              <label>
                Type <b>{objectName(mutation.target)}</b> to confirm
                <input
                  value={confirm}
                  disabled={working}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            {inspecting && (
              <p>
                <LoaderCircle className="spin" size={14} /> Checking declared
                foreign keys…
              </p>
            )}
            {incoming.length > 0 && (
              <div className="dependency-note">
                <b>Referenced by {incoming.length} foreign key(s)</b>
                {incoming.map((r) => (
                  <div key={r.id}>
                    {r.fromTable.schema}.{r.fromTable.name}
                  </div>
                ))}
                <p>
                  {mutation.action === "rename"
                    ? "Review references before renaming. Database dependency rules still apply."
                    : sqliteBlocked
                      ? "SQLite DROP can trigger cascading data changes. Use a SQL tab to review and handle dependencies explicitly."
                      : "PostgreSQL DROP uses RESTRICT; dependencies will block deletion. CASCADE is never added automatically."}
                </p>
              </div>
            )}
            {!mutation.target.table && mutation.action === "drop" && (
              <p>
                The schema must be empty. Dependent objects are protected by
                RESTRICT.
              </p>
            )}
            <pre>{sql || validation}</pre>
            {error && (
              <div role="alert" className="object-error">
                <AlertCircle size={16} />
                <pre>{error}</pre>
              </div>
            )}
            <footer>
              <button
                className="secondary"
                disabled={working}
                onClick={() => setMutation(null)}
              >
                Cancel
              </button>
              <button
                className={
                  mutation.action === "drop" ? "object-drop" : "primary"
                }
                disabled={
                  working ||
                  busy ||
                  inspecting ||
                  !!validation ||
                  sqliteBlocked ||
                  !!(mutation.target.table && !details) ||
                  (mutation.action === "rename" &&
                    mutation.name ===
                      (mutation.target.table?.name ||
                        mutation.target.schema)) ||
                  (mutation.action === "drop" &&
                    confirm !== objectName(mutation.target))
                }
                onClick={() => void apply()}
              >
                {working
                  ? "Applying…"
                  : mutation.action === "rename"
                    ? "Rename"
                    : "Drop"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
