import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Search,
  X,
  Check,
} from "lucide-react";
import {
  branchIds,
  jsonTokens,
  parseJson,
  prettyJson,
  searchJson,
  type JsonDocument,
  type JsonNode,
} from "./json-viewer-model";
import "./json-viewer.css";
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLocaleLowerCase(),
    needle = query.toLocaleLowerCase();
  const parts = [];
  let start = 0,
    index = lower.indexOf(needle);
  while (index >= 0) {
    parts.push(
      text.slice(start, index),
      <mark key={index}>{text.slice(index, index + query.length)}</mark>,
    );
    start = index + query.length;
    index = lower.indexOf(needle, start);
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}
export function JsonViewer({
  value,
  onClose,
}: {
  value: JsonDocument;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [mode, setMode] = useState<"tree" | "formatted" | "raw">("tree");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const parsed = useMemo(() => {
    if (value.sqlNull) return { root: null, pretty: "", error: "" };
    try {
      const root = parseJson(value.raw);
      return { root, pretty: prettyJson(root), error: "" };
    } catch (e) {
      return { root: null, pretty: value.raw, error: String(e) };
    }
  }, [value]);
  const [expanded, setExpanded] = useState(
    () => new Set(parsed.root ? branchIds(parsed.root, 2) : []),
  );
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const search = useMemo(
    () =>
      parsed.root
        ? searchJson(parsed.root, query)
        : { visible: new Set<string>(), matches: new Set<string>() },
    [parsed.root, query],
  );
  const text = mode === "raw" ? value.raw : parsed.pretty;
  const tokens = useMemo(() => {
    try {
      return jsonTokens(text);
    } catch {
      return [];
    }
  }, [text]);
  function toggle(node: JsonNode) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }
  function tree(node: JsonNode, key: string | null, index: number | null) {
    if (query && !search.visible.has(node.id)) return null;
    const branch = node.kind === "object" || node.kind === "array";
    const open = query ? true : expanded.has(node.id);
    const name =
      key === null
        ? index === null
          ? "$"
          : String(index)
        : (JSON.parse(key) as string);
    return (
      <div key={node.id} className="json-tree-node">
        <div
          className={`json-tree-line ${search.matches.has(node.id) ? "is-match" : ""}`}
          style={{ paddingLeft: 12 + node.depth * 18 }}
        >
          {branch && node.children.length ? (
            <button
              type="button"
              className="json-tree-toggle"
              aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
              aria-expanded={open}
              onClick={() => toggle(node)}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="json-tree-spacer" />
          )}
          <span className={key === null ? "json-index" : "json-key"}>
            <Highlight text={name} query={query} />
          </span>
          <span className="json-punctuation">:</span>
          {branch ? (
            <span className="json-branch-value">
              {node.kind === "object" ? "{" : "["}
              <span>
                {node.children.length}{" "}
                {node.kind === "object" ? "keys" : "items"}
              </span>
              {node.kind === "object" ? "}" : "]"}
            </span>
          ) : (
            <span className={`json-value json-${node.kind}`}>
              <Highlight text={node.raw} query={query} />
            </span>
          )}
          <small className="json-type">{node.kind}</small>
        </div>
        {branch &&
          open &&
          node.children.map((child, i) =>
            tree(child.node, child.key, node.kind === "array" ? i : null),
          )}
      </div>
    );
  }
  function close() {
    dialog.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="json-viewer"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby={`${id}-title`}
    >
      <header className="json-viewer-heading">
        <div>
          <span className="json-viewer-icon">
            <Braces size={19} />
          </span>
          <div>
            <h2 id={`${id}-title`}>{value.label}</h2>
            <p>
              {value.origin} <span>·</span> Read-only
            </p>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close JSON viewer"
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>
      {!value.sqlNull && (
        <div className="json-viewer-toolbar">
          <div
            className="json-viewer-tabs"
            role="tablist"
            aria-label="JSON display mode"
          >
            {(["tree", "formatted", "raw"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode === tab}
                id={`${id}-${tab}`}
                aria-controls={`${id}-panel`}
                onClick={() => setMode(tab)}
              >
                {tab === "tree"
                  ? "Tree"
                  : tab === "formatted"
                    ? "Formatted"
                    : "Raw"}
              </button>
            ))}
          </div>
          <div className="json-viewer-actions">
            {mode === "tree" && parsed.root && (
              <>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setExpanded(new Set(branchIds(parsed.root!)))}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setExpanded(new Set())}
                >
                  Collapse all
                </button>
              </>
            )}
            <button
              type="button"
              className="secondary small"
              title={
                mode === "raw" ? "Copy original JSON" : "Copy formatted JSON"
              }
              onClick={() => {
                void navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    setCopyError("");
                    setCopied(true);
                  })
                  .catch(() =>
                    setCopyError(
                      "Clipboard unavailable. Select text in Raw view to copy.",
                    ),
                  );
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </div>
        </div>
      )}
      {!value.sqlNull && (
        <div className="json-viewer-search">
          <Search size={14} />
          <input
            aria-label="Find JSON keys or values"
            placeholder="Find keys or values…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <>
              <span>
                {mode === "tree"
                  ? search.matches.size
                  : text.toLocaleLowerCase().split(query.toLocaleLowerCase())
                      .length - 1}{" "}
                matches
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Clear JSON search"
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      )}
      {copyError && (
        <p className="json-viewer-error" role="alert">
          {copyError}
        </p>
      )}
      <section
        className="json-viewer-content"
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${mode}`}
      >
        {value.sqlNull ? (
          <div className="json-viewer-empty">
            <Braces size={32} />
            <h3>SQL NULL</h3>
            <p>
              This cell has no JSON value. JSON <code>null</code> is a separate
              value.
            </p>
          </div>
        ) : parsed.error && mode === "tree" ? (
          <div className="json-viewer-empty">
            <p>{parsed.error}</p>
            <button className="secondary" onClick={() => setMode("raw")}>
              View raw JSON
            </button>
          </div>
        ) : mode === "tree" && parsed.root ? (
          <div className="json-tree">
            {query && !search.matches.size ? (
              <div className="json-viewer-empty">
                No keys or values match “{query}”.
              </div>
            ) : (
              tree(parsed.root, null, null)
            )}
          </div>
        ) : (
          <pre className="json-code">
            <code>
              {tokens.length
                ? tokens.map((token, i) => (
                    <span key={token.offset}>
                      {text.slice(i ? tokens[i - 1].end : 0, token.offset)}
                      <span
                        className={
                          token.raw.startsWith('"')
                            ? tokens[i + 1]?.raw === ":"
                              ? "json-key"
                              : "json-string"
                            : /^(true|false)$/.test(token.raw)
                              ? "json-boolean"
                              : token.raw === "null"
                                ? "json-null"
                                : /^-?\d/.test(token.raw)
                                  ? "json-number"
                                  : "json-punctuation"
                        }
                      >
                        <Highlight text={token.raw} query={query} />
                      </span>
                      {i === tokens.length - 1 ? text.slice(token.end) : null}
                    </span>
                  ))
                : text}
            </code>
          </pre>
        )}
      </section>
      <footer className="json-viewer-footer">
        <span>
          {value.sqlNull
            ? "SQL NULL"
            : `${new TextEncoder().encode(value.raw).length.toLocaleString()} bytes`}
        </span>
        <span>
          {value.sqlNull
            ? "No value"
            : query
              ? "Search filters the tree; source views keep the full document."
              : "Esc to close · Original value preserved"}
        </span>
      </footer>
    </dialog>
  );
}
