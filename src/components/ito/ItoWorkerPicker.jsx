/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// Who does it. `DR-R001` 3, step 5 of the A-to-Z.
//
// THE WORKERS ARE OFFERED TWICE, and that is the owner's design, not a
// duplication: those within 100 m are drawn on the map so the office can see
// who is close, and **every** field worker of the main contractor and its
// subcontractors is listed beside it however far away, because the nearest man
// is not always the right one. iREPS suggests the nearest and says on the
// screen that it is a suggestion.
//
// A worker is chosen by clicking him or by dragging him onto the allocation
// box. Both are real here: the row is a button for the keyboard and the mouse,
// and draggable for the hand.

const NAV = "NAv";

function Grip() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true" style={styles.grip}>
      <circle cx="6" cy="3" r="1.4" /><circle cx="10" cy="3" r="1.4" />
      <circle cx="6" cy="8" r="1.4" /><circle cx="10" cy="8" r="1.4" />
      <circle cx="6" cy="13" r="1.4" /><circle cx="10" cy="13" r="1.4" />
    </svg>
  );
}

/** What is known about one worker, in one line under his name. */
function WorkerFacts({ worker }) {
  return (
    <span style={styles.meta}>
      {worker.subcontractor ? "Subcontractor · " : ""}
      {worker.movement} · {worker.jobsOpen === null ? NAV : worker.jobsOpen} jobs open ·{" "}
      <span style={worker.heardIsStale ? styles.heardOld : styles.heardOk}>{worker.heard}</span>
    </span>
  );
}

function WorkerRow({ worker, selected, onPick }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", worker.uid);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(worker)}
      aria-pressed={selected}
      style={{ ...styles.row, ...(selected ? styles.rowPicked : null) }}
    >
      <Grip />
      <span style={styles.rowBody}>
        <strong style={styles.rowName}>{worker.name}</strong>
        <WorkerFacts worker={worker} />
      </span>
      <span style={{ ...styles.dist, ...(worker.metres === null ? styles.distUnknown : null) }}>
        {worker.distance}
      </span>
    </button>
  );
}

export default function ItoWorkerPicker({
  choices,
  selectedUid,
  onPick,
  loading = false,
}) {
  const { suggested, onTheMap, all, radiusM } = choices;

  if (loading) {
    return <p style={styles.note}>Finding the field workers…</p>;
  }

  if (all.length === 0) {
    return (
      <p style={styles.note}>
        No field worker is available in this municipality. Work goes to one field
        worker, so there is nobody to send this to until one is here.
      </p>
    );
  }

  return (
    <>
      <p style={styles.lead}>Click a worker, or drag one onto the box below.</p>

      {suggested ? (
        <div style={styles.suggestion}>
          <span style={{ ...styles.label, color: "#1e3a8a" }}>iREPS suggests — nearest</span>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", suggested.uid);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onPick(suggested)}
            aria-pressed={selectedUid === suggested.uid}
            style={{
              ...styles.suggestionButton,
              ...(selectedUid === suggested.uid ? styles.rowPicked : null),
            }}
          >
            <span style={styles.suggestionTop}>
              <strong style={styles.suggestionName}>{suggested.name}</strong>
              <span style={styles.dist}>{suggested.distance}</span>
            </span>
            <WorkerFacts worker={suggested} />
          </button>
          <p style={styles.suggestionNote}>
            A suggestion, not the choice. Anyone below can be picked instead.
          </p>
        </div>
      ) : (
        <p style={styles.note}>
          iREPS cannot suggest anyone: no field worker has a position against
          this meter. Everyone is still listed below and any of them can be sent.
        </p>
      )}

      <span style={styles.label}>On the map — within {radiusM} m</span>
      {onTheMap.length === 0 ? (
        <p style={styles.note}>Nobody is within {radiusM} m of this meter.</p>
      ) : (
        <div style={styles.list}>
          {onTheMap.map((worker) => (
            <WorkerRow
              key={worker.uid}
              worker={worker}
              selected={selectedUid === worker.uid}
              onPick={onPick}
            />
          ))}
        </div>
      )}

      <span style={{ ...styles.label, marginTop: 2 }}>
        All field workers — main contractor and its subcontractors
      </span>
      <div style={{ ...styles.list, ...styles.scroller }}>
        {all.map((worker) => (
          <WorkerRow
            key={worker.uid}
            worker={worker}
            selected={selectedUid === worker.uid}
            onPick={onPick}
          />
        ))}
      </div>

      <p style={styles.footnote}>
        Distances and movement are the last thing the server was told, not where
        the worker is now. A worker who has gone quiet still shows.
      </p>
    </>
  );
}

const styles = {
  lead: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "#475569" },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
  },
  suggestion: {
    background: "#eff6ff",
    border: "2px solid #1d4ed8",
    borderRadius: 14,
    padding: "12px 14px",
  },
  suggestionButton: {
    display: "block",
    width: "100%",
    marginTop: 6,
    padding: 0,
    border: "none",
    background: "none",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  },
  suggestionTop: { display: "flex", alignItems: "baseline", gap: 8 },
  suggestionName: { fontSize: 15, flexGrow: 1, minWidth: 0 },
  suggestionNote: {
    margin: "8px 0 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "#1e3a8a",
  },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  scroller: { maxHeight: 232, overflowY: "auto", paddingRight: 4 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    cursor: "grab",
    textAlign: "left",
    font: "inherit",
  },
  rowPicked: { borderColor: "#1d4ed8", boxShadow: "0 0 0 1px #1d4ed8 inset" },
  rowBody: { flexGrow: 1, minWidth: 0 },
  rowName: { display: "block", fontSize: 14 },
  grip: { flex: "0 0 auto", color: "#cbd5e1" },
  meta: { display: "block", fontSize: 11, lineHeight: 1.45, color: "#475569" },
  heardOk: { color: "#14532d" },
  heardOld: { color: "#78350f" },
  dist: { fontSize: 13, fontWeight: "bold", whiteSpace: "nowrap" },
  distUnknown: { color: "#78350f" },
  note: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "#475569" },
  footnote: {
    margin: "2px 0 0",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#475569",
    borderTop: "1px solid #e2e8f0",
    paddingTop: 10,
  },
};
