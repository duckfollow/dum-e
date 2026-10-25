import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  countdownSeconds,
  intervalSeconds,
  startRepeater,
  type RefreshEvent,
} from "./auto-run";
import "./auto-run.css";
export function AutoRun({
  identity,
  sql,
  available,
  suspended,
  run,
}: {
  identity: string;
  sql: string;
  available: boolean;
  suspended: boolean;
  run: () => Promise<boolean | null>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [preset, setPreset] = useState("3");
  const [custom, setCustom] = useState("10");
  const [running, setRunning] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [progress, setProgress] = useState<RefreshEvent | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const started = useRef({ identity, sql });
  const latest = useRef(run);
  latest.current = run;
  const seconds = intervalSeconds(preset === "custom" ? custom : preset);
  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    setRunning(false);
    setProgress(null);
    menu.current?.hidePopover();
  }, [identity, sql, available, suspended, hidden]);
  useEffect(() => {
    setLastUpdated(null);
    setFailed(false);
  }, [identity, sql]);
  useEffect(() => {
    if (
      !running ||
      !available ||
      suspended ||
      hidden ||
      !seconds ||
      started.current.identity !== identity ||
      started.current.sql !== sql
    )
      return;
    return startRepeater(
      () => latest.current(),
      seconds,
      () => {
        setRunning(false);
        setFailed(true);
      },
      undefined,
      (event) => {
        setNow(performance.now());
        setProgress(event);
        if (event.phase === "waiting" && event.refreshed)
          setLastUpdated(Date.now());
      },
    );
  }, [running, available, suspended, hidden, seconds, identity, sql]);
  const nextAt =
    running && progress?.phase === "waiting" ? progress.nextAt : null;
  useEffect(() => {
    if (nextAt === null) return;
    const tick = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(tick);
  }, [nextAt]);
  const remaining = nextAt === null ? 0 : countdownSeconds(nextAt, now);
  const refreshing = running && progress?.phase !== "waiting";
  const fraction =
    nextAt === null || !seconds
      ? 0
      : Math.max(0, Math.min(1, (nextAt - now) / (seconds * 1000)));
  const dialValue = String(
    failed ? "!" : refreshing ? "…" : ((running ? remaining : seconds) ?? "–"),
  );
  const updated =
    lastUpdated === null
      ? null
      : new Date(lastUpdated).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
  const disabled =
    !running && (!available || suspended || hidden || !seconds || !sql.trim());
  function toggleRunning() {
    if (disabled) {
      openMenu();
      return;
    }
    menu.current?.hidePopover();
    started.current = { identity, sql };
    setFailed(false);
    setRunning((v) => !v);
  }
  function openMenu() {
    if (menuOpen) {
      menu.current?.hidePopover();
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition({
      left: Math.max(8, Math.min(window.innerWidth - 248, rect.right - 240)),
      top: Math.max(8, Math.min(window.innerHeight - 310, rect.bottom + 8)),
    });
    menu.current?.showPopover();
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }
  const label = refreshing
    ? "Refreshing…"
    : running
      ? `Refresh in ${remaining}s`
      : failed
        ? "Refresh stopped"
        : seconds
          ? `Auto refresh · ${seconds}s`
          : "Auto refresh";
  return (
    <div className="auto-run">
      <button
        ref={button}
        type="button"
        className={`auto-run-button ${running ? "is-running" : ""} ${failed ? "has-error" : ""}`}
        aria-pressed={running}
        aria-busy={refreshing}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`${running ? "Stop" : "Start"} auto refresh, ${running ? (refreshing ? "refreshing" : `next in ${remaining} seconds`) : `every ${seconds ?? "custom"} seconds`}. Arrow down for interval settings.`}
        title={`${label}. ${updated ? `Updated ${updated}. ` : ""}Click to ${running ? "stop" : "start"}. Click the arrow or press ↓ for interval settings.`}
        onClick={toggleRunning}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <svg
          className={`auto-run-dial ${disabled ? "unavailable" : ""}`}
          width="30"
          height="30"
          viewBox="0 0 32 32"
          aria-hidden="true"
        >
          <g transform="rotate(-90 16 16)">
            <circle className="auto-run-dial-track" cx="16" cy="16" r="12.5" />
            <circle
              className="auto-run-dial-progress"
              cx="16"
              cy="16"
              r="12.5"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={(1 - fraction) * 100}
            />
          </g>
          <text
            x="16"
            y="16"
            dy=".35em"
            textAnchor="middle"
            fontSize={
              dialValue.length > 4 ? 6.5 : dialValue.length > 3 ? 8 : 10
            }
          >
            {dialValue}
          </text>
        </svg>
        <span
          className="auto-run-arrow"
          aria-hidden="true"
          title="Refresh settings"
          onClick={(event) => {
            event.stopPropagation();
            openMenu();
          }}
        >
          <ChevronDown size={12} />
        </span>
      </button>
      <div
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Auto refresh settings"
        className="auto-run-menu"
        style={{ left: menuPosition.left, top: menuPosition.top }}
        onToggle={(event) =>
          setMenuOpen(event.currentTarget.matches(":popover-open"))
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") button.current?.focus();
        }}
      >
        <header>
          <strong>Auto refresh</strong>
          <span>Refresh interval</span>
        </header>
        <div
          className="auto-run-options"
          role="group"
          aria-label="Refresh interval"
        >
          {["1", "3", "5"].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              disabled={running}
              onClick={() => {
                setPreset(value);
                menu.current?.hidePopover();
                button.current?.focus();
              }}
            >
              <span>
                Every {value} second{value === "1" ? "" : "s"}
              </span>
              {preset === value && <Check size={13} />}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={preset === "custom"}
            disabled={running}
            onClick={() => setPreset("custom")}
          >
            <span>Custom interval</span>
            {preset === "custom" && <Check size={13} />}
          </button>
        </div>
        {preset === "custom" && (
          <label className="auto-run-custom">
            Seconds
            <input
              aria-label="Custom interval in seconds"
              type="number"
              min="1"
              max="86400"
              step="1"
              disabled={running}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            {!seconds && (
              <span className="auto-run-error">Enter 1–86400 seconds.</span>
            )}
          </label>
        )}
        <footer>
          <span>{updated ? `Updated ${updated}` : "Read-only query"}</span>
          <small>
            {running
              ? "Stop refresh to change the interval."
              : "Click the toolbar button to start."}
          </small>
        </footer>
      </div>
    </div>
  );
}
