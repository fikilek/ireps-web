import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { useGetTargetedBatchDetailsByIdQuery } from "../../../redux/salesTargetedBatchApi";

export default function SalesTargetedBatchDetailsModal({ tbId, lmPcode, onClose }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const { data, isError } = useGetTargetedBatchDetailsByIdQuery(
    tbId && lmPcode ? { tbId, lmPcode } : skipToken,
  );
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("button")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== "Tab") return;
      const controls = [...(panelRef.current?.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) || [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  const details = data?.details;
  const batchError = isError || data?.sync?.sources?.batch === "error";
  const batchLoading = !batchError && data?.sync?.sources?.batch !== "ready";
  const geofenceState = data?.sync?.sources?.geofence;
  const geofenceError = geofenceState === "error";
  return createPortal(
    <div style={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} style={styles.card}>
        <header style={styles.header}>
          <h2 id={titleId} style={{ margin: 0, fontSize: "1.15rem" }}>Targeted Batch Details</h2>
          <button type="button" style={styles.close} onClick={onClose} aria-label="Close Targeted Batch details">✕</button>
        </header>
        <div style={styles.body}>
          <dl style={styles.list}>
            <div><dt style={styles.label}>Targeted Batch ID</dt><dd style={styles.value}>{tbId}</dd></div>
            {!batchLoading && !batchError && details && (
              <>
                <div>
                  <dt style={styles.label}>Geofence</dt>
                  <dd style={styles.value}>
                    {geofenceError ? (
                      <><span>{details.geofenceId}</span><p role="alert" style={styles.note}>Unable to load geofence details.</p></>
                    ) : !details.geofenceId ? "Not recorded" : (
                      <><span>ID: {details.geofenceId}</span><br />
                        <span>Name: {geofenceState === "syncing" ? "Loading…" : details.geofenceName || "Unavailable"}</span></>
                    )}
                  </dd>
                </div>
                <div><dt style={styles.label}>Created At</dt><dd style={styles.value}>
                  {details.createdAtMs ? new Date(details.createdAtMs).toLocaleString() : "Not recorded"}
                </dd></div>
                <div><dt style={styles.label}>Created By</dt><dd style={styles.value}>
                  {details.createdByUser || details.createdByUid || "Not recorded"}
                </dd></div>
              </>
            )}
          </dl>
          {batchLoading && <p role="status">Loading batch details…</p>}
          {batchError && <p role="alert">Unable to load batch details.</p>}
          {!batchLoading && !batchError && !details && <p role="status">Targeted Batch not found.</p>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(15,23,42,0.5)", padding: "1rem" },
  card: { width: "min(100%, 480px)", maxHeight: "85vh", overflowY: "auto", borderRadius: "0.9rem",
    background: "#fff", color: "#0f172a", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem",
    padding: "1rem 1.2rem", borderBottom: "1px solid #e2e8f0" },
  close: { background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "0.4rem",
    padding: "0.4rem 0.6rem", cursor: "pointer" },
  body: { padding: "1rem 1.2rem" },
  list: { margin: 0, display: "grid", gap: "1rem" },
  label: { color: "#64748b", fontSize: "0.75rem", fontWeight: 800, marginBottom: "0.3rem" },
  value: { margin: 0, overflowWrap: "anywhere", fontSize: "0.9rem", lineHeight: 1.5 },
  note: { margin: "0.25rem 0", color: "#991b1b" },
};
