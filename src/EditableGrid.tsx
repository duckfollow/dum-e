import { JsonCell } from "./JsonCell";
import type { JsonDocument } from "./json-viewer-model";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Undo2, Check, X, ArrowUpDown } from "lucide-react";
import { api } from "./api";
import { cellText, type Cell, type QueryTab } from "./model";
import type { TableDetails } from "./table-model";
import {
  editableColumn,
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
  rows,
  sort,
  onSort,
  selectedRow,
  onRow,
  connected,
  busy,
  onEditing,
  onApplied,
  onOpenJson,
}: {
  tab: QueryTab;
  rows: { values: Cell[]; index: number }[];
  sort: { index: number; asc: boolean } | null;
  onSort: (s: { index: number; asc: boolean }) => void;
  selectedRow: number | null;
  onRow: (index: number, inspect?: boolean) => void;
  connected: boolean;
  busy: boolean;
  onEditing: (value: boolean) => void;
  onApplied: () => Promise<void>;
  onOpenJson: (doc: JsonDocument) => void;
}) {
  const [source, setSource] = useState(tab.result!);
  const [details, setDetails] = useState<TableDetails | null>(null);
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
  useEffect(() => {
    let disposed = false;
    void api<TableDetails>("table_details", {
      id: tab.profileId,
      table: tab.table,
    })
      .then((d) => {
        if (!disposed) setDetails(d);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [tab.profileId, tab.table?.schema, tab.table?.name, connected]);
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
            source.rows[editor.row],
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
    if (!canEdit || !details || !editableColumn(details.columns[column]))
      return;
    if (
      typeof row === "number" &&
      (draftRef.current.deleted.includes(row) ||
        !editableRow(details, source, source.rows[row]))
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
        ? source.rows[row][column]
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
        editableColumn(c) &&
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
      .filter((i) => details && editableRow(details, source, source.rows[i]));
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
    const deleted = !isNew && draft.deleted.includes(row);
    const changed = isNew
      ? value !== undefined
      : !!c && Object.hasOwn(draft.edits[row]?.changes || {}, c.name);
    const editing = editor?.row === row && editor.column === column;
    const allowed =
      canEdit &&
      !!c &&
      editableColumn(c) &&
      !deleted &&
      (isNew || editableRow(details!, source, source.rows[row]));
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
            className="grid-cell-editor"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                finalized();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setEditor(null);
                setError("");
              }
              if (e.key === "Enter") {
                e.preventDefault();
                finalized();
              }
            }}
          >
            {/^(bool|boolean)$/i.test(c.dataType) ? (
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
            <select
              aria-label={`${c.name} value mode`}
              value={editor.mode}
              onChange={(e) =>
                setEditor({ ...editor, mode: e.target.value as Editor["mode"] })
              }
            >
              <option value="value">Value</option>
              {c.nullable && <option value="null">NULL</option>}
              {isNew && <option value="default">Default</option>}
            </select>
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
          <JsonCell
            value={display}
            dataType={source.columns[column]?.dataType || ""}
            raw={
              typeof row === "number"
                ? source.jsonRaw?.[row]?.[column]
                : undefined
            }
            label={`${source.columns[column]?.name} · ${typeof row === "number" ? `Row ${tab.page * 200 + row + 1}` : "New row"}`}
            onOpen={onOpenJson}
          />
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
        editableRow(details, source, r.values) &&
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
                    title="Sort current result page"
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
                      !editableRow(details, source, values) ||
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
    </div>
  );
}
