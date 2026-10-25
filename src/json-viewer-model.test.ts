import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJson,
  prettyJson,
  searchJson,
  jsonCellDocument,
  branchIds,
} from "./json-viewer-model.ts";

test("formatting preserves exact numbers, duplicate keys and escaped strings", () => {
  const raw =
    '{"id":9007199254740993,"id":1.234567890123456789,"text":"ไทย\\n\\\"💛"}';
  const root = parseJson(raw);
  const pretty = prettyJson(root);
  assert.equal(root.children.length, 3);
  assert.ok(pretty.includes("9007199254740993"));
  assert.ok(pretty.includes("1.234567890123456789"));
  assert.equal((pretty.match(/"id":/g) ?? []).length, 2);
  assert.deepEqual(JSON.parse(pretty), JSON.parse(raw));
});
test("rejects malformed JSON instead of displaying an inaccurate tree", () => {
  for (const raw of [
    "",
    '{"a":1,}',
    "[1,]",
    "01",
    "true false",
    "{a:1}",
    '"bad\nstring"',
    "[NaN]",
    '{"a" 1}',
  ])
    assert.throws(() => parseJson(raw), Error, raw);
});
test("search finds decoded keys and values and keeps their ancestors", () => {
  const root = parseJson(
    '{"nested":{"\\u006eame":"Thai","count":7},"other":false}',
  );
  const found = searchJson(root, "NAME");
  assert.equal(found.matches.size, 1);
  assert.equal(found.visible.size, 3);
  assert.equal(searchJson(root, "thai").matches.size, 1);
  assert.equal(searchJson(root, "missing").visible.size, 0);
  assert.equal(branchIds(root).length, 2);
});
test("distinguishes JSON null, SQL NULL and structured JSON text", () => {
  assert.equal(
    jsonCellDocument(null, "JSONB", "null", "x")?.sqlNull,
    undefined,
  );
  assert.equal(jsonCellDocument(null, "JSONB", undefined, "x")?.sqlNull, true);
  assert.equal(
    jsonCellDocument("[1,true,null]", "TEXT", undefined, "x")?.raw,
    "[1,true,null]",
  );
  assert.equal(jsonCellDocument("hello", "TEXT", undefined, "x"), null);
  assert.equal(jsonCellDocument("{invalid}", "TEXT", undefined, "x"), null);
  assert.equal(prettyJson(parseJson("null")), "null");
  assert.equal(prettyJson(parseJson("{}")), "{}");
  assert.equal(prettyJson(parseJson("[]")), "[]");
});
test("bounds tree work for deeply nested and very wide documents", () => {
  assert.throws(
    () => parseJson("[".repeat(130) + "0" + "]".repeat(130)),
    /deeply nested/,
  );
  assert.throws(
    () => parseJson("[" + Array(5001).fill("0").join(",") + "]"),
    /too many values/,
  );
});
