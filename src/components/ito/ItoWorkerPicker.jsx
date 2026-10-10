/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// Who the work goes to. `DR-R001` 3, step 5 of the A-to-Z.
//
// FOUR GROUPS, EACH IN ITS OWN BOX with its name on a grey strip across the
// top (owner, 10 October 2026). Where one group ends and the next begins is
// never in doubt, and **an empty group still shows its box and says why it is
// empty** — "nobody is within 100 m" is a fact worth seeing, and a group that
// vanishes tells the office nothing.
//
// BLUE MEANS CHOSEN, AND NOTHING ELSE IS BLUE (owner, 10 October 2026). Three
// things wore the same blue — the man allocated, the man iREPS suggests, and
// the selected row — so none of them read as *this is the one*. Now:
//   the answer     solid blue, the only filled block on the column
//   the suggestion grey, because it is advice and the card says so in words
//   the chosen row a thin blue bar, a tick and the word Allocated — it echoes
//                  the answer rather than repeating it
// Amber is untouched and means something else entirely: a position iREPS has
// not heard from in a while.
//
// THE ANSWER SITS ABOVE THE CHOICES. The allocation box used to be at the foot
// of the page — "too far from action". It is the first group now, so it fills
// in under the office's hand.
//
// The workers are still offered twice, which is the owner's design and not a
// duplication: those within 100 m, and every field worker of the main
// contractor and its subcontractors however far away.

const NAV = "NAv";

function Group({ title, blue = false, children }) {
  return (
    <section style={{ ...styles.group, ...(blue ? styles.groupBlue : null) }}>
      <h3 style={styles.groupTitle}>{title}</h3>
      <div style={styles.groupBody}>{children}</div>
    </section>
  );
}

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
function WorkerFacts({ worker, allocated = false }) {
  return (
    <span style={styles.meta}>
      {allocated ? "Allocated · " : ""}
      {worker.subcontractor ? "Subcontractor · " : ""}
      {worker.movement} · {worker.jobsOpen === null ? NAV : worker.jobsOpen} jobs open ·{" "}
      <span style={worker.heardIsStale ? styles.heardOld : styles.heardOk}>{worker.heard}</span>
    </span>
  );
}

const dragging = (worker) => (event) => {
  event.dataTransfer.setData("text/plain", worker.uid);
  event.dataTransfer.effectAllowed = "copy";
};

function WorkerRow({ worker, selected, onPick }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={dragging(worker)}
      onClick={() => onPick(worker)}
      aria-pressed={selected}
      style={{ ...styles.row, ...(selected ? styles.rowChosen : null) }}
    >
      {selected ? (
        <span aria-hidden="true" style={styles.tick}>
          ✓
        </span>
      ) : (
        <Grip />
      )}
      <span style={styles.rowBody}>
        <strong style={styles.rowName}>{worker.name}</strong>
        <WorkerFacts worker={worker} allocated={selected} />
      </span>
      <span style={{ ...styles.dist, ...(worker.metres === null ? styles.distUnknown : null) }}>
        {worker.distance}
      </span>
    </button>
  );
}

export default function ItoWorkerPicker({
  choices,
  picked,
  onPick,
  onClear,
  loading = false,
}) {
  const { suggested, onTheMap, all, radiusM } = choices;
  const selectedUid = picked?.uid || null;

  function takeDrop(event) {
    event.preventDefault();

    const uid = event.dataTransfer.getData("text/plain");
    const dropped = all.find((worker) => worker.uid === uid);

    if (dropped) onPick(dropped);
  }

  if (loading) {
    return <p style={styles.note}>Finding the field workers…</p>;
  }

  if (all.length === 0) {
    return (
      <Group title="Allocated to" blue>
        <p style={styles.note}>
          No field worker is available in this municipality. Work goes to one
          field worker, so there is nobody to send this to until one is here.
        </p>
      </Group>
    );
  }

  return (
    <>
      <Group title="Allocated to" blue>
        <div
          style={picked ? styles.chosen : styles.empty}
          onDragOver={(event) => event.preventDefault()}
          onDrop={takeDrop}
        >
          {picked ? (
            <>
              <span style={styles.chosenWho}>
                <strong style={styles.chosenName}>{picked.name}</strong>
                <span style={styles.chosenFacts}>
                  {picked.distance} · {picked.movement} · {picked.heard}
                </span>
              </span>
              <button type="button" onClick={onClear} style={styles.change}>
                Change
              </button>
            </>
          ) : (
            <span style={styles.emptyText}>
              Nobody yet — click a worker below, or drop one here
            </span>
          )}
        </div>
      </Group>

      <Group title="Suggested">
        {suggested ? (
          <>
            <div style={styles.suggested}>
              <span style={styles.suggestedTop}>
                <strong style={styles.rowName}>{suggested.name}</strong>
                <span style={styles.dist}>{suggested.distance}</span>
              </span>
              <WorkerFacts worker={suggested} />
            </div>
            <p style={styles.groupNote}>
              The nearest iREPS can see. A suggestion, not the choice.
            </p>
          </>
        ) : (
          <p style={styles.note}>
            iREPS cannot suggest anyone: no field worker has a position against
            this meter. Everyone is still listed below and any of them can be
            sent.
          </p>
        )}
      </Group>

      <Group title={`Within ${radiusM} m from meter`}>
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
      </Group>

      <Group title="All field workers">
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
        <p style={styles.groupNote}>
          Main contractor and its subcontractors. Click one, or drag him to the
          box at the top.
        </p>
      </Group>

      <p style={styles.footnote}>
        Distances and movement are the last thing the server was told, not where
        the worker is now. A worker who has gone quiet still shows.
      </p>
    </>
  );
}

const styles = {
  group: {
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    overflow: "hidden",
  },
  // The only blue edge on the column. The answer is the one group that stands
  // out, and blue only ever means chosen.
  groupBlue: { borderColor: "#1d4ed8" },
  groupTitle: {
    margin: 0,
    padding: "11px 14px",
    background: "#f1f5f9",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 15,
    fontWeight: "bold",
    color: "#0f172a",
  },
  groupBody: { padding: "12px 14px 14px" },
  groupNote: { margin: "9px 0 0", fontSize: 11, lineHeight: 1.5, color: "#64748b" },

  chosen: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: "12px 14px",
    background: "#1d4ed8",
  },
  chosenWho: { flexGrow: 1, minWidth: 0 },
  chosenName: { display: "block", fontSize: 15, color: "#ffffff" },
  chosenFacts: { display: "block", marginTop: 3, fontSize: 12, color: "#dbeafe" },
  change: {
    padding: "8px 14px",
    border: "1px solid #ffffff",
    borderRadius: 10,
    background: "transparent",
    color: "#ffffff",
    fontSize: 13,
    cursor: "pointer",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "2px dashed #cbd5e1",
    borderRadius: 12,
    padding: "12px 14px",
    background: "#f8fafc",
  },
  emptyText: { fontSize: 13, color: "#475569" },

  // Grey, because it is advice and the card says so in words.
  suggested: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderLeft: "4px solid #94a3b8",
    borderRadius: 12,
    padding: "11px 13px",
  },
  suggestedTop: { display: "flex", alignItems: "baseline", gap: 8 },

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
  // Echoes the answer, never repeats it.
  rowChosen: { borderLeft: "4px solid #1d4ed8", background: "#f8fafc" },
  tick: {
    flex: "0 0 auto",
    width: 18,
    height: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#1d4ed8",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "bold",
  },
  rowBody: { flexGrow: 1, minWidth: 0 },
  rowName: { display: "block", fontSize: 14, flexGrow: 1, minWidth: 0 },
  grip: { flex: "0 0 auto", color: "#cbd5e1" },
  meta: { display: "block", fontSize: 11, lineHeight: 1.45, color: "#475569" },
  heardOk: { color: "#14532d" },
  heardOld: { color: "#78350f" },
  dist: { fontSize: 13, fontWeight: "bold", whiteSpace: "nowrap" },
  distUnknown: { color: "#78350f" },
  note: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "#475569" },
  footnote: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.5,
    color: "#475569",
  },
};
