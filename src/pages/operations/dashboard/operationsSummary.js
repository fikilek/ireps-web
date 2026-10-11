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
 * A job nobody has answered yet. A reassign returns the request to `ISSUED`
 * under the new worker's name (`DR-R001` 5), so `REASSIGNED` is the same
 * question: it is out and waiting to be accepted.
 */
export const ITO_ISSUED_STATES = Object.freeze(["ISSUED", "REASSIGNED"]);

/**
 * A job a worker has taken.
 *
 * There is NOTHING between accepted and submitted on this path. The owner,
 * 9 October 2026 and again on 11 October: you allocate, he accepts, and the
 * next thing is a submission or a no access - and a no access IS the end of
 * it, there is nothing further he will do. Unlike a targeted batch, where a
 * premise and a no access give the office something to watch, an individual
 * transaction has no in-between for anyone to report.
 *
 * So `IN_PROGRESS` is not listed here, and is not quietly folded in either.
 * If one ever reaches this screen it is a fault, and it surfaces as one.
 */
export const ITO_ACCEPTED_STATES = Object.freeze(["ACCEPTED"]);

/** A job with nobody on it, waiting to be given out. `DR-R001` 5. */
export const ITO_CREATED_STATES = Object.freeze(["CREATED"]);

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
  if (!ITO_TRN_TYPES.includes(readTrnType(row))) return false;
  if (!isOfficeIssued(row)) return false;

  // Every reader excludes DELETED (`DR-R001` 5.5). A soft delete is only
  // safe if each reader knows to skip it; otherwise deleted work quietly
  // reappears in the numbers.
  return readWorkflowState(row) !== "DELETED";
}

export function summariseIto(rows) {
  const considered = Array.isArray(rows) ? rows.length : 0;
  const list = (Array.isArray(rows) ? rows : []).filter(isItoWork);

  const figures = { created: 0, issued: 0, accepted: 0, completed: 0 };
  const unaccounted = [];

  // A refusal is no longer a state (`DR-R001` 5.1). The job it happened to
  // is back in CREATED with nobody on it, so refusals are counted as THINGS
  // THAT HAPPENED and sit outside the total, rather than pretending to be a
  // place where work is.
  let refusals = 0;

  for (const row of list) {
    refusals += countRefusals(row);

    const state = readWorkflowState(row);

    if (ITO_CREATED_STATES.includes(state)) figures.created += 1;
    else if (ITO_ISSUED_STATES.includes(state)) figures.issued += 1;
    else if (ITO_ACCEPTED_STATES.includes(state)) figures.accepted += 1;
    else if (state === "COMPLETED") figures.completed += 1;
    else unaccounted.push(state || "(no state)");
  }

  return { ...figures, refusals, total: list.length, considered, unaccounted };
}

/**
 * How many times this job has been handed back. `DR-R001` 5.7.
 *
 * The list is the fast read of the history and is written in the same
 * transaction as the refusal. A record rejected before 11 October 2026 has
 * no list — it carries one reason on the document — so one known refusal
 * counts as one, and an unknown number is never guessed at.
 */
export function countRefusals(row) {
  const written = row?.workflow?.rejections ?? row?.rejections;

  if (Array.isArray(written)) return written.length;

  const reason = String(row?.rejectReason ?? row?.assignment?.rejectReason ?? "").trim();

  if (readWorkflowState(row) === "REJECTED") return 1;

  return reason && reason.toUpperCase() !== "NAV" ? 1 : 0;
}

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

  // Four states a job can be sitting in, and they add up to the Total above
  // them. `Created` took the place `Rejected` held until 11 October 2026: a
  // refusal is not a place work sits, and the job it happened to is in
  // `Created` now, waiting to be given out again.
  return [
    { key: "created", label: "Created", value: value(summary?.created ?? 0), attention: true },
    { key: "issued", label: "Issued", value: value(summary?.issued ?? 0) },
    { key: "accepted", label: "Accepted", value: value(summary?.accepted ?? 0) },
    { key: "completed", label: "Completed", value: value(summary?.completed ?? 0) },
  ];
}

/**
 * Counted, given no tile, and said in words rather than dropped. A refusal
 * happened; it is not somewhere work is.
 */
export function itoAside(summary) {
  const notes = [];

  const refusals = Number(summary?.refusals || 0);

  if (refusals > 0) notes.push(`${refusals} ${refusals === 1 ? "refusal" : "refusals"}`);

  // Rows arrived and none counted. That is not "nothing out", it is
  // "nothing counted", and the two must never look the same.
  if (Number(summary?.considered || 0) > 0 && Number(summary?.total || 0) === 0) {
    notes.push(`${summary.considered} read, none of it office work`);
  }

  return notes;
}

export function batchFigures(summary, { ready = true } = {}) {
  const value = (n) => (ready ? n : NAV);

  return [
    { key: "out", label: "In progress", value: value(summary?.out ?? 0) },
    { key: "notStarted", label: "Not started", value: value(summary?.notStarted ?? 0) },
    { key: "completed", label: "Completed", value: value(summary?.completed ?? 0) },
  ];
}

/**
 * The Total shown on a lane card, which is **the sum of the tiles drawn on
 * that card** — not a number worked out beside them.
 *
 * Owner, 11 October 2026, on the Operations Dashboard: the ITO card reads 9,
 * and 4 + 1 + 2 + 2 is 9. Summing the figures themselves is what makes that
 * true by construction: a figure added, removed or renamed moves the total
 * with it, and a card cannot come to disagree with its own numbers.
 *
 * `NAv` when any figure is `NAv`, because a total of what is not counted is
 * not a number — and a 0 there would read as "nothing in this lane".
 */
export function sumFigures(figures) {
  const list = Array.isArray(figures) ? figures : [];

  if (!list.length) return NAV;

  let total = 0;

  for (const figure of list) {
    const value = Number(figure?.value);

    if (!Number.isFinite(value)) return NAV;

    total += value;
  }

  return total;
}
