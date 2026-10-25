import { memo, useMemo } from "react";
import { Braces } from "lucide-react";
import { cellText, type Cell } from "./model";
import {
  jsonCellDocument,
  jsonSummary,
  type JsonDocument,
} from "./json-viewer-model";
import "./json-viewer.css";
export const JsonCell = memo(function JsonCell({
  value,
  dataType,
  raw,
  label,
  onOpen,
}: {
  value: Cell;
  dataType: string;
  raw?: string;
  label: string;
  onOpen: (doc: JsonDocument) => void;
}) {
  const doc = useMemo(
    () => jsonCellDocument(value, dataType, raw, label),
    [value, dataType, raw, label],
  );
  if (!doc) return <>{cellText(value)}</>;
  return (
    <button
      type="button"
      className={`json-cell-button ${doc.sqlNull ? "is-sql-null" : ""}`}
      title={`View ${doc.origin}: ${label}`}
      aria-label={`View JSON ${label}${doc.sqlNull ? " (SQL NULL)" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(doc);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Braces size={13} aria-hidden="true" />
      <span>{jsonSummary(doc)}</span>
    </button>
  );
});
