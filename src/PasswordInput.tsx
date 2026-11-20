import { useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

export function PasswordInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  revealSaved,
  onError,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  revealSaved?: () => Promise<string>;
  onError: (error: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (!visible && !value && revealSaved) {
      setLoading(true);
      try {
        onChange(await revealSaved());
      } catch (error) {
        onError(String(error));
        return;
      } finally {
        setLoading(false);
      }
    }
    setVisible(!visible);
  }
  return (
    <div className="password-input">
      <input
        aria-label={label}
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled || loading}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="icon-button"
        disabled={disabled || loading}
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        title={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        onClick={() => void toggle()}
      >
        {loading ? (
          <LoaderCircle size={15} className="spin" />
        ) : visible ? (
          <EyeOff size={15} />
        ) : (
          <Eye size={15} />
        )}
      </button>
    </div>
  );
}
