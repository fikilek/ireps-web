// The three summaries on the Operations Dashboard. `UI-R009`.
//
// ONE WELL. Each lane's figures are worked out here and nowhere else, so the
// number on the summary and the number inside that lane's own dashboard can
// be compared rather than quietly diverging.
//
// EVERY FIGURE IS EXHAUSTIVE, which is the lesson of 11 October 2026. A
// Disconnections card on the owner's phone read 7 above boxes adding to 5,
// because the total counted seven states and the boxes drew four: two
// rejected jobs were counted and shown nowhere. So a lane here names every
// state it can meet, `unaccounted` catches anything it cannot, and a test
// fails when that is not zero. A figure nobody can place is a figure that
// has to be seen, not dropped.
//
// EACH LANE SPEAKS ITS OWN LANGUAGE (`UI-R009` 6). ITO says `Rejected`
// because that is the request's own state (`DR-R001` 5). No fourth word is
// invented to cover all three lanes.
//
// THE UI DOES THE ARITHMETIC, deliberately (`UI-R009` 5, owner: "we will
// follow that because the numbers are not that big now"). Ward scope is what
// keeps that cheap. The first view that reaches past one ward is the view
// whose numbers must be prepared on the server instead.

/** Not held, not counted, not zero. */
export const NAV = "NAv";

/** The office's individual lane covers these five, and only these. */
export const ITO_TRN_TYPES = Object.freeze([
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_INSPECTION",
  "METER_REMOVAL",
  "METER_READING",
]);

/**
 * Work that is still out there. Nobody has finished it and nobody has
 * handed it back, so it is the office's open question.
 */
export const ITO_OUT_STATES = Object.freeze([
  "ISSUED",
  "REASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
]);

const upper = (value) => String(value ?? "").trim().toUpperCase();

// Two normalisers feed this screen - the registry rows flatten the fields,
// the ward stream keeps the document's own shape - so read both rather than
// silently counting nothing when handed the other one.
export function readWorkflowState(row) {
  return upper(row?.workflowState ?? row?.workflow?.state);
}

export function readOriginChannel(row) {
  return upper(row?.originChannel ?? row?.origin?.channel);
}

export function readTrnType(row) {
  return upper(row?.trnType ?? row?.accessData?.trnType);
}

/** Only the office channel is watchable. `DR-R001` 9. */
function isOfficeIssued(row) {
  return readOriginChannel(row) === "OFFICE";
}

function isItoWork(row) {
  return ITO_TRN_TYPES.includes(readTrnType(row)) && isOfficeIssued(row);
}

/**
 * The ITO summary for one ward.
 *
 * Field work never appears: it is on the worker's device until it is
 * submitted and it arrives finished, so there is no state to watch
 * (`DR-R001` 9). It is read in the TRN Registry instead.
 */
export function summariseIto(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(isItoWork);

  const figures = { out: 0, rejected: 0, completed: 0, cancelled: 0 };
  const unaccounted = [];

  for (const row of list) {
    const state = readWorkflowState(row);

    if (ITO_OUT_STATES.includes(state)) figures.out += 1;
    else if (state === "REJECTED") figures.rejected += 1;
    else if (state === "COMPLETED") figures.completed += 1;
    else if (state === "CANCELLED") figures.cancelled += 1;
    else unaccounted.push(state || "(no state)");
  }

  return { ...figures, total: list.length, unaccounted };
}

/**
 * A batch lane — TB or BGO — summarised from the batches themselves rather
 * than from the work inside them.
 *
 * Counting the batch and not its rows is what keeps this cheap enough to
 * compute on the page. The rows are what the lane's own dashboard is for,
 * which is where the Open button goes.
 */
export function summariseBatches(batches, { statusOf, wardOf, wardPcode } = {}) {
  const readStatus = typeof statusOf === "function" ? statusOf : () => "";
  const readWard = typeof wardOf === "function" ? wardOf : () => "";
  const wanted = upper(wardPcode);

  const list = (Array.isArray(batches) ? batches : []).filter((batch) =>
    wanted ? upper(readWard(batch)) === wanted : true,
  );

  const figures = { out: 0, notStarted: 0, completed: 0 };
  const unaccounted = [];

  for (const batch of list) {
    const status = upper(readStatus(batch));

    if (status === "IN_PROGRESS" || status === "ALLOCATING") figures.out += 1;
    else if (status === "NOT_STARTED") figures.notStarted += 1;
    else if (status === "COMPLETED") figures.completed += 1;
    else unaccounted.push(status || "(no status)");
  }

  return { ...figures, total: list.length, unaccounted };
}

/**
 * What a card draws: a label and a value, in that lane's own words.
 *
 * A lane with nothing loaded yet shows `NAv` on every figure rather than a
 * row of zeros — nothing out and nothing counted are different facts, and a
 * `0` claims the first when it means the second (owner, 30 September 2026).
 */
export function itoFigures(summary, { ready = true } = {}) {
  const value = (n) => (ready ? n : NAV);

  return [
    { key: "out", label: "Out", value: value(summary?.out ?? 0) },
    { key: "rejected", label: "Rejected", value: value(summary?.rejected ?? 0), attention: true },
    { key: "completed", label: "Completed", value: value(summary?.completed ?? 0) },
    { key: "cancelled", label: "Cancelled", value: value(summary?.cancelled ?? 0) },
  ];
}

export function batchFigures(summary, { ready = true } = {}) {
  const value = (n) => (ready ? n : NAV);

  return [
    { key: "out", label: "In progress", value: value(summary?.out ?? 0) },
    { key: "notStarted", label: "Not started", value: value(summary?.notStarted ?? 0) },
    { key: "completed", label: "Completed", value: value(summary?.completed ?? 0) },
  ];
}
