const DEFAULT_MAX_REGISTRY_ID_CHARS = 31;
const DEFAULT_EMPTY_VALUE = "NAv";

function safeDisplayText(value, fallback = DEFAULT_EMPTY_VALUE) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function truncateRegistryIdentifier(value, maxChars = DEFAULT_MAX_REGISTRY_ID_CHARS) {
  const text = safeDisplayText(value);

  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return ".".repeat(Math.max(maxChars, 0));

  return `${text.slice(0, maxChars - 3)}...`;
}

export default function RegistryIdText({
  value,
  maxChars = DEFAULT_MAX_REGISTRY_ID_CHARS,
  className = "",
  style = {},
}) {
  const fullText = safeDisplayText(value);
  const displayText = truncateRegistryIdentifier(fullText, maxChars);

  return (
    <span
      className={className}
      title={fullText}
      style={{
        display: "inline-block",
        maxWidth: `${maxChars}ch`,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        ...style,
      }}
    >
      {displayText}
    </span>
  );
}
