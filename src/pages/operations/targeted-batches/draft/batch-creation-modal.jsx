/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useId, useRef } from "react";
import BusySpinner from "../../../../components/busy-spinner.jsx";

// Targeted Batch rules TB-R040 (1.3.36) and TB-R047 (1.3.37): one window for confirming, checking, working and the result.
// While it works it has no buttons, keeps keyboard focus inside and ignores Escape, so nothing
// behind it can be reached; a result window's Escape runs its escape action (OK, Close or Stay).
export default function BatchCreationModal({ title, steps = null, lines = [], tone = "info", working = false, actions = [], escapeAction = null, children = null }) {
  const card = useRef(null), firstAction = useRef(null), linesId = useId();
  useEffect(() => { (firstAction.current || card.current)?.focus(); }, [actions.length, title]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  const handleKeys = event => {
    if (event.key === "Escape") { event.preventDefault(); if (!working && escapeAction) escapeAction(); return; }
    if (event.key !== "Tab") return;
    const nodes = [...card.current.querySelectorAll("button:not([disabled])")];
    if (!nodes.length) { event.preventDefault(); card.current.focus(); return; }
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const lineStyle = tone === "error" ? styles.error : tone === "warning" ? styles.warning : styles.text;
  return <div style={styles.backdrop}>
    <div ref={card} tabIndex={-1} role={tone === "error" ? "alertdialog" : "dialog"} aria-modal="true" aria-label={title} aria-describedby={linesId}
      onKeyDown={handleKeys} style={styles.card}>
      <h2 style={styles.title}>{title}</h2>
      {steps ? <ol style={styles.steps}>
        {steps.map(step => <li key={step.key} style={{ ...styles.step, color: step.done || step.active ? "#0f172a" : "#94a3b8" }}>
          <span style={styles.marker} aria-hidden="true">{step.done ? <span style={styles.tick}>✓</span> : step.active ? <BusySpinner size={16} asStatus={false}/> : <span style={styles.dot}>•</span>}</span>
          {step.label}
          <span style={styles.visuallyHidden}>{step.done ? " (done)" : step.active ? " (in progress)" : " (not started)"}</span>
        </li>)}
      </ol> : null}
      <div id={linesId} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} style={styles.lines}>
        {working && !steps ? <BusySpinner label={lines[0] || "Working…"} size={18} asStatus={false}/> : null}
        {(working && !steps ? lines.slice(1) : lines).map((line, index) => <p key={index} style={lineStyle}>{line}</p>)}
      </div>
      {children}
      {actions.length ? <div style={styles.actions}>
        {actions.map((action, index) => <button key={action.label} ref={index === 0 ? firstAction : null} type="button"
          style={action.primary ? styles.primary : styles.secondary} onClick={action.onClick}>{action.label}</button>)}
      </div> : null}
    </div>
  </div>;
}

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15, 23, 42, 0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "min(94vw, 520px)", borderRadius: 16, background: "#ffffff", boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)", padding: "20px 22px", display: "grid", gap: 12, outline: "none" },
  title: { margin: 0, fontSize: 20, color: "#0f172a" },
  lines: { display: "grid", gap: 10 },
  text: { margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" },
  warning: { margin: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", fontSize: 13, fontWeight: 700 },
  error: { margin: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 700 },
  steps: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 },
  step: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700 },
  marker: { width: 20, display: "inline-flex", justifyContent: "center" },
  tick: { color: "#16a34a", fontWeight: 900 },
  dot: { color: "#cbd5e1", fontSize: 18 },
  visuallyHidden: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  primary: { border: "1px solid #0f172a", background: "#0f172a", color: "#ffffff", borderRadius: 10, padding: "8px 18px", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #cbd5e1", background: "#ffffff", color: "#334155", borderRadius: 10, padding: "8px 18px", fontWeight: 800, cursor: "pointer" },
};
