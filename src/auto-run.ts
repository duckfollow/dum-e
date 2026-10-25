export function intervalSeconds(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400
    ? seconds
    : null;
}
export type RefreshEvent =
  | { phase: "refreshing" }
  | { phase: "waiting"; nextAt: number; refreshed: boolean };
export function countdownSeconds(nextAt: number, now: number) {
  return Math.max(0, Math.ceil((nextAt - now) / 1000));
}
export interface Timer {
  now?: () => number;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (handle: unknown) => void;
}
// Schedule after completion, never while the previous request is pending.
export function startRepeater(
  work: () => Promise<boolean | null>,
  seconds: number,
  onStop: () => void,
  timer: Timer = {
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  onProgress?: (event: RefreshEvent) => void,
) {
  let stopped = false;
  let handle: unknown;
  async function tick() {
    if (stopped) return;
    let success: boolean | null = false;
    onProgress?.({ phase: "refreshing" });
    try {
      success = await work();
    } catch {
      /* Stop on failure; caller displays the query error. */
    }
    if (stopped) return;
    if (success === false) {
      stopped = true;
      onStop();
      return;
    }
    onProgress?.({
      phase: "waiting",
      nextAt: (timer.now?.() ?? performance.now()) + seconds * 1000,
      refreshed: success === true,
    });
    handle = timer.schedule(() => {
      void tick();
    }, seconds * 1000);
  }
  void tick();
  return () => {
    stopped = true;
    if (handle !== undefined) timer.cancel(handle);
  };
}
