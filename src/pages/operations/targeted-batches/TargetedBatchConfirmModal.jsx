/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useRef } from "react";
import { salesDraftMessage } from "./draft/sales-batch-draft-model";
import { draftButtonStyle } from "./draft/targetedBatchDraftReviewStyles";
import BusySpinner from "../../../components/busy-spinner.jsx";
export default function TargetedBatchConfirmModal({ draft, confirmation, isCreating, stale, onCancel, onConfirm }) {
  const dialog = useRef(null), cancel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; cancel.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  const handleKeys = event => {
    if (event.key === "Escape" && !isCreating) onCancel();
    if (event.key !== "Tab") return;
    const nodes = [...dialog.current.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const included = confirmation.rows.filter(row => confirmation.includedIds.includes(row.salesId));
  const leftOut = confirmation.rows.filter(row => !confirmation.includedIds.includes(row.salesId));
  return <div style={styles.overlay}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tb-confirm-title" onKeyDown={handleKeys} style={styles.card}>
    <div style={styles.header}><h2 id="tb-confirm-title">Create Targeted Batch</h2></div>
    <div style={styles.body}><p>{draft.id} · {confirmation.scope.wardName}</p><h3>Included ({included.length})</h3>
      <ul>{included.map(row => <li key={row.salesId}>{row.meterNo} · {row.address} · {row.erfId}</li>)}</ul>
      <h3>Left out ({leftOut.length})</h3><ul>{leftOut.map(row => <li key={row.salesId}>{row.meterNo} · {salesDraftMessage(row.reason)}</li>)}</ul>
      <p>OK creates this single batch with exactly the included meters.</p>
      {stale && <p role="alert">Draft data changed. Cancel and select Create again to review the current list.</p>}
      <button ref={cancel} type="button" style={draftButtonStyle(isCreating)} disabled={isCreating} onClick={onCancel}>Cancel</button>
      <button type="button" style={draftButtonStyle(isCreating || stale || included.length === 0, true)} disabled={isCreating || stale || included.length === 0} onClick={onConfirm}>{isCreating ? <BusySpinner label="Creating…" size={14} inverse asStatus={false}/> : "OK"}</button>
    </div></div></div>;
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
    width: "min(720px, 96vw)",
    maxHeight: "92vh",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    overflow: "auto",
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
  batchSummary: {
    color: "#475569",
    fontSize: "0.82rem",
  },
  batchList: {
    display: "grid",
    gap: "0.55rem",
  },
  batchListItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.8rem",
    padding: "0.75rem",
    border: "1px solid #bbf7d0",
    borderRadius: "0.75rem",
    background: "#f0fdf4",
    flexWrap: "wrap",
  },
  batchListMeta: {
    display: "block",
    marginTop: "0.2rem",
    color: "#166534",
    fontSize: "0.78rem",
  },
  batchListId: {
    color: "#166534",
    fontSize: "0.76rem",
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
