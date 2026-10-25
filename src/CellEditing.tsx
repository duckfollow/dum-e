import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { cellText, type Cell, type QueryTab } from "./model";
import type { TableDetails } from "./table-model";
import {
  editableColumn,
  editableRow,
  parseCell,
  stageCell,
  type RowEdit,
} from "./cell-editing-model";
import "./cell-editing.css";
const previewText = (value: Cell) =>
  value === "" ? "(empty string)" : cellText(value);
export function CellEditing({
  tab,
  initialCell,
  onClose,
  onApplied,
}: {
  tab: QueryTab;
  initialCell?: { row: number; column: number };
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [cell, setCell] = useState(initialCell);
  const [text, setText] = useState("");
  const [isNull, setNull] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const result = tab.result!;
  const count = Object.keys(edits).length;
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    void api<TableDetails>("table_details", {
      id: tab.profileId,
      table: tab.table,
    })
      .then((d) => {
        if (!disposed) {
          setDetails(d);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [tab.profileId, tab.table]);
  useEffect(() => {
    if (!cell || !details) return;
    const c = details.columns[cell.column];
    const original = result.rows[cell.row];
    if (!c || !editableColumn(c) || !editableRow(details, result, original)) {
      setCell(undefined);
      return;
    }
    const value = Object.hasOwn(edits[cell.row]?.changes || {}, c.name)
      ? edits[cell.row].changes[c.name]
      : original[cell.column];
    setText(
      value === null
        ? ""
        : typeof value === "boolean"
          ? String(value)
          : cellText(value),
    );
    setNull(value === null);
  }, [cell, details]);
  function close() {
    if (busy) return;
    if ((count || cell) && !window.confirm("Discard all unsaved cell edits?"))
      return;
    onClose();
  }
  function stage() {
    if (!cell || !details) return;
    try {
      const c = details.columns[cell.column];
      const value = parseCell(text, c, isNull);
      setEdits((current) =>
        stageCell(
          current,
          cell.row,
          c.name,
          value,
          result.rows[cell.row],
          cell.column,
        ),
      );
      setCell(undefined);
      setReview(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      await api<number>("apply_cell_edits", {
        id: tab.profileId,
        table: tab.table,
        edits: Object.values(edits),
      });
    } catch (e) {
      setError(`${String(e)} Reload before trying again.`);
      setFailed(true);
      setBusy(false);
      return;
    }
    // Never retain a retryable batch after a successful commit, even if reload fails.
    await onApplied();
    onClose();
  }
  const hasKey = details?.columns.some((c) => c.primaryKeyPosition > 0);
  return (
    <dialog
      ref={dialog}
      className="cell-edit-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="cell-edit-heading"
    >
      <header>
        <div>
          <h2 id="cell-edit-heading">Edit {tab.table?.name}</h2>
          <p>
            Double-click a cell or focus it and press Enter. Changes stay here
            until you Apply.
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={close}>
          Close
        </button>
      </header>
      {error && (
        <p className="edit-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p>Reading table structure…</p>
      ) : (
        details && (
          <>
            {(!hasKey || details.table.kind !== "table") && (
              <p>
                This object is read-only. Editing requires a table with a
                Primary Key.
              </p>
            )}
            <p className="edit-hint">
              Generated, identity and unsupported columns are read-only. Rows
              containing JSON, binary previews or NULL keys are read-only.
            </p>
            <div className="cell-edit-grid">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>#</th>
                    {result.columns.map((c, i) => (
                      <th key={i}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, r) => (
                    <tr key={r}>
                      <td>{r + 1}</td>
                      {row.map((value, i) => {
                        const c = details.columns[i],
                          allowed =
                            c &&
                            editableColumn(c) &&
                            editableRow(details, result, row) &&
                            !busy &&
                            !failed &&
                            !cell;
                        const changed =
                          c && Object.hasOwn(edits[r]?.changes || {}, c.name);
                        const display = changed
                          ? edits[r].changes[c.name]
                          : value;
                        const start = () => {
                          if (allowed) {
                            setCell({ row: r, column: i });
                            setReview(false);
                            setError("");
                          }
                        };
                        return (
                          <td
                            key={i}
                            tabIndex={allowed ? 0 : undefined}
                            className={changed ? "edited-cell" : ""}
                            title={
                              allowed
                                ? "Double-click or press Enter to edit"
                                : "Read-only"
                            }
                            onDoubleClick={start}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                start();
                              }
                            }}
                          >
                            {previewText(display)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cell && (
              <form
                className="cell-value-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  stage();
                }}
              >
                <label>
                  {details.columns[cell.column].name}
                  {/^(bool|boolean)$/i.test(
                    details.columns[cell.column].dataType,
                  ) ? (
                    <select
                      autoFocus
                      disabled={isNull || busy}
                      value={
                        text === "1" ? "true" : text === "0" ? "false" : text
                      }
                      onChange={(e) => setText(e.target.value)}
                    >
                      <option value="">Choose…</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <textarea
                      autoFocus
                      disabled={isNull || busy}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      aria-label="Cell value"
                    />
                  )}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={isNull}
                    disabled={!details.columns[cell.column].nullable || busy}
                    onChange={(e) => setNull(e.target.checked)}
                  />
                  Set NULL
                </label>
                <button className="primary" disabled={busy}>
                  Stage change
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setCell(undefined)}
                >
                  Cancel cell
                </button>
              </form>
            )}
            {review && (
              <section className="edit-review" aria-label="Review changes">
                <h3>
                  {count} {count === 1 ? "row" : "rows"} to update ·{" "}
                  {Object.values(edits).reduce(
                    (n, e) => n + Object.keys(e.changes).length,
                    0,
                  )}{" "}
                  changed cells
                </h3>
                <p>
                  All updates use one transaction. If a row changed since it was
                  loaded, the batch is rolled back.
                </p>
                <p>
                  Counts cover directly edited rows; database triggers and
                  cascades may affect additional rows.
                </p>
                {Object.entries(edits).map(([r, edit]) => (
                  <article key={r}>
                    <b>Row {Number(r) + 1}</b>
                    {Object.entries(edit.changes).map(([name, value]) => (
                      <div key={name}>
                        <strong>{name}</strong>
                        <del>
                          {previewText(
                            edit.original[
                              result.columns.findIndex((c) => c.name === name)
                            ],
                          )}
                        </del>
                        <span>→ {previewText(value)}</span>
                      </div>
                    ))}
                  </article>
                ))}
              </section>
            )}
          </>
        )
      )}
      <footer>
        <span>
          {count} {count === 1 ? "row" : "rows"} staged
        </span>
        <button
          className="secondary"
          disabled={busy || (!count && !cell)}
          onClick={() => {
            setEdits({});
            setCell(undefined);
            setReview(false);
            setError("");
          }}
        >
          Discard
        </button>
        {failed ? (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onApplied();
              onClose();
            }}
          >
            Discard & reload
          </button>
        ) : review ? (
          <button
            className="primary"
            disabled={!count || busy || !!cell}
            onClick={() => void apply()}
          >
            {busy
              ? "Applying…"
              : `Apply ${count} ${count === 1 ? "row" : "rows"}`}
          </button>
        ) : (
          <button
            className="primary"
            disabled={!count || !!cell || busy}
            onClick={() => setReview(true)}
          >
            Review changes
          </button>
        )}
      </footer>
    </dialog>
  );
}
