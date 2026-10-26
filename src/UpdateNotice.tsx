import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, RefreshCw, X } from "lucide-react";
import { api, desktop } from "./api";
import "./update-notice.css";

interface AvailableUpdate {
  version: string;
  url: string;
}
const DAY = 24 * 60 * 60 * 1000;
const CHECKED_KEY = "dum-e.updates.last-attempt";
function lastAttempt(): number {
  try {
    const value = Number(localStorage.getItem(CHECKED_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
export function UpdateNotice() {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);
  const running = useRef(false);
  const attempted = useRef(lastAttempt());
  const mounted = useRef(true);
  const check = useCallback(async (manual: boolean) => {
    if (!desktop || running.current) return;
    const elapsed = Date.now() - attempted.current;
    if (!manual && elapsed >= 0 && elapsed < DAY) return;
    running.current = true;
    setChecking(true);
    if (manual) setMessage("");
    attempted.current = Date.now();
    try {
      localStorage.setItem(CHECKED_KEY, String(attempted.current));
    } catch {
      /* The check still works without local storage. */
    }
    try {
      const available = await api<AvailableUpdate | null>("check_for_updates");
      if (!mounted.current) return;
      setUpdate(available);
      if (manual)
        setMessage(
          available
            ? ""
            : "You’re up to date. No newer published release is available.",
        );
    } catch (error) {
      if (manual && mounted.current) setMessage(String(error));
    } finally {
      running.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (desktop)
      void getVersion()
        .then((value) => {
          if (mounted.current) setVersion(value);
        })
        .catch(() => {});
    const initial = setTimeout(() => void check(false), 3000);
    const interval = setInterval(() => void check(false), 60 * 60 * 1000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [check]);
  return (
    <div className="app-updates">
      <div className="update-check-row">
        <span>{version ? `v${version}` : "Dum-E"}</span>
        <button
          className="update-check-button"
          disabled={!desktop || checking}
          onClick={() => void check(true)}
          title="Check for updates"
        >
          <RefreshCw size={12} className={checking ? "update-spinning" : ""} />
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {update && (
        <div className="update-card" role="status">
          <strong>New version available</strong>
          <span>Dum-E {update.version}</span>
          <div>
            <button
              className="small"
              disabled={opening}
              onClick={async () => {
                setOpening(true);
                setMessage("");
                try {
                  await api("open_release_page", { url: update.url });
                } catch (error) {
                  setMessage(String(error));
                } finally {
                  setOpening(false);
                }
              }}
            >
              <Download size={12} />
              {opening ? "Opening…" : "Download"}
            </button>
            <button className="small" onClick={() => setUpdate(null)}>
              Later
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className="update-message" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss update message"
            onClick={() => setMessage("")}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
