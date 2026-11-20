import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { getActivities, subscribeActivities } from "./activity";

export function LoadingProgress({ localLabel }: { localLabel?: string }) {
  const activities = useSyncExternalStore(subscribeActivities, getActivities);
  const local = useMemo(
    () =>
      localLabel ? { label: localLabel, startedAt: Date.now() } : undefined,
    [localLabel],
  );
  const current = activities[0] || local;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!current) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [current?.startedAt]);
  if (!current) return null;
  const elapsed = Math.max(0, now - current.startedAt) / 1000;
  return (
    <div className="loading-progress" aria-busy="true">
      <div className="loading-progress-status" role="status" aria-live="polite">
        <LoaderCircle size={14} className="spin" />
        <span>{current.label}</span>
        {activities.length > 1 && (
          <span className="loading-progress-count">
            {activities.length} operations
          </span>
        )}
        <time aria-label="Elapsed time">{elapsed.toFixed(1)} s</time>
      </div>
      <div
        className="loading-progress-track"
        role="progressbar"
        aria-label={current.label}
      >
        <span />
      </div>
    </div>
  );
}
