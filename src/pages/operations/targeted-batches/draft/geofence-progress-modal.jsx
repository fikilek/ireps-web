/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import BusySpinner from "../../../../components/busy-spinner.jsx";
import { geofenceFinalCounts } from "./geofence-progress.js";

// Targeted Batch rules TB-R040 (1.3.22): progress while the geofence is saved and linked, then
// Geofence created with the next step. It never creates the batch; OK only closes it.
// The GPS Sales map (TB-R055) passes its own `linkedTo`, `stillLinkingText` and `next`.
export default function GeofenceProgressModal({ name, wardLabel, progress, fence, onClose, linkedTo = "this draft",
  stillLinkingText = "Its ERFs and meters are still being linked. If Create Batch isn't available yet, wait a moment.",
  next = <><strong>Next:</strong> press <strong>Create Batch</strong> (next to Satellite) to create the batch now, or create it later from <strong>Batches &amp; Geofences</strong>.</> }) {
  const counts = geofenceFinalCounts(fence);
  return <div style={styles.backdrop}>
    <div role="dialog" aria-modal="true" aria-label={progress.done ? "Geofence created" : `Creating ${name}`} style={styles.card}>
      {progress.done ? <>
        <h2 style={styles.title}>Geofence created</h2>
        <p style={styles.text}><strong>{name}</strong> is saved in {wardLabel} and linked to {linkedTo}.</p>
        <p style={styles.counts}>ERFs {counts.erfs} · Sales meters {counts.salesMeters} · Premises {counts.premises} · Assets {counts.assets}</p>
        {progress.stillLinking ? <p role="status" style={styles.warning}>{stillLinkingText}</p> : null}
        <p style={styles.next}>{next}</p>
        <div style={styles.actions}><button type="button" style={styles.okButton} onClick={onClose}>OK</button></div>
      </> : <>
        <h2 style={styles.title}>Creating {name}</h2>
        <ol style={styles.steps}>
          {progress.steps.map(step => <li key={step.key} style={{ ...styles.step, color: step.done || step.active ? "#0f172a" : "#94a3b8" }}>
            <span style={styles.marker}>{step.done ? <span aria-label="done" style={styles.tick}>✓</span> : step.active ? <BusySpinner size={16} asStatus={false}/> : <span style={styles.dot}>•</span>}</span>
            {step.label}
          </li>)}
        </ol>
        <p role="status" style={styles.text}>Please wait. This usually takes less than a minute.</p>
      </>}
    </div>
  </div>;
}

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15, 23, 42, 0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "min(94vw, 520px)", borderRadius: 16, background: "#ffffff", boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)", padding: "20px 22px", display: "grid", gap: 12 },
  title: { margin: 0, fontSize: 20, color: "#0f172a" },
  text: { margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.5 },
  counts: { margin: 0, padding: "8px 10px", borderRadius: 10, background: "#f1f5f9", color: "#0f172a", fontSize: 13, fontWeight: 700 },
  warning: { margin: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", fontSize: 13, fontWeight: 700 },
  next: { margin: 0, color: "#0f172a", fontSize: 14, lineHeight: 1.5 },
  steps: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 },
  step: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700 },
  marker: { width: 20, display: "inline-flex", justifyContent: "center" },
  tick: { color: "#16a34a", fontWeight: 900 },
  dot: { color: "#cbd5e1", fontSize: 18 },
  actions: { display: "flex", justifyContent: "flex-end" },
  okButton: { border: "1px solid #0f172a", background: "#0f172a", color: "#ffffff", borderRadius: 10, padding: "8px 18px", fontWeight: 900, cursor: "pointer" },
};
