// Work nobody answers goes back to the pool. `DR-R001` 5.6.
//
// The owner, 11 October 2026: a job left in `Issued` for more than three days
// is returned automatically, and no human has to notice. It needs no sixth
// state - it is the `cancel` the machine already has, with the clock as the
// actor instead of a supervisor.
//
// ONLY FROM `ISSUED`, and that is deliberate. The owner settled it: the clock
// cannot see that a man is standing at the meter, so accepted work is never
// taken off him by a timer. The override of 5.5 is what covers the man who
// accepted and then could not go.
//
// A JOB WITH NO `workflow.issuedAt` NEVER EXPIRES, and this is the one thing
// in the file worth reading twice. Most records written before 10 October 2026
// carry none - all of TEST's and LIVE's single issued job among them - and an
// unknown age is not a long one (`UI-R008`).
//
// So THE CLOCK IS NOT IN THE QUERY. A Firestore filter of
// `where("workflow.issuedAt", "<", cutoff)` would match those records, because
// an explicit `null` sorts BEFORE a string in Firestore's type ordering - it
// would expire exactly the set the rule says must never expire, and it would
// look right while doing it. The query asks only for `ISSUED`, which is a
// single-field equality needing no composite index, and every candidate is then
// put to `hasExpired` in the state machine, where the rule already lives and is
// already tested.
//
// The clock and the database are arguments, so this runs under test without an
// emulator and without a real clock.

import { FieldValue } from "firebase-admin/firestore";

import { buildTrnActiveLifecycle } from "./helpers.js";
import {
  EXPIRES_AFTER_MS,
  TRN_STATES,
  hasExpired,
  readIssuedAt,
} from "./trnStateMachine.js";

/** Who the record says did it. An expiry has no person behind it. */
export const EXPIRY_ACTOR = Object.freeze({
  uid: "SYSTEM",
  name: "iREPS",
});

/** What the history calls it. `DR-R001` 5.7. */
export const EXPIRY_EVENT = "EXPIRED";

const text = (value) => String(value ?? "").trim();

function getAstId(trnData = {}) {
  return text(trnData?.ast?.astData?.astId || trnData?.astId);
}

function getTrnType(trnData = {}) {
  return text(trnData?.accessData?.trnType || trnData?.trnType).toUpperCase();
}

/**
 * What an expiry writes on the transaction.
 *
 * It does NOT reuse the cancel's own stamps. `workflow.cancelledAt` and
 * `assignment.cancelReason` say a person took the work back, and labelling a
 * clock-driven return as an office cancellation would make the two
 * indistinguishable on the fast read - while `DR-R001` 9.1 counts them
 * separately. The state they land in is the same; what happened is not.
 */
export function buildExpiryPatch({ now, afterMs = EXPIRES_AFTER_MS }) {
  return {
    "workflow.state": TRN_STATES.CREATED,

    // `DR-R001` 9.2: the Waiting view says how long each job has waited, and
    // that is from when it came BACK, not from when it was issued three days
    // ago. Written by every move that lands in `Created`.
    "workflow.returnedToCreatedAt": now,
    "workflow.expiredAt": now,
    "workflow.expiredAfterMs": afterMs,

    // Nobody holds it any more. Leaving his name on it would make the job
    // his and nobody's at once, which is the fault the five states remove
    // (`DR-R001` 5.1).
    "assignment.targets": [],

    "metadata.updatedAt": now,
    "metadata.updatedByUid": EXPIRY_ACTOR.uid,
    "metadata.updatedByUser": EXPIRY_ACTOR.name,
  };
}

/** The history event. The document's fields are the fast read; this is the record. */
export function buildExpiryHistoryEvent({ trnId, trnType, astId, now, ageMs }) {
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  return {
    event: EXPIRY_EVENT,
    workflowState: TRN_STATES.CREATED,
    outcome: "NAv",
    trnId,
    trnType,
    astId,
    note: `No answer in ${days} days, so the work went back to the pool.`,
    actor: { uid: EXPIRY_ACTOR.uid, name: EXPIRY_ACTOR.name },
    metadata: {
      createdAt: now,
      createdByUid: EXPIRY_ACTOR.uid,
      createdByUser: EXPIRY_ACTOR.name,
      updatedAt: now,
      updatedByUid: EXPIRY_ACTOR.uid,
      updatedByUser: EXPIRY_ACTOR.name,
    },
  };
}

/**
 * Returns the work that has gone quiet for too long, having asked the machine
 * about every candidate rather than the database.
 *
 * Paged by document id so a page boundary cannot skip a record, and so a run
 * that stops on its deadline can be resumed by the next tick.
 */
export async function findSilentWork({ db, nowMs, pageSize = 200, maxScan = 20000 }) {
  const expired = [];
  const neverExpire = [];
  const unreadable = [];

  let scanned = 0;
  let pages = 0;
  let after = null;

  for (;;) {
    let query = db
      .collection("trns")
      .where("workflow.state", "==", TRN_STATES.ISSUED)
      .orderBy("__name__")
      .limit(pageSize);

    if (after) query = query.startAfter(after);

    const page = await query.get();

    pages += 1;

    if (page.empty) break;

    for (const doc of page.docs) {
      scanned += 1;

      const data = doc.data() || {};

      const issuedAt = readIssuedAt(data);

      if (hasExpired(data, nowMs)) {
        expired.push({
          trnId: doc.id,
          ref: doc.ref,
          data,
          trnType: getTrnType(data),
          astId: getAstId(data),
          ageMs: nowMs - issuedAt.ms,
        });

        continue;
      }

      // EVERY CANDIDATE LANDS SOMEWHERE. A job that is simply too young is
      // neither of these and needs no bucket; the two that do are the ones a
      // run could otherwise drop without saying so.
      if (issuedAt.kind === "absent") neverExpire.push(doc.id);
      if (issuedAt.kind === "unreadable") unreadable.push(doc.id);
    }

    after = page.docs[page.docs.length - 1];

    if (page.size < pageSize) break;
    if (scanned >= maxScan) break;
  }

  return { expired, neverExpire, unreadable, scanned, pages };
}

/**
 * Expires one job, in one transaction, writing the same three places every
 * other state change writes (`DR-R001` 5.3).
 *
 * It re-reads the transaction inside the transaction and gives up quietly if
 * it is no longer expired - the office may have cancelled it, or the worker
 * may have accepted it, between the scan and the write. A timer that overrode
 * a person would be worse than a timer that missed a tick.
 */
export async function expireOne({ db, job, nowMs, now }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(job.ref);

    if (!snap.exists) return { trnId: job.trnId, done: false, why: "gone" };

    const data = snap.data() || {};

    if (!hasExpired(data, nowMs)) {
      return { trnId: job.trnId, done: false, why: "no longer expired" };
    }

    const astId = getAstId(data) || job.astId;
    const trnType = getTrnType(data) || job.trnType;
    const issuedAtMs = Date.parse(String(data?.workflow?.issuedAt));
    const ageMs = Number.isFinite(issuedAtMs) ? nowMs - issuedAtMs : 0;

    const astRef = astId ? db.collection("asts").doc(astId) : null;
    const astSnap = astRef ? await tx.get(astRef) : null;

    tx.update(job.ref, buildExpiryPatch({ now }));

    tx.set(
      job.ref.collection("history").doc(),
      buildExpiryHistoryEvent({ trnId: job.trnId, trnType, astId: astId || "NAv", now, ageMs }),
    );

    // The meter is still held - a job back in `Created` holds it (5.2) - but
    // by a job waiting to be given out rather than by a worker, so the
    // marker must stop naming him. Only if it names THIS job, matched on the
    // id alone: the marker is one field and may be naming a different kind
    // of work on the same meter.
    if (astSnap?.exists) {
      const marker = astSnap.data()?.trnActiveLifecycle;

      if (String(marker?.trnId || "").trim() === job.trnId) {
        tx.update(astRef, {
          trnActiveLifecycle: buildTrnActiveLifecycle({
            trnId: job.trnId,
            trnType,
            workflowState: TRN_STATES.CREATED,
            outcome: "NAv",
            assignedTo: {},
            updatedAt: now,
            updatedByUser: EXPIRY_ACTOR.name,
          }),
          "metadata.updatedAt": now,
          "metadata.updatedByUid": EXPIRY_ACTOR.uid,
          "metadata.updatedByUser": EXPIRY_ACTOR.name,
        });
      }
    }

    return { trnId: job.trnId, done: true, astId: astId || "NAv", ageMs };
  });
}

/**
 * One run. Returns what it did, including what it did NOT get to, because a
 * run that stopped on its cap and looks complete is how a backlog hides.
 */
export async function expireSilentWork({
  db,
  nowMs,
  now = new Date(nowMs).toISOString(),
  pageSize = 200,
  maxPerRun = 500,
  deadlineMs = null,
  startedMs = nowMs,
}) {
  const found = await findSilentWork({ db, nowMs, pageSize });

  const expired = [];
  const refused = [];

  let stoppedOnCap = false;
  let stoppedOnDeadline = false;

  for (const job of found.expired) {
    if (expired.length >= maxPerRun) {
      stoppedOnCap = true;
      break;
    }

    if (deadlineMs !== null && nowMs - startedMs > deadlineMs) {
      stoppedOnDeadline = true;
      break;
    }

    const outcome = await expireOne({ db, job, nowMs, now });

    if (outcome.done) expired.push(outcome);
    else refused.push(outcome);
  }

  return {
    at: now,
    scanned: found.scanned,
    pages: found.pages,
    found: found.expired.length,
    expired: expired.map((item) => item.trnId),
    // Not a failure: something happened to the job between the scan and the
    // write, and the person who did it wins.
    leftAlone: refused,
    // Said out loud. These are the records the rule protects: issued before
    // the stamp existed, so their age is unknown and an unknown age is not a
    // long one.
    neverExpire: found.neverExpire.length,

    // And these are a fault, not a protection: a stamp that is there and
    // cannot be read. Named individually, because one is one too many and
    // nothing else in iREPS would ever say so.
    unreadableIssuedAt: found.unreadable,
    stoppedOnCap,
    stoppedOnDeadline,
    remaining: Math.max(0, found.expired.length - expired.length - refused.length),
  };
}

/** Kept so a caller cannot restate the three days. */
export { EXPIRES_AFTER_MS, FieldValue };
