/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useRef } from "react";

import BatchCreationModal from "../draft/batch-creation-modal.jsx";
import {
  TAKE_OUT_REASON_MAX,
  takeOutConfirmWindow,
  takeOutProgressWindow,
} from "./takeOutOfBatchModel";

// Targeted Batch rules TB-R060 (1.3.62): taking a meter out of a batch follows the owner's submit standard.
// A confirmation window naming the meter(s) and the batch and asking for the reason in the person's own words,
// visible progress while it runs (never silence), and a result window afterwards saying how many were taken
// out and naming any that were refused, with the reason in plain words.
// The confirmation has its own card, as Unallocate's does, because it takes a reason: the keyboard starts in
// the reason box. Progress and the result use the shared window.
function TakeOutConfirmCard({ batch, items, reasonText, onReasonChange, onConfirm, onClose }) {
  const view = takeOutConfirmWindow({ batch, items, reasonText });
  const reasonRef = useRef(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={styles.card} role="dialog" aria-modal="true" aria-labelledby="take-out-title">
        <div style={styles.header}>
          <p style={styles.eyebrow}>Take out of batch</p>
          <h2 id="take-out-title" style={styles.title}>{view.title}</h2>
        </div>

        <div style={styles.body}>
          <ul style={styles.meterList}>
            {view.rows.map((row) => (
              <li key={row.key} style={styles.meterItem}>
                <strong>{row.meterNo}</strong>
                <small style={styles.muted}>{row.line}</small>
              </li>
            ))}
          </ul>

          {view.lines.map((line) => (
            <p key={line} style={styles.text}>{line}</p>
          ))}

          <label style={styles.reasonLabel} htmlFor="take-out-reason">
            Reason, in your own words (required)
            <textarea
              id="take-out-reason"
              ref={reasonRef}
              style={styles.reasonInput}
              value={reasonText}
              maxLength={TAKE_OUT_REASON_MAX}
              rows={3}
              placeholder="For example: batched by mistake, the meter belongs to next month's work"
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </label>
          {view.reasonHint ? <p style={styles.hint}>{view.reasonHint}</p> : null}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...styles.confirmButton, ...(view.canConfirm ? null : styles.disabledButton) }}
            onClick={onConfirm}
            disabled={!view.canConfirm}
          >
            Take out of batch
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TargetedBatchTakeOutWindows({
  view,
  batch,
  items = [],
  reasonText = "",
  onReasonChange,
  onConfirm,
  onClose,
}) {
  if (!view) return null;

  if (view.kind === "confirm") {
    return (
      <TakeOutConfirmCard
        batch={batch}
        items={items}
        reasonText={reasonText}
        onReasonChange={onReasonChange}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
  }

  if (view.kind === "working") {
    const progress = takeOutProgressWindow({ batch, items });
    return <BatchCreationModal title={progress.title} working lines={progress.lines} />;
  }

  return (
    <BatchCreationModal
      title={view.title}
      tone={view.tone}
      lines={view.lines}
      escapeAction={onClose}
      actions={[{ label: "OK", primary: true, onClick: onClose }]}
    />
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, zIndex: 1100, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.62)" },
  card: { width: "min(640px, 96vw)", maxHeight: "92vh", overflowY: "auto", borderRadius: "1rem", background: "#ffffff", boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)" },
  header: { padding: "1rem 1.1rem", borderBottom: "1px solid #e2e8f0" },
  eyebrow: { margin: 0, color: "#b45309", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" },
  title: { margin: "0.2rem 0 0", color: "#0f172a", fontSize: "1.15rem", overflowWrap: "anywhere" },
  body: { display: "grid", gap: "0.8rem", padding: "1rem 1.1rem" },
  meterList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem", maxHeight: 220, overflowY: "auto" },
  meterItem: { display: "grid", gap: "0.15rem", padding: "0.5rem 0.6rem", border: "1px solid #e2e8f0", borderRadius: "0.6rem", background: "#f8fafc", overflowWrap: "anywhere" },
  muted: { color: "#64748b" },
  text: { margin: 0, color: "#334155", fontSize: "0.9rem", lineHeight: 1.5 },
  reasonLabel: { display: "grid", gap: "0.4rem", color: "#334155", fontSize: "0.85rem", fontWeight: 850 },
  reasonInput: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: "0.6rem", padding: "0.6rem", font: "inherit", fontWeight: 500, resize: "vertical" },
  hint: { margin: 0, padding: "0.5rem 0.6rem", border: "1px solid #fde68a", borderRadius: "0.6rem", background: "#fffbeb", color: "#92400e", fontSize: "0.85rem", fontWeight: 700 },
  footer: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.9rem 1.1rem", borderTop: "1px solid #e2e8f0" },
  cancelButton: { border: "1px solid #cbd5e1", borderRadius: "0.7rem", padding: "0.6rem 0.85rem", background: "#ffffff", color: "#334155", fontWeight: 850, cursor: "pointer" },
  confirmButton: { border: "1px solid #b45309", borderRadius: "0.7rem", padding: "0.6rem 0.85rem", background: "#b45309", color: "#ffffff", fontWeight: 850, cursor: "pointer" },
  disabledButton: { opacity: 0.55, cursor: "not-allowed" },
};
