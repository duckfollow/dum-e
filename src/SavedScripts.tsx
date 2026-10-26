import { useEffect, useId, useRef, useState } from "react";
import { Save, X, Search } from "lucide-react";
import { SqlPreview } from "./SqlPreview";
import type { SavedScript } from "./saved-scripts";
import "./query-history.css";

export function SavedScripts({
  scripts,
  draft,
  loadError,
  onClose,
  onSave,
  onDelete,
  onOpen,
}: {
  scripts: SavedScript[];
  draft: SavedScript | null;
  loadError: string;
  onClose: () => void;
  onSave: (script: SavedScript) => void;
  onDelete: (id: string) => void;
  onOpen: (script: SavedScript) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [editing, setEditing] = useState(draft);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const visible = scripts.filter((script) =>
    `${script.name}\n${script.sql}\n${script.connectionName}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <dialog
      ref={dialog}
      className="query-history saved-scripts"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>
          <Save size={18} /> Saved scripts
        </h2>
        <button
          className="icon-button"
          aria-label="Close saved scripts"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {loadError ? (
        <p className="history-error saved-script-message" role="alert">
          {loadError}
        </p>
      ) : (
        <>
          {editing ? (
            <form
              className="saved-script-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!editing.name.trim() || !editing.sql.trim()) return;
                try {
                  onSave({
                    ...editing,
                    name: editing.name.trim(),
                    updatedAt: Date.now(),
                  });
                  setEditing(null);
                  setError("");
                } catch {
                  setError(
                    "Could not save script. Check available storage and try again.",
                  );
                }
              }}
            >
              <label>
                Script name
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </label>
              <p className="history-note">
                Connection: {editing.connectionName} ·{" "}
                {editing.driver === "postgres" ? "PostgreSQL" : "SQLite"}
              </p>
              <label>
                SQL
                <textarea
                  required
                  rows={8}
                  spellCheck={false}
                  value={editing.sql}
                  onChange={(event) =>
                    setEditing({ ...editing, sql: event.target.value })
                  }
                />
              </label>
              <div className="saved-script-actions">
                <button
                  className="primary small"
                  type="submit"
                  disabled={!editing.name.trim() || !editing.sql.trim()}
                >
                  Save script
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="history-tools">
              <label>
                <Search size={15} />
                <input
                  autoFocus
                  placeholder="Search saved scripts…"
                  aria-label="Search saved scripts"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>
          )}
          {error && (
            <p className="history-error saved-script-message" role="alert">
              {error}
            </p>
          )}
          <p className="history-note">
            Saved on this device · Opening a script does not run it.
          </p>
          <div className="history-list">
            {visible.length ? (
              visible.map((script) => (
                <article key={script.id}>
                  <div className="history-meta">
                    <strong>{script.name}</strong>
                    <span>{script.connectionName}</span>
                    <time dateTime={new Date(script.updatedAt).toISOString()}>
                      {new Date(script.updatedAt).toLocaleString()}
                    </time>
                  </div>
                  <SqlPreview sql={script.sql} driver={script.driver} />
                  <div className="saved-script-actions">
                    <button className="small" onClick={() => onOpen(script)}>
                      Open in new tab
                    </button>
                    <button
                      className="small"
                      onClick={() => {
                        setEditing({ ...script });
                        setDeleting("");
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                    {deleting === script.id ? (
                      <>
                        <span>Delete this script?</span>
                        <button
                          className="small"
                          onClick={() => {
                            try {
                              onDelete(script.id);
                              setDeleting("");
                              setError("");
                            } catch {
                              setError(
                                "Could not delete script. Please try again.",
                              );
                            }
                          }}
                        >
                          Confirm delete
                        </button>
                        <button
                          className="small"
                          onClick={() => setDeleting("")}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="small"
                        onClick={() => setDeleting(script.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="history-empty">
                <Save size={28} />
                <p>
                  {scripts.length
                    ? "No matching scripts."
                    : "No saved scripts yet. Save one from the SQL editor."}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
