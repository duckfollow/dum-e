import { memo, useMemo } from "react";
import { PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import type { ReactNode } from "react";
import type { Driver } from "./model";
import "./sql-highlight.css";

export const SqlPreview = memo(function SqlPreview({
  sql,
  driver,
  className = "",
  inline = false,
}: {
  sql: string;
  driver: Driver;
  className?: string;
  inline?: boolean;
}) {
  const content = useMemo(() => {
    const dialect = driver === "postgres" ? PostgreSQL : SQLite;
    const nodes: ReactNode[] = [];
    let position = 0;
    highlightTree(
      dialect.language.parser.parse(sql),
      classHighlighter,
      (from, to, classes) => {
        if (from > position) nodes.push(sql.slice(position, from));
        nodes.push(
          <span key={from} className={classes}>
            {sql.slice(from, to)}
          </span>,
        );
        position = to;
      },
    );
    if (position < sql.length) nodes.push(sql.slice(position));
    return nodes;
  }, [sql, driver]);
  if (inline)
    return <code className={`sql-highlight ${className}`}>{content}</code>;
  return (
    <pre className={`sql-highlight ${className}`}>
      <code>{content}</code>
    </pre>
  );
});
