// RG-R001 section 7: where a refused submission's reason is written.
//
// A registration that could not produce its meter must not exist (RG-R001 section 1), so there is no
// transaction left to write the reason on. It goes two places instead: the refused item on the
// worker's phone, so they read it in their own words, and here, because a worker's phone is not where
// the office looks.
//
// This is not a transaction. It is never counted as field work and it never becomes a meter.
import * as logger from "firebase-functions/logger";
import { plainReasonFor } from "../meterDiscovery/captureOutcome.js";

export const REFUSED_SUBMISSIONS = "refused_submissions";

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

  const text = (value) => {
    const out = String(value ?? "").trim();
    return out || "NAv";
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
    refusal: {
      code: safeCode,
      // The sentence a person reads. Our own message is kept beside it, never in place of it.
      reason: plainReasonFor({ code: safeCode, message }),
      detail: text(message),
      ...(details ? { details } : {}),
    },
  };

  try {
    await db.collection(REFUSED_SUBMISSIONS).doc(safeTrnId).set(record, {
      merge: true,
    });

    logger.warn("refusedSubmissions ---- a registration was refused", {
      trnId: safeTrnId,
      code: safeCode,
      reason: record.refusal.reason,
    });

    return { recorded: true, record };
  } catch (error) {
    logger.error("refusedSubmissions ---- could not record the refusal", {
      trnId: safeTrnId,
      code: safeCode,
      message: error?.message || String(error),
    });

    return { recorded: false, record };
  }
}
