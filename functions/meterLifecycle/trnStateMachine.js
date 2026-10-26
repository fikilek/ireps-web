// The transaction's states, and every way it may move between them.
// `DR-R001` 5, owner 11 October 2026.
//
// ONE WELL. Every writer asks this module whether a move is allowed, and
// every reader asks it what a state means. A second copy of the transition
// table is how two parts of iREPS come to disagree about what a job is.
//
// A TRANSACTION IS IN EXACTLY ONE STATE at any moment, never between two.
// The owner's words: "A TRN can only be in only one of the STATES at any
// point in time. That eliminates confusion totally."
//
// FOUR OLD WORDS ARE NOT STATES: `REASSIGNED`, `IN_PROGRESS`, `REJECTED`
// and `CANCELLED`. They are things that happened, and they live in the
// transaction's history (`DR-R001` 5.1). Under the old shape a rejected job
// sat in REJECTED with the worker's name still on it, so it was his and
// nobody's at once - his row counted it while the meter treated it as free.
// One fact, two answers. The canonical lifecycle prevents that ambiguity.

/** Unified TRN Lifecycle v3, QA-R001 section 13. REMOVED is not persisted. */
export const TRN_STATES = Object.freeze({
  CREATED: "CREATED",
  DELETED: "DELETED",
  ISSUED: "ISSUED",
  ACCEPTED: "ACCEPTED",
  COMPLETED: "COMPLETED",
  QA_FAIL: "QA FAIL",
  QA_PASS: "QA PASS",
});

export const TRN_STATE_LIST = Object.freeze(Object.values(TRN_STATES));

/**
 * Every move, by the state it starts in. `DR-R001` 5.
 *
 * Read it as the owner wrote it: CREATED takes delete and allocate, DELETED
 * takes create and final delete, ISSUED takes reject, cancel and accept,
 * ACCEPTED takes cancel and execute; submitted work follows the approved QA moves.
 */
export const TRN_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze({
    allocate: TRN_STATES.ISSUED,
    delete: TRN_STATES.DELETED,
  }),
  DELETED: Object.freeze({
    // `create` is the restore. `finalDelete` removes the record and is NOT
    // built (`DR-R001` 5.5): a delete flags, it does not remove. The move is
    // declared so the machine is whole, and refused until it has a writer.
    create: TRN_STATES.CREATED,
    finalDelete: null,
  }),
  ISSUED: Object.freeze({
    accept: TRN_STATES.ACCEPTED,
    reject: TRN_STATES.CREATED,
    cancel: TRN_STATES.CREATED,
    expire: TRN_STATES.CREATED,
  }),
  ACCEPTED: Object.freeze({
    execute: TRN_STATES.COMPLETED,
    cancel: TRN_STATES.CREATED,
  }),
  COMPLETED: Object.freeze({
    amend: TRN_STATES.COMPLETED,
    qaFail: TRN_STATES.QA_FAIL,
    qaPass: TRN_STATES.QA_PASS,
  }),
  [TRN_STATES.QA_FAIL]: Object.freeze({ amend: TRN_STATES.COMPLETED }),
  [TRN_STATES.QA_PASS]: Object.freeze({}),
});

/**
 * The moves only a supervisor or a manager may make. `DR-R001` 5.5.
 *
 * The owner, 11 October 2026: "Someone accepts the work, and then he's hit
 * by a car, he's in hospital... A supervisor and the manager must be able to
 * override things. That's how it works in the real world."
 */
export const OFFICE_ONLY_ACTIONS = Object.freeze(["allocate", "cancel", "delete", "create"]);

/** Who may make an office move. */
export const OFFICE_ROLES = Object.freeze(["SPV", "MNG"]);

/**
 * The states in which a job occupies its meter. `DR-R001` 5.2.
 *
 * `CREATED` counts: it has nobody on it, but it exists and is going to be
 * allocated, and a second would leave two to allocate on one meter - the
 * thing "never two of the same kind out" forbids. `DELETED` and `COMPLETED`
 * do not count.
 */
export const STATES_HOLDING_THE_METER = Object.freeze([
  TRN_STATES.CREATED,
  TRN_STATES.ISSUED,
  TRN_STATES.ACCEPTED,
]);

/**
 * What a worker's phone shows. `DR-R001` 5.5.
 *
 * Owner, 11 October 2026: *"DELETED must not show in FWRs devices. It will
 * confuse them."* Said as what it SHOWS rather than what it hides, because a
 * list of exclusions is a list somebody forgets to add to.
 *
 * `COMPLETED` was missing here until 12 October, and that was my overreach
 * surviving in the code after the rule had been corrected: I had written
 * that a completed job "has left his hands", which the owner never said -
 * his own card has a working Completed box. The rule was amended the same
 * day (1.12.8); this list was not, so for a day the code and the rule
 * disagreed about the owner's own screen.
 */
export const STATES_THE_WORKER_SEES = Object.freeze([
  TRN_STATES.ISSUED,
  TRN_STATES.ACCEPTED,
  TRN_STATES.COMPLETED,
  TRN_STATES.QA_FAIL,
  TRN_STATES.QA_PASS,
]);

/**
 * Where an old state lands under this machine, for the migration.
 * `DR-R001` 5.6. Measured first: the census of 11 October found every
 * existing record placeable, and no `CANCELLED` anywhere.
 */
export const OLD_STATE_LANDS_IN = Object.freeze({
  ISSUED: TRN_STATES.ISSUED,
  REASSIGNED: TRN_STATES.ISSUED,
  ACCEPTED: TRN_STATES.ACCEPTED,
  IN_PROGRESS: TRN_STATES.ACCEPTED,
  REJECTED: TRN_STATES.CREATED,
  CANCELLED: TRN_STATES.CREATED,
  COMPLETED: TRN_STATES.COMPLETED,
});

const upper = (value) => String(value ?? "").trim().toUpperCase();

/**
 * The state a stored value means TODAY, placed on a canonical state.
 *
 * Records written before 11 October 2026 - and the copies of the state kept
 * on the meter and on its registry row - may still carry one of the four old
 * words. A reader that tested them against the five directly would read
 * `REASSIGNED` as "no state" and so read a meter with work out on it as
 * free. This is the one seam where the old words are understood; everything
 * else asks for a canonical state.
 *
 * Returns "" for a value that cannot be placed - which is a fault to show,
 * not a gap to fill with a plausible state.
 */
export function currentState(raw) {
  const state = upper(raw);

  if (TRN_STATE_LIST.includes(state)) return state;

  return OLD_STATE_LANDS_IN[state] || "";
}

/** Is this a canonical state? */
export function isTrnState(state) {
  return TRN_STATE_LIST.includes(upper(state));
}

/**
 * Does a job in this state hold its meter against another of its kind?
 * It reads stored state, so it places an old word first (`currentState`).
 */
export function holdsTheMeter(state) {
  return STATES_HOLDING_THE_METER.includes(currentState(state));
}

/** Is this job the worker's, and so drawn on his phone? */
export function theWorkerSees(state) {
  return STATES_THE_WORKER_SEES.includes(currentState(state));
}

/**
 * Whether a move is allowed, and where it lands.
 *
 * It answers in words rather than true/false, because the words are what
 * the office or the worker is shown, and a rule that cannot say why it
 * refused is a rule nobody can act on.
 */
export function canMove(from, action) {
  const state = upper(from);

  if (!isTrnState(state)) {
    return { ok: false, code: "UNKNOWN_STATE", message: `${from || "A transaction with no state"} is not a canonical lifecycle state.` };
  }

  const moves = TRN_TRANSITIONS[state] || {};
  const name = String(action ?? "").trim();

  if (!Object.hasOwn(moves, name)) {
    const allowed = Object.keys(moves);

    // Say what it CAN take, not merely no. A rule that cannot say what to do
    // instead is a rule nobody can act on. The moves are named as they are
    // given, never conjugated - "cancelled" and "allocateed" are how a
    // helpful message turns into a wrong one.
    return {
      ok: false,
      code: "MOVE_NOT_ALLOWED",
      message: allowed.length
        ? `A transaction that is ${state} cannot take '${name || "that"}'. From here it can only take: ${allowed.slice().sort().join(", ")}.`
        : `A transaction that is ${state} is finished. Nothing moves it.`,
    };
  }

  const to = moves[name];

  if (!to) {
    return {
      ok: false,
      code: "MOVE_NOT_BUILT",
      message: `${name} is part of the machine but is not built yet.`,
    };
  }

  return { ok: true, to };
}

/**
 * The same question, for a writer that also has to check who is asking.
 * Office moves are the supervisor's and the manager's (`DR-R001` 5.5).
 */
export function canMoveAs(from, action, role) {
  const move = canMove(from, action);

  if (!move.ok) return move;

  if (OFFICE_ONLY_ACTIONS.includes(String(action).trim()) && !OFFICE_ROLES.includes(upper(role))) {
    return {
      ok: false,
      code: "NOT_YOURS_TO_DO",
      message: `Only a supervisor or a manager may ${action} a transaction.`,
    };
  }

  return move;
}

/**
 * Whether a job left in `ISSUED` has waited longer than iREPS allows.
 * `DR-R001` 5.6: three days, measured from `workflow.issuedAt`.
 *
 * **A job with no issue time is never expired.** Most records written before
 * 10 October 2026 have none - 58 of 94 on DEV, all of TEST's, and LIVE's one
 * - and an unknown age is not a long one. Guessing it from the record's
 * creation time would turn an unknown into a plausible number, which
 * `UI-R008` refuses.
 */
export const EXPIRES_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function hasExpired(trn, nowMs) {
  // It PLACES the stored word, like every other reader here. It used to test
  // the raw value, so a record carrying `REASSIGNED` - which `currentState`
  // places in `Issued`, and which holds its meter - could never expire,
  // though those are exactly the records 5.6 exists to clear. Nothing writes
  // that word any more and the census of 11 October found none, so this is
  // the principle made consistent rather than a live fault closed.
  if (currentState(trn?.workflow?.state) !== TRN_STATES.ISSUED) return false;

  return readIssuedAt(trn).expired(nowMs);
}

/**
 * The issue time, and WHICH KIND OF NOTHING it is when there isn't one.
 *
 * Absent and unreadable are different facts. A `null` issuedAt is a job that
 * predates the stamp - the rule protects it. A value that is there and cannot
 * be parsed is a fault in the record, and a sweep that lumps the two together
 * drops the second silently and reports a clean run.
 */
export function readIssuedAt(trn) {
  const raw = trn?.workflow?.issuedAt;

  if (!raw) {
    return { kind: "absent", ms: null, expired: () => false };
  }

  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));

  if (!Number.isFinite(ms)) {
    // A Firestore Timestamp stringifies to "[object Object]" and lands here.
    return { kind: "unreadable", ms: null, expired: () => false };
  }

  return {
    kind: "read",
    ms,
    expired: (nowMs) => Number.isFinite(nowMs) && nowMs - ms > EXPIRES_AFTER_MS,
  };
}

/** Submitted fieldwork remains submitted after review; QA is not another visit. */
export const SUBMITTED_TRN_STATES = Object.freeze([
  TRN_STATES.COMPLETED, TRN_STATES.QA_FAIL, TRN_STATES.QA_PASS,
]);
export const isSubmittedState = state => SUBMITTED_TRN_STATES.includes(currentState(state));
