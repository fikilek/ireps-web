/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect } from "react";

export default function TargetedBatchConfirmModal({
  draft,
  isCreating = false,
  onCancel,
  onConfirm,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !isCreating) onCancel();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreating, onCancel]);

  const rowCount = Array.isArray(draft?.displayRows)
    ? draft.displayRows.length
    : 0;

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isCreating) onCancel();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tb-confirm-title"
        aria-describedby="tb-confirm-description"
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>TB Draft</p>
            <h2 id="tb-confirm-title" style={styles.title}>
              Confirm permanent Targeted Batch creation
            </h2>
          </div>

          <button
            type="button"
            style={{
              ...styles.closeButton,
              ...(isCreating ? styles.disabledButton : null),
            }}
            onClick={onCancel}
            disabled={isCreating}
            aria-label="Close confirmation"
          >
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.batchCard}>
            <span style={styles.label}>Targeted Batch ID</span>
            <strong style={styles.batchId}>{draft?.id || "NAv"}</strong>
          </div>

          <p id="tb-confirm-description" style={styles.description}>
            This will create one permanent TB parent, {rowCount} permanent TB
            {rowCount === 1 ? " Row" : " Rows"}, and the matching Sales
            references. The temporary TB Draft will be cleared only after the
            backend verifies the permanent Targeted Batch as READY.
          </p>

          <div style={styles.notice}>
            <strong>Permanent creation gate</strong>
            <span>
              Do not close or refresh the page while creation and verification
              are running.
            </span>
          </div>
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              ...(isCreating ? styles.disabledButton : null),
            }}
            onClick={onCancel}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(isCreating ? styles.disabledButton : null),
            }}
            onClick={onConfirm}
            disabled={isCreating}
          >
            {isCreating ? "Creating Targeted Batch..." : "Confirm TB Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "grid",
    placeItems: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.62)",
  },
  card: {
    width: "min(560px, 96vw)",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.25rem 0 0",
    color: "#0f172a",
    fontSize: "1.2rem",
  },
  closeButton: {
    width: "2.2rem",
    height: "2.2rem",
    flex: "0 0 auto",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
  },
  body: {
    display: "grid",
    gap: "1rem",
    padding: "1rem 1.1rem",
  },
  batchCard: {
    display: "grid",
    gap: "0.25rem",
    padding: "0.85rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.8rem",
    background: "#eff6ff",
  },
  label: {
    color: "#1e40af",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  batchId: {
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  description: {
    margin: 0,
    color: "#475569",
    lineHeight: 1.6,
  },
  notice: {
    display: "grid",
    gap: "0.25rem",
    padding: "0.8rem",
    borderRadius: "0.8rem",
    background: "#f8fafc",
    color: "#334155",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    padding: "0.9rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    padding: "0.6rem 0.9rem",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 850,
    cursor: "pointer",
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    borderRadius: "0.7rem",
    padding: "0.6rem 0.9rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
};
