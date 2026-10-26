import { useEffect, useId, useRef, useState } from "react";
import { Trash2, LoaderCircle, X } from "lucide-react";
import type { Profile } from "./model";

export function RemoveConnectionDialog({
  profile,
  connected,
  onClose,
  onRemove,
}: {
  profile: Profile;
  connected: boolean;
  onClose: () => void;
  onRemove: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(),
    description = useId();
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="connection-dialog remove-connection-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        if (working) event.preventDefault();
        else onClose();
      }}
    >
      <header>
        <div className="dialog-title-icon">
          <Trash2 size={21} />
        </div>
        <div>
          <span className="eyebrow">SAVED CONNECTION</span>
          <h2 id={title}>Remove connection?</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close remove connection dialog"
          disabled={working}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="dialog-content">
        <p id={description}>
          Remove <strong>{profile.name}</strong> and its saved password from
          Dum-E? Your database and its data will not be deleted.
        </p>
        {connected && <p>This connection will be disconnected.</p>}
        <p className="remove-connection-note">
          Open SQL tabs and saved scripts will be kept. You can add this
          connection again later.
        </p>
        {error && (
          <p className="history-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button
          autoFocus
          className="secondary"
          disabled={working}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="remove-connection-button"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            setError("");
            try {
              await onRemove();
            } catch (error) {
              setError(String(error));
              setWorking(false);
            }
          }}
        >
          {working ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Trash2 size={14} />
          )}
          {working ? "Removing…" : "Remove connection"}
        </button>
      </footer>
    </dialog>
  );
}
