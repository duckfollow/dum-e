import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import { api, desktop } from "./api";
import "./update-notice.css";
const companionApps = [
  {
    id: "edith",
    name: "EDITH",
    category: "DEBUGGING",
    description:
      "Inspect HTTP traffic, route requests, and explore logs in one workbench.",
  },
  {
    id: "ultron",
    name: "Ultron",
    category: "SSH WORKBENCH",
    description:
      "Connect to servers, manage SSH sessions, and keep terminal work organized.",
  },
  {
    id: "u",
    name: "u",
    category: "API WORKBENCH",
    description:
      "Build API requests and connect them into reusable, sequential flows.",
  },
];
const companionIcons: Record<string, string> = {
  edith: new URL("./assets/companion-apps/edith.png", import.meta.url).href,
  ultron: new URL("./assets/companion-apps/ultron.png", import.meta.url).href,
  u: new URL("./assets/companion-apps/u.png", import.meta.url).href,
};
interface AvailableUpdate {
  version: string;
  url: string;
  notes: string;
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
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [visible, setVisible] = useState(false);
  const [companionError, setCompanionError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const attempted = useRef(lastAttempt());
  const mounted = useRef(true);
  const check = useCallback(async (manual: boolean) => {
    if (!desktop || running.current) return;
    const elapsed = Date.now() - attempted.current;
    if (!manual && elapsed >= 0 && elapsed < DAY) return;
    running.current = true;
    setChecking(true);
    setError("");
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
      setCheckedAt(Date.now());
    } catch (error) {
      if (manual && mounted.current) setError(String(error));
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
  useEffect(() => {
    if (visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [visible]);
  async function openRelease() {
    setOpening(true);
    setError("");
    try {
      await api("open_release_page", {
        url:
          update?.url ??
          `https://github.com/duckfollow/dum-e/releases/tag/v${version}`,
      });
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setOpening(false);
    }
  }
  const status = checking
    ? "Checking for updates…"
    : update
      ? "A new version is available"
      : checkedAt
        ? "You’re up to date"
        : "Ready to check for updates";
  return (
    <div className="app-updates">
      <button
        className={`update-nav-button${visible ? " active" : ""}`}
        onClick={() => {
          setVisible(true);
          if (!checkedAt) void check(true);
        }}
        title={`Updates${version ? ` · v${version}` : ""}${update ? ` · New version ${update.version}` : ""}`}
        aria-label="Updates"
        aria-haspopup="dialog"
      >
        <RefreshCw size={15} className={checking ? "update-spinning" : ""} />
        <span className="update-nav-label">Updates</span>
        <span className="update-nav-version">
          {version ? `v${version}` : "Dum-E"}
        </span>
        {update && (
          <span
            className="update-new-badge"
            aria-label={`Version ${update.version} available`}
          >
            New
          </span>
        )}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="updates-dialog"
          aria-labelledby="updates-title"
          onCancel={() => setVisible(false)}
          onClose={() => setVisible(false)}
        >
          <header className="updates-heading">
            <div>
              <span className="updates-eyebrow">KEEP DUM-E CURRENT</span>
              <h2 id="updates-title">Updates</h2>
              <p>Check for new versions and see what’s changed.</p>
            </div>
            <button
              className="icon-button"
              aria-label="Close updates"
              onClick={() => setVisible(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="updates-body">
            {!desktop && (
              <p className="updates-error" role="status">
                Update checks are available in the Dum-E desktop app.
              </p>
            )}
            {error && (
              <p className="updates-error" role="alert">
                {error}
              </p>
            )}
            <section className="updates-hero" aria-live="polite">
              <div className="updates-app-icon">D</div>
              <div>
                <span className="updates-eyebrow">DUM-E FOR MACOS</span>
                <h3>{status}</h3>
                <p>
                  Installed <strong>{version || "Loading…"}</strong>
                  {update && (
                    <>
                      {" "}
                      <span>→</span> Available <strong>{update.version}</strong>
                    </>
                  )}
                </p>
              </div>
              <span className="updates-channel">
                {version.includes("-") ? "Preview channel" : "Stable channel"}
              </span>
            </section>
            <div className="updates-toolbar">
              <button
                className="updates-action"
                disabled={!desktop || checking}
                onClick={() => void check(true)}
              >
                <RefreshCw
                  size={14}
                  className={checking ? "update-spinning" : ""}
                />
                {checking ? "Checking…" : "Check for updates"}
              </button>
            </div>
            <div className="updates-grid">
              <section className="updates-card">
                <h3>
                  <GitBranch size={16} />
                  Release source
                </h3>
                <p>Updates come from the official Dum-E GitHub repository.</p>
                <div className="updates-source">duckfollow/dum-e</div>
                <small>
                  {version.includes("-")
                    ? "Preview builds receive newer preview and stable releases."
                    : "Stable builds receive stable releases only."}
                </small>
              </section>
              <section className="updates-card">
                <h3>
                  <Download size={16} />
                  Install an update
                </h3>
                <p>
                  Download the macOS DMG, quit Dum-E, then replace the app in
                  Applications and open it again.
                </p>
                <button
                  className="updates-action updates-primary"
                  disabled={!desktop || !version || opening}
                  onClick={() => void openRelease()}
                >
                  <ExternalLink size={14} />
                  {opening
                    ? "Opening…"
                    : update
                      ? "Download macOS update"
                      : "View current release"}
                </button>
                <small>
                  Saved connections and preferences stay on this Mac. Save your
                  SQL work and finish active queries before quitting.
                </small>
              </section>
            </div>
            {update?.notes && (
              <section className="updates-card updates-notes">
                <h3>
                  <CheckCircle2 size={16} />
                  What’s new in {update.version}
                </h3>
                <pre>{update.notes}</pre>
              </section>
            )}
            <section
              className="updates-discover"
              aria-labelledby="updates-discover-title"
            >
              <div className="updates-discover-heading">
                <h3 id="updates-discover-title">More from duckfollow</h3>
                <p>A few more tools for your workshop.</p>
              </div>
              <div className="updates-companions">
                {companionApps.map((app) => (
                  <article className="updates-companion" key={app.id}>
                    <div className="updates-companion-brand">
                      <img
                        src={companionIcons[app.id]}
                        alt=""
                        width={40}
                        height={40}
                      />
                      <div>
                        <span>{app.category}</span>
                        <h4>{app.name}</h4>
                      </div>
                    </div>
                    <p>{app.description}</p>
                    <a
                      href={`https://github.com/duckfollow/${app.id}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Learn more about ${app.name}`}
                      onClick={(event) => {
                        if (!desktop) return;
                        event.preventDefault();
                        setCompanionError("");
                        void api("open_companion_app", { app: app.id }).catch(
                          () =>
                            setCompanionError(
                              `Could not open ${app.name}. Please try again.`,
                            ),
                        );
                      }}
                    >
                      Learn more <ExternalLink size={12} />
                    </a>
                  </article>
                ))}
              </div>
              {companionError && (
                <p className="updates-error" role="alert">
                  {companionError}
                </p>
              )}
            </section>
            <div className="updates-footnote">
              <Info size={14} />
              <span>
                {checkedAt
                  ? `Last checked ${new Date(checkedAt).toLocaleString()}. `
                  : ""}
                No automatic downloads. You choose when to update.
              </span>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
