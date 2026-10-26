import { syntaxTree } from "@codemirror/language";
import {
  insertCompletionText,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { quoteIdentifier, type Table } from "./model.ts";

// Quoted identifiers may contain spaces, dots, Unicode, and escaped quotes.
const identifier = '(?:"(?:[^"\\n]|"")*"|[\\p{L}_][\\p{L}\\p{N}\\p{M}_$]*)';
const qualifiedSuffix = new RegExp(
  `(${identifier})\\s*\\.\\s*("(?:[^"\\n]|"")*"?|[\\p{L}\\p{N}\\p{M}_$]*)$`,
  "u",
);
const identifierSuffix = /"(?:[^"\n]|"")*"?$|[\p{L}\p{N}\p{M}_$]+$/u;
const decode = (value: string) =>
  value.startsWith('"')
    ? value
        .slice(1, value.endsWith('"') && value.length > 1 ? -1 : undefined)
        .replaceAll('""', '"')
    : value;

export function tableCompletionSource(tables: Table[]): CompletionSource {
  const unique = [
    ...new Map(
      tables.map((table) => [
        JSON.stringify([table.schema, table.name]),
        table,
      ]),
    ).values(),
  ];
  return (context) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (/Comment|String|Bits|Bytes/.test(node.name)) return null;
    const before = context.state.sliceDoc(0, context.pos);
    const qualified = qualifiedSuffix.exec(before);
    const word = identifierSuffix.exec(before);
    const prefix = qualified ? decode(qualified[1]) : null;
    const fragment = qualified ? qualified[2] : word?.[0] || "";
    if (!qualified && !word && !context.explicit) return null;
    // A dotted reference to an alias or unknown schema must not get table suggestions.
    const from = qualified?.index ?? word?.index ?? context.pos;
    if (!qualified && /\.\s*$/.test(before.slice(0, from))) return null;
    const candidates = unique.filter(
      (table) =>
        prefix === null ||
        (qualified![1].startsWith('"')
          ? table.schema === prefix
          : table.schema.toLocaleLowerCase() === prefix.toLocaleLowerCase()),
    );
    const needle = decode(fragment).toLocaleLowerCase();
    return {
      from,
      // The full qualified span is replaced, so filtering uses the table fragment here.
      filter: false,
      options: candidates
        .filter((table) => table.name.toLocaleLowerCase().startsWith(needle))
        .map((table) => ({
          label: table.name,
          detail: table.schema,
          type: "type",
          apply(view, _completion, start, end) {
            const text = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
            // Consume a closing quote when completing inside an existing quoted identifier.
            const closing =
              fragment.startsWith('"') &&
              !fragment.slice(1).endsWith('"') &&
              view.state.sliceDoc(end, end + 1) === '"'
                ? 1
                : 0;
            view.dispatch(
              insertCompletionText(view.state, text, start, end + closing),
            );
          },
        })),
    };
  };
}
