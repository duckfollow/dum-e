import type { Cell } from "./model";
export interface JsonDocument {
  label: string;
  raw: string;
  origin: string;
  sqlNull?: boolean;
}
export type JsonKind =
  "object" | "array" | "string" | "number" | "boolean" | "null";
export interface JsonNode {
  id: string;
  kind: JsonKind;
  raw: string;
  children: { key: string | null; node: JsonNode }[];
  depth: number;
}
export interface JsonToken {
  raw: string;
  offset: number;
  end: number;
}
export function jsonTokens(raw: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const pattern =
    /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/y;
  let offset = 0;
  while (offset < raw.length) {
    if (/[ \t\r\n]/.test(raw[offset])) {
      offset++;
      continue;
    }
    pattern.lastIndex = offset;
    const match = pattern.exec(raw);
    if (!match) throw Error(`Invalid JSON at character ${offset + 1}.`);
    tokens.push({ raw: match[0], offset, end: pattern.lastIndex });
    offset = pattern.lastIndex;
  }
  return tokens;
}
export function parseJson(raw: string): JsonNode {
  if (raw.length > 262144)
    throw Error(
      "This JSON value is too large for the tree view. Use Raw to inspect it.",
    );
  const tokens = jsonTokens(raw);
  let index = 0,
    nodes = 0;
  function value(depth: number): JsonNode {
    if (depth > 128 || ++nodes > 5000)
      throw Error(
        "This JSON is too deeply nested or has too many values for the tree view. Use Raw.",
      );
    const token = tokens[index++];
    if (!token) throw Error("Unexpected end of JSON.");
    const kind: JsonKind =
      token.raw === "{"
        ? "object"
        : token.raw === "["
          ? "array"
          : token.raw.startsWith('"')
            ? "string"
            : token.raw === "null"
              ? "null"
              : ["true", "false"].includes(token.raw)
                ? "boolean"
                : "number";
    if (
      kind === "number" &&
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.raw)
    )
      throw Error("Expected a JSON value.");
    const node: JsonNode = {
      id: `n${token.offset}`,
      kind,
      raw: token.raw,
      children: [],
      depth,
    };
    if (kind !== "object" && kind !== "array") return node;
    const end = kind === "object" ? "}" : "]";
    if (tokens[index]?.raw === end) {
      index++;
      return node;
    }
    while (true) {
      let key: string | null = null;
      if (kind === "object") {
        const token = tokens[index++];
        if (!token?.raw.startsWith('"')) throw Error("Expected an object key.");
        key = token.raw;
        if (tokens[index++]?.raw !== ":")
          throw Error("Expected a colon after the object key.");
      }
      node.children.push({ key, node: value(depth + 1) });
      const separator = tokens[index++]?.raw;
      if (separator === end) break;
      if (separator !== ",") throw Error(`Expected a comma or ${end}.`);
    }
    return node;
  }
  const root = value(0);
  if (index !== tokens.length)
    throw Error("Unexpected content after JSON value.");
  return root;
}
export function prettyJson(node: JsonNode, depth = 0): string {
  if (node.kind !== "object" && node.kind !== "array") return node.raw;
  const [open, close] = node.kind === "object" ? ["{", "}"] : ["[", "]"];
  if (!node.children.length) return open + close;
  const indent = "  ".repeat(depth + 1);
  return `${open}\n${node.children.map((child) => `${indent}${child.key === null ? "" : `${child.key}: `}${prettyJson(child.node, depth + 1)}`).join(",\n")}\n${"  ".repeat(depth)}${close}`;
}
export function searchJson(root: JsonNode, query: string) {
  const visible = new Set<string>(),
    matches = new Set<string>();
  const needle = query.toLocaleLowerCase();
  function walk(node: JsonNode, key: string | null): boolean {
    const text = key ? (JSON.parse(key) as string) : "";
    const literal =
      node.kind === "string" ? (JSON.parse(node.raw) as string) : node.raw;
    const match =
      !!needle &&
      (text.toLocaleLowerCase().includes(needle) ||
        (!node.children.length &&
          literal.toLocaleLowerCase().includes(needle)));
    if (match) matches.add(node.id);
    let childMatch = false;
    for (const child of node.children)
      childMatch = walk(child.node, child.key) || childMatch;
    if (match || childMatch) visible.add(node.id);
    return match || childMatch;
  }
  walk(root, null);
  return { visible, matches };
}
export function jsonCellDocument(
  value: Cell,
  type: string,
  raw: string | undefined,
  label: string,
): JsonDocument | null {
  const kind = type.toLowerCase();
  if (raw !== undefined)
    return { label, raw, origin: kind === "jsonb" ? "JSONB" : "JSON" };
  if (kind === "json" || kind === "jsonb")
    return value === null
      ? { label, raw: "", origin: kind.toUpperCase(), sqlNull: true }
      : { label, raw: JSON.stringify(value), origin: kind.toUpperCase() };
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      JSON.parse(value);
      return { label, raw: value, origin: "JSON text" };
    } catch {
      return null;
    }
  }
  return null;
}
export function jsonSummary(doc: JsonDocument): string {
  if (doc.sqlNull) return "SQL NULL";
  try {
    const v = JSON.parse(doc.raw);
    if (Array.isArray(v)) return `[…] · ${v.length} items`;
    if (v !== null && typeof v === "object")
      return `{…} · ${Object.keys(v).length} keys`;
    return doc.raw.length > 65 ? doc.raw.slice(0, 62) + "…" : doc.raw;
  } catch {
    return "View JSON";
  }
}
export function branchIds(node: JsonNode, maxDepth = Infinity): string[] {
  return [
    ...(node.children.length && node.depth < maxDepth ? [node.id] : []),
    ...node.children.flatMap((child) => branchIds(child.node, maxDepth)),
  ];
}
