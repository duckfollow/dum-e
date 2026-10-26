import { tableCompletionSource } from "./sql-completion";
import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import "./sql-highlight.css";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import type { Driver, Table } from "./model";
export function SqlEditor({
  value,
  onChange,
  onRun,
  driver,
  tables,
  theme,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: (selection?: string) => void;
  driver: Driver;
  tables: Table[];
  theme: string;
  readOnly: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };
  const suppress = useRef(false);
  const config = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                const selection = view.current?.state.selection.main;
                const selected =
                  selection && !selection.empty
                    ? view.current!.state.sliceDoc(selection.from, selection.to)
                    : undefined;
                callbacks.current.onRun(selected);
                return true;
              },
            },
          ]),
          basicSetup,
          syntaxHighlighting(classHighlighter),
          config.current.of([]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !suppress.current)
              callbacks.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({
            "aria-label": "SQL editor",
            spellcheck: "false",
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      suppress.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
      suppress.current = false;
    }
  }, [value]);
  useEffect(() => {
    const dialect = driver === "postgres" ? PostgreSQL : SQLite;
    view.current?.dispatch({
      effects: config.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        sql({ dialect }),
        dialect.language.data.of({
          autocomplete: tableCompletionSource(tables),
        }),
        EditorView.theme(
          {
            "&": { height: "100%", backgroundColor: "var(--editor)" },
            ".cm-content": {
              fontFamily: "var(--mono)",
              fontSize: "13px",
              padding: "18px 0",
              caretColor: "var(--accent)",
              color: "var(--text)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--editor)",
              border: "none",
              color: "var(--muted)",
              paddingRight: "16px",
            },
            ".cm-activeLine,.cm-activeLineGutter": {
              backgroundColor: "var(--hover)",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground": {
              backgroundColor: "var(--selection) !important",
            },
            ".cm-cursor": { borderLeftColor: "var(--accent)" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-tooltip": {
              backgroundColor: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--line)",
            },
          },
          { dark: theme === "dark" },
        ),
      ]),
    });
  }, [driver, tables, theme, readOnly]);
  return <div className="sql-editor" ref={host} />;
}
