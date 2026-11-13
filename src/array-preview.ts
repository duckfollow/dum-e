type ArrayPart = { kind: "bracket" | "value" | "null"; text: string };

export function formatArrayPreview(
  value: string,
  booleanArray: boolean,
): ArrayPart[] | undefined {
  // Preserve the literal for arrays with explicit bounds or a custom delimiter.
  if (!value.startsWith("{") || !value.endsWith("}") || value.includes(";"))
    return undefined;

  const parts: ArrayPart[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[^{},"\\]+|[{},]/gy;
  let depth = 0;
  while (tokens.lastIndex < value.length) {
    const match = tokens.exec(value);
    if (!match) return undefined;
    const token = match[0];
    if (token === "{") {
      if (depth++ > 0) parts.push({ kind: "bracket", text: "[" });
    } else if (token === "}") {
      if (--depth > 0) parts.push({ kind: "bracket", text: "]" });
    } else if (token === "NULL") {
      parts.push({ kind: "null", text: "NULL" });
    } else if (token !== ",") {
      const text = token.startsWith('"')
        ? JSON.stringify(token.slice(1, -1).replace(/\\([\s\S])/g, "$1"))
        : booleanArray && (token === "t" || token === "f")
          ? token === "t"
            ? "true"
            : "false"
          : token;
      parts.push({ kind: "value", text });
    }
  }
  return parts;
}
