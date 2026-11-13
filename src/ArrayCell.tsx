import { formatArrayPreview } from "./array-preview";

export function ArrayCell({
  value,
  dataType,
}: {
  value: string;
  dataType: string;
}) {
  const parts = formatArrayPreview(value, dataType === "boolean[]");
  if (!parts) return <span>{value}</span>;

  return (
    <span className="array-preview" title={value}>
      {parts.length === 0 && <span className="array-preview-null">[]</span>}
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.kind === "bracket"
              ? "array-preview-bracket"
              : `array-preview-item ${part.kind === "null" ? "array-preview-null" : ""}`
          }
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}
