import test from "node:test";
import assert from "node:assert/strict";
import { createTableDetailsCache } from "./table-details-cache.ts";
import type { TableDetails } from "./table-model.ts";
const table = { schema: "public", name: "items", kind: "table" };
const details = {
  table,
  columns: [],
  relations: [],
} as unknown as TableDetails;

test("inspector and grid share an in-flight request and cached metadata on return", async () => {
  let calls = 0;
  const cache = createTableDetailsCache(async () => {
    calls++;
    return details;
  });
  const first = cache.load("db", table);
  assert.equal(cache.load("db", table), first);
  await first;
  assert.equal(cache.peek("db", table), details);
  assert.equal(await cache.load("db", table), details);
  assert.equal(calls, 1);
  await cache.load("other-db", table);
  await cache.load("db", { ...table, schema: "other" });
  assert.equal(calls, 3);
});

test("failed metadata loads can be retried", async () => {
  let calls = 0;
  const cache = createTableDetailsCache(async () => {
    if (++calls === 1) throw Error("offline");
    return details;
  });
  await assert.rejects(cache.load("db", table), /offline/);
  assert.equal(await cache.load("db", table), details);
});

test("a late response cannot replace metadata from a forced refresh", async () => {
  let finish!: (value: TableDetails) => void;
  let calls = 0;
  const newer = { ...details, comment: "new schema" };
  const cache = createTableDetailsCache(() =>
    ++calls === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(newer),
  );
  const first = cache.load("db", table);
  await cache.load("db", table, true);
  finish(details);
  await first;
  assert.equal(cache.peek("db", table), newer);
});
