// Targeted Batch rules 18.7 (1.3.4): whenever TB Draft is busy it shows a spinner
// with a short message, so work in progress never looks like a stuck page.
// Use asStatus={false} inside a button (the button itself carries the state).
export default function BusySpinner({ label = "", size = 16, inverse = false, asStatus = true }) {
  return (
    <span
      {...(asStatus ? { role: "status", "aria-live": "polite" } : {})}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <span
        className={`ireps-spinner${inverse ? " ireps-spinner--inverse" : ""}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
