// A cell that opens something. One look, one component, every table.
//
// Owner, 12 October 2026, holding the Meter Registry and the ITO monitoring
// screen side by side: **"can we be consistent with css"**.
//
// He was looking at the same three things - a meter, an ERF, an address -
// drawn as blue chips with icons on one screen and as bare underlined text on
// the other. The component that makes the chip already existed; it just lived
// INSIDE `MetersRegistryPage.jsx`, so every other screen that wanted the same
// thing had to invent its own. That is how one look becomes three.
//
// So it moves here, with its icons, and both screens import it. A third
// screen that needs a clickable cell takes this one rather than writing a
// fourth.
//
// The icons are drawn in `currentColor` so the chip's own colour reaches
// them, and sized in `rem` like everything else here, so a meter number and
// an ERF number line up at any text size.

/** A meter. */
export function MeterActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="7" y="6.5" width="10" height="5" rx="1" fill="currentColor" opacity=".35" />
      <circle cx="9" cy="16" r="1.4" fill="currentColor" />
      <circle cx="15" cy="16" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** A piece of land. */
export function ErfActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M4 7.5 10 4.5l4 3 6-3v12l-6 3-4-3-6 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** An administrative area. */
export function WardActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 4.5v13M15 6.5v13" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
    </svg>
  );
}

/** A place on the ground. */
export function PremiseActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** Looking for something. */
export function SearchActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.8 15.8 20 20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** Putting a meter in. */
export function InstalledActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M12 3v7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.5 10h9v4.5a4.5 4.5 0 0 1-9 0z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 19v2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** A field worker. Not `AllocateActionIcon`, which is a man with a plus on
 * him and means *send work to somebody* - a different thing from *this is the
 * man*. One icon, one meaning. */
export function WorkerActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <circle cx="12" cy="7.8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Sending work to somebody. */
export function AllocateActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <circle cx="9.5" cy="8" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 19.2a5.7 5.7 0 0 1 11.4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.5 7.5v6M14.5 10.5h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** Putting something in the bin. It keeps the chip's shape and says what it is in colour AND in its word. */
export function BinActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.5 7V5.2h5V7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6.8 7l.9 12.1h8.6L17.2 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Bringing it back out. */
export function RestoreActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M4.4 11a7.6 7.6 0 1 1 2.2 5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 6.2V11h4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Photographs and what else was captured. */
export function MediaActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 6.5 10 4h4l1.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** A report. */
export function ReportActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.icon} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A cell you can press.
 *
 * `tone` is the one thing that changes: `"open"` is the blue chip that opens
 * a window, and `"remove"` is the red one that takes something away. The red
 * never stands alone - its word says what it does as well as its colour, so
 * nobody has to see the colour to read the table.
 */
export default function DataActionButton({
  children,
  onClick,
  title,
  icon = null,
  compact = false,
  tone = "open",
  disabled = false,
  busy = false,
  // A chip that opens a window says so, for a reader who cannot see it open.
  haspopup = null,
}) {
  const base = compact ? styles.compact : styles.button;

  const style = disabled
    ? { ...base, ...styles.disabled }
    : busy
      ? { ...base, ...styles.busy }
      : tone === "remove"
        ? { ...base, ...styles.remove }
        : base;

  return (
    <button
      type="button"
      style={style}
      title={title}
      aria-label={title}
      aria-haspopup={haspopup || undefined}
      disabled={disabled || busy}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled && !busy) onClick?.();
      }}
    >
      {icon ? (
        <span
          style={
            tone === "remove"
              ? { ...styles.iconWrap, ...styles.iconWrapRemove }
              : styles.iconWrap
          }
        >
          {busy ? <Spinner /> : icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" style={{ ...styles.icon, ...styles.spinner }} aria-hidden="true">
      <path d="M8 1.6a6.4 6.4 0 1 0 6.4 6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const spinKeyframes = "ireps-data-action-spin";

if (typeof document !== "undefined" && !document.getElementById(spinKeyframes)) {
  const sheet = document.createElement("style");

  sheet.id = spinKeyframes;
  sheet.textContent =
    "@keyframes ireps-data-action-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}";
  document.head.append(sheet);
}

const styles = {
  button: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.48rem",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "0.38rem 0.62rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  compact: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.42rem",
    border: "1px solid #bfdbfe",
    background: "#f8fbff",
    color: "#1d4ed8",
    padding: "0.38rem 0.54rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    whiteSpace: "nowrap",
  },
  remove: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
  },
  busy: { borderColor: "#1d4ed8", color: "#1d4ed8", cursor: "progress" },
  disabled: {
    border: "1px solid #e2e8f0",
    background: "#f1f5f9",
    color: "#94a3b8",
    cursor: "not-allowed",
  },
  iconWrap: {
    width: "1.55rem",
    height: "1.55rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    borderRadius: "0.45rem",
    background: "#dbeafe",
  },
  iconWrapRemove: { background: "#fee2e2" },
  icon: { display: "block", width: "1.05rem", height: "1.05rem" },
  spinner: { animation: "ireps-data-action-spin 0.7s linear infinite" },
};
