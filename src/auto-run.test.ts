import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countdownSeconds,
  intervalSeconds,
  startRepeater,
  type Timer,
  type RefreshEvent,
} from "./auto-run.ts";
function clock() {
  const callbacks = new Map<number, () => void>();
  let id = 0;
  const delays: number[] = [];
  const timer: Timer = {
    schedule: (cb, delay) => {
      callbacks.set(++id, cb);
      delays.push(delay);
      return id;
    },
    cancel: (handle) => {
      callbacks.delete(handle as number);
    },
  };
  return {
    timer,
    callbacks,
    delays,
    tick: () => {
      const [id, cb] = [...callbacks][0];
      callbacks.delete(id);
      cb();
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("presets and custom intervals require whole seconds within bounds", () => {
  for (const s of ["1", "3", "5", "17", "86400"])
    assert.equal(intervalSeconds(s), Number(s));
  for (const s of ["", "0", "-1", "1.5", "Infinity", "86401", "1e3"])
    assert.equal(intervalSeconds(s), null);
});
test("auto run waits for completion before scheduling the next query", async () => {
  const c = clock();
  let calls = 0;
  let resolve!: (v: boolean) => void;
  const stop = startRepeater(
    () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    3,
    () => assert.fail("unexpected stop"),
    c.timer,
  );
  assert.equal(calls, 1);
  assert.equal(c.callbacks.size, 0);
  resolve(true);
  await flush();
  assert.deepEqual(c.delays, [3000]);
  c.tick();
  assert.equal(calls, 2);
  assert.equal(c.callbacks.size, 0);
  stop();
  resolve(true);
  await flush();
  assert.equal(c.callbacks.size, 0);
});
test("stop removes pending timers; a failed query stops repetition", async () => {
  const c = clock();
  let calls = 0;
  let stopped = 0;
  const stop = startRepeater(
    async () => {
      calls++;
      return true;
    },
    1,
    () => {
      stopped++;
    },
    c.timer,
  );
  await flush();
  stop();
  assert.equal(c.callbacks.size, 0);
  assert.equal(calls, 1);
  startRepeater(
    async () => false,
    5,
    () => {
      stopped++;
    },
    c.timer,
  );
  await flush();
  assert.equal(stopped, 1);
  assert.equal(c.callbacks.size, 0);
  startRepeater(
    async () => {
      throw Error("connection lost");
    },
    5,
    () => {
      stopped++;
    },
    c.timer,
  );
  await flush();
  assert.equal(stopped, 2);
  assert.equal(c.callbacks.size, 0);
});

test("countdown rounds up to the real deadline and never goes negative", () => {
  assert.equal(countdownSeconds(4000, 1000), 3);
  assert.equal(countdownSeconds(4000, 1001), 3);
  assert.equal(countdownSeconds(4000, 3000), 1);
  assert.equal(countdownSeconds(4000, 4100), 0);
});
test("progress reports refreshing until completion then the next deadline", async () => {
  const c = clock();
  const events: RefreshEvent[] = [];
  let resolve!: (v: boolean) => void;
  c.timer.now = () => 1000;
  const stop = startRepeater(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    3,
    () => assert.fail("unexpected stop"),
    c.timer,
    (e) => events.push(e),
  );
  assert.deepEqual(events, [{ phase: "refreshing" }]);
  resolve(true);
  await flush();
  assert.deepEqual(events[1], {
    phase: "waiting",
    nextAt: 4000,
    refreshed: true,
  });
  stop();
});
test("skipped work and stopped requests cannot report a successful refresh", async () => {
  const c = clock();
  const events: RefreshEvent[] = [];
  const stop = startRepeater(
    async () => null,
    1,
    () => assert.fail("unexpected stop"),
    c.timer,
    (e) => events.push(e),
  );
  await flush();
  assert.equal(events[1].phase, "waiting");
  assert.equal(
    (events[1] as Extract<RefreshEvent, { phase: "waiting" }>).refreshed,
    false,
  );
  stop();
  let resolve!: (v: boolean) => void;
  events.length = 0;
  const cancel = startRepeater(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    3,
    () => {},
    c.timer,
    (e) => events.push(e),
  );
  cancel();
  resolve(true);
  await flush();
  assert.deepEqual(events, [{ phase: "refreshing" }]);
});
