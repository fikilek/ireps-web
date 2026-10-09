// THE ITO LAUNCH BUTTON — one button per transaction, on the meter's own row.
//
// `DR-R001` 3.2, owner 9 October 2026. It replaces the Credit control group of
// two buttons: the same work, plus inspection, removal and reading, and the
// meter's own count carried on each button so the office reads the history
// before it reaches for the action.
//
// Pressing one opens the ITO page with that transaction already chosen. The
// transaction is decided HERE, on the row, and cannot be changed on that page.
//
// Which transaction is offered when, and how a count is read, live beside this
// in `itoTransactions.jsx`.
import { ITO_TRANSACTIONS, itoCountState, readItoCount } from "./itoTransactions";

// One glyph per transaction, keyed by the work it stands for. DCN is a broken
// line and RCN a joined one: opposites in SHAPE, so they are told apart without
// relying on colour.
const ICONS = {
  disconnect: (
    <>
      <path d="M1 8h4" />
      <path d="M11 8h4" />
    </>
  ),
  reconnect: <path d="M1 8h14" />,
  inspect: (
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.3 10.3 14 14" />
    </>
  ),
  remove: (
    <>
      <path d="M2 3v10h7" />
      <path d="M9 8h5" />
      <path d="M11.5 5.5 14 8l-2.5 2.5" />
    </>
  ),
  read: (
    <>
      <path d="M2.4 12a6.2 6.2 0 1 1 11.2 0" />
      <path d="M8 12 11 7.6" />
    </>
  ),
};

export default function ItoLaunchButtons({ row, busy = false, onLaunch }) {
  const state = String(row?.statusState || row?.status || "NAv").toUpperCase();

  return (
    <div style={styles.row}>
      {ITO_TRANSACTIONS.map((transaction) => {
        const allowed = transaction.available(state);
        const disabled = !allowed || busy;
        const count = readItoCount(row, transaction.countKey);
        const known = count !== null;
        const countStyle = styles[itoCountState(count)];

        return (
          <button
            key={transaction.work}
            type="button"
            style={disabled ? styles.buttonDisabled : styles.button}
            disabled={disabled}
            title={
              allowed
                ? `${transaction.name} — ${
                    known
                      ? `${count} on this meter already`
                      : "iREPS does not hold a count for this meter yet"
                  }`
                : transaction.refusal(state)
            }
            aria-label={`${transaction.name}${
              known ? `, ${count} on this meter already` : ", count not held"
            }`}
            onClick={() => onLaunch(row, transaction.work)}
          >
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {ICONS[transaction.work]}
            </svg>
            {transaction.code}
            <span style={countStyle}>
              {known ? count : "NAv"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const buttonBase = {
  position: "relative",
  width: "64px",
  height: "48px",
  padding: 0,
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "2px",
  borderRadius: "10px",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "11px",
  fontWeight: "bold",
  letterSpacing: "0.02em",
};

// The badge sits on the corner of the button. The white ring it used to carry
// was there to lift a black disc off the button; these three read as chips,
// which is what the No Access count beside them already is.
const countBase = {
  position: "absolute",
  top: "-8px",
  right: "-8px",
  minWidth: "20px",
  height: "20px",
  padding: "0 5px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 850,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
};

const styles = {
  row: {
    display: "flex",
    gap: "10px",
  },
  button: {
    ...buttonBase,
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    cursor: "pointer",
  },
  buttonDisabled: {
    ...buttonBase,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    color: "#94a3b8",
    cursor: "not-allowed",
  },
  // Something has happened here. The No Access chip's own colours, so one
  // glance down the column finds every meter that has a history.
  some: {
    ...countBase,
    background: "#fff7ed",
    border: "1px solid #fcd9b6",
    color: "#9a3412",
  },
  // Nothing has ever happened. It steps back, and that is the half that makes
  // the other work: left heavy, zero would compete with the colour on every
  // row and a meter with a history would still have to be read, not seen.
  none: {
    ...countBase,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    color: "#94a3b8",
  },
  // iREPS holds no count for this meter. Dashed, so it differs in SHAPE and
  // not only in colour — pale orange and pale amber are close enough to
  // confuse at a glance, and a gap must never read as a quiet meter.
  unknown: {
    ...countBase,
    background: "#fffbeb",
    border: "1px dashed #b45309",
    color: "#78350f",
  },
};
