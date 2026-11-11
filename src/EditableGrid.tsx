import { ColumnFilterDialog } from "./PreviewOptions";
import { createPortal } from "react-dom";
import type { TableDetailsCache } from "./table-details-cache";
import { JsonCell } from "./JsonCell";
import { parseJson, prettyJson, type JsonDocument } from "./json-viewer-model";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Undo2,
  Check,
  X,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Filter,
  Pencil,
} from "lucide-react";
import { api } from "./api";
import {
  cellText,
  type Cell,
  type QueryTab,
  type PreviewOptions,
} from "./model";
import type { TableDetails } from "./table-model";
import {
  editableColumn,
  jsonColumn,
  editableRow,
  parseCell,
  stageCell,
} from "./cell-editing-model";
import {
  emptyDraft,
  mutationCount,
  mutations,
  deleteRows,
  snapshotRows,
  originalRow,
  type GridDraft,
} from "./grid-editing-model";
import "./grid-editing.css";
type Editor = {
  row: number | string;
  column: number;
  text: string;
  mode: "value" | "null" | "default";
};
export function EditableGrid({
  tab,
  cache,
  rows,
  sort,
  onSort,
  onTableSort,
  onPreviewOptions,
  selectedRow,
  onRow,
  connected,
  postgres,
  busy,
  onEditing,
  onApplied,
  onOpenJson,
}: {
  tab: QueryTab;
  cache: TableDetailsCache;
  rows: { values: Cell[]; index: number }[];
  sort: { index: number; asc: boolean } | null;
  onSort: (s: { index: number; asc: boolean }) => void;
  onTableSort: (column: string, direction: "ASC" | "DESC") => void;
  onPreviewOptions: (options: PreviewOptions) => void;
  selectedRow: number | null;
  onRow: (index: number, inspect?: boolean) => void;
  connected: boolean;
  postgres: boolean;
  busy: boolean;
  onEditing: (value: boolean) => void;
  onApplied: () => Promise<void>;
  onOpenJson: (doc: JsonDocument) => void;
}) {
  const [source, setSource] = useState(tab.result!);
  const [details, setDetails] = useState<TableDetails | null>(() =>
    cache.peek(tab.profileId, tab.table!),
  );
  const [draft, setDraftState] = useState<GridDraft>(emptyDraft);
  const draftRef = useRef(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setDraft = (next: GridDraft) => {
    setConfirmDelete(false);
    draftRef.current = next;
    setDraftState(next);
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false),
    [failed, setFailed] = useState(false),
    [error, setError] = useState("");
  const editorElement = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const count = mutationCount(draft);
  const canEdit =
    !!connected &&
    !busy &&
    !saving &&
    !failed &&
    !!details &&
    details.table.kind === "table" &&
    details.columns.some((c) => c.primaryKeyPosition > 0) &&
    details.columns.every((c, i) => source.columns[i]?.name === c.name);
  const pending = count > 0 || !!editor || saving;
  const [columnMenu, setColumnMenu] = useState<{
    column: string;
    x: number;
    y: number;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [filterDialog, setFilterDialog] = useState<{
    column: TableDetails["columns"][number];
    anchor: HTMLButtonElement;
  } | null>(null);
  const applied = tab.previewOptions;
  function closeFilterDialog() {
    filterDialog?.anchor.focus();
    setFilterDialog(null);
  }
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const menuDisabled = busy || pending || !connected;
  useEffect(() => {
    if (!columnMenu) return;
    if (menuDisabled) {
      setColumnMenu(null);
      return;
    }
    columnMenuRef.current?.querySelector("button")?.focus();
    const close = () => setColumnMenu(null);
    const outside = (event: PointerEvent) => {
      if (!columnMenuRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [columnMenu, menuDisabled]);
  function openColumnMenu(
    column: string,
    anchor: HTMLButtonElement,
    x: number,
    y: number,
  ) {
    if (menuDisabled) return;
    setColumnMenu({
      column,
      anchor,
      x: Math.max(8, Math.min(x, window.innerWidth - 236)),
      y: Math.max(
        8,
        Math.min(
          y,
          window.innerHeight -
            (applied?.filter && applied.sort
              ? 218
              : applied?.filter || applied?.sort
                ? 186
                : 145),
        ),
      ),
    });
  }
  useEffect(() => {
    let disposed = false;
    setDetails(connected ? cache.peek(tab.profileId, tab.table!) : null);
    if (!connected) return;
    void cache
      .load(tab.profileId, tab.table!)
      .then((d) => {
        if (!disposed) setDetails(d);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [cache, tab.profileId, tab.table?.schema, tab.table?.name, connected]);
  useEffect(() => {
    if (!pending && tab.result) {
      setSource(tab.result);
      setSelected(new Set());
    }
  }, [tab.result, pending]);
  useEffect(() => {
    onEditing(pending);
  }, [pending, onEditing]);
  useEffect(() => {
    const stop = (event: BeforeUnloadEvent) => {
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [pending]);
  function finalized(): GridDraft | null {
    if (!editor || !details) return draftRef.current;
    try {
      const c = details.columns[editor.column];
      const value =
        editor.mode === "default"
          ? undefined
          : parseCell(editor.text, c, editor.mode === "null");
      let next = draftRef.current;
      if (typeof editor.row === "number") {
        if (value === undefined)
          throw Error("Existing cells cannot use DEFAULT.");
        next = {
          ...next,
          edits: stageCell(
            next.edits,
            editor.row,
            c.name,
            value,
            originalRow(source, editor.row),
            editor.column,
          ),
        };
      } else {
        next = {
          ...next,
          inserted: next.inserted.map((row) => {
            if (row.id !== editor.row) return row;
            const values = { ...row.values, [c.name]: value as Cell };
            if (value === undefined) delete values[c.name];
            return { ...row, values };
          }),
        };
      }
      setDraft(next);
      setEditor(null);
      setError("");
      return next;
    } catch (e) {
      setError(String(e));
      editorElement.current
        ?.querySelector<HTMLInputElement>("input,select")
        ?.focus();
      return null;
    }
  }
  function start(row: number | string, column: number) {
    setConfirmDelete(false);
    if (
      !canEdit ||
      !details ||
      !editableColumn(details.columns[column], postgres)
    )
      return;
    if (
      typeof row === "number" &&
      (draftRef.current.deleted.includes(row) ||
        !editableRow(details, source, source.rows[row], postgres))
    )
      return;
    const next = finalized();
    if (!next) return;
    const c = details.columns[column];
    const values =
      typeof row === "number"
        ? next.edits[row]?.changes
        : next.inserted.find((r) => r.id === row)?.values;
    const explicit = !!values && Object.hasOwn(values, c.name);
    const value = explicit
      ? values![c.name]
      : typeof row === "number"
        ? (source.jsonRaw?.[row]?.[column] ?? source.rows[row][column])
        : undefined;
    const mode =
      value === undefined ? "value" : value === null ? "null" : "value";
    setEditor({ row, column, text: value == null ? "" : String(value), mode });
    setError("");
  }
  function add() {
    if (
      !canEdit ||
      !details ||
      !finalized() ||
      mutationCount(draftRef.current) >= 200
    )
      return;
    const id = crypto.randomUUID();
    setDraft({
      ...draftRef.current,
      inserted: [...draftRef.current.inserted, { id, values: {} }],
    });
    const column = details.columns.findIndex(
      (c) =>
        editableColumn(c, postgres) &&
        c.name !== details.rowidAlias &&
        c.primaryKeyPosition === 0,
    );
    if (column >= 0) setEditor({ row: id, column, text: "", mode: "value" });
    requestAnimationFrame(() => {
      if (wrap.current) wrap.current.scrollTop = wrap.current.scrollHeight;
    });
  }
  function remove() {
    if (!canEdit || !finalized()) return;
    const indices = [...selected]
      .filter((k) => k.startsWith("row:"))
      .map((k) => Number(k.slice(4)))
      .filter(
        (i) =>
          details && editableRow(details, source, source.rows[i], postgres),
      );
    setDraft(
      deleteRows(
        draftRef.current,
        indices,
        [...selected].filter((k) => !k.startsWith("row:")),
      ),
    );
    setSelected(new Set());
  }
  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  async function reload() {
    setSaving(true);
    setError("");
    try {
      await onApplied();
      setDraft(emptyDraft());
      setEditor(null);
      setFailed(false);
      setSelected(new Set());
    } catch (e) {
      setError(`Could not reload: ${String(e)}`);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  async function save(confirmed = false) {
    if (saving || busy || failed || !details) return;
    const next = finalized();
    if (!next) return;
    const batch = mutations(next, source);
    if (!batch.length) return;
    if (batch.length > 200) {
      setError("Save up to 200 changed rows at a time.");
      return;
    }
    for (const row of next.inserted)
      for (const c of details.columns) {
        if (
          !c.nullable &&
          !c.defaultValue &&
          !c.generated &&
          !c.identity &&
          c.name !== details.rowidAlias &&
          !Object.hasOwn(row.values, c.name)
        ) {
          setError(`Enter a value for ${c.name} in the new row.`);
          return;
        }
      }
    if (next.deleted.length && !confirmed) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setSaving(true);
    setError("");
    try {
      await api<number>("apply_cell_edits", {
        id: tab.profileId,
        table: tab.table,
        edits: batch,
      });
    } catch (e) {
      setError(`${String(e)} Discard and reload before trying again.`);
      setFailed(true);
      setSaving(false);
      return;
    }
    // A committed batch is never left retryable, including when the reload fails.
    setDraft(emptyDraft());
    setEditor(null);
    setSelected(new Set());
    try {
      await onApplied();
    } catch (e) {
      setError(`Changes saved, but reload failed: ${String(e)}`);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  function cell(row: number | string, column: number, value: Cell | undefined) {
    const c = details?.columns[column];
    const isNew = typeof row === "string";
    const isJson = !!c && postgres && jsonColumn(c);
    const deleted = !isNew && draft.deleted.includes(row);
    const changed = isNew
      ? value !== undefined
      : !!c && Object.hasOwn(draft.edits[row]?.changes || {}, c.name);
    const editing = editor?.row === row && editor.column === column;
    const allowed =
      canEdit &&
      !!c &&
      editableColumn(c, postgres) &&
      !deleted &&
      (isNew || editableRow(details!, source, source.rows[row], postgres));
    const display =
      changed && !isNew && c ? draft.edits[row].changes[c.name] : value;
    return (
      <td
        key={column}
        tabIndex={allowed ? 0 : undefined}
        className={`${changed ? "grid-cell-changed " : ""}${editing ? "grid-cell-editing " : ""}${display === null ? "null-cell" : ""}`}
        title={
          allowed
            ? "Double-click or press Enter to edit"
            : cellText(display ?? null)
        }
        onDoubleClick={(e) => {
          e.stopPropagation();
          start(row, column);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            start(row, column);
          }
        }}
      >
        {editing && c ? (
          <div
            ref={editorElement}
            className={`grid-cell-editor${isJson ? " grid-json-editor" : ""}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (!isJson && !e.currentTarget.contains(e.relatedTarget as Node))
                finalized();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setEditor(null);
                setError("");
              }
              if (e.key === "Enter" && (!isJson || e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                finalized();
              }
            }}
          >
            {isJson && (
              <header className="grid-json-header">
                <strong>{c.name}</strong>
                <code>{c.dataType}</code>
                <button
                  type="button"
                  className="text-button"
                  disabled={editor.mode !== "value" || !editor.text.trim()}
                  onClick={() => {
                    try {
                      setEditor({
                        ...editor,
                        text: prettyJson(parseJson(editor.text)),
                      });
                      setError("");
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Could not format JSON.",
                      );
                    }
                  }}
                >
                  Format JSON
                </button>
              </header>
            )}
            {isJson ? (
              <textarea
                autoFocus
                aria-label={`${c.name} JSON value`}
                aria-keyshortcuts="Meta+Enter Control+Enter"
                rows={7}
                spellCheck={false}
                autoCapitalize="off"
                disabled={editor.mode !== "value"}
                value={editor.text}
                onChange={(e) => {
                  setEditor({ ...editor, text: e.target.value });
                  setError("");
                }}
              />
            ) : c.enumValues.length > 0 ? (
              <select
                autoFocus
                aria-label={`${c.name} value`}
                disabled={editor.mode !== "value"}
                value={editor.text}
                onChange={(e) => setEditor({ ...editor, text: e.target.value })}
              >
                {!c.enumValues.includes("") && (
                  <option value="">Choose…</option>
                )}
                {c.enumValues.map((label) => (
                  <option key={label} value={label}>
                    {label || "(empty string)"}
                  </option>
                ))}
              </select>
            ) : /^(bool|boolean)$/i.test(c.dataType) ? (
              <select
                autoFocus
                aria-label={`${c.name} value`}
                disabled={editor.mode !== "value"}
                value={
                  editor.text === "1"
                    ? "true"
                    : editor.text === "0"
                      ? "false"
                      : editor.text
                }
                onChange={(e) => setEditor({ ...editor, text: e.target.value })}
              >
                <option value="">Choose…</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                autoFocus
                aria-label={`${c.name} value`}
                disabled={editor.mode !== "value"}
                value={editor.text}
                onChange={(e) =>
                  setEditor({ ...editor, text: e.target.value, mode: "value" })
                }
              />
            )}
            <div className={isJson ? "grid-json-actions" : "grid-value-mode"}>
              <select
                aria-label={`${c.name} value mode`}
                value={editor.mode}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    mode: e.target.value as Editor["mode"],
                  })
                }
              >
                <option value="value">{isJson ? "JSON value" : "Value"}</option>
                {c.nullable && (
                  <option value="null">{isJson ? "SQL NULL" : "NULL"}</option>
                )}
                {isNew && <option value="default">Default</option>}
              </select>
              {isJson && (
                <>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditor(null);
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => finalized()}
                  >
                    Stage edit
                  </button>
                </>
              )}
            </div>
          </div>
        ) : display === undefined ? (
          <span className="grid-placeholder">
            {c?.generated || c?.identity || c?.name === details?.rowidAlias
              ? "Auto"
              : c?.defaultValue
                ? "Default"
                : c?.nullable
                  ? "NULL"
                  : "Required"}
          </span>
        ) : (
          <>
            <JsonCell
              value={display}
              dataType={source.columns[column]?.dataType || ""}
              raw={
                changed
                  ? c && jsonColumn(c) && typeof display === "string"
                    ? display
                    : undefined
                  : typeof row === "number"
                    ? source.jsonRaw?.[row]?.[column]
                    : undefined
              }
              label={`${source.columns[column]?.name} · ${typeof row === "number" ? `Row ${tab.page * 200 + row + 1}` : "New row"}`}
              onOpen={onOpenJson}
            />
            {allowed && c && postgres && jsonColumn(c) && (
              <button
                type="button"
                className="icon-button"
                title="Edit JSON"
                aria-label={`Edit JSON ${c.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  start(row, column);
                }}
              >
                <Pencil size={12} />
              </button>
            )}
          </>
        )}
      </td>
    );
  }
  const visible = snapshotRows(
    source,
    rows.map((r) => r.index),
  );
  const rowKeys = visible
    .filter(
      (r) =>
        details &&
        editableRow(details, source, r.values, postgres) &&
        !draft.deleted.includes(r.index),
    )
    .map((r) => `row:${r.index}`);
  const allSelected =
    rowKeys.length > 0 && rowKeys.every((k) => selected.has(k));
  return (
    <div
      className="editable-grid"
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      <div className="grid-edit-toolbar">
        <div>
          <button
            className="secondary small"
            disabled={!canEdit || count >= 200}
            onClick={add}
          >
            <Plus size={13} />
            Add row
          </button>
          <button
            className="text-button"
            disabled={!canEdit || !selected.size}
            onClick={remove}
          >
            <Trash2 size={13} />
            Delete{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
        <div>
          <span className="grid-edit-summary">
            {count
              ? `${draft.inserted.length} new · ${Object.keys(draft.edits).filter((i) => !draft.deleted.includes(Number(i))).length} edited · ${draft.deleted.length} deleted`
              : details
                ? "Double-click a cell to edit · Enter to finish"
                : "Reading table…"}
          </span>
          {failed ? (
            <>
              <button
                className="text-button"
                disabled={saving || (!count && !editor)}
                onClick={() => {
                  setDraft(emptyDraft());
                  setEditor(null);
                  setSelected(new Set());
                  setError(
                    "Changes discarded. Reload before editing this table again.",
                  );
                }}
              >
                Discard
              </button>
              <button
                className="secondary small"
                disabled={saving}
                onClick={() => void reload()}
              >
                Reload
              </button>
            </>
          ) : (
            <>
              <button
                className="text-button"
                disabled={(!count && !editor) || saving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDraft(emptyDraft());
                  setEditor(null);
                  setError("");
                  setSelected(new Set());
                }}
              >
                <X size={13} />
                Discard
              </button>
              <button
                className="primary small"
                disabled={(!count && !editor) || saving || busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void save()}
              >
                <Check size={13} />
                {saving ? "Saving…" : `Save${count ? ` (${count})` : ""}`}
              </button>
            </>
          )}
        </div>
      </div>
      {confirmDelete && (
        <div className="grid-delete-confirm" role="alert">
          <span>
            Delete {draft.deleted.length} row(s) and save all changes?
          </span>
          <button
            className="secondary small"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
          <button
            className="primary small"
            disabled={saving || busy}
            onClick={() => void save(true)}
          >
            Delete & save
          </button>
        </div>
      )}
      {error && (
        <div className="grid-edit-error" role="alert">
          {error}
        </div>
      )}
      {details && !details.columns.some((c) => c.primaryKeyPosition > 0) && (
        <div className="grid-edit-hint">
          Read-only: this table needs a primary key to edit rows.
        </div>
      )}
      <div className="data-grid-wrap" ref={wrap}>
        <table className="data-grid">
          <thead>
            <tr>
              <th className="grid-selection">
                <input
                  type="checkbox"
                  aria-label="Select visible rows"
                  checked={allSelected}
                  disabled={!canEdit || !rowKeys.length}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rowKeys))
                  }
                />
              </th>
              <th className="row-number">#</th>
              {source.columns.map((c, i) => (
                <th key={i}>
                  <button
                    title="Click to sort this page. Right-click to filter or sort the table."
                    aria-haspopup="menu"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const anchor = event.currentTarget;
                      const rect = anchor.getBoundingClientRect();
                      openColumnMenu(
                        c.name,
                        anchor,
                        event.clientX || rect.left,
                        event.clientY || rect.bottom,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ContextMenu" &&
                        !(event.shiftKey && event.key === "F10")
                      )
                        return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openColumnMenu(
                        c.name,
                        event.currentTarget,
                        rect.left,
                        rect.bottom,
                      );
                    }}
                    onClick={() =>
                      onSort({
                        index: i,
                        asc: sort?.index === i ? !sort.asc : true,
                      })
                    }
                  >
                    <span>
                      <b>{c.name}</b>
                      <small>{c.dataType || "value"}</small>
                    </span>
                    <span className="grid-column-actions">
                      {applied?.filter?.column === c.name && (
                        <Filter
                          className="accent"
                          size={11}
                          aria-label="Filter applied"
                        />
                      )}
                      {applied?.sort?.column === c.name && sort?.index !== i ? (
                        applied.sort.direction === "ASC" ? (
                          <ArrowUp
                            className="accent"
                            size={11}
                            aria-label="Table sorted ascending"
                          />
                        ) : (
                          <ArrowDown
                            className="accent"
                            size={11}
                            aria-label="Table sorted descending"
                          />
                        )
                      ) : (
                        <ArrowUpDown
                          size={11}
                          className={sort?.index === i ? "accent" : ""}
                        />
                      )}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ values, index }) => (
              <tr
                key={index}
                className={`${draft.deleted.includes(index) ? "grid-row-deleted " : ""}${selectedRow === index ? "selected-row" : ""}`}
                onClick={() => onRow(index)}
              >
                <td className="grid-selection">
                  <input
                    type="checkbox"
                    aria-label={`Select row ${index + 1}`}
                    disabled={
                      !canEdit ||
                      !details ||
                      !editableRow(details, source, values, postgres) ||
                      draft.deleted.includes(index)
                    }
                    checked={selected.has(`row:${index}`)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(`row:${index}`)}
                  />
                  {draft.deleted.includes(index) && (
                    <button
                      className="grid-undo"
                      title="Undo delete"
                      aria-label={`Undo delete row ${index + 1}`}
                      disabled={saving}
                      onClick={() =>
                        setDraft({
                          ...draftRef.current,
                          deleted: draftRef.current.deleted.filter(
                            (i) => i !== index,
                          ),
                        })
                      }
                    >
                      <Undo2 size={12} />
                    </button>
                  )}
                </td>
                <td className="row-number">{tab.page * 200 + index + 1}</td>
                {values.map((v, i) => cell(index, i, v))}
              </tr>
            ))}
            {draft.inserted.map((row, i) => (
              <tr key={row.id} className="grid-row-new">
                <td className="grid-selection">
                  <input
                    type="checkbox"
                    aria-label={`Select new row ${i + 1}`}
                    disabled={saving || failed}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td className="row-number">New</td>
                {source.columns.map((c, i) =>
                  cell(
                    row.id,
                    i,
                    Object.hasOwn(row.values, c.name)
                      ? row.values[c.name]
                      : undefined,
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !draft.inserted.length && (
          <div className="no-rows">No rows. Choose Add row to create one.</div>
        )}
      </div>
      {columnMenu &&
        createPortal(
          <div
            className="explorer-menu"
            role="menu"
            aria-label={`Table options for ${columnMenu.column}`}
            ref={columnMenuRef}
            style={{ left: columnMenu.x, top: columnMenu.y }}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                setColumnMenu(null);
                columnMenu.anchor.focus();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                items[
                  (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
                    items.length
                ]?.focus();
              }
            }}
          >
            <small>{columnMenu.column}</small>
            {(["ASC", "DESC"] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                role="menuitem"
                onClick={() => {
                  setColumnMenu(null);
                  columnMenu.anchor.focus();
                  onTableSort(columnMenu.column, direction);
                }}
              >
                {direction === "ASC" ? "Sort ascending" : "Sort descending"}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              disabled={
                !details?.columns.some(
                  (column) => column.name === columnMenu.column,
                )
              }
              onClick={() => {
                const column = details?.columns.find(
                  (entry) => entry.name === columnMenu.column,
                );
                columnMenu.anchor.focus();
                if (column)
                  setFilterDialog({ column, anchor: columnMenu.anchor });
                setColumnMenu(null);
              }}
            >
              Filter by this column
            </button>
            {(applied?.filter || applied?.sort) && (
              <>
                <hr />
                {applied.filter && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setColumnMenu(null);
                      columnMenu.anchor.focus();
                      onPreviewOptions({ sort: applied.sort });
                    }}
                  >
                    Clear table filter
                  </button>
                )}
                {applied.sort && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setColumnMenu(null);
                      columnMenu.anchor.focus();
                      onPreviewOptions({ filter: applied.filter });
                    }}
                  >
                    Clear table sort
                  </button>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
      {filterDialog &&
        createPortal(
          <ColumnFilterDialog
            column={filterDialog.column}
            current={
              applied?.filter?.column === filterDialog.column.name
                ? applied.filter
                : undefined
            }
            onClose={closeFilterDialog}
            onApply={(filter) => {
              closeFilterDialog();
              onPreviewOptions({ ...applied, filter });
            }}
          />,
          document.body,
        )}
    </div>
  );
}
