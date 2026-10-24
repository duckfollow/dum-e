import test from "node:test";
import assert from "node:assert/strict";
import { mutationSql } from "./explorer-model.ts";

test("PostgreSQL object mutations quote every identifier and never add CASCADE", () => {
  const target = {
    schema: 'shop"; DROP SCHEMA public; --',
    table: {
      schema: 'shop"; DROP SCHEMA public; --',
      name: 'order"items',
      kind: "table",
    },
  };
  assert.equal(
    mutationSql(target, "postgres", "rename", 'new"name'),
    'ALTER TABLE "shop""; DROP SCHEMA public; --"."order""items" RENAME TO "new""name";',
  );
  assert.equal(
    mutationSql(target, "postgres", "drop"),
    'DROP TABLE "shop""; DROP SCHEMA public; --"."order""items" RESTRICT;',
  );
  assert.equal(
    mutationSql({ schema: "demo" }, "postgres", "rename", "archive"),
    'ALTER SCHEMA "demo" RENAME TO "archive";',
  );
  assert.equal(
    mutationSql({ schema: "demo" }, "postgres", "drop"),
    'DROP SCHEMA "demo" RESTRICT;',
  );
});
test("mutation syntax respects PostgreSQL views and foreign tables", () => {
  for (const [kind, sqlKind] of [
    ["view", "VIEW"],
    ["materialized view", "MATERIALIZED VIEW"],
    ["foreign table", "FOREIGN TABLE"],
    ["partitioned table", "TABLE"],
  ]) {
    const target = {
      schema: "public",
      table: { schema: "public", name: "items", kind },
    };
    assert.equal(
      mutationSql(target, "postgres", "drop"),
      `DROP ${sqlKind} "public"."items" RESTRICT;`,
    );
    assert.equal(
      mutationSql(target, "postgres", "rename", "next"),
      `ALTER ${sqlKind} "public"."items" RENAME TO "next";`,
    );
  }
});
test("SQLite unsupported mutations fail before execution and table names stay quoted", () => {
  assert.throws(() => mutationSql({ schema: "main" }, "sqlite", "drop"));
  assert.throws(() =>
    mutationSql({ schema: "main" }, "sqlite", "rename", "next"),
  );
  const view = {
    schema: "main",
    table: { schema: "main", name: "items", kind: "view" },
  };
  assert.throws(() => mutationSql(view, "sqlite", "rename", "next"));
  assert.equal(
    mutationSql(view, "sqlite", "drop"),
    'DROP VIEW "main"."items";',
  );
  assert.equal(
    mutationSql(
      { ...view, table: { ...view.table, kind: "table" } },
      "sqlite",
      "rename",
      "next",
    ),
    'ALTER TABLE "main"."items" RENAME TO "next";',
  );
});
test("rename validates empty, null and PostgreSQL UTF-8 byte limits", () => {
  const target = { schema: "public" };
  assert.throws(() => mutationSql(target, "postgres", "rename", " "));
  assert.throws(() => mutationSql(target, "postgres", "rename", "a\0b"));
  assert.throws(() =>
    mutationSql(target, "postgres", "rename", "ก".repeat(22)),
  );
  assert.ok(mutationSql(target, "postgres", "rename", "ก".repeat(21)));
});
