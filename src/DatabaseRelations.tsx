import { useEffect, useMemo, useState, useId } from "react";
import {
  GitFork,
  RefreshCw,
  LoaderCircle,
  AlertCircle,
  Search,
  ArrowUpRight,
  ArrowRight,
  Database,
  KeyRound,
  Table2,
} from "lucide-react";
import { api } from "./api";
import type { Table } from "./model";
import { pairsLabel, qualified, tableKey } from "./table-model";
import { RelationGraph } from "./TableWorkbench";
import {
  filterOverview,
  overviewGraph,
  type DatabaseRelationsData,
} from "./database-relations-model";
import "./database-relations.css";
export function DatabaseRelations({
  connectionId,
  connected,
  catalogRevision,
  scope = "",
  onOpen,
}: {
  connectionId: string;
  connected: boolean;
  catalogRevision: number;
  scope?: string;
  onOpen: (t: Table) => void;
}) {
  const panelId = useId();
  const [display, setDisplay] = useState<"diagram" | "keys" | "objects">(
    "diagram",
  );
  const [data, setData] = useState<DatabaseRelationsData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [schema, setSchema] = useState(scope),
    [search, setSearch] = useState(""),
    [onlyConnected, setOnlyConnected] = useState(false),
    [page, setPage] = useState(0),
    [objectPage, setObjectPage] = useState(0);
  useEffect(() => {
    setSchema(scope);
  }, [scope]);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    if (!connected) {
      setData(null);
      setLoading(false);
      setError("Reconnect to this database to view its relationships.");
      return;
    }
    void api<DatabaseRelationsData>("database_relations", { id: connectionId })
      .then((value) => {
        if (!disposed) {
          setData((previous) =>
            JSON.stringify(previous) === JSON.stringify(value)
              ? previous
              : value,
          );
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [connectionId, connected, catalogRevision, revision]);
  useEffect(() => {
    setPage(0);
    setObjectPage(0);
  }, [schema, search, onlyConnected, data]);
  const filtered = useMemo(
    () =>
      filterOverview(
        data || { tables: [], relations: [], notes: [] },
        schema,
        search,
        onlyConnected,
      ),
    [data, schema, search, onlyConnected],
  );
  const graph = useMemo(
    () => overviewGraph(filtered.tables, filtered.relations),
    [filtered],
  );
  const visible = new Map(data?.tables.map((t) => [tableKey(t), t]));
  const open = (t: Table) => {
    const actual = visible.get(tableKey(t));
    if (actual) onOpen(actual);
  };
  const link = (t: Table) => (
    <button
      className="text-button"
      disabled={!visible.has(tableKey(t))}
      onClick={() => open(t)}
    >
      {qualified(t)}
      <ArrowUpRight size={12} />
    </button>
  );
  return (
    <section
      className="database-relations"
      aria-label="Database relations overview"
    >
      <header>
        <div className="overview-title">
          <span className="overview-title-icon">
            <GitFork size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Database Relations</h1>
            {data && (
              <div className="overview-stats">
                <span>
                  <Table2 size={13} aria-hidden="true" /> {data.tables.length}{" "}
                  objects
                </span>
                <span>
                  <KeyRound size={13} aria-hidden="true" />{" "}
                  {data.relations.length} foreign keys
                </span>
                <span>
                  <Database size={13} aria-hidden="true" />{" "}
                  {new Set(data.tables.map((t) => t.schema)).size} schemas
                </span>
              </div>
            )}
          </div>
        </div>
        <button
          className="secondary"
          disabled={loading || !connected}
          aria-busy={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />{" "}
          Refresh relations
        </button>
      </header>
      {loading && !data ? (
        <div className="result-empty">
          <LoaderCircle className="spin" size={28} />
          <h3>Reading database relationships…</h3>
        </div>
      ) : error && !data ? (
        <div className="query-error" role="alert">
          <AlertCircle size={24} />
          <h3>Could not load relationships.</h3>
          <pre>{error}</pre>
          <button
            className="secondary"
            onClick={() => setRevision((r) => r + 1)}
            disabled={!connected}
          >
            Try again
          </button>
        </div>
      ) : (
        data && (
          <>
            {error && (
              <p className="overview-note" role="alert">
                Refresh failed. Showing the previous relationships. {error}
              </p>
            )}
            <div className="overview-filters">
              <label>
                Schema
                <select
                  aria-label="Relation schema filter"
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                >
                  <option value="">All schemas</option>
                  {[
                    ...new Set([
                      ...data.tables.map((t) => t.schema),
                      ...(scope ? [scope] : []),
                    ]),
                  ]
                    .sort()
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </label>
              <label>
                <Search size={14} />
                <input
                  aria-label="Find table in relations"
                  value={search}
                  placeholder="Find a table or schema…"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={onlyConnected}
                  onChange={(e) => setOnlyConnected(e.target.checked)}
                />{" "}
                Connected only
              </label>
              <button
                disabled={!schema && !search && !onlyConnected}
                className="text-button"
                onClick={() => {
                  setSearch("");
                  setSchema("");
                  setOnlyConnected(false);
                }}
              >
                Clear filters
              </button>
            </div>
            <nav className="overview-navigation" aria-label="Overview views">
              <div
                role="tablist"
                aria-label="Database relation views"
                onKeyDown={(e) => {
                  const choices = ["diagram", "keys", "objects"] as const;
                  let index = choices.indexOf(display);
                  if (e.key === "ArrowRight") index = (index + 1) % 3;
                  else if (e.key === "ArrowLeft") index = (index + 2) % 3;
                  else if (e.key === "Home") index = 0;
                  else if (e.key === "End") index = 2;
                  else return;
                  e.preventDefault();
                  setDisplay(choices[index]);
                  document
                    .getElementById(`${panelId}-${choices[index]}`)
                    ?.focus();
                }}
              >
                {(
                  [
                    ["diagram", "Diagram", graph.nodes.length, GitFork],
                    [
                      "keys",
                      "Foreign keys",
                      filtered.relations.length,
                      KeyRound,
                    ],
                    ["objects", "Objects", filtered.tables.length, Table2],
                  ] as const
                ).map(([id, label, count, Icon]) => (
                  <button
                    key={id}
                    id={`${panelId}-${id}`}
                    role="tab"
                    aria-selected={display === id}
                    tabIndex={display === id ? 0 : -1}
                    aria-controls={`${panelId}-panel`}
                    onClick={() => setDisplay(id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                    <small>{count}</small>
                  </button>
                ))}
              </div>
              {display === "diagram" && (
                <span className="overview-legend">
                  <ArrowRight size={14} aria-hidden="true" /> References
                </span>
              )}
            </nav>
            {(schema || search) && (
              <p className="overview-note">
                Matching objects include their direct neighbors, even in other
                schemas. Arrows retain the original FK direction.
              </p>
            )}
            <div
              className="overview-panel"
              role="tabpanel"
              id={`${panelId}-panel`}
              aria-labelledby={`${panelId}-${display}`}
            >
              {display === "diagram" &&
                (graph.nodes.length ? (
                  <RelationGraph
                    table={graph.nodes[0].table}
                    relations={filtered.relations}
                    graph={graph}
                    onOpen={open}
                    canOpen={(t) => visible.has(tableKey(t))}
                  />
                ) : (
                  <div className="result-empty">
                    <GitFork size={26} />
                    <h3>No matching objects.</h3>
                    <p>Try clearing the filters.</p>
                  </div>
                ))}
              {display === "keys" && (
                <section className="overview-list">
                  <h2>Foreign keys · {filtered.relations.length}</h2>
                  <div className="overview-table">
                    <table>
                      <thead>
                        <tr>
                          <th>From</th>
                          <th>References</th>
                          <th>Columns</th>
                          <th>On delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.relations
                          .slice(page * 100, (page + 1) * 100)
                          .map((r) => (
                            <tr key={r.id}>
                              <td>
                                {link(r.fromTable)}
                                <small>
                                  {r.name || "Declared foreign key"}
                                </small>
                              </td>
                              <td>{link(r.toTable)}</td>
                              <td>{pairsLabel(r)}</td>
                              <td>{r.onDelete}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!filtered.relations.length && (
                    <p>
                      No declared foreign keys in this view. Isolated tables and
                      views can still appear in the graph.
                    </p>
                  )}
                  <div className="overview-pages">
                    <button
                      className="secondary"
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page + 1} · {filtered.relations.length} links
                    </span>
                    <button
                      className="secondary"
                      disabled={(page + 1) * 100 >= filtered.relations.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
              )}
              {display === "objects" && (
                <section className="overview-list">
                  <h2>Objects · {filtered.tables.length}</h2>
                  <div className="overview-objects">
                    {filtered.tables
                      .slice(objectPage * 100, (objectPage + 1) * 100)
                      .map((t) => (
                        <div key={tableKey(t)}>
                          {link(t)}
                          <small>{t.kind}</small>
                        </div>
                      ))}
                  </div>
                  <div className="overview-pages">
                    <button
                      className="secondary"
                      disabled={!objectPage}
                      onClick={() => setObjectPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {objectPage + 1}</span>
                    <button
                      className="secondary"
                      disabled={
                        (objectPage + 1) * 100 >= filtered.tables.length
                      }
                      onClick={() => setObjectPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
              )}
            </div>
            <details className="overview-help">
              <summary>About relationships</summary>
              {data.notes.map((note) => (
                <p key={note} className="overview-note">
                  {note}
                </p>
              ))}
            </details>
          </>
        )
      )}
    </section>
  );
}
