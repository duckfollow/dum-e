import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Database,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Table2,
  FileCode2,
  X,
  Play,
  Square,
  RefreshCw,
  Download,
  PanelRightClose,
  PanelRightOpen,
  PlugZap,
  Unplug,
  ArrowUpDown,
  Check,
  Clock3,
  ShieldCheck,
  FolderOpen,
  ArrowRight,
  ChevronLeft,
  Monitor,
  Sun,
  Moon,
  AlertCircle,
  LoaderCircle,
  Braces,
  Layers3,
  Terminal,
  Columns3,
  KeyRound,
  ExternalLink,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { SqlEditor } from "./SqlEditor";
import { api, desktop } from "./api";
import {
  cellText,
  filteredRows,
  exportCsv,
  exportJson,
  newProfile,
  tableSql,
  PAGE_SIZE,
  type Profile,
  type Connected,
  type QueryTab,
  type QueryResult,
  type Table,
  type Driver,
} from "./model";
import "./styles.css";
function Mark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M7 32h26M12 30V20l10-9 8 5v7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="20"
        r="2.5"
        fill="var(--panel)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="22"
        cy="11"
        r="2"
        fill="var(--panel)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M27 23v3l3 2 3-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function DriverMark({
  driver,
  small = false,
}: {
  driver: Driver;
  small?: boolean;
}) {
  return (
    <span className={`driver-mark ${driver} ${small ? "small" : ""}`}>
      {driver === "postgres" ? (
        <Database size={small ? 14 : 20} />
      ) : (
        <Layers3 size={small ? 14 : 20} />
      )}
    </span>
  );
}
const emptySql =
  "-- A little help with your data.\n-- Run your query with ⌘ Enter.\n\nSELECT 1 AS hello;";
function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [connections, setConnections] = useState<Record<string, Connected>>({}),
    [selectedId, setSelectedId] = useState("");
  const [tabs, setTabs] = useState<QueryTab[]>([]),
    [activeId, setActiveId] = useState(""),
    [tableSearch, setTableSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState<{ index: number; asc: boolean } | null>(null);
  const [modal, setModal] = useState<Profile | null>(null),
    [message, setMessage] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(""),
    [connecting, setConnecting] = useState(false),
    [inspector, setInspector] = useState(false),
    [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [theme, setTheme] = useState(
      () => localStorage.getItem("dum-e.theme") || "system",
    ),
    [systemDark, setSystemDark] = useState(
      () => matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const active = tabs.find((t) => t.id === activeId),
    connection = connections[active?.profileId || selectedId],
    profile = connection?.profile;
  const dialectProfile =
    profile || profiles.find((p) => p.id === active?.profileId);
  const queryId = useRef(""),
    busyRef = useRef(false);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      handler = () => setSystemDark(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    if (desktop)
      void api<Profile[]>("list_connections")
        .then(setProfiles)
        .catch((e) => setMessage(String(e)));
  }, []);
  useEffect(() => {
    setFilter("");
    setSort(null);
    setSelectedRow(null);
  }, [activeId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const patch = (id: string, value: Partial<QueryTab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...value } : t)));
  function newQuery(id = profile?.id) {
    if (!id) return;
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      profileId: id,
      title: `Query ${tabsRef.current.filter((t) => !t.table).length + 1}`,
      sql: emptySql,
      page: 0,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
    setSelectedId(id);
  }
  async function execute(tab: QueryTab, sqlText = tab.sql, page = tab.page) {
    if (busyRef.current) return;
    if (!connections[tab.profileId]) {
      setMessage("Reconnect to this database before running the query.");
      return;
    }
    busyRef.current = true;
    setBusy(tab.id);
    setSelectedRow(null);
    const requestId = crypto.randomUUID();
    queryId.current = requestId;
    patch(tab.id, { error: undefined });
    try {
      const result = await api<QueryResult>("run_query", {
        id: tab.profileId,
        requestId,
        sql: sqlText,
      });
      patch(tab.id, { result, page, sql: sqlText, error: undefined });
    } catch (e) {
      patch(tab.id, { error: String(e), result: undefined });
    } finally {
      queryId.current = "";
      busyRef.current = false;
      setBusy("");
    }
  }
  async function browse(table: Table, conn = connection) {
    if (!conn) return;
    const existing = tabsRef.current.find(
      (t) =>
        t.profileId === conn.profile.id &&
        t.table?.name === table.name &&
        t.table?.schema === table.schema,
    );
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      profileId: conn.profile.id,
      title: table.name,
      sql: tableSql(table),
      table,
      page: 0,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
    setSelectedId(conn.profile.id);
    await execute(tab);
  }
  async function didConnect(conn: Connected) {
    setConnections((cs) => ({ ...cs, [conn.profile.id]: conn }));
    setProfiles((ps) => [
      ...ps.filter((p) => p.id !== conn.profile.id),
      conn.profile,
    ]);
    setSelectedId(conn.profile.id);
    setModal(null);
    setMessage("");
    const tab = tabsRef.current.find((t) => t.profileId === conn.profile.id);
    if (tab) setActiveId(tab.id);
    else {
      const t: QueryTab = {
        id: crypto.randomUUID(),
        profileId: conn.profile.id,
        title: "Query 1",
        sql:
          conn.profile.driver === "sqlite" &&
          conn.profile.name.includes("sample")
            ? "-- Your workshop, at a glance.\nSELECT *\nFROM missions\nORDER BY id;"
            : emptySql,
        page: 0,
      };
      setTabs((ts) => [...ts, t]);
      setActiveId(t.id);
    }
  }
  async function selectProfile(p: Profile) {
    if (connections[p.id]) {
      setSelectedId(p.id);
      const tab = tabsRef.current.find((t) => t.profileId === p.id);
      if (tab) setActiveId(tab.id);
      else newQuery(p.id);
      return;
    }
    if (p.driver === "postgres" && !p.rememberPassword) {
      setModal(p);
      return;
    }
    setConnecting(true);
    try {
      await didConnect(
        await api<Connected>("connect_database", {
          profile: p,
          password: null,
        }),
      );
    } catch (e) {
      setMessage(String(e));
      setModal(p);
    } finally {
      setConnecting(false);
    }
  }
  async function sample() {
    setConnecting(true);
    try {
      await didConnect(await api<Connected>("open_sample"));
      setToast("Sample database opened. This is a real SQLite file.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setConnecting(false);
    }
  }
  async function refresh() {
    if (!profile) return;
    try {
      const tables = await api<Table[]>("list_tables", { id: profile.id });
      setConnections((cs) => ({
        ...cs,
        [profile.id]: { ...cs[profile.id], tables },
      }));
      setToast("Schema refreshed");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function disconnect() {
    if (!profile || busy) return;
    try {
      await api("disconnect_database", { id: profile.id });
      setConnections((cs) => {
        const c = { ...cs };
        delete c[profile.id];
        return c;
      });
      setToast("Disconnected. SQL tabs are kept for this session.");
    } catch (e) {
      setMessage(String(e));
    }
  }
  function closeTab(tab: QueryTab) {
    if (busy === tab.id) return;
    const remaining = tabs.filter((t) => t.id !== tab.id);
    setTabs(remaining);
    if (activeId === tab.id) setActiveId(remaining.at(-1)?.id || "");
  }
  const result = active?.result,
    rows = result ? filteredRows(result, filter, sort) : [],
    visibleTables =
      connection?.tables.filter((t) =>
        `${t.schema}.${t.name}`
          .toLowerCase()
          .includes(tableSearch.toLowerCase()),
      ) || [];
  const groups = [...new Set(visibleTables.map((t) => t.schema))];
  async function exportData(format: "csv" | "json") {
    if (!result) return;
    try {
      const done = await api<boolean>("export_result", {
        content: format === "csv" ? exportCsv(result) : exportJson(result),
        format,
      });
      if (done) setToast(`${format.toUpperCase()} exported`);
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Mark />
          </span>
          <div>
            <strong>
              Dum-E<span className="brand-dot">.</span>
            </strong>
            <span className="brand-caption">YOUR DATABASE HELPER</span>
          </div>
          <span className="alpha">ALPHA</span>
        </div>
        <button
          className="new-connection"
          onClick={() => setModal(newProfile())}
        >
          <Plus size={16} /> New connection <kbd>＋</kbd>
        </button>
        <div className="section-label">
          CONNECTIONS <span>{profiles.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="connection-list">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`connection-item ${profile?.id === p.id ? "selected" : ""}`}
              onClick={() => void selectProfile(p)}
              disabled={connecting}
            >
              <DriverMark driver={p.driver} small />
              <span>
                <b>{p.name}</b>
                <small>
                  {p.driver === "sqlite"
                    ? "SQLite · local file"
                    : `${p.host}:${p.port}`}
                </small>
              </span>
              <span
                className={`connection-dot ${connections[p.id] ? "online" : ""}`}
                title={connections[p.id] ? "Connected" : "Disconnected"}
              />
            </button>
          ))}
          {!profiles.length && (
            <p className="sidebar-empty">
              Your connections live here.
              <br />
              Add one to get started.
            </p>
          )}
        </div>
        {profile && (
          <>
            <div className="section-label objects-label">
              DATABASE EXPLORER{" "}
              <button
                className="icon-button"
                title="Refresh schema"
                aria-label="Refresh schema"
                onClick={() => void refresh()}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="side-search">
              <Search size={14} />
              <input
                placeholder="Find a table…"
                aria-label="Find a table"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
            </div>
            <div className="object-tree">
              {groups.map((schema) => (
                <section key={schema}>
                  <div className="schema-name">
                    <ChevronDown size={13} />
                    <Database size={14} />
                    {schema}
                    <span>
                      {visibleTables.filter((t) => t.schema === schema).length}
                    </span>
                  </div>
                  {visibleTables
                    .filter((t) => t.schema === schema)
                    .map((t) => (
                      <button
                        key={`${schema}.${t.name}`}
                        className={`table-item ${active?.table?.name === t.name && active?.table?.schema === schema ? "active" : ""}`}
                        onClick={() => void browse(t)}
                      >
                        <Table2 size={14} />
                        <span>{t.name}</span>
                        {t.kind.toLowerCase().includes("view") && (
                          <small>view</small>
                        )}
                      </button>
                    ))}
                </section>
              ))}
              {!visibleTables.length && (
                <p className="sidebar-empty">
                  {tableSearch
                    ? "No matching tables."
                    : "No visible tables yet."}
                </p>
              )}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={15} />
            <span>On your machine. In your hands.</span>
          </div>
          <div className="sidebar-footer">
            <span>v0.1.0-alpha.1</span>
            <div className="theme-controls" aria-label="Appearance">
              {[
                { value: "light", label: "Light", Icon: Sun },
                { value: "dark", label: "Dark", Icon: Moon },
                { value: "system", label: "System", Icon: Monitor },
              ].map(({ value, label, Icon }) => (
                <button
                  key={value}
                  title={label}
                  aria-label={`${label} theme`}
                  aria-pressed={theme === value}
                  className={theme === value ? "chosen" : ""}
                  onClick={() => {
                    setTheme(value);
                    localStorage.setItem("dum-e.theme", value);
                  }}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <b>{profile?.name || "Welcome"}</b>
            {active && (
              <>
                <ChevronRight size={13} />
                <span>{active.title}</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <span className="readonly-badge">
              <ShieldCheck size={12} /> Read-only alpha
            </span>
            {profile && (
              <button
                className="icon-button"
                title="Disconnect selected database"
                aria-label="Disconnect database"
                disabled={!!busy}
                onClick={() => void disconnect()}
              >
                <Unplug size={16} />
              </button>
            )}
          </div>
        </header>
        {!desktop && (
          <div className="preview-banner">
            <Monitor size={14} /> Browser preview · Open the desktop app to
            connect to real databases.
          </div>
        )}
        {message && (
          <div className="message error" role="alert">
            <AlertCircle size={16} />
            <span>{message}</span>
            <button aria-label="Dismiss error" onClick={() => setMessage("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {!active ? (
          <div className="welcome">
            <div className="welcome-topline">
              <span className="eyebrow">
                <span className="tiny-dot" /> A LITTLE HELP. A LOT LESS
                FRICTION.
              </span>
              <span className="welcome-version">DATABASE WORKSPACE / 001</span>
            </div>
            <div className="welcome-content">
              <div className="welcome-emblem">
                <Mark />
              </div>
              <span className="eyebrow">MEET YOUR NEW WORKSHOP ASSISTANT</span>
              <h1>
                Good things start
                <br />
                with a <em>connection.</em>
              </h1>
              <p>
                A quieter place for your databases. Explore tables,
                <br />
                ask better questions, and get closer to your data.
              </p>
              <div className="welcome-buttons">
                <button
                  className="primary"
                  onClick={() => setModal(newProfile())}
                >
                  <Plus size={16} /> Connect a database <ArrowRight size={16} />
                </button>
                <button
                  className="secondary"
                  disabled={connecting}
                  onClick={() => void sample()}
                >
                  {connecting ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Layers3 size={15} />
                  )}{" "}
                  Explore a sample
                </button>
              </div>
              <div className="engine-options">
                <span>BUILT FOR</span>
                <div>
                  <DriverMark driver="postgres" small /> PostgreSQL
                </div>
                <span className="engine-divider" />
                <div>
                  <DriverMark driver="sqlite" small /> SQLite
                </div>
              </div>
            </div>
            <div className="welcome-features">
              <div>
                <Table2 />
                <b>Find your bearings</b>
                <p>Tables and views, a click away.</p>
              </div>
              <div>
                <Terminal />
                <b>Ask your data</b>
                <p>A focused SQL editor. No distractions.</p>
              </div>
              <div>
                <ShieldCheck />
                <b>Explore with confidence</b>
                <p>Read-only connections in this alpha.</p>
              </div>
            </div>
            <div className="welcome-foot">
              <span>SMALL TOOL. THOUGHTFUL DETAILS.</span>
              <span>No cloud account. No telemetry.</span>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="tabs" role="tablist" aria-label="SQL tabs">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab ${t.id === activeId ? "active" : ""}`}
                >
                  <button
                    role="tab"
                    aria-selected={t.id === activeId}
                    onClick={() => {
                      setActiveId(t.id);
                      setSelectedId(t.profileId);
                    }}
                  >
                    {t.table ? <Table2 size={14} /> : <FileCode2 size={14} />}
                    <span>{t.title}</span>
                    {busy === t.id && (
                      <LoaderCircle size={12} className="spin" />
                    )}
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`Close ${t.title}`}
                    disabled={busy === t.id}
                    onClick={() => closeTab(t)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                className="add-tab icon-button"
                title="New SQL tab"
                aria-label="New SQL tab"
                onClick={() => newQuery()}
                disabled={!profile}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="query-pane">
              <div className="editor-toolbar">
                <div>
                  <span className="editor-label">
                    <Terminal size={13} /> SQL EDITOR
                  </span>
                  <span className="toolbar-divider" />
                  <span className="dialect">
                    {dialectProfile?.driver === "postgres"
                      ? "PostgreSQL"
                      : "SQLite"}
                  </span>
                </div>
                <div>
                  <span className="shortcut">⌘ Enter to run</span>
                  {busy ? (
                    <button
                      className="secondary small"
                      onClick={() =>
                        void api("cancel_query", {
                          requestId: queryId.current,
                        }).catch((e) => setMessage(String(e)))
                      }
                    >
                      <Square size={11} /> Cancel
                    </button>
                  ) : (
                    <button
                      className="primary small"
                      disabled={!profile}
                      onClick={() => void execute(active)}
                    >
                      <Play size={12} fill="currentColor" /> Run query
                    </button>
                  )}
                </div>
              </div>
              <SqlEditor
                key={active.id}
                readOnly={busy === active.id}
                value={active.sql}
                onChange={(sql) => {
                  setSelectedRow(null);
                  patch(active.id, {
                    sql,
                    table: undefined,
                    page: 0,
                    result: undefined,
                    error: undefined,
                  });
                }}
                onRun={() =>
                  void execute(
                    tabsRef.current.find((t) => t.id === activeId) || active,
                  )
                }
                driver={dialectProfile?.driver || "sqlite"}
                tables={connection?.tables || []}
                theme={resolved}
              />
              <div className="editor-foot">
                <span>
                  <ShieldCheck size={11} /> SELECT & WITH queries · 200-row
                  preview · 15s statement limit
                </span>
                <span>
                  UTF-8 <span className="foot-dot">·</span> SQL
                </span>
              </div>
            </div>
            <div className="result-toolbar">
              <div className="result-heading">
                <Table2 size={15} />
                <b>Results</b>
                {result && (
                  <span className="count-badge">
                    {result.rows.length}
                    {result.truncated ? "+" : ""}
                  </span>
                )}
                {result && (
                  <span className="query-timing">
                    <Check size={12} />
                    {result.elapsedMs} ms
                  </span>
                )}
              </div>
              <div className="result-actions">
                <div className="result-filter">
                  <Search size={13} />
                  <input
                    aria-label="Filter current result page"
                    placeholder="Filter current page…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    disabled={!result}
                  />
                  {filter && (
                    <button
                      aria-label="Clear result filter"
                      onClick={() => setFilter("")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <span className="toolbar-divider" />
                <button
                  className="icon-button"
                  title="Refresh query"
                  aria-label="Refresh query"
                  disabled={!!busy || !profile}
                  onClick={() => void execute(active)}
                >
                  <RefreshCw size={14} />
                </button>
                <div className="export-menu">
                  <button
                    className="text-button"
                    disabled={!result}
                    onClick={() => void exportData("csv")}
                    title="Export current result as spreadsheet-safe CSV"
                  >
                    <Download size={14} /> CSV
                  </button>
                  <button
                    className="text-button"
                    disabled={!result}
                    onClick={() => void exportData("json")}
                  >
                    <Braces size={14} /> JSON
                  </button>
                </div>
                <button
                  className={`icon-button ${inspector ? "accent" : ""}`}
                  title="Toggle row inspector"
                  aria-label="Toggle row inspector"
                  onClick={() => setInspector(!inspector)}
                >
                  {inspector ? (
                    <PanelRightClose size={16} />
                  ) : (
                    <PanelRightOpen size={16} />
                  )}
                </button>
              </div>
            </div>
            <div className="result-body">
              {active.error ? (
                <div className="query-error" role="alert">
                  <AlertCircle size={24} />
                  <h3>Let’s take another look.</h3>
                  <pre>{active.error}</pre>
                  <p>
                    Your query didn’t return a result. Update it above and try
                    again.
                  </p>
                </div>
              ) : busy === active.id ? (
                <div className="result-empty">
                  <LoaderCircle className="spin" size={26} />
                  <h3>Asking your database…</h3>
                  <p>You can cancel this query at any time.</p>
                </div>
              ) : !result ? (
                <div className="result-empty">
                  <Terminal size={28} />
                  <h3>Your next answer starts here.</h3>
                  <p>
                    Write a query above and press <kbd>⌘ Enter</kbd> to run it.
                  </p>
                  <span className="empty-note">
                    <ShieldCheck size={12} /> This alpha keeps your data
                    read-only.
                  </span>
                </div>
              ) : (
                <>
                  <div className="data-grid-wrap">
                    <table className="data-grid">
                      <thead>
                        <tr>
                          <th className="row-number">#</th>
                          {result.columns.map((c, i) => (
                            <th key={i}>
                              <button
                                title="Sort current result page"
                                onClick={() =>
                                  setSort({
                                    index: i,
                                    asc: sort?.index === i ? !sort.asc : true,
                                  })
                                }
                              >
                                <span>
                                  <b>{c.name}</b>
                                  <small>{c.dataType || "value"}</small>
                                </span>
                                <ArrowUpDown
                                  size={11}
                                  className={sort?.index === i ? "accent" : ""}
                                />
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ values, index }) => (
                          <tr
                            key={index}
                            className={
                              selectedRow === index ? "selected-row" : ""
                            }
                            tabIndex={0}
                            aria-label={`Row ${active.page * PAGE_SIZE + index + 1}`}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedRow(index);
                                setInspector(true);
                              }
                            }}
                            onClick={() => {
                              setSelectedRow(index);
                            }}
                            onDoubleClick={() => {
                              setSelectedRow(index);
                              setInspector(true);
                            }}
                          >
                            <td className="row-number">
                              {active.page * PAGE_SIZE + index + 1}
                            </td>
                            {values.map((v, i) => (
                              <td
                                key={i}
                                title={cellText(v)}
                                className={
                                  v === null
                                    ? "null-cell"
                                    : typeof v === "object"
                                      ? "json-cell"
                                      : ""
                                }
                              >
                                {v !== null &&
                                result.columns[i]?.name === "status" ? (
                                  <span
                                    className={`status-chip ${cellText(v).toLowerCase().replaceAll(" ", "-")}`}
                                  >
                                    <span />
                                    {cellText(v)}
                                  </span>
                                ) : (
                                  cellText(v)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!rows.length && (
                      <div className="no-rows">
                        {filter
                          ? "No rows match this filter."
                          : "Query finished. No rows returned."}
                      </div>
                    )}
                  </div>
                  {inspector && (
                    <aside className="row-inspector">
                      <header>
                        <b>Row inspector</b>
                        <button
                          className="icon-button"
                          aria-label="Close row inspector"
                          onClick={() => setInspector(false)}
                        >
                          <X size={14} />
                        </button>
                      </header>
                      {selectedRow === null ? (
                        <div className="inspector-empty">
                          <Columns3 size={24} />
                          <p>Select a row to see its values.</p>
                        </div>
                      ) : (
                        <>
                          <span className="inspector-row">
                            ROW {active.page * PAGE_SIZE + selectedRow + 1}
                          </span>
                          {result.columns.map((c, i) => (
                            <div className="inspect-field" key={i}>
                              <label>
                                {c.name}
                                <small>{c.dataType}</small>
                              </label>
                              <pre
                                className={
                                  result.rows[selectedRow][i] === null
                                    ? "null-cell"
                                    : ""
                                }
                              >
                                {cellText(result.rows[selectedRow][i])}
                              </pre>
                            </div>
                          ))}
                        </>
                      )}
                    </aside>
                  )}
                </>
              )}
            </div>
            <div className="results-footer">
              <div>
                {result ? (
                  <>
                    <span className="success-dot" />
                    {rows.length} {filter ? "matching" : "returned"} rows{" "}
                    <span className="foot-dot">·</span> {result.columns.length}{" "}
                    columns
                    {result.truncated && (
                      <span className="limit-note">
                        Preview limited to 200 rows
                      </span>
                    )}
                  </>
                ) : (
                  <span>Ready when you are.</span>
                )}
              </div>
              <div>
                {active.table && (
                  <div className="pagination">
                    <button
                      className="icon-button"
                      aria-label="Previous page"
                      disabled={!active.page || !!busy}
                      onClick={() =>
                        void execute(
                          active,
                          tableSql(active.table!, active.page - 1),
                          active.page - 1,
                        )
                      }
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>Page {active.page + 1}</span>
                    <button
                      className="icon-button"
                      aria-label="Next page"
                      disabled={!result?.truncated || !!busy}
                      onClick={() =>
                        void execute(
                          active,
                          tableSql(active.table!, active.page + 1),
                          active.page + 1,
                        )
                      }
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
                <span className="read-only-note">
                  <KeyRound size={11} /> Read-only
                </span>
              </div>
            </div>
          </div>
        )}
        <footer className="statusbar">
          <div>
            <span className={`connection-dot ${profile ? "online" : ""}`} />
            <span>{profile ? "Connected" : "Not connected"}</span>
            {profile && (
              <>
                <span className="status-separator">/</span>
                <span>
                  {profile.driver === "sqlite"
                    ? "SQLite"
                    : `${profile.database}@${profile.host}`}
                </span>
              </>
            )}
          </div>
          <div>
            <span>
              <Clock3 size={11} /> Session only query history
            </span>
            <span className="status-separator">/</span>
            <span>Made for the workbench.</span>
          </div>
        </footer>
      </main>
      {modal && (
        <ConnectionDialog
          profile={modal}
          onClose={() => setModal(null)}
          onConnected={didConnect}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
function ConnectionDialog({
  profile: initial,
  onClose,
  onConnected,
}: {
  profile: Profile;
  onClose: () => void;
  onConnected: (c: Connected) => Promise<void>;
}) {
  const [p, setP] = useState(initial),
    [password, setPassword] = useState(""),
    [working, setWorking] = useState(""),
    [error, setError] = useState(""),
    [tested, setTested] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const change = (value: Partial<Profile>) => {
    setP((p) => ({ ...p, ...value }));
    setTested(false);
    setError("");
  };
  async function chooseFile() {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "SQLite database",
            extensions: ["sqlite", "sqlite3", "db", "db3"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof path === "string")
        change({ path, name: p.name || path.split("/").at(-1) || "SQLite" });
    } catch (e) {
      setError(String(e));
    }
  }
  async function submit(testOnly: boolean) {
    if (working) return;
    setWorking(testOnly ? "test" : "connect");
    setError("");
    setTested(false);
    try {
      if (testOnly) {
        await api("test_connection", { profile: p, password });
        setTested(true);
      } else {
        await onConnected(
          await api<Connected>("connect_database", {
            profile: p,
            password: password || null,
          }),
        );
        setPassword("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="connection-dialog"
      onCancel={(e) => {
        if (working) e.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <header>
          <div className="dialog-title-icon">
            <PlugZap size={21} />
          </div>
          <div>
            <span className="eyebrow">A NEW CONNECTION</span>
            <h2>Meet your database.</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close connection dialog"
            disabled={!!working}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="dialog-content">
          <div className="driver-choices">
            {(["postgres", "sqlite"] as Driver[]).map((driver) => (
              <button
                type="button"
                className={p.driver === driver ? "active" : ""}
                key={driver}
                disabled={!!working}
                onClick={() => change({ driver })}
              >
                <DriverMark driver={driver} />
                <span>
                  <b>{driver === "postgres" ? "PostgreSQL" : "SQLite"}</b>
                  <small>
                    {driver === "postgres"
                      ? "Connect to a server"
                      : "Open a local file"}
                  </small>
                </span>
                {p.driver === driver && <Check size={15} />}
              </button>
            ))}
          </div>
          <label>
            Connection name
            <input
              autoFocus
              required
              maxLength={100}
              placeholder="e.g. Local development"
              value={p.name}
              disabled={!!working}
              onChange={(e) => change({ name: e.target.value })}
            />
          </label>
          {p.driver === "sqlite" ? (
            <label>
              Database file
              <div className="file-input">
                <input
                  required
                  aria-label="Database file path"
                  placeholder="/path/to/database.sqlite"
                  value={p.path}
                  disabled={!!working}
                  onChange={(e) => change({ path: e.target.value })}
                />
                <button
                  type="button"
                  title="Browse SQLite files"
                  disabled={!!working || !desktop}
                  onClick={() => void chooseFile()}
                >
                  <FolderOpen size={16} /> Browse
                </button>
              </div>
              <small>An existing SQLite file. Dum-E opens it read-only.</small>
            </label>
          ) : (
            <>
              <div className="form-row">
                <label>
                  Host
                  <input
                    required
                    placeholder="localhost"
                    value={p.host}
                    disabled={!!working}
                    onChange={(e) => change({ host: e.target.value })}
                  />
                </label>
                <label className="port-label">
                  Port
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={p.port}
                    disabled={!!working}
                    onChange={(e) => change({ port: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label>
                Database
                <input
                  required
                  value={p.database}
                  disabled={!!working}
                  onChange={(e) => change({ database: e.target.value })}
                />
              </label>
              <div className="form-row">
                <label>
                  Username
                  <input
                    required
                    autoComplete="off"
                    value={p.username}
                    disabled={!!working}
                    onChange={(e) => change({ username: e.target.value })}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      p.rememberPassword
                        ? "Saved in Keychain"
                        : "Database password"
                    }
                    value={password}
                    disabled={!!working}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setTested(false);
                    }}
                  />
                </label>
              </div>
              <div className="connection-options">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={p.tls}
                    disabled={!!working}
                    onChange={(e) => change({ tls: e.target.checked })}
                  />
                  <span>
                    Verified TLS<small>Required for remote servers</small>
                  </span>
                  <ShieldCheck size={15} />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={p.rememberPassword}
                    disabled={!!working}
                    onChange={(e) =>
                      change({ rememberPassword: e.target.checked })
                    }
                  />
                  <span>
                    Remember password
                    <small>Store securely in macOS Keychain</small>
                  </span>
                  <KeyRound size={15} />
                </label>
              </div>
              {!p.tls && (
                <p className="field-hint">
                  Unencrypted connections are supported for localhost only.
                </p>
              )}
            </>
          )}
          {error && (
            <div className="dialog-feedback error" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
          {tested && (
            <div className="dialog-feedback success" role="status">
              <Check size={15} /> Connection successful. Your database is ready.
            </div>
          )}
          <div className="privacy-note">
            <ShieldCheck size={14} />
            <p>
              Connections stay on this device. Queries run read-only in this
              alpha.
            </p>
          </div>
        </div>
        <footer>
          <button
            type="button"
            className="secondary"
            disabled={!!working || !desktop}
            onClick={() => void submit(true)}
          >
            {working === "test" ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <PlugZap size={14} />
            )}{" "}
            Test connection
          </button>
          <div>
            <button
              type="button"
              className="text-button"
              disabled={!!working}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={!!working || !desktop}
              type="submit"
            >
              {working === "connect" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <ArrowRight size={14} />
              )}{" "}
              Connect
            </button>
          </div>
        </footer>
        {!desktop && (
          <div className="browser-note">
            <ExternalLink size={12} /> Use the desktop app to connect. Browser
            mode previews the interface.
          </div>
        )}
      </form>
    </dialog>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
