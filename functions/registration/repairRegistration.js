// RG-R001 section 8: a transaction with no meter is repaired under its own TRN ID.
//
// Eight of them exist — 1 on DEV, 4 on TEST, 3 on LIVE by 28 September 2026. Each is a real visit by a
// real worker whose meter was never created, because the transaction was written first and the meter
// was made afterwards by a step that failed in silence. The rule now stops new ones; these are the old
// ones, and they are repaired, not resubmitted: a fresh submission would record the same visit twice.
//
// The repair uses the SAME one creator as a fresh registration (RG-R001 section 9), so a repaired meter
// is identical to one registered today. It keeps the original capture's own attribution — the worker
// who did the work and the day they did it — and records the repair beside it, never in place of it.
import { registrationError } from "./registerMeter.js";
import { resolveRefusedSubmission } from "./refusedSubmissions.js";

export const REPAIRABLE = Object.freeze({
  READY: "READY",
  // The meter is there but not linked everywhere. The same creator fills only what is missing, because it
  // keeps an asset it finds (registerMeter.js step 1) — a meter already normalised is never rewritten.
  LINKS_ONLY: "LINKS_ONLY",
});

/**
 * Which of a registered meter's links are not there. RG-R001 section 2: the meter master's field link and
 * the premise's own meter list are part of the registration, not decorations on it.
 */
export function missingLinks({
  trnId,
  meterType,
  masterSnap,
  premiseSnap,
  getServiceBucketFromMeterType,
}) {
  const missing = [];

  if (!masterSnap?.exists) {
    missing.push("the meter master has no document for this meter number");
  } else if (!(masterSnap.data()?.refs?.asts?.id || "")) {
    missing.push("the meter master carries no field link, so the meter can never be VISIBLE");
  }

  const bucket = getServiceBucketFromMeterType
    ? getServiceBucketFromMeterType({ meterType, trnId })
    : "";
  if (bucket && premiseSnap?.exists) {
    const list = premiseSnap.data()?.services?.[bucket];
    const listed = Array.isArray(list) && list.some((item) => item?.trnId === trnId);
    if (!listed) missing.push("the premise does not carry the meter on its own list");
  }

  return missing;
}

export const NOT_REPAIRABLE = Object.freeze({
  TRN_NOT_FOUND: "TRN_NOT_FOUND",
  NOT_A_REGISTRATION: "NOT_A_REGISTRATION",
  NO_ACCESS_HAS_NO_METER: "NO_ACCESS_HAS_NO_METER",
  ALREADY_HAS_ITS_METER: "ALREADY_HAS_ITS_METER",
  MISSING_METER_DETAILS: "MISSING_METER_DETAILS",
  MISSING_METER_NUMBER: "MISSING_METER_NUMBER",
  MISSING_PREMISE: "MISSING_PREMISE",
  PREMISE_NOT_FOUND: "PREMISE_NOT_FOUND",
  INVALID_METER_TYPE: "INVALID_METER_TYPE",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  METER_NUMBER_TAKEN: "METER_NUMBER_TAKEN",
  MASTER_NOT_WRITABLE: "MASTER_NOT_WRITABLE",
});

const WHY_NOT = Object.freeze({
  [NOT_REPAIRABLE.TRN_NOT_FOUND]: "There is no transaction with that TRN ID.",
  [NOT_REPAIRABLE.NOT_A_REGISTRATION]:
    "That transaction is not a Meter Discovery, so it never had a meter to make.",
  [NOT_REPAIRABLE.NO_ACCESS_HAS_NO_METER]:
    "That is a No Access visit. It is complete as it stands: there is no meter, and that is the point.",
  [NOT_REPAIRABLE.ALREADY_HAS_ITS_METER]:
    "That transaction already has its meter. There is nothing to repair.",
  [NOT_REPAIRABLE.MISSING_METER_DETAILS]:
    "That transaction holds no meter details, so a meter cannot be made from it.",
  [NOT_REPAIRABLE.MISSING_METER_NUMBER]:
    "That transaction holds no usable meter number.",
  [NOT_REPAIRABLE.MISSING_PREMISE]: "That transaction names no premise.",
  [NOT_REPAIRABLE.PREMISE_NOT_FOUND]:
    "The premise that work was done on no longer exists. Restore the premise first.",
  [NOT_REPAIRABLE.INVALID_METER_TYPE]:
    "That transaction is neither a water nor an electricity meter.",
  [NOT_REPAIRABLE.INVALID_PAYLOAD]:
    "That transaction does not pass today's checks, so repairing it would store work we would refuse now.",
  [NOT_REPAIRABLE.METER_NUMBER_TAKEN]:
    "That meter number now belongs to another meter. This needs a person, not a repair.",
  [NOT_REPAIRABLE.MASTER_NOT_WRITABLE]:
    "The meter master record for that meter number is not in a shape this can safely write to. It needs a person.",
});

export function whyNot(code) {
  return WHY_NOT[code] || "That transaction cannot be repaired.";
}

/**
 * Can this transaction be repaired, and what would the repair write?
 *
 * Reads only. This is the dry run: it changes nothing and says exactly what it found.
 */
export async function inspectRegistration({ db, trnId, deps }) {
  const {
    normalizeMeterNo,
    validateMeterDiscoveryPayload,
    getServiceBucketFromMeterType,
    classifyOperationalAstChange,
    METER_MASTER_CLASSIFICATIONS,
  } = deps;
  const safeTrnId = String(trnId || "").trim();

  if (!safeTrnId) {
    return { repairable: false, code: NOT_REPAIRABLE.TRN_NOT_FOUND, trnId: "NAv" };
  }

  const trnSnap = await db.collection("trns").doc(safeTrnId).get();

  if (!trnSnap.exists) {
    return {
      repairable: false,
      code: NOT_REPAIRABLE.TRN_NOT_FOUND,
      trnId: safeTrnId,
    };
  }

  const trnData = trnSnap.data() || {};
  const no = (code) => ({ repairable: false, code, trnId: safeTrnId, trnData });

  if (trnData?.accessData?.trnType !== "METER_DISCOVERY") {
    return no(NOT_REPAIRABLE.NOT_A_REGISTRATION);
  }

  if (trnData?.accessData?.access?.hasAccess !== "yes") {
    return no(NOT_REPAIRABLE.NO_ACCESS_HAS_NO_METER);
  }

  if (!trnData?.ast) return no(NOT_REPAIRABLE.MISSING_METER_DETAILS);

  const meterType = trnData?.meterType;
  if (meterType !== "water" && meterType !== "electricity") {
    return no(NOT_REPAIRABLE.INVALID_METER_TYPE);
  }

  const rawMeterNo = trnData?.ast?.astData?.astNo || "";
  let normalizedMeterNo = "";
  try {
    normalizedMeterNo = normalizeMeterNo(rawMeterNo);
  } catch {
    return no(NOT_REPAIRABLE.MISSING_METER_NUMBER);
  }

  const premiseId = trnData?.accessData?.premise?.id || "";
  if (!premiseId || premiseId === "NAv") return no(NOT_REPAIRABLE.MISSING_PREMISE);

  const validationError = validateMeterDiscoveryPayload({ data: trnData });
  if (validationError) {
    return {
      ...no(NOT_REPAIRABLE.INVALID_PAYLOAD),
      detail: `${validationError.code}: ${validationError.message}`,
    };
  }

  const [astSnap, masterSnap, premiseSnap] = await Promise.all([
    db.collection("asts").doc(safeTrnId).get(),
    db.collection("meter_master").doc(normalizedMeterNo).get(),
    db.collection("premises").doc(premiseId).get(),
  ]);

  if (!premiseSnap.exists) return no(NOT_REPAIRABLE.PREMISE_NOT_FOUND);

  // The meter number may have been captured again since, under its own transaction. That is a person's
  // decision — which of the two visits is the meter — and never a repair's (RG-R001 section 8).
  const masterAstId = masterSnap.exists
    ? masterSnap.data()?.refs?.asts?.id || ""
    : "";
  if (masterAstId && masterAstId !== safeTrnId) {
    return {
      ...no(NOT_REPAIRABLE.METER_NUMBER_TAKEN),
      detail: `meter_master/${normalizedMeterNo} points at ${masterAstId}`,
    };
  }

  // A dry run is what the owner reads before saying go, so it must not promise a repair the write would
  // refuse. The meter master guards its own shape, and it does so inside the transaction - so ask it the
  // same question here, where nothing is written (measured on DEV: 22 old masters answer no).
  if (masterSnap.exists && classifyOperationalAstChange) {
    const decision = classifyOperationalAstChange({
      masterId: normalizedMeterNo,
      existing: masterSnap.data(),
      incomingAstId: safeTrnId,
      incomingLmPcode: trnData?.accessData?.parents?.lmPcode || null,
      incomingMeterType: meterType,
      sourceWriter: "inspectRegistration",
    });
    if (
      METER_MASTER_CLASSIFICATIONS &&
      decision?.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT
    ) {
      return {
        ...no(NOT_REPAIRABLE.MASTER_NOT_WRITABLE),
        detail: `${decision?.conflict?.conflictCode || "CONFLICT"}: ${
          decision?.conflict?.message || "the meter master refused"
        }`,
      };
    }
  }

  // RG-R001 section 2: a meter is not registered because `asts` holds a document. It is registered when
  // all of its records stand together. A master with no field link can never be VISIBLE (MV-R001), and a
  // meter missing from its premise list does not show on the premise card — yet both read as finished
  // everywhere that counts the asset alone. So asking only "does the asset exist" is not the question.
  const missing = missingLinks({
    trnId: safeTrnId,
    meterType,
    masterSnap,
    premiseSnap,
    getServiceBucketFromMeterType,
  });

  if (astSnap.exists && !missing.length) {
    return no(NOT_REPAIRABLE.ALREADY_HAS_ITS_METER);
  }

  return {
    repairable: true,
    code: astSnap.exists ? REPAIRABLE.LINKS_ONLY : REPAIRABLE.READY,
    trnId: safeTrnId,
    trnData,
    ...(astSnap.exists ? { missingLinks: missing } : {}),
    // What the repair would write, so a dry run can be read before it is run.
    willWrite: {
      ast: astSnap.exists ? "already there, and left as it is" : `asts/${safeTrnId}`,
      master: `meter_master/${normalizedMeterNo}`,
      premise: `premises/${premiseId}`,
      meterNo: normalizedMeterNo,
      meterType,
      workedOn:
        trnData?.metadata?.createdOnDevice || trnData?.metadata?.createdAt || "NAv",
      worker: trnData?.metadata?.createdByUser || "NAv",
    },
    facts: { normalizedMeterNo, rawMeterNo, premiseId, meterType },
  };
}

/**
 * Repair one transaction: make its meter, under its own TRN ID, in one transaction.
 *
 * `dryRun` reports what it would do and writes nothing.
 */
export async function repairRegistration({
  db,
  Timestamp,
  trnId,
  actorUid,
  actorName,
  reason = "",
  dryRun = true,
  deps,
  now = new Date().toISOString(),
}) {
  const { registerMeterInTransaction, logger } = deps;

  const inspection = await inspectRegistration({ db, trnId, deps });

  if (!inspection.repairable) {
    return {
      success: false,
      repaired: false,
      dryRun,
      trnId: inspection.trnId,
      code: inspection.code,
      message: whyNot(inspection.code),
      ...(inspection.detail ? { detail: inspection.detail } : {}),
    };
  }

  if (dryRun) {
    return {
      success: true,
      repaired: false,
      dryRun: true,
      trnId: inspection.trnId,
      code: "WOULD_REPAIR",
      message:
        inspection.code === REPAIRABLE.LINKS_ONLY
          ? `The meter is there but not linked everywhere: ${inspection.missingLinks.join(
              "; ",
            )}. The links can be filled in. Nothing has been written.`
          : "This transaction can be repaired. Nothing has been written.",
      willWrite: inspection.willWrite,
      ...(inspection.missingLinks ? { missingLinks: inspection.missingLinks } : {}),
    };
  }

  if (!String(reason || "").trim()) {
    throw registrationError(
      "REPAIR_REASON_REQUIRED",
      "A repair is recorded in the person's own words, so a reason is required.",
    );
  }

  const { trnData, facts } = inspection;
  const trnRef = db.collection("trns").doc(inspection.trnId);

  // RG-R001 section 8 (owner, 2026-09-29): a batch that has since been deleted must not keep a meter out
  // of iREPS. The visit happened and the worker was there, so the meter is made and the missing batch is
  // recorded on the repair. Only the batch's own records may be missing — anything else still refuses,
  // because the repair may never write half a registration.
  const MISSING_BATCH_CODES = new Set([
    "TARGETED_BATCH_NOT_FOUND",
    "TARGETED_BATCH_ROW_NOT_FOUND",
    "SALES_DOCUMENT_NOT_FOUND",
  ]);
  let batchGone = null;
  const repairDeps = {
    ...deps,
    completeTargetedBatchMeterDiscoveryInTransaction: async (args) => {
      try {
        return await deps.completeTargetedBatchMeterDiscoveryInTransaction(args);
      } catch (error) {
        const code = error?.irepsCode || error?.code || "";
        if (!MISSING_BATCH_CODES.has(code)) throw error;

        batchGone = { code, detail: error?.message || String(error) };
        return { applied: false, batchGone: true };
      }
    },
  };

  // RG-R001 section 8: the original capture keeps its own attribution. The repair's own time and the
  // person who ran it are recorded beside it, never in place of it.
  const metadata = {
    ...(trnData.metadata || {}),
    updatedOnServer: now,
    updatedAt: now,
    updatedByUid: actorUid,
    updatedByUser: actorName,
  };

  const result = await db.runTransaction(async (tx) => {
    const registration = await registerMeterInTransaction({
      tx,
      db,
      Timestamp,
      trnData,
      trnId: inspection.trnId,
      rawMeterNo: facts.rawMeterNo,
      normalizedMeterNo: facts.normalizedMeterNo,
      meterType: facts.meterType,
      lmPcode: trnData?.accessData?.parents?.lmPcode || null,
      premiseId: facts.premiseId,
      erfId: trnData?.accessData?.erfId || "",
      metadata,
      deps: repairDeps,
    });

    tx.set(
      trnRef,
      {
        derived: registration.derived,
        metadata,
        repair: {
          at: now,
          byUid: actorUid,
          byUser: actorName,
          reason: String(reason).trim(),
          rule: "RG-R001",
          // The batch this work was filed under no longer exists. The meter is still made; the office
          // can see why its row was never closed (owner, 2026-09-29).
          ...(batchGone
            ? {
                batchGone: {
                  tbId: trnData?.targetedBatchContext?.tbId || "NAv",
                  code: batchGone.code,
                  detail: batchGone.detail,
                },
              }
            : {}),
        },
      },
      { merge: true },
    );

    return registration;
  });

  // The work is no longer refused (RG-R001 1.3.0 section 7). It is marked resolved, never deleted: the
  // attempts beneath it are the only record that the app refused this worker, and how many times.
  await resolveRefusedSubmission({
    db,
    trnId: inspection.trnId,
    how: "the office repaired it",
    standingTrnId: inspection.trnId,
    byUid: actorUid,
    byUser: actorName,
    now,
  });

  logger?.info?.("repairRegistration ---- repaired", {
    trnId: inspection.trnId,
    astId: result.astId,
    meterNo: facts.normalizedMeterNo,
    visibility: result.visibility,
    byUser: actorName,
  });

  return {
    success: true,
    repaired: true,
    dryRun: false,
    trnId: inspection.trnId,
    astId: result.astId,
    meterNo: facts.normalizedMeterNo,
    visibility: result.visibility,
    // So the caller can rebuild the counts and the flat rows afterwards, outside the repair.
    premiseId: facts.premiseId,
    erfId: trnData?.accessData?.erfId || "NAv",
    code: "REPAIRED",
    ...(batchGone ? { batchGone: batchGone.code } : {}),
    ...(inspection.missingLinks ? { missingLinks: inspection.missingLinks } : {}),
    message: [
      inspection.code === REPAIRABLE.LINKS_ONLY
        ? "The meter was already there and was left as it is. It is now linked everywhere: the meter master carries its field link, and the premise carries it on its own list."
        : "The meter now exists, under the same TRN ID as the original visit.",
      batchGone
        ? "The batch it was filed under no longer exists, and that is recorded on the repair."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
