import { useEffect, useId, useRef, useState } from "react";
import {
  Table2,
  Columns3,
  Layers3,
  GitFork,
  FileCode2,
  RefreshCw,
  LoaderCircle,
  AlertCircle,
  KeyRound,
  ArrowUpRight,
  ArrowRight,
  Copy,
  GripHorizontal,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import type { Table } from "./model";
import {
  focusGraph,
  pairsLabel,
  qualified,
  sameTable,
  tableKey,
  type GraphNode,
  type FocusGraph,
  type TableDetails,
  type TableView,
  type Relation,
} from "./table-model";
import "./table-workbench.css";
const views = [
  { id: "data", name: "Data", Icon: Table2 },
  { id: "structure", name: "Structure", Icon: Columns3 },
  { id: "indexes", name: "Indexes", Icon: Layers3 },
  { id: "relations", name: "Relations", Icon: GitFork },
  { id: "sql", name: "SQL", Icon: FileCode2 },
] as const;
export function TableWorkbench({
  connectionId,
  table,
  connected,
  visibleTables,
  view,
  onView,
  onOpen,
}: {
  connectionId: string;
  table: Table;
  connected: boolean;
  visibleTables: Table[];
  view: TableView;
  onView: (view: TableView) => void;
  onOpen: (table: Table) => void;
}) {
  const [details, setDetails] = useState<TableDetails | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const sequence = useRef(0);
  const sectionId = useId();
  useEffect(() => {
    let disposed = false;
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    setDetails(null);
    if (!connected) {
      setLoading(false);
      setError("Reconnect to this database to inspect its structure.");
      return;
    }
    void api<TableDetails>("table_details", { id: connectionId, table })
      .then((value) => {
        if (!disposed && sequence.current === request) setDetails(value);
      })
      .catch((error) => {
        if (!disposed && sequence.current === request) setError(String(error));
      })
      .finally(() => {
        if (!disposed && sequence.current === request) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [connectionId, table.schema, table.name, connected, revision]);
  const open = (target: Table) => {
    const visible = visibleTables.find((t) => sameTable(t, target));
    if (visible) onOpen(visible);
  };
  const canOpen = (target: Table) =>
    visibleTables.some((t) => sameTable(t, target));
  return (
    <>
      <nav className="table-views" aria-label="Table views">
        <div role="tablist" aria-label={`${qualified(table)} views`}>
          {views.map(({ id, name, Icon }) => (
            <button
              key={id}
              role="tab"
              id={`${sectionId}-${id}`}
              aria-controls={id === "data" ? undefined : `${sectionId}-panel`}
              aria-selected={view === id}
              className={view === id ? "active" : ""}
              onClick={() => onView(id)}
            >
              <Icon size={14} />
              {name}
              {id === "structure" && details && (
                <small>{details.columns.length}</small>
              )}
              {id === "relations" && details && (
                <small>{details.relations.length}</small>
              )}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="Refresh table details"
          title="Refresh structure and relationships"
          disabled={loading || !connected}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </nav>
      {view !== "data" && (
        <section
          className="table-details"
          id={`${sectionId}-panel`}
          role="tabpanel"
          aria-labelledby={`${sectionId}-${view}`}
        >
          {loading ? (
            <div className="result-empty">
              <LoaderCircle size={26} className="spin" />
              <h3>Reading your table’s structure…</h3>
              <p>Only database metadata is being inspected.</p>
            </div>
          ) : error ? (
            <div className="query-error" role="alert">
              <AlertCircle size={24} />
              <h3>Couldn’t read this table.</h3>
              <pre>{error}</pre>
              <button
                className="secondary"
                disabled={!connected}
                onClick={() => setRevision((v) => v + 1)}
              >
                Try again
              </button>
            </div>
          ) : (
            details && (
              <>
                <header className="table-details-heading">
                  <div>
                    <span className="eyebrow">
                      {details.table.kind.toUpperCase()} /{" "}
                      {details.table.schema}
                    </span>
                    <h2>{details.table.name}</h2>
                    {details.comment && <p>{details.comment}</p>}
                  </div>
                  <span className="metadata-readonly">
                    <ShieldCheck size={13} /> Metadata only
                  </span>
                </header>
                {view === "structure" && (
                  <>
                    <div className="table-facts">
                      <span>
                        <Columns3 size={13} />
                        {details.columns.length} columns
                      </span>
                      <span>
                        <KeyRound size={13} />
                        {
                          details.columns.filter(
                            (c) => c.primaryKeyPosition > 0,
                          ).length
                        }{" "}
                        PK columns
                      </span>
                      <span>
                        <Layers3 size={13} />
                        {details.indexes.length} indexes
                      </span>
                      {details.strict !== null && (
                        <span>
                          STRICT <b>{details.strict ? "On" : "Off"}</b>
                        </span>
                      )}
                      {details.withoutRowid !== null && (
                        <span>
                          {details.withoutRowid
                            ? "WITHOUT ROWID"
                            : details.rowidAlias
                              ? `rowid alias: ${details.rowidAlias}`
                              : "rowid table"}
                        </span>
                      )}
                    </div>
                    <div className="metadata-table-wrap">
                      <table className="metadata-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Column</th>
                            <th>Type</th>
                            <th>NULL</th>
                            <th>Default / generation</th>
                            <th>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.columns.map((column) => (
                            <tr key={column.ordinal}>
                              <td className="muted">{column.ordinal}</td>
                              <td>
                                <code>{column.name}</code>
                                {details.relations.some(
                                  (r) =>
                                    sameTable(r.fromTable, details.table) &&
                                    r.columns.some(
                                      (p) => p.from === column.name,
                                    ),
                                ) && <span className="meta-chip">FK</span>}
                                {column.primaryKeyPosition > 0 && (
                                  <span className="meta-chip pk">
                                    <KeyRound size={10} />
                                    PK {column.primaryKeyPosition}
                                  </span>
                                )}
                              </td>
                              <td>
                                <code>
                                  {column.dataType || "(no declared type)"}
                                </code>
                                {column.typeDetail && (
                                  <small>{column.typeDetail}</small>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`meta-chip ${column.nullable ? "" : "required"}`}
                                >
                                  {column.nullable ? "Allowed" : "NOT NULL"}
                                </span>
                              </td>
                              <td>
                                <code className="metadata-expression">
                                  {column.identity
                                    ? `GENERATED ${column.identity} AS IDENTITY`
                                    : (column.defaultValue ?? "—")}
                                </code>
                                {column.generated && (
                                  <small>Generated: {column.generated}</small>
                                )}
                              </td>
                              <td>
                                {column.enumValues.length > 0 && (
                                  <details>
                                    <summary>
                                      {column.enumValues.length} enum values
                                    </summary>
                                    <code>{column.enumValues.join(" · ")}</code>
                                  </details>
                                )}
                                {column.comment && (
                                  <span>{column.comment}</span>
                                )}
                                {!column.enumValues.length &&
                                  !column.comment && (
                                    <span className="muted">—</span>
                                  )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <section className="metadata-section">
                      <div className="metadata-section-title">
                        <h3>Constraints</h3>
                        <span>{details.constraints.length}</span>
                      </div>
                      {details.constraints.length ? (
                        <div className="constraint-list">
                          {details.constraints.map((constraint, i) => (
                            <article key={i}>
                              <div>
                                <span className="meta-chip">
                                  {constraint.kind}
                                </span>
                                <b>{constraint.name || "Name not exposed"}</b>
                              </div>
                              <code>{constraint.definition}</code>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="metadata-empty">
                          No constraints are exposed for this object.
                        </p>
                      )}
                    </section>
                    <div className="metadata-notes">
                      {details.notes.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  </>
                )}
                {view === "indexes" && (
                  <section className="metadata-section index-section">
                    <div className="metadata-section-title">
                      <h3>Indexes</h3>
                      <span>{details.indexes.length}</span>
                    </div>
                    {details.indexes.length ? (
                      details.indexes.map((index) => (
                        <article className="index-card" key={index.name}>
                          <header>
                            <div>
                              <Layers3 size={16} />
                              <code>{index.name}</code>
                            </div>
                            <div>
                              {index.primary && (
                                <span className="meta-chip pk">PRIMARY</span>
                              )}
                              {index.unique && (
                                <span className="meta-chip">UNIQUE</span>
                              )}
                              {index.partial && (
                                <span className="meta-chip">PARTIAL</span>
                              )}
                              {index.valid === false && (
                                <span className="meta-chip warning">
                                  INVALID
                                </span>
                              )}
                              <span className="meta-chip">{index.method}</span>
                            </div>
                          </header>
                          <ol className="index-parts">
                            {index.parts.map((part, i) => (
                              <li key={i}>
                                <span>{i + 1}</span>
                                <code>{part.expression}</code>
                                <small>
                                  {part.role}
                                  {part.descending === true
                                    ? " · DESC"
                                    : part.descending === false
                                      ? " · ASC"
                                      : ""}
                                </small>
                              </li>
                            ))}
                          </ol>
                          {index.predicate && (
                            <p className="index-predicate">
                              <b>WHERE</b> <code>{index.predicate}</code>
                            </p>
                          )}
                          {index.partial && !index.predicate && (
                            <p className="metadata-hint">
                              Partial index. Inspect the stored SQL for its
                              exact WHERE clause.
                            </p>
                          )}
                          {index.definition ? (
                            <details className="index-definition">
                              <summary>SQL definition</summary>
                              <pre>{index.definition}</pre>
                            </details>
                          ) : (
                            <p className="metadata-hint">
                              SQLite maintains this index for a table
                              constraint; no separate CREATE INDEX statement is
                              stored.
                            </p>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="metadata-empty">
                        No indexes are declared for this object. SQLite INTEGER
                        PRIMARY KEY rowid aliases do not require a separate PK
                        index.
                      </p>
                    )}
                  </section>
                )}
                {view === "relations" && (
                  <section className="relations-section">
                    <div className="metadata-section-title">
                      <h3>Declared relationships</h3>
                      <span>{details.relations.length}</span>
                    </div>
                    <p className="metadata-hint">
                      Arrows point from foreign-key columns to the referenced
                      table. Only declared foreign keys are shown; names do not
                      imply a relationship.
                    </p>
                    {details.foreignKeysEnforced !== null && (
                      <p className="fk-enforcement">
                        FK enforcement for this read-only connection:{" "}
                        <b>{details.foreignKeysEnforced ? "On" : "Off"}</b>{" "}
                        <span>· connection-local setting</span>
                      </p>
                    )}
                    {details.relations.length ? (
                      <>
                        <RelationGraph
                          table={details.table}
                          relations={details.relations}
                          onOpen={open}
                          canOpen={canOpen}
                        />
                        <div className="relation-list">
                          {details.relations.map((relation) => (
                            <article key={relation.id}>
                              <header>
                                <span className="meta-chip">
                                  {sameTable(relation.fromTable, details.table)
                                    ? sameTable(relation.toTable, details.table)
                                      ? "SELF REFERENCE"
                                      : "OUTGOING"
                                    : "INCOMING"}
                                </span>
                                <b>{relation.name || "Declared foreign key"}</b>
                                {relation.validated === false && (
                                  <span className="meta-chip warning">
                                    NOT VALIDATED
                                  </span>
                                )}
                              </header>
                              <div className="relation-endpoints">
                                <button
                                  disabled={!canOpen(relation.fromTable)}
                                  onClick={() => open(relation.fromTable)}
                                >
                                  {qualified(relation.fromTable)}
                                  <ArrowUpRight size={12} />
                                </button>
                                <ArrowRight size={14} />
                                <button
                                  disabled={!canOpen(relation.toTable)}
                                  onClick={() => open(relation.toTable)}
                                >
                                  {qualified(relation.toTable)}
                                  <ArrowUpRight size={12} />
                                </button>
                              </div>
                              <ol>
                                {relation.columns.map((pair, i) => (
                                  <li key={i}>
                                    <code>{pair.from}</code>
                                    <ArrowRight size={12} />
                                    <code>
                                      {pair.to ??
                                        "Parent primary key unavailable"}
                                    </code>
                                  </li>
                                ))}
                              </ol>
                              <footer>
                                ON UPDATE {relation.onUpdate}
                                <span>ON DELETE {relation.onDelete}</span>
                                {relation.deferrable !== null && (
                                  <span>
                                    {relation.deferrable
                                      ? "DEFERRABLE"
                                      : "NOT DEFERRABLE"}
                                  </span>
                                )}
                              </footer>
                            </article>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="metadata-empty relations-empty">
                        <GitFork size={30} />
                        <h3>No declared foreign keys.</h3>
                        <p>
                          This table has no incoming or outgoing foreign keys
                          visible in the database catalog.
                          <br />
                          Columns such as <code>user_id</code> are not treated
                          as relations automatically.
                        </p>
                      </div>
                    )}
                  </section>
                )}
                {view === "sql" && (
                  <section className="definition-section">
                    <div className="metadata-section-title">
                      <h3>{details.definitionKind}</h3>
                      <button
                        className="secondary small"
                        disabled={!details.definition}
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(details.definition!)
                            .then(() => {
                              setCopyError("");
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1800);
                            })
                            .catch(() =>
                              setCopyError(
                                "Clipboard unavailable. Select and copy the SQL below.",
                              ),
                            );
                        }}
                      >
                        <Copy size={12} />
                        {copied ? "Copied" : "Copy SQL"}
                      </button>
                    </div>
                    {copyError && (
                      <p className="metadata-hint" role="alert">
                        {copyError}
                      </p>
                    )}
                    {details.definition ? (
                      <pre className="table-definition">
                        {details.definition}
                      </pre>
                    ) : (
                      <p className="metadata-empty">
                        A SQL definition is not available for this object type.
                      </p>
                    )}
                    <div className="metadata-notes">
                      {details.notes.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
export function RelationGraph({
  table,
  relations,
  onOpen,
  canOpen,
  graph,
}: {
  graph?: FocusGraph;
  table: Table;
  relations: Relation[];
  onOpen: (table: Table) => void;
  canOpen: (table: Table) => boolean;
}) {
  const initial = graph || focusGraph(table, relations);
  const viewport = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>(initial.nodes),
    [zoom, setZoom] = useState(0.85),
    [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (graph) {
      setNodes(graph.nodes);
      setZoom(
        Math.max(
          0.25,
          Math.min(
            0.85,
            ((viewport.current?.clientWidth || 960) - 32) / graph.width,
          ),
        ),
      );
      setHovered(null);
    }
  }, [graph]);
  const drag = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const marker = useId().replaceAll(":", "");
  const map = new Map(nodes.map((node) => [node.id, node]));
  const move = (id: string, x: number, y: number) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          ? {
              ...n,
              x: Math.max(8, Math.min(initial.width - 248, x)),
              y: Math.max(24, Math.min(initial.height - 110, y)),
            }
          : n,
      ),
    );
  function path(relation: Relation, index: number) {
    const from = map.get(tableKey(relation.fromTable))!,
      to = map.get(tableKey(relation.toTable))!;
    if (from.id === to.id) {
      const x = from.x + 240,
        y = from.y + 30;
      return `M ${x} ${y} C ${x + 75} ${y - 90}, ${x + 75} ${y + 90}, ${x} ${y + 34}`;
    }
    if (graph) {
      // Route overview links through the spaces beside and above grid cards.
      // A long straight link must not pass under unrelated table cards.
      const sx = from.x + 240,
        sy = from.y + 48,
        tx = to.x + 240,
        ty = to.y + 48;
      const offset = 20 + (index % 3) * 8,
        fc = sx + offset,
        tc = tx + offset;
      if (from.x === to.x) return `M ${sx} ${sy} H ${fc} V ${ty} H ${tx}`;
      const lane = Math.min(from.y, to.y) - 30 - (index % 4) * 10;
      return `M ${sx} ${sy} H ${fc} V ${lane} H ${tc} V ${ty} H ${tx}`;
    }
    const right = from.x < to.x,
      x1 = from.x + (right ? 240 : 0),
      x2 = to.x + (right ? 0 : 240),
      y1 = from.y + 48 + ((index % 3) - 1) * 7,
      y2 = to.y + 48 + ((index % 3) - 1) * 7,
      dx = Math.max(45, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  return (
    <div className="relation-graph">
      <div className="graph-toolbar">
        <span>
          <GitFork size={13} />
          {graph ? "Database relationships" : "Direct relationships"}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Zoom out relations"
            disabled={zoom <= (graph ? 0.25 : 0.5)}
            onClick={() =>
              setZoom((z) => Math.max(graph ? 0.25 : 0.5, z - 0.1))
            }
          >
            <Minus size={13} />
          </button>
          <small>{Math.round(zoom * 100)}%</small>
          {graph && (
            <button
              className="text-button"
              onClick={() =>
                setZoom(
                  Math.max(
                    0.25,
                    Math.min(
                      1.3,
                      ((viewport.current?.clientWidth || 960) - 24) /
                        initial.width,
                    ),
                  ),
                )
              }
            >
              Fit width
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Zoom in relations"
            disabled={zoom >= 1.3}
            onClick={() => setZoom((z) => Math.min(1.3, z + 0.1))}
          >
            <Plus size={13} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              setNodes(initial.nodes);
              setZoom(0.85);
            }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>
      {(initial.omitted > 0 || !!initial.omittedEdges) && (
        <p className="graph-limit">
          Showing {nodes.length} objects; {initial.omitted} objects{" "}
          {graph ? `and ${initial.omittedEdges || 0} FK links` : ""} are omitted
          from the diagram.{" "}
          {graph
            ? "Use filters to focus the graph. Lists below cover all matching metadata."
            : "The relationship list below is complete."}
        </p>
      )}
      <div className="graph-viewport" ref={viewport}>
        <div
          style={{ width: initial.width * zoom, height: initial.height * zoom }}
        >
          <div
            className="graph-canvas"
            style={{
              width: initial.width,
              height: initial.height,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              className="graph-edges"
              width={initial.width}
              height={initial.height}
              aria-label="Foreign key directions"
            >
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 10 10"
                  refX="10"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>
              {initial.edges.map((relation, i) => (
                <path
                  key={relation.id}
                  d={path(relation, i)}
                  className={
                    graph && hovered
                      ? tableKey(relation.fromTable) === hovered ||
                        tableKey(relation.toTable) === hovered
                        ? "active-edge"
                        : "muted-edge"
                      : undefined
                  }
                  markerEnd={`url(#${marker})`}
                >
                  <title>
                    {qualified(relation.fromTable)} →{" "}
                    {qualified(relation.toTable)}: {pairsLabel(relation)}
                  </title>
                </path>
              ))}
            </svg>
            {nodes.map((node) => (
              <div
                key={node.id}
                className={`graph-node ${node.role === "selected" ? "selected" : ""} ${graph && hovered === node.id ? "highlighted" : ""}`}
                onMouseEnter={() => {
                  if (graph) setHovered(node.id);
                }}
                onMouseLeave={() => {
                  if (graph) setHovered(null);
                }}
                onFocusCapture={() => {
                  if (graph) setHovered(node.id);
                }}
                onBlurCapture={(e) => {
                  if (
                    graph &&
                    !e.currentTarget.contains(e.relatedTarget as Node)
                  )
                    setHovered(null);
                }}
                style={{ left: node.x, top: node.y }}
              >
                <div className="graph-node-top">
                  <span>
                    {node.role === "overview"
                      ? node.table.kind.toUpperCase()
                      : node.role === "selected"
                        ? "SELECTED TABLE"
                        : node.role === "incoming"
                          ? "REFERENCES THIS TABLE"
                          : "REFERENCED TABLE"}
                  </span>
                  <button
                    className="graph-drag"
                    aria-label={`Move ${qualified(node.table)}`}
                    title="Drag to move; arrow keys also work"
                    onPointerDown={(event) => {
                      drag.current = {
                        id: node.id,
                        pointer: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        startX: node.x,
                        startY: node.y,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const d = drag.current;
                      if (d?.id === node.id && d.pointer === event.pointerId)
                        move(
                          node.id,
                          d.startX + (event.clientX - d.x) / zoom,
                          d.startY + (event.clientY - d.y) / zoom,
                        );
                    }}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                    }}
                    onKeyDown={(event) => {
                      const delta: Record<string, [number, number]> = {
                        ArrowLeft: [-16, 0],
                        ArrowRight: [16, 0],
                        ArrowUp: [0, -16],
                        ArrowDown: [0, 16],
                      };
                      const step = delta[event.key];
                      if (step) {
                        event.preventDefault();
                        move(node.id, node.x + step[0], node.y + step[1]);
                      }
                    }}
                  >
                    <GripHorizontal size={16} />
                  </button>
                </div>
                <button
                  className="graph-open"
                  title={
                    canOpen(node.table)
                      ? `Open ${qualified(node.table)}`
                      : "Not visible in the current connection explorer"
                  }
                  disabled={!canOpen(node.table)}
                  onClick={() => onOpen(node.table)}
                >
                  <Table2 size={16} />
                  <span>
                    <small>{node.table.schema}</small>
                    <b>{node.table.name}</b>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="graph-caption">
        {graph
          ? "Drag handles to arrange · Hover to follow links · Open a table by its name · Layout is temporary"
          : "Drag handles to arrange tables. Open a table using its name. Layout is temporary. Reset restores the initial arrangement."}
      </p>
    </div>
  );
}
