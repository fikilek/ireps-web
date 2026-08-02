/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect } from "react";

import { formatNumber } from "./targetedBatchUtils";

export default function TargetedBatchDeleteModal({
  batch,
  isDeleting = false,
  error = "",
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !isDeleting) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeleting, onClose]);

  const rowCount = Number(
    batch?.counts?.totalRows || batch?.totalRows || 0,
  );

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !isDeleting
        ) {
          onClose();
        }
      }}
    >
      <div style={styles.card} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Delete Targeted Batch</p>
            <h2 style={styles.title}>{batch?.id || "NAv"}</h2>
            <p style={styles.subtitle}>
              This action permanently removes the complete Targeted Batch.
            </p>
          </div>

          <button
            type="button"
            style={{
              ...styles.closeButton,
              ...(isDeleting ? styles.disabledButton : null),
            }}
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close delete confirmation"
          >
            ×
          </button>
        </div>

        <div style={styles.body}>
          <section style={styles.warningBox}>
            <strong>Deletion is permitted only before execution starts.</strong>
            <p style={styles.warningText}>
              The backend will recheck the parent and every permanent TB Row.
              If any row has entered execution, deletion will be blocked.
            </p>
          </section>

          <section style={styles.summaryBox}>
            <div>
              <span style={styles.summaryLabel}>TB ID</span>
              <strong style={styles.summaryValue}>{batch?.id || "NAv"}</strong>
            </div>
            <div>
              <span style={styles.summaryLabel}>Permanent TB Rows</span>
              <strong style={styles.summaryValue}>
                {formatNumber(rowCount)}
              </strong>
            </div>
          </section>

          <p style={styles.explanation}>
            Confirming will delete the <strong>tb_uploads</strong> parent, all
            matching <strong>tb_rows</strong>, and this TB ID from each linked
            Sales document&apos;s <strong>tbRefs</strong> array. Sales documents
            themselves are not deleted.
          </p>

          {error ? (
            <div style={styles.errorBox}>
              <strong>Deletion failed</strong>
              <p style={styles.errorText}>{error}</p>
            </div>
          ) : null}
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            style={{
              ...styles.cancelButton,
              ...(isDeleting ? styles.disabledButton : null),
            }}
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>

          <button
            type="button"
            style={{
              ...styles.deleteButton,
              ...(isDeleting ? styles.disabledButton : null),
            }}
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting Targeted Batch..." : "Delete Targeted Batch"}
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
    zIndex: 1100,
    display: "grid",
    placeItems: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.62)",
  },
  card: {
    width: "min(680px, 96vw)",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
  },
  closeButton: {
    width: "2.2rem",
    height: "2.2rem",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    cursor: "pointer",
    fontSize: "1.25rem",
  },
  body: {
    display: "grid",
    gap: "1rem",
    padding: "1rem 1.1rem",
  },
  warningBox: {
    padding: "0.9rem",
    border: "1px solid #fca5a5",
    borderRadius: "0.8rem",
    background: "#fef2f2",
    color: "#991b1b",
  },
  warningText: {
    margin: "0.35rem 0 0",
    lineHeight: 1.5,
  },
  summaryBox: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.75rem",
    padding: "0.9rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.8rem",
    background: "#f8fafc",
  },
  summaryLabel: {
    display: "block",
    marginBottom: "0.3rem",
    color: "#64748b",
    fontSize: "0.75rem",
    fontWeight: 850,
  },
  summaryValue: {
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  explanation: {
    margin: 0,
    color: "#475569",
    lineHeight: 1.6,
  },
  errorBox: {
    padding: "0.9rem",
    border: "1px solid #fca5a5",
    borderRadius: "0.8rem",
    background: "#fff1f2",
    color: "#9f1239",
  },
  errorText: {
    margin: "0.3rem 0 0",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    padding: "0.9rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  cancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    padding: "0.6rem 0.85rem",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 850,
    cursor: "pointer",
  },
  deleteButton: {
    border: "1px solid #b91c1c",
    borderRadius: "0.7rem",
    padding: "0.6rem 0.85rem",
    background: "#b91c1c",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
};
