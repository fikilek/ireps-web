/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
export default function LoadingIndicator({ children = "Loading…", style }) {
  return <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "12px 4px", color: "#475569", ...style }}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <g><path d="M12 3a9 9 0 0 1 9 9" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" /></g>
    </svg>{children}
  </span>;
}
