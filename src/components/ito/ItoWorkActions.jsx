// The controls on a row of the ITO dashboard. `DR-R001` 5.5, 9.2.
//
// One button per move the row can take, with the row's own busy state so the
// office sees WHICH row it is waiting on - the same shape as the launch
// buttons on the Meter Registry, which learnt it the hard way: a control that
// greys in silence is the one thing the owner's submit standard forbids.
//
// It renders nothing at all for anyone who may not do these things. The route
// into this screen admits a supervising user and an administrator as readers,
// and `DR-R001` 5.5 restricts the moves themselves to a supervisor and a
// manager - so a reader sees the screen and no buttons, rather than buttons
// that refuse.

import { ITO_MANAGE_ACTIONS, canManageItoWork } from "./manageItoRequest";

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      style={styles.spinner}
    >
      <path d="M8 1.6a6.4 6.4 0 1 0 6.4 6.4" />
    </svg>
  );
}

export default function ItoWorkActions({
  row,
  actions = [],
  busyId = null,
  role = "",
  onAct,
}) {
  if (!canManageItoWork(role)) return null;

  const busy = busyId === row?.id;

  return (
    <div style={styles.row}>
      {actions.map((key) => {
        const move = ITO_MANAGE_ACTIONS[key];

        if (!move) return null;

        const working = busy;

        return (
          <button
            key={key}
            type="button"
            disabled={Boolean(busyId)}
            style={
              working
                ? { ...styles.button, ...styles.working }
                : busyId
                  ? styles.disabled
                  : key === "DELETE"
                    ? { ...styles.button, ...styles.danger }
                    : styles.button
            }
            title={
              working
                ? `${move.verb}…`
                : `${move.verb} — ${row?.meterNo || "this meter"}`
            }
            aria-label={`${move.verb} the ${row?.letter || "job"} on meter ${row?.meterNo || "NAv"}`}
            onClick={(event) => {
              event.stopPropagation();
              onAct?.(key, row);
            }}
          >
            {working ? <Spinner /> : move.verb}
          </button>
        );
      })}
    </div>
  );
}

const spinKeyframes = "ito-actions-spin";

if (typeof document !== "undefined" && !document.getElementById(spinKeyframes)) {
  const sheet = document.createElement("style");

  sheet.id = spinKeyframes;
  sheet.textContent =
    "@keyframes ito-actions-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}";
  document.head.append(sheet);
}

const base = {
  padding: "5px 11px",
  borderRadius: 8,
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const styles = {
  row: { display: "flex", gap: 8, justifyContent: "flex-end" },
  spinner: { animation: "ito-actions-spin 0.7s linear infinite" },
  button: {
    ...base,
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    cursor: "pointer",
  },
  // Deleting is the one that takes something away, so it differs in COLOUR
  // and the word says it too - nobody has to rely on the colour.
  danger: { borderColor: "#fca5a5", color: "#991b1b" },
  working: { borderColor: "#1d4ed8", color: "#1d4ed8", cursor: "progress" },
  disabled: {
    ...base,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    color: "#94a3b8",
    cursor: "not-allowed",
  },
};
