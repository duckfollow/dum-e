import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";

export function ConnectionMenu({
  name,
  connected,
  disabled,
  onEdit,
  onRemove,
}: {
  name: string;
  connected: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    action.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <div
      className="connection-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="icon-button connection-menu-trigger"
        title={`Connection options: ${name}`}
        aria-label={`Connection options: ${name}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect)
            setPosition({
              top: Math.min(rect.bottom + 4, window.innerHeight - 110),
              left: Math.max(8, rect.right - 240),
            });
          setOpen((value) => !value);
        }}
      >
        <Ellipsis size={16} />
      </button>
      {open && (
        <div id={id} className="connection-menu-panel" style={position}>
          <button
            ref={action}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onEdit();
            }}
          >
            <Pencil size={13} />
            {connected ? "Disconnect & edit connection" : "Edit connection"}
          </button>
          <div className="connection-menu-divider" />
          <button
            className="connection-remove-action"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 size={13} />
            Remove connection
          </button>
        </div>
      )}
    </div>
  );
}
