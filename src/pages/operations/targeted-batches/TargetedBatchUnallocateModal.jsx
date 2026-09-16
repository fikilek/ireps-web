import { useEffect, useRef, useState } from "react";

import { formatNumber } from "./targetedBatchUtils";

// Targeted Batch rules TB-R048 (1.3.33): confirm Unallocate with a reason. The batch, its rows, its
// geofence and its Sales membership stay; only the TEAM or SP is taken off it.
const REASON_LIMIT = 1000;

export default function TargetedBatchUnallocateModal({
  batch,
  authority = "ALLOCATOR",
  changedSinceOpened = false,
  isUnallocating = false,
  error = "",
  onClose,
  onConfirm,
}) {
  const [reason, setReason] = useState("");
  const reasonRef = useRef(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !isUnallocating) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUnallocating, onClose]);

  const rowCount = Number(batch?.counts?.totalRows || 0);
  const targetKind = batch?.allocation?.targetType === "TEAM" ? "TEAM" : "Service provider";
  const targetName = batch?.allocation?.targetName || batch?.allocation?.targetId || "NAv";
  const acceptance = String(batch?.acceptance?.status || "").toUpperCase();
  const acceptanceLabel = { WAITING: "Waiting for acceptance", ACCEPTED: "Accepted", REJECTED: "Rejected", NOT_READY: "Not ready" }[acceptance] || acceptance || "NAv";
  const trimmedReason = reason.trim();
  const canConfirm = Boolean(trimmedReason) && trimmedReason.length <= REASON_LIMIT && !isUnallocating && !changedSinceOpened;

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isUnallocating) onClose();
      }}
    >
      <div style={styles.card} role="dialog" aria-modal="true" aria-labelledby="unallocate-title">
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Unallocate Targeted Batch</p>
            <h2 id="unallocate-title" style={styles.title}>{batch?.id || "NAv"}</h2>
            <p style={styles.subtitle}>
              Takes the batch back from {targetName} so it can be allocated again, to anyone.
            </p>
          </div>

          <button
            type="button"
            style={{ ...styles.closeButton, ...(isUnallocating ? styles.disabledButton : null) }}
            onClick={onClose}
            disabled={isUnallocating}
            aria-label="Close unallocate confirmation"
          >
            ×
          </button>
        </div>

        <div style={styles.body}>
          <section style={styles.summaryBox}>
            <div>
              <span style={styles.summaryLabel}>{targetKind}</span>
              <strong style={styles.summaryValue}>{targetName}</strong>
            </div>
            <div>
              <span style={styles.summaryLabel}>Acceptance</span>
              <strong style={styles.summaryValue}>{acceptanceLabel}</strong>
            </div>
            <div>
              <span style={styles.summaryLabel}>Rows</span>
              <strong style={styles.summaryValue}>{formatNumber(rowCount)}</strong>
            </div>
          </section>

          <section style={styles.infoBox}>
            <strong>Only before field work starts.</strong>
            <p style={styles.infoText}>
              The backend rechecks every row first. If any row has started (a premise linked or a No Access
              recorded), nothing is unallocated. The batch, its rows, its geofence and its Sales meters all stay.
            </p>
          </section>

          {acceptance === "ACCEPTED" ? (
            <section style={styles.warningBox}>
              <strong>{targetName} has already accepted this batch.</strong>
              <p style={styles.infoText}>
                It is on their phones. It leaves their list of batches when a phone is online. A worker who already
                has its rows open is not moved out, but whatever they submit for it is refused and nothing is recorded.
              </p>
            </section>
          ) : null}

          {authority === "MANAGER_OVERRIDE" ? (
            <section style={styles.warningBox}>
              <strong>You did not allocate this batch.</strong>
              <p style={styles.infoText}>
                {batch?.allocation?.allocatedByUser || "Another user"} allocated it. Unallocating it is recorded as a
                manager override.
              </p>
            </section>
          ) : null}

          {changedSinceOpened ? (
            <section style={styles.errorBox}>
              <strong>This batch changed since you opened this window.</strong>
              <p style={styles.errorText}>
                It was unallocated or allocated again by someone else. Close this window and check the batch in TB
                Register before doing anything.
              </p>
            </section>
          ) : null}

          <label style={styles.reasonLabel} htmlFor="unallocate-reason">
            Reason (required)
            <textarea
              id="unallocate-reason"
              ref={reasonRef}
              style={styles.reasonInput}
              value={reason}
              maxLength={REASON_LIMIT}
              rows={3}
              placeholder="For example: allocated to the wrong team"
              onChange={(event) => setReason(event.target.value)}
              disabled={isUnallocating}
            />
          </label>

          {error ? (
            <div style={styles.errorBox}>
              <strong>Unallocate failed</strong>
              <p style={styles.errorText}>{error}</p>
            </div>
          ) : null}
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            style={{ ...styles.cancelButton, ...(isUnallocating ? styles.disabledButton : null) }}
            onClick={onClose}
            disabled={isUnallocating}
          >
            Cancel
          </button>

          <button
            type="button"
            style={{ ...styles.confirmButton, ...(!canConfirm ? styles.disabledButton : null) }}
            onClick={() => onConfirm(trimmedReason)}
            disabled={!canConfirm}
          >
            {isUnallocating ? "Unallocating..." : "Unallocate Targeted Batch"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, zIndex: 1100, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.62)" },
  card: { width: "min(680px, 96vw)", maxHeight: "92vh", overflowY: "auto", borderRadius: "1rem", background: "#ffffff", boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)" },
  header: { display: "flex", justifyContent: "space-between", gap: "1rem", padding: "1rem 1.1rem", borderBottom: "1px solid #e2e8f0" },
  eyebrow: { margin: 0, color: "#b45309", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" },
  title: { margin: "0.2rem 0 0", color: "#0f172a", overflowWrap: "anywhere" },
  subtitle: { margin: "0.35rem 0 0", color: "#64748b" },
  closeButton: { width: "2.2rem", height: "2.2rem", border: "1px solid #cbd5e1", borderRadius: "999px", background: "#ffffff", cursor: "pointer", fontSize: "1.25rem" },
  body: { display: "grid", gap: "1rem", padding: "1rem 1.1rem" },
  summaryBox: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", padding: "0.9rem", border: "1px solid #e2e8f0", borderRadius: "0.8rem", background: "#f8fafc" },
  summaryLabel: { display: "block", marginBottom: "0.3rem", color: "#64748b", fontSize: "0.75rem", fontWeight: 850 },
  summaryValue: { color: "#0f172a", overflowWrap: "anywhere" },
  infoBox: { padding: "0.9rem", border: "1px solid #bfdbfe", borderRadius: "0.8rem", background: "#eff6ff", color: "#1e3a8a" },
  warningBox: { padding: "0.9rem", border: "1px solid #fcd34d", borderRadius: "0.8rem", background: "#fffbeb", color: "#92400e" },
  infoText: { margin: "0.35rem 0 0", lineHeight: 1.5 },
  reasonLabel: { display: "grid", gap: "0.4rem", color: "#334155", fontSize: "0.85rem", fontWeight: 850 },
  reasonInput: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: "0.6rem", padding: "0.6rem", font: "inherit", fontWeight: 500, resize: "vertical" },
  errorBox: { padding: "0.9rem", border: "1px solid #fca5a5", borderRadius: "0.8rem", background: "#fff1f2", color: "#9f1239" },
  errorText: { margin: "0.3rem 0 0" },
  footer: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.9rem 1.1rem", borderTop: "1px solid #e2e8f0" },
  cancelButton: { border: "1px solid #cbd5e1", borderRadius: "0.7rem", padding: "0.6rem 0.85rem", background: "#ffffff", color: "#334155", fontWeight: 850, cursor: "pointer" },
  confirmButton: { border: "1px solid #b45309", borderRadius: "0.7rem", padding: "0.6rem 0.85rem", background: "#b45309", color: "#ffffff", fontWeight: 850, cursor: "pointer" },
  disabledButton: { opacity: 0.55, cursor: "not-allowed" },
};
