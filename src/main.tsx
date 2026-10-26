import { RemoveConnectionDialog } from "./RemoveConnectionDialog";
import { ConnectionMenu } from "./ConnectionMenu";
import { UpdateNotice } from "./UpdateNotice";
import { SavedScripts } from "./SavedScripts";
import {
  readSavedScripts,
  writeSavedScripts,
  type SavedScript,
} from "./saved-scripts";
import { QueryHistory, type QueryHistoryEntry } from "./QueryHistory";
import { JsonCell } from "./JsonCell";
import { JsonViewer } from "./JsonViewer";
import type { JsonDocument } from "./json-viewer-model";
import { reconciledResult, refreshedTab } from "./refresh-model";
import { AutoRun } from "./AutoRun";
import { EditableGrid } from "./EditableGrid";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Database,
  Plus,
  Search,
  ChevronRight,
  Table2,
  FileCode2,
  X,
  Play,
  RefreshCw,
  Download,
  PanelRightClose,
  PanelRightOpen,
  PlugZap,
  Unplug,
  ArrowUpDown,
  Check,
  RotateCcwClock,
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
  Save,
  GitFork,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { SqlEditor } from "./SqlEditor";
import { TableWorkbench } from "./TableWorkbench";
import { DatabaseRelations } from "./DatabaseRelations";
import { DatabaseExplorer } from "./DatabaseExplorer";
import type { TableView } from "./table-model";
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
  type ExecutionResult,
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
  const [savedState, setSavedState] = useState<{
    scripts: SavedScript[];
    error: string;
  }>(() => {
    try {
      return { scripts: readSavedScripts(localStorage), error: "" };
    } catch {
      return {
        scripts: [],
        error:
          "Saved scripts could not be read. Existing data has not been changed.",
      };
    }
  });
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [scriptDraft, setScriptDraft] = useState<SavedScript | null>(null);
  function persistScripts(scripts: SavedScript[]) {
    if (savedState.error) throw new Error(savedState.error);
    writeSavedScripts(localStorage, scripts);
    setSavedState({ scripts, error: "" });
  }

  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [jsonViewer, setJsonViewer] = useState<JsonDocument | null>(null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const updateEditing = React.useCallback((value: boolean) => {
    editingRef.current = value;
    setEditing(value);
  }, []);
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [connections, setConnections] = useState<Record<string, Connected>>({}),
    [selectedId, setSelectedId] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [tabs, setTabs] = useState<QueryTab[]>([]),
    [activeId, setActiveId] = useState(""),
    [tableSearch, setTableSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState<{ index: number; asc: boolean } | null>(null);
  const [removingConnection, setRemovingConnection] = useState<Profile | null>(
    null,
  );
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
  function guardEdits() {
    if (!editingRef.current) return false;
    setToast("Save or discard table changes first.");
    return true;
  }
  function newQuery(id = profile?.id) {
    if (guardEdits()) return;
    if (!id) return;
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      profileId: id,
      title: `Query ${tabsRef.current.filter((t) => !t.table && !t.overview).length + 1}`,
      sql: emptySql,
      page: 0,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
    setSelectedId(id);
  }
  async function readCatalog(id: string) {
    const [tables, schemas] = await Promise.all([
      api<Table[]>("list_tables", { id }),
      api<string[]>("list_schemas", { id }),
    ]);
    return { tables, schemas };
  }
  async function execute(
    tab: QueryTab,
    sqlText = tab.sql,
    page = tab.page,
    selectionOnly = false,
    automatic = false,
  ) {
    if (editingRef.current) {
      if (!automatic) guardEdits();
      return null;
    }
    if (busyRef.current) return null;
    if (!connections[tab.profileId]) {
      setMessage("Reconnect to this database before running the query.");
      return false;
    }
    busyRef.current = true;
    if (!automatic) {
      setBusy(tab.id);
      if (page !== tab.page || sqlText !== tab.sql) setSelectedRow(null);
    }
    const startedAt = Date.now();
    const recordHistory = (elapsedMs: number, error?: string) => {
      if (automatic) return;
      setHistory((entries) =>
        [
          {
            id: crypto.randomUUID(),
            profileId: tab.profileId,
            driver: connections[tab.profileId].profile.driver,
            connectionName:
              connections[tab.profileId].profile.name ||
              connections[tab.profileId].profile.database ||
              "Database",
            sql: sqlText,
            startedAt,
            elapsedMs,
            error,
          },
          ...entries,
        ].slice(0, 200),
      );
    };
    const requestId = crypto.randomUUID();
    queryId.current = requestId;
    if (!automatic)
      patch(tab.id, {
        error: undefined,
      });
    try {
      if (!tab.table && !automatic) {
        const execution = await api<ExecutionResult>("execute_sql", {
          id: tab.profileId,
          requestId,
          sql: sqlText,
        });
        recordHistory(execution.elapsedMs, execution.error);
        patch(tab.id, {
          execution,
          result: execution.results.at(-1)
            ? reconciledResult(tab.result, execution.results.at(-1)!)
            : execution.error
              ? tab.result
              : undefined,
          page,
          sql: selectionOnly ? tab.sql : sqlText,
          error: undefined,
        });
      } else {
        const result = await api<QueryResult>("run_query", {
          id: tab.profileId,
          requestId,
          sql: sqlText,
        });
        recordHistory(result.elapsedMs);
        if (automatic) {
          setTabs((ts) => {
            let changed = false;
            const next = ts.map((t) => {
              if (t.id !== tab.id) return t;
              const refreshed = refreshedTab(t, result, sqlText, page);
              if (refreshed !== t) changed = true;
              return refreshed;
            });
            return changed ? next : ts;
          });
        } else {
          patch(tab.id, {
            result: reconciledResult(tab.result, result),
            page,
            sql: selectionOnly ? tab.sql : sqlText,
            error: undefined,
          });
        }
      }
      return true;
    } catch (e) {
      recordHistory(Date.now() - startedAt, String(e));
      if (automatic) {
        setTabs((ts) =>
          ts.map((t) =>
            t.id === tab.id && t.sql === sqlText && t.page === page
              ? { ...t, error: `Auto run stopped (read-only): ${String(e)}` }
              : t,
          ),
        );
      } else patch(tab.id, { error: String(e) });
      return false;
    } finally {
      if (!tab.table && !automatic) {
        try {
          const catalog = await readCatalog(tab.profileId);
          setConnections((cs) =>
            cs[tab.profileId]
              ? { ...cs, [tab.profileId]: { ...cs[tab.profileId], ...catalog } }
              : cs,
          );
        } catch (e) {
          setMessage(`SQL finished; schema refresh failed: ${String(e)}`);
        }
      }
      queryId.current = "";
      busyRef.current = false;
      if (!automatic) setBusy("");
    }
  }
  function openOverview(scope = "") {
    if (guardEdits()) return;
    if (!profile) return;
    const existing = tabsRef.current.find(
      (t) => t.profileId === profile.id && t.overview,
    );
    if (existing) {
      patch(existing.id, { overviewSchema: scope });
      setActiveId(existing.id);
      return;
    }
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      title: "Database Relations",
      sql: "",
      page: 0,
      overview: true,
      overviewSchema: scope,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }
  async function browse(table: Table, conn = connection, view?: TableView) {
    if (guardEdits()) return;
    if (!conn) return;
    const existing = tabsRef.current.find(
      (t) =>
        t.profileId === conn.profile.id &&
        t.table?.name === table.name &&
        t.table?.schema === table.schema,
    );
    if (existing) {
      if (view) patch(existing.id, { tableView: view });
      setActiveId(existing.id);
      return;
    }
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      profileId: conn.profile.id,
      title: table.name,
      sql: tableSql(table),
      table,
      tableView: view,
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
  async function editConnection(p: Profile) {
    if (guardEdits()) return;
    if (busyRef.current || connecting) {
      setToast(
        "Wait for the current operation to finish before editing a connection.",
      );
      return;
    }
    busyRef.current = true;
    setConnecting(true);
    try {
      if (connections[p.id]) {
        await api("disconnect_database", { id: p.id });
        setConnections((current) => {
          const next = { ...current };
          delete next[p.id];
          return next;
        });
      }
      setModal({ ...p });
    } catch (error) {
      setMessage(String(error));
    } finally {
      busyRef.current = false;
      setConnecting(false);
    }
  }
  async function selectProfile(p: Profile) {
    if (guardEdits()) return;
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
      const catalog = await readCatalog(profile.id);
      setConnections((cs) => ({
        ...cs,
        [profile.id]: { ...cs[profile.id], ...catalog },
      }));
      setToast("Schema refreshed");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function disconnect() {
    if (guardEdits()) return;
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
    if (tab.id === activeId && guardEdits()) return;
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
            <div
              className={`connection-row ${profile?.id === p.id ? "selected" : ""}`}
              key={p.id}
            >
              <button
                className="connection-item"
                onClick={() => void selectProfile(p)}
                disabled={connecting || editing}
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
              <ConnectionMenu
                name={p.name}
                connected={!!connections[p.id]}
                disabled={connecting || editing || !!busy}
                onEdit={() => void editConnection(p)}
                onRemove={() => {
                  if (!guardEdits()) setRemovingConnection(p);
                }}
              />
            </div>
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
            <button
              className="secondary database-relations-button"
              onClick={() => openOverview()}
            >
              <GitFork size={15} /> Database Relations
            </button>
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
            <DatabaseExplorer
              key={profile.id}
              connection={connection}
              tables={visibleTables}
              search={tableSearch}
              active={active?.table}
              busy={!!busy || editing}
              onOverview={openOverview}
              onOpen={(table, view) => void browse(table, connection, view)}
              onSql={(sql, title) => {
                if (guardEdits()) return;
                const tab: QueryTab = {
                  id: crypto.randomUUID(),
                  profileId: profile.id,
                  title,
                  sql,
                  page: 0,
                };
                setTabs((ts) => [...ts, tab]);
                setActiveId(tab.id);
              }}
              onRefresh={() => void refresh()}
              onNotice={setToast}
              onMutate={async (sql, target, newName) => {
                if (busyRef.current)
                  throw Error("Wait for the current query to finish.");
                const id = profile.id,
                  requestId = crypto.randomUUID();
                busyRef.current = true;
                setBusy("object-management");
                queryId.current = requestId;
                try {
                  const output = await api<ExecutionResult>("execute_sql", {
                    id,
                    requestId,
                    sql,
                  });
                  if (output.error) throw Error(output.error);
                  const updated = tabsRef.current.flatMap((tab) => {
                    if (
                      tab.profileId !== id ||
                      !tab.table ||
                      tab.table.schema !== target.schema ||
                      (target.table && tab.table.name !== target.table.name)
                    )
                      return [tab];
                    if (!newName) return [];
                    const table = target.table
                      ? { ...tab.table, name: newName }
                      : { ...tab.table, schema: newName };
                    return [
                      {
                        ...tab,
                        table,
                        title: table.name,
                        sql: tableSql(table),
                        page: 0,
                        result: undefined,
                        error: undefined,
                        execution: undefined,
                      },
                    ];
                  });
                  setTabs(updated);
                  setActiveId((current) =>
                    updated.some((t) => t.id === current)
                      ? current
                      : updated.at(-1)?.id || "",
                  );
                  setCatalogRevision((r) => r + 1);
                  try {
                    const catalog = await readCatalog(id);
                    setConnections((cs) =>
                      cs[id] ? { ...cs, [id]: { ...cs[id], ...catalog } } : cs,
                    );
                  } catch (e) {
                    setMessage(
                      `Object changed, but refresh failed. Do not repeat the operation: ${String(e)}`,
                    );
                  }
                  setToast(newName ? "Object renamed" : "Object dropped");
                } finally {
                  busyRef.current = false;
                  setBusy("");
                  queryId.current = "";
                }
              }}
            />
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={15} />
            <span>On your machine. In your hands.</span>
          </div>
          <UpdateNotice />
          <div className="sidebar-footer">
            <span>Appearance</span>
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
            {profile && (
              <span
                className="connection-identity"
                title={
                  profile.driver === "postgres"
                    ? `${profile.username}@${profile.host}:${profile.port}/${profile.database}`
                    : profile.path
                }
              >
                <Database size={13} />
                {profile.driver === "postgres"
                  ? `${profile.username} / ${profile.database}`
                  : "SQLite · local file"}
              </span>
            )}
            {profile && (
              <button
                className="icon-button"
                title="Disconnect selected database"
                aria-label="Disconnect database"
                aria-disabled={!!busy}
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
                  disabled={connecting || editing}
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
                <p>Run SQL with the permissions of your database user.</p>
              </div>
            </div>
            <div className="welcome-foot">
              <span>SMALL TOOL. THOUGHTFUL DETAILS.</span>
              <span>No cloud account. No telemetry.</span>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="tabs" role="tablist" aria-label="Workspace tabs">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab ${t.id === activeId ? "active" : ""}`}
                >
                  <button
                    role="tab"
                    aria-selected={t.id === activeId}
                    onClick={() => {
                      if (t.id !== activeId && guardEdits()) return;
                      setActiveId(t.id);
                      setSelectedId(t.profileId);
                    }}
                  >
                    {t.overview ? (
                      <GitFork size={14} />
                    ) : t.table ? (
                      <Table2 size={14} />
                    ) : (
                      <FileCode2 size={14} />
                    )}
                    <span>{t.title}</span>
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`Close ${t.title}`}
                    aria-disabled={busy === t.id}
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
            {active.overview ? (
              <DatabaseRelations
                key={`${active.id}-${catalogRevision}`}
                connectionId={active.profileId}
                connected={!!profile}
                scope={active.overviewSchema}
                onOpen={(table) => void browse(table, connection, "structure")}
              />
            ) : (
              <>
                {active.table && (
                  <TableWorkbench
                    driver={dialectProfile?.driver || "sqlite"}
                    key={`${active.id}-${catalogRevision}`}
                    connectionId={active.profileId}
                    table={active.table}
                    connected={!!profile}
                    visibleTables={connection?.tables || []}
                    view={active.tableView || "data"}
                    onView={(tableView) => {
                      if (!guardEdits()) patch(active.id, { tableView });
                    }}
                    onOpen={(table) => void browse(table)}
                  />
                )}
                <div
                  className="data-workspace"
                  hidden={
                    !!active.table &&
                    !!active.tableView &&
                    active.tableView !== "data"
                  }
                >
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
                        <AutoRun
                          key={active.id}
                          identity={`${active.id}:${active.page}`}
                          sql={active.sql}
                          available={!!profile}
                          suspended={
                            !!editing ||
                            !!jsonViewer ||
                            historyOpen ||
                            scriptsOpen ||
                            !!modal ||
                            !!removingConnection ||
                            connecting ||
                            (!!active.tableView && active.tableView !== "data")
                          }
                          run={() =>
                            execute(
                              active,
                              active.sql,
                              active.page,
                              false,
                              true,
                            )
                          }
                        />
                        <button
                          className="primary small run-query-button"
                          aria-busy={!!busy}
                          disabled={!profile && !busy}
                          aria-label={
                            busy
                              ? "Cancel running query"
                              : active.table
                                ? "Run query"
                                : "Run script"
                          }
                          title={
                            busy
                              ? "Running… click to cancel"
                              : "Run query (⌘ Enter)"
                          }
                          onClick={() => {
                            if (busy)
                              void api("cancel_query", {
                                requestId: queryId.current,
                              }).catch((e) => setMessage(String(e)));
                            else void execute(active);
                          }}
                        >
                          <Play
                            size={12}
                            fill="currentColor"
                            aria-hidden="true"
                          />
                          {!active.table ? "Run script" : "Run query"}
                        </button>
                      </div>
                    </div>
                    <SqlEditor
                      key={active.id}
                      readOnly={busy === active.id || editing}
                      value={active.sql}
                      onChange={(sql) => {
                        setSelectedRow(null);
                        patch(active.id, {
                          sql,
                          table: undefined,
                          page: 0,
                          result: undefined,
                          execution: undefined,
                          error: undefined,
                        });
                      }}
                      onRun={(selection) =>
                        void execute(
                          tabsRef.current.find((t) => t.id === activeId) ||
                            active,
                          selection,
                          active.page,
                          !!selection,
                        )
                      }
                      driver={dialectProfile?.driver || "sqlite"}
                      tables={connection?.tables || []}
                      theme={resolved}
                    />
                    <div className="editor-foot">
                      <span>
                        <ShieldCheck size={11} />{" "}
                        {!active.table
                          ? "Full SQL · Runs the selected SQL or entire script · Changes apply directly"
                          : "SELECT & WITH queries · 200-row preview · 15s statement limit"}
                      </span>
                      <div className="editor-foot-actions">
                        <div
                          className="editor-script-actions"
                          role="group"
                          aria-label="SQL scripts"
                        >
                          <button
                            className="icon-button"
                            title="Query history"
                            aria-label="Query history"
                            onClick={() => setHistoryOpen(true)}
                          >
                            <RotateCcwClock size={16} />
                          </button>
                          <button
                            className="icon-button"
                            title="Save script"
                            aria-label="Save script"
                            disabled={!active.sql.trim()}
                            onClick={() => {
                              const existing = savedState.scripts.find(
                                (script) => script.id === active.savedScriptId,
                              );
                              setScriptDraft({
                                id: existing?.id || crypto.randomUUID(),
                                name: existing?.name || active.title,
                                sql: active.sql,
                                profileId: active.profileId,
                                connectionName:
                                  dialectProfile?.name || "Database",
                                driver: dialectProfile?.driver || "sqlite",
                                updatedAt: Date.now(),
                              });
                              setScriptsOpen(true);
                            }}
                          >
                            <Save size={16} />
                          </button>
                          <button
                            className="icon-button"
                            title="Saved scripts"
                            aria-label="Saved scripts"
                            onClick={() => {
                              setScriptDraft(null);
                              setScriptsOpen(true);
                            }}
                          >
                            <FolderOpen size={16} />
                          </button>
                        </div>
                        <span className="editor-encoding">
                          UTF-8 <span className="foot-dot">·</span> SQL
                        </span>
                      </div>
                    </div>
                  </div>
                  {active.execution && (
                    <div className="execution-summary" role="status">
                      <div>
                        <Check size={14} />
                        <b>
                          {active.execution.error
                            ? "Execution needs attention"
                            : "Execution finished"}
                        </b>
                        <span>
                          {active.execution.results.length} completed
                          statement(s) · {active.execution.elapsedMs} ms
                        </span>
                        {active.execution.results.length > 0 && (
                          <select
                            aria-label="Statement result"
                            value={active.execution.results.indexOf(result!)}
                            onChange={(e) => {
                              patch(active.id, {
                                result:
                                  active.execution!.results[
                                    Number(e.target.value)
                                  ],
                              });
                              setFilter("");
                              setSort(null);
                              setSelectedRow(null);
                            }}
                          >
                            {active.execution.results.map((r, i) => (
                              <option key={i} value={i}>
                                Statement {i + 1} ·{" "}
                                {r.columns.length
                                  ? `${r.rows.length}${r.truncated ? "+" : ""} preview rows`
                                  : "No preview rows"}{" "}
                                · affected: {r.affectedRows ?? "—"}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {active.execution.omittedResults > 0 && (
                        <p>
                          {active.execution.omittedResults} additional statement
                          results omitted from preview.
                        </p>
                      )}
                      {active.execution.error && (
                        <pre role="alert">{active.execution.error}</pre>
                      )}
                    </div>
                  )}
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
                        className="icon-button query-refresh-button"
                        title={
                          busy ? "Query is already running" : "Refresh query"
                        }
                        aria-label="Refresh query"
                        aria-busy={!!busy}
                        disabled={!profile}
                        onClick={() => {
                          if (!busyRef.current) void execute(active);
                        }}
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
                  {active.error && result && (
                    <div className="auto-run-error-banner" role="alert">
                      {active.error}
                      <span>
                        {" "}
                        Previous result is still shown.
                        {!active.table &&
                        !active.error.startsWith("Auto run stopped")
                          ? " Earlier statements may have committed; inspect before retrying."
                          : ""}
                      </span>
                    </div>
                  )}
                  <div className="result-body">
                    {active.error && !result ? (
                      <div className="query-error" role="alert">
                        <AlertCircle size={24} />
                        <h3>Let’s take another look.</h3>
                        <pre>{active.error}</pre>
                        <p>
                          {active.table ||
                          active.error.startsWith("Auto run stopped")
                            ? "Update your query above and try again."
                            : "Some changes may already be committed. Check the database before running this SQL again."}
                        </p>
                      </div>
                    ) : busy === active.id && !result ? (
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
                          Write a query above and press <kbd>⌘ Enter</kbd> to
                          run it.
                        </p>
                        <span className="empty-note">
                          <ShieldCheck size={12} /> SQL runs with your database
                          permissions.
                        </span>
                      </div>
                    ) : !result.columns.length ? (
                      <div className="result-empty">
                        <Check size={28} />
                        <h3>Statement completed.</h3>
                        <p>
                          Database-reported affected rows:{" "}
                          {result.affectedRows ?? "—"}
                        </p>
                        <span className="empty-note">
                          SELECT data to inspect the current database state.
                        </span>
                      </div>
                    ) : (
                      <>
                        {active.table &&
                        active.sql === tableSql(active.table, active.page) ? (
                          <EditableGrid
                            key={active.id}
                            tab={active}
                            rows={rows}
                            sort={sort}
                            onSort={setSort}
                            selectedRow={selectedRow}
                            onRow={(index, inspect) => {
                              setSelectedRow(index);
                              if (inspect) setInspector(true);
                            }}
                            connected={!!profile}
                            onOpenJson={setJsonViewer}
                            busy={!!busy}
                            onEditing={updateEditing}
                            onApplied={async () => {
                              const refreshed = await api<QueryResult>(
                                "run_query",
                                {
                                  id: active.profileId,
                                  requestId: crypto.randomUUID(),
                                  sql: active.sql,
                                },
                              );
                              patch(active.id, {
                                result: refreshed,
                                error: undefined,
                              });
                              setSelectedRow(null);
                              setToast("Table updated.");
                            }}
                          />
                        ) : (
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
                                            asc:
                                              sort?.index === i
                                                ? !sort.asc
                                                : true,
                                          })
                                        }
                                      >
                                        <span>
                                          <b>{c.name}</b>
                                          <small>{c.dataType || "value"}</small>
                                        </span>
                                        <ArrowUpDown
                                          size={11}
                                          className={
                                            sort?.index === i ? "accent" : ""
                                          }
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
                                      selectedRow === index
                                        ? "selected-row"
                                        : ""
                                    }
                                    tabIndex={0}
                                    aria-label={`Row ${active.page * PAGE_SIZE + index + 1}`}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                      ) {
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
                                          <JsonCell
                                            value={v}
                                            dataType={
                                              result.columns[i]?.dataType || ""
                                            }
                                            raw={result.jsonRaw?.[index]?.[i]}
                                            label={`${result.columns[i]?.name} · Row ${active.page * PAGE_SIZE + index + 1}`}
                                            onOpen={setJsonViewer}
                                          />
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
                        )}
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
                            {selectedRow === null ||
                            !result.rows[selectedRow] ? (
                              <div className="inspector-empty">
                                <Columns3 size={24} />
                                <p>Select a row to see its values.</p>
                              </div>
                            ) : (
                              <>
                                <span className="inspector-row">
                                  ROW{" "}
                                  {active.page * PAGE_SIZE + selectedRow + 1}
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
                                      <JsonCell
                                        value={result.rows[selectedRow][i]}
                                        dataType={c.dataType}
                                        raw={result.jsonRaw?.[selectedRow]?.[i]}
                                        label={`${c.name} · Row ${active.page * PAGE_SIZE + selectedRow + 1}`}
                                        onOpen={setJsonViewer}
                                      />
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
                          <span className="foot-dot">·</span>{" "}
                          {result.columns.length} columns
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
                        <KeyRound size={11} />{" "}
                        {active.table
                          ? "Table preview"
                          : "Database permissions"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
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
            <button
              className="history-trigger"
              onClick={() => setHistoryOpen(true)}
              title="Query history"
            >
              <RotateCcwClock size={11} /> Query history ({history.length}) ·
              Session only
            </button>
            <span className="status-separator">/</span>
            <button
              className="history-trigger"
              onClick={() => {
                setScriptDraft(null);
                setScriptsOpen(true);
              }}
            >
              <FolderOpen size={11} /> Saved scripts (
              {savedState.scripts.length})
            </button>
          </div>
        </footer>
      </main>
      {scriptsOpen && (
        <SavedScripts
          scripts={savedState.scripts}
          draft={scriptDraft}
          loadError={savedState.error}
          onClose={() => setScriptsOpen(false)}
          onSave={(script) => {
            persistScripts([
              script,
              ...savedState.scripts.filter((item) => item.id !== script.id),
            ]);
            if (scriptDraft?.id === script.id && active)
              patch(active.id, {
                savedScriptId: script.id,
                title: script.name,
              });
            setToast("Script saved.");
          }}
          onDelete={(id) =>
            persistScripts(
              savedState.scripts.filter((script) => script.id !== id),
            )
          }
          onOpen={(script) => {
            if (guardEdits()) return;
            const tab: QueryTab = {
              id: crypto.randomUUID(),
              savedScriptId: script.id,
              profileId: script.profileId,
              title: script.name,
              sql: script.sql,
              page: 0,
            };
            setTabs((tabs) => [...tabs, tab]);
            setActiveId(tab.id);
            setSelectedId(script.profileId);
            setScriptsOpen(false);
          }}
        />
      )}
      {historyOpen && (
        <QueryHistory
          entries={history}
          onClose={() => setHistoryOpen(false)}
          onClear={() => setHistory([])}
          onOpen={(entry) => {
            if (guardEdits()) return;
            const tab: QueryTab = {
              id: crypto.randomUUID(),
              profileId: entry.profileId,
              title: "History query",
              sql: entry.sql,
              page: 0,
            };
            setTabs((tabs) => [...tabs, tab]);
            setActiveId(tab.id);
            setSelectedId(entry.profileId);
            setHistoryOpen(false);
          }}
        />
      )}
      {jsonViewer && (
        <JsonViewer value={jsonViewer} onClose={() => setJsonViewer(null)} />
      )}
      {removingConnection && (
        <RemoveConnectionDialog
          profile={removingConnection}
          connected={!!connections[removingConnection.id]}
          onClose={() => setRemovingConnection(null)}
          onRemove={async () => {
            if (guardEdits())
              throw new Error("Save or discard table changes first.");
            if (busyRef.current || connecting)
              throw new Error("Wait for the current operation to finish.");
            const id = removingConnection.id;
            busyRef.current = true;
            setConnecting(true);
            try {
              if (connections[id]) {
                await api("disconnect_database", { id });
                setConnections((current) => {
                  const next = { ...current };
                  delete next[id];
                  return next;
                });
              }
              await api("remove_connection", { id });
              setProfiles((current) =>
                current.filter((profile) => profile.id !== id),
              );
              setSelectedId((current) => (current === id ? "" : current));
              setRemovingConnection(null);
              setToast("Connection removed. Your database is unchanged.");
            } finally {
              busyRef.current = false;
              setConnecting(false);
            }
          }}
        />
      )}
      {modal && (
        <ConnectionDialog
          key={modal.id}
          profile={modal}
          saved={profiles.some((p) => p.id === modal.id)}
          onClose={() => setModal(null)}
          onConnected={didConnect}
          onSaved={(saved) => {
            setProfiles((ps) => [
              ...ps.filter((p) => p.id !== saved.id),
              saved,
            ]);
            setModal(null);
            setToast("Connection saved. Connect whenever you are ready.");
          }}
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
  saved,
  onClose,
  onConnected,
  onSaved,
}: {
  profile: Profile;
  saved: boolean;
  onClose: () => void;
  onConnected: (c: Connected) => Promise<void>;
  onSaved: (p: Profile) => void;
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
  async function saveOnly() {
    if (working) return;
    if (!dialog.current?.querySelector("form")?.reportValidity()) return;
    setWorking("save");
    setError("");
    try {
      const saved = await api<Profile>("save_connection", {
        profile: p,
        password: password || null,
      });
      setPassword("");
      onSaved(saved);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
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
            <span className="eyebrow">
              {saved ? "SAVED CONNECTION" : "A NEW CONNECTION"}
            </span>
            <h2>{saved ? "Connection settings." : "Meet your database."}</h2>
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
              <small>
                An existing SQLite file. SQL access follows file permissions.
              </small>
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
                      initial.rememberPassword
                        ? "Leave blank to keep saved password"
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
              Save keeps settings on this device without connecting. Passwords
              are stored only when Remember password is selected. SQL follows
              database or file permissions.
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
              type="button"
              className="secondary"
              disabled={!!working || !desktop}
              onClick={() => void saveOnly()}
            >
              {working === "save" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Save size={14} />
              )}{" "}
              Save
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
              Save & connect
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
