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
import { ITO_TRANSACTIONS, readItoCount } from "./itoTransactions";

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
            <span style={known ? styles.count : styles.countUnknown}>
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

const countBase = {
  position: "absolute",
  top: "-7px",
  right: "-7px",
  minWidth: "19px",
  height: "19px",
  padding: "0 5px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#ffffff",
  border: "2px solid #ffffff",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: "bold",
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
  count: {
    ...countBase,
    background: "#0f172a",
  },
  // Amber, and the word rather than a number, so a gap cannot be mistaken for
  // a meter nothing has ever happened to.
  countUnknown: {
    ...countBase,
    background: "#b45309",
  },
};
