// RG-R001 section 7: where a refused submission's reason is written.
//
// A registration that could not produce its meter must not exist (RG-R001 section 1), so there is no
// transaction left to write the reason on. It goes two places instead: the refused item on the
// worker's phone, so they read it in their own words, and here, because a worker's phone is not where
// the office looks.
//
// RG-R001 1.3.0: EVERY ATTEMPT IS KEPT. One document per TRN ID used to mean each attempt overwrote the
// one before it, and a repair deleted the record altogether — so iREPS could not show that a worker had
// been refused four times on one meter. That number is the signal that a rule does not fit the ground,
// or that a form cannot say what the worker is looking at, and it is the one thing this record exists to
// carry. The document holds the current state; the attempts beneath it hold the history, and nothing
// overwrites an attempt. When the work finally lands the submission is marked resolved, never deleted.
//
// This is not a transaction. It is never counted as field work and it never becomes a meter.
import * as logger from "firebase-functions/logger";
import { plainReasonFor } from "../meterDiscovery/captureOutcome.js";

export const REFUSED_SUBMISSIONS = "refused_submissions";
export const REFUSAL_ATTEMPTS = "attempts";

const text = (value) => {
  const out = String(value ?? "").trim();
  return out || "NAv";
};

// An attempt is named by the moment it was refused, so attempts read in order and no two collide.
const attemptId = (now) => String(now).replace(/[:.]/g, "-");

/**
 * Record a refusal. Never throws, and never blocks the answer to the worker: a failure to record a
 * failure must not turn into a worse one. The worker has already been told; this is for the office.
 */
export async function recordRefusedSubmission({
  db,
  trnId,
  code,
  message = "",
  data = {},
  actorUid = "NAv",
  actorName = "NAv",
  now = new Date().toISOString(),
  details = null,
}) {
  const safeTrnId = String(trnId || "").trim();
  const safeCode = String(code || "UNKNOWN").trim().toUpperCase();

  if (!db || !safeTrnId) return { recorded: false };

  const refusal = {
    code: safeCode,
    // The sentence a person reads. Our own message is kept beside it, never in place of it.
    reason: plainReasonFor({ code: safeCode, message }),
    detail: text(message),
    ...(details ? { details } : {}),
  };

  const record = {
    trnId: safeTrnId,
    trnType: text(data?.accessData?.trnType || "METER_DISCOVERY"),
    meterType: text(data?.meterType),
    meterNo: text(data?.ast?.astData?.astNo),
    premiseId: text(data?.accessData?.premise?.id),
    premiseAddress: text(data?.accessData?.premise?.address),
    erfId: text(data?.accessData?.erfId),
    erfNo: text(data?.accessData?.erfNo),
    lmPcode: text(data?.accessData?.parents?.lmPcode),
    wardPcode: text(data?.accessData?.parents?.wardPcode),
    worker: {
      uid: text(actorUid),
      name: text(actorName),
      serviceProviderId: text(data?.serviceProvider?.id),
      serviceProviderName: text(data?.serviceProvider?.name),
    },
    // The time the work was done, and the time it was refused. RG-R001 1.1.0 section 2.
    doneOnDevice: text(data?.metadata?.createdOnDevice || data?.metadata?.createdAt),
    refusedAt: now,
    refusal,
  };

  const ref = db.collection(REFUSED_SUBMISSIONS).doc(safeTrnId);

  try {
    // How many times this submission has been refused before, so the count is a fact and not a guess.
    let before = null;
    try {
      const snap = await ref.get();
      before = snap.exists ? snap.data() : null;
    } catch {
      before = null;
    }

    const attempts = Number(before?.attempts || 0) + 1;

    // The number the owner asked to see: how many times this WORKER HAS BEEN TURNED AWAY FROM THIS METER.
    // It is not the same as . The phone never reuses a refused TRN ID - a Submit after a refusal
    // is a new attempt with a new id - so four refusals on one meter are four submissions, each of which
    // has been refused once. Counted across the open submissions for the same meter, it is one number on
    // the newest record, and nobody has to add up four documents to see that a rule is not working.
    let timesThisMeterHasBeenRefused = attempts;
    let firstRefusedThisMeterAt = before?.firstRefusedAt || now;
    try {
      const meterNo = record.meterNo;
      if (meterNo && meterNo !== "NAv") {
        const others = await db
          .collection(REFUSED_SUBMISSIONS)
          .where("open", "==", true)
          .where("meterNo", "==", meterNo)
          .get();
        for (const doc of others.docs) {
          if (doc.id === safeTrnId) continue;
          const other = doc.data() || {};
          timesThisMeterHasBeenRefused += Number(other.attempts || 1);
          const otherFirst = other.firstRefusedAt || "";
          if (otherFirst && otherFirst < firstRefusedThisMeterAt) firstRefusedThisMeterAt = otherFirst;
        }
      }
    } catch {
      // A count that could not be worked out is left as this submission's own. Never block the record.
    }

    await ref.set(
      {
        ...record,
        firstRefusedAt: before?.firstRefusedAt || now,
        lastRefusedAt: now,
        attempts,
        timesThisMeterHasBeenRefused,
        firstRefusedThisMeterAt,
        // It is refused until something puts it right (resolveRefusedSubmission).
        resolved: null,
        open: true,
      },
      { merge: true },
    );

    // The attempt itself, which nothing is allowed to overwrite.
    await ref
      .collection(REFUSAL_ATTEMPTS)
      .doc(attemptId(now))
      .set({
        attempt: attempts,
        refusedAt: now,
        refusal,
        // Which app was refused, so a refusal that only old phones get is visible as that.
        contractVersion: Number(data?.meterDiscoveryContractVersion ?? 0) || "NAv",
        worker: record.worker,
        meterNo: record.meterNo,
      });

    logger.warn("refusedSubmissions ---- a registration was refused", {
      trnId: safeTrnId,
      code: safeCode,
      attempts,
      timesThisMeterHasBeenRefused,
      reason: refusal.reason,
    });

    return { recorded: true, record, attempts, timesThisMeterHasBeenRefused };
  } catch (error) {
    logger.error("refusedSubmissions ---- could not record the refusal", {
      trnId: safeTrnId,
      code: safeCode,
      message: error?.message || String(error),
    });

    return { recorded: false, record };
  }
}

/**
 * The work landed. Mark the submission resolved — never delete it (RG-R001 1.3.0 section 7).
 *
 * `how` says which of the two endings it was: the worker submitted again, or the office repaired it.
 * Never throws: a registration that has committed is not undone because its history could not be filed.
 */
export async function resolveRefusedSubmission({
  db,
  trnId,
  how,
  standingTrnId = "",
  byUid = "NAv",
  byUser = "NAv",
  now = new Date().toISOString(),
}) {
  const safeTrnId = String(trnId || "").trim();
  if (!db || !safeTrnId) return { resolved: false };

  try {
    const ref = db.collection(REFUSED_SUBMISSIONS).doc(safeTrnId);
    const snap = await ref.get();
    if (!snap.exists) return { resolved: false, nothingToResolve: true };

    await ref.set(
      {
        open: false,
        resolved: {
          at: now,
          how: text(how),
          standingTrnId: text(standingTrnId || safeTrnId),
          byUid: text(byUid),
          byUser: text(byUser),
        },
      },
      { merge: true },
    );

    logger.info("refusedSubmissions ---- resolved", {
      trnId: safeTrnId,
      how: text(how),
      attempts: Number(snap.data()?.attempts || 0),
    });

    return { resolved: true, attempts: Number(snap.data()?.attempts || 0) };
  } catch (error) {
    logger.error("refusedSubmissions ---- could not resolve the refusal", {
      trnId: safeTrnId,
      message: error?.message || String(error),
    });
    return { resolved: false };
  }
}

/**
 * A registration committed. Close whatever it put right.
 *
 * A worker who is refused starts a NEW attempt with its own TRN ID (the phone never reuses a refused
 * one), so the open record almost never carries the id that finally succeeded. It is found by the meter
 * number instead — the thing the worker was trying to register. Two equality filters on one collection,
 * which Firestore serves from its own single-field indexes; no composite index is needed.
 *
 * Never throws: work that has committed is not undone because its history could not be filed.
 */
export async function resolveRefusalsForMeter({
  db,
  meterNo,
  standingTrnId,
  byUid = "NAv",
  byUser = "NAv",
  now = new Date().toISOString(),
  how = "the worker submitted again",
}) {
  const safeMeterNo = String(meterNo || "").trim();
  const safeStanding = String(standingTrnId || "").trim();
  if (!db || !safeStanding) return { resolved: 0 };

  const resolveOne = (trnId) =>
    resolveRefusedSubmission({
      db,
      trnId,
      how,
      standingTrnId: safeStanding,
      byUid,
      byUser,
      now,
    });

  let resolved = 0;

  try {
    // The same id, for a submission that was refused and then accepted under its own TRN ID.
    const same = await resolveOne(safeStanding);
    if (same.resolved) resolved += 1;

    if (!safeMeterNo || safeMeterNo === "NAv") return { resolved };

    const open = await db
      .collection(REFUSED_SUBMISSIONS)
      .where("open", "==", true)
      .where("meterNo", "==", safeMeterNo)
      .get();

    for (const doc of open.docs) {
      if (doc.id === safeStanding) continue;
      const outcome = await resolveOne(doc.id);
      if (outcome.resolved) resolved += 1;
    }

    if (resolved) {
      logger.info("refusedSubmissions ---- closed by a registration that landed", {
        standingTrnId: safeStanding,
        meterNo: safeMeterNo,
        resolved,
      });
    }

    return { resolved };
  } catch (error) {
    logger.error("refusedSubmissions ---- could not close the refusals", {
      standingTrnId: safeStanding,
      meterNo: safeMeterNo,
      message: error?.message || String(error),
    });
    return { resolved };
  }
}
