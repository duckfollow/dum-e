import { useEffect, useId, useRef, useState } from "react";
import { RotateCcwClock, Search, X } from "lucide-react";
import "./query-history.css";
import { SqlPreview } from "./SqlPreview";
import type { Driver } from "./model";

export interface QueryHistoryEntry {
  id: string;
  profileId: string;
  driver: Driver;
  connectionName: string;
  sql: string;
  startedAt: number;
  elapsedMs: number;
  error?: string;
}

export function QueryHistory({
  entries,
  onClose,
  onOpen,
  onClear,
}: {
  entries: QueryHistoryEntry[];
  onClose: () => void;
  onOpen: (entry: QueryHistoryEntry) => void;
  onClear: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [search, setSearch] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const needle = search.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) =>
    `${entry.sql}\n${entry.connectionName}\n${entry.error || ""}`
      .toLocaleLowerCase()
      .includes(needle),
  );
  return (
    <dialog
      ref={dialog}
      className="query-history"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>
          <RotateCcwClock size={18} /> Query history
        </h2>
        <button
          className="icon-button"
          aria-label="Close query history"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="history-tools">
        <label>
          <Search size={15} />
          <input
            autoFocus
            placeholder="Search SQL or connection…"
            aria-label="Search query history"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button disabled={!entries.length} onClick={onClear}>
          Clear history
        </button>
      </div>
      <p className="history-note">
        Last 200 manual queries · This session only · Open a query to review
        before running.
      </p>
      <div className="history-list">
        {visible.length ? (
          visible.map((entry) => (
            <article key={entry.id}>
              <div className="history-meta">
                <strong>{entry.connectionName}</strong>
                <time dateTime={new Date(entry.startedAt).toISOString()}>
                  {new Date(entry.startedAt).toLocaleString()}
                </time>
                <span
                  className={entry.error ? "history-error" : "history-success"}
                >
                  {entry.error ? "Failed" : "Success"}
                </span>
                <span>{entry.elapsedMs} ms</span>
              </div>
              <SqlPreview sql={entry.sql} driver={entry.driver} />
              {entry.error && <p className="history-error">{entry.error}</p>}
              <button className="small" onClick={() => onOpen(entry)}>
                Open in new tab
              </button>
            </article>
          ))
        ) : (
          <div className="history-empty">
            <RotateCcwClock size={28} />
            <p>
              {entries.length
                ? "No matching queries."
                : "No queries yet. Run a query to see it here."}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}
