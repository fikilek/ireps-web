import React from "react";

function normalizeUpper(value = "") {
  return String(value ?? "").trim().toUpperCase();
}

export function qaStatusTone(status = "") {
  const normalized = normalizeUpper(status).replace(/_/g, " ");
  switch (normalized) {
    case "TRUE":
    case "COMPLETED":
    case "LINKED":
    case "ACCEPTED":
    case "QA PASS":
    case "PASS":
      return "success";
    case "FALSE":
    case "FAILED":
    case "REJECTED":
    case "QA FAIL":
    case "FAIL":
      return "danger";
    case "IN PROGRESS":
    case "QA PENDING":
    case "PENDING":
      return "warning";
    default:
      return "neutral";
  }
}

const styles = {
  qaPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "1.9rem",
    padding: "0.25rem 0.65rem",
    borderRadius: "9999px",
    fontSize: "0.74rem",
    fontWeight: 800,
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
    border: "1px solid #cbd5e1",
    background: "#f1f5f9",
    color: "#475569",
    cursor: "default",
    transition: "all 0.15s ease-in-out",
  },
  qaPillEnabled: {
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  qaPillDisabled: {
    opacity: 0.9,
    cursor: "not-allowed",
  },
  qaPillSuccess: {
    border: "1px solid #86efac",
    background: "#f0fdf4",
    color: "#166534",
  },
  qaPillWarning: {
    border: "1px solid #fde047",
    background: "#fefce8",
    color: "#854d0e",
  },
  qaPillDanger: {
    border: "1px solid #fca5a5",
    background: "#fef2f2",
    color: "#991b1b",
  },
};

/**
 * Standardized clickable QA Status pill button for all iREPS tables.
 *
 * Displays the authoritative QA status in canonical colors.
 * Clicking the button opens the dedicated Review Modal.
 */
export default function QaPill({
  status,
  label,
  disabled = false,
  onClick,
  title,
  ariaLabel,
}) {
  const displayLabel = label || status || "QA NAv";
  const tone = qaStatusTone(status || displayLabel);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={title}
      aria-label={ariaLabel || title || displayLabel}
      style={{
        ...styles.qaPill,
        ...(tone === "success" ? styles.qaPillSuccess : null),
        ...(tone === "warning" ? styles.qaPillWarning : null),
        ...(tone === "danger" ? styles.qaPillDanger : null),
        ...(disabled ? styles.qaPillDisabled : styles.qaPillEnabled),
      }}
    >
      {displayLabel}
    </button>
  );
}
