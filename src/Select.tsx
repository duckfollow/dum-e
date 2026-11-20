import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join("");
}

// Keep a native select for form values and React change events. The visible
// trigger and listbox share the app's theme, including inside modal dialogs.
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
  });
  const search = useRef({ text: "", time: 0 });
  const options = Children.toArray(props.children)
    .filter(
      isValidElement<{
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      }>,
    )
    .map((child) => ({
      value: String(child.props.value ?? optionText(child.props.children)),
      label: optionText(child.props.children),
      disabled: !!child.props.disabled,
    }));
  const selected = options.findIndex(
    (option) => option.value === String(props.value ?? props.defaultValue),
  );
  const selectedIndex = selected >= 0 ? selected : 0;

  function show() {
    const button = trigger.current;
    if (!button || button.matches(":disabled") || !options.length) return;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(280, Math.max(below, above));
    const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 180));
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top:
        below >= Math.min(280, options.length * 34 + 8) || below >= above
          ? rect.bottom + 4
          : Math.max(
              8,
              rect.top - Math.min(height, options.length * 34 + 8) - 4,
            ),
      width,
      maxHeight: height,
    });
    setActive(selectedIndex);
    setOpen(true);
  }
  function close() {
    setOpen(false);
  }
  function choose(index: number) {
    const option = options[index];
    if (
      !option ||
      option.disabled ||
      !native.current ||
      native.current.matches(":disabled")
    )
      return;
    if (native.current.value !== option.value) {
      native.current.value = option.value;
      native.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
    trigger.current?.focus();
  }
  function move(direction: number) {
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActive(next);
        return;
      }
    }
  }
  useLayoutEffect(() => {
    if (open) {
      const list = menu.current;
      list?.focus({ preventScroll: true });
      const option = list?.querySelector<HTMLElement>(
        `[data-index="${active}"]`,
      );
      if (list && option) {
        if (option.offsetTop < list.scrollTop)
          list.scrollTop = option.offsetTop;
        else if (
          option.offsetTop + option.offsetHeight >
          list.scrollTop + list.clientHeight
        )
          list.scrollTop =
            option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        close();
    }
    function scroll(event: Event) {
      if (!menu.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const label = props["aria-label"] || "Select option";
  return (
    <>
      <select
        {...props}
        ref={native}
        autoFocus={false}
        aria-hidden="true"
        tabIndex={-1}
        className="select-native"
      />
      <button
        ref={trigger}
        type="button"
        className={`select-trigger ${props.className || ""}`}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        aria-label={label}
        aria-labelledby={props["aria-labelledby"]}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={options[selectedIndex]?.label}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            show();
            if (event.key === "Home")
              setActive(options.findIndex((option) => !option.disabled));
            if (event.key === "End")
              setActive(
                options.map((option) => !option.disabled).lastIndexOf(true),
              );
          }
          props.onKeyDown?.(
            event as unknown as KeyboardEvent<HTMLSelectElement>,
          );
        }}
      >
        <span>{options[selectedIndex]?.label || "Choose…"}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="select-menu"
            role="listbox"
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            tabIndex={-1}
            style={position}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowDown":
                  event.preventDefault();
                  event.stopPropagation();
                  move(1);
                  return;
                case "ArrowUp":
                  event.preventDefault();
                  event.stopPropagation();
                  move(-1);
                  return;
                case "Home":
                  event.preventDefault();
                  setActive(options.findIndex((option) => !option.disabled));
                  return;
                case "End":
                  event.preventDefault();
                  setActive(
                    options.map((option) => !option.disabled).lastIndexOf(true),
                  );
                  return;
                case "Enter":
                case " ":
                  event.preventDefault();
                  event.stopPropagation();
                  choose(active);
                  return;
                case "Escape":
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                  trigger.current?.focus();
                  return;
                case "Tab":
                  close();
                  trigger.current?.focus();
                  return;
              }
              if (
                event.key.length === 1 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey
              ) {
                event.preventDefault();
                const now = Date.now();
                search.current = {
                  text:
                    (now - search.current.time < 700
                      ? search.current.text
                      : "") + event.key.toLowerCase(),
                  time: now,
                };
                const match = options.findIndex(
                  (option) =>
                    !option.disabled &&
                    option.label.toLowerCase().startsWith(search.current.text),
                );
                if (match >= 0) setActive(match);
              }
            }}
          >
            {options.map((option, index) => (
              <div
                key={`${option.value}-${index}`}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={option.disabled}
                className={`select-option ${active === index ? "active" : ""}`}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {index === selectedIndex && <Check size={14} />}
              </div>
            ))}
          </div>,
          trigger.current?.closest("dialog") || document.body,
        )}
    </>
  );
}
