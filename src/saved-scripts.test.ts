import test from "node:test";
import assert from "node:assert/strict";
import {
  readSavedScripts,
  writeSavedScripts,
  SAVED_SCRIPTS_KEY,
} from "./saved-scripts.ts";

test("saved scripts survive reload with exact SQL and connection metadata", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.deepEqual(readSavedScripts(storage), []);
  const scripts = [
    {
      id: "script",
      name: "รายงาน",
      sql: "-- report\nSELECT '🦆', 9007199254740993;",
      profileId: "db",
      connectionName: "Local",
      driver: "postgres" as const,
      updatedAt: 1000,
    },
  ];
  writeSavedScripts(storage, scripts);
  assert.deepEqual(readSavedScripts(storage), scripts);
  writeSavedScripts(storage, [
    { ...scripts[0], name: "Renamed", sql: "SELECT 2;" },
  ]);
  assert.equal(readSavedScripts(storage)[0].sql, "SELECT 2;");
  writeSavedScripts(storage, []);
  assert.deepEqual(readSavedScripts(storage), []);
  assert.ok(values.has(SAVED_SCRIPTS_KEY));
});
test("unreadable saved data and storage failures are surfaced without writing", () => {
  for (const raw of [
    "{",
    "null",
    "{}",
    '[{"id":"x"}]',
    '[{"id":"x","name":"n","sql":"s","profileId":"p","connectionName":"c","driver":"unknown","updatedAt":1}]',
  ]) {
    assert.throws(() => readSavedScripts({ getItem: () => raw }));
  }
  assert.throws(() =>
    readSavedScripts({
      getItem: () => {
        throw Error("denied");
      },
    }),
  );
  assert.throws(() =>
    writeSavedScripts(
      {
        setItem: () => {
          throw Error("full");
        },
      },
      [],
    ),
  );
});
