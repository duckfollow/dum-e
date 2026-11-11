import { useEffect, useId, useRef, useState } from "react";
import { Filter } from "lucide-react";
import type { PreviewOptions } from "./model";
import type { ColumnInfo } from "./table-model";

type PreviewFilter = NonNullable<PreviewOptions["filter"]>;

export function ColumnFilterDialog({
  column,
  current,
  onClose,
  onApply,
}: {
  column: ColumnInfo;
  current?: PreviewFilter;
  onClose: () => void;
  onApply: (filter: PreviewFilter) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [operator, setOperator] = useState(current?.operator ?? "equals");
  const [value, setValue] = useState(
    current?.value ?? column.enumValues[0] ?? "",
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="connection-dialog column-filter-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply({ column: column.name, operator, value });
        }}
      >
        <header>
          <span className="dialog-title-icon">
            <Filter size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 id={title}>Filter by {column.name}</h2>
            <code>{column.dataType}</code>
          </div>
        </header>
        <div className="column-filter-fields">
          <label>
            Condition
            <select
              autoFocus
              value={operator}
              onChange={(event) =>
                setOperator(event.target.value as PreviewFilter["operator"])
              }
            >
              <option value="equals">Equals</option>
              <option value="is-null">Is NULL</option>
              <option value="not-null">Is not NULL</option>
            </select>
          </label>
          {operator === "equals" && (
            <label>
              Value
              {column.enumValues.length > 0 ? (
                <select
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {column.enumValues.map((label) => (
                    <option key={label} value={label}>
                      {label || "(empty string)"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder="Enter a value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
          )}
        </div>
        <footer>
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary small">
            Apply filter
          </button>
        </footer>
      </form>
    </dialog>
  );
}
