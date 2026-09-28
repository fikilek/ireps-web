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
import { REFUSED_SUBMISSIONS } from "./refusedSubmissions.js";

export const REPAIRABLE = Object.freeze({
  READY: "READY",
});

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
  const { normalizeMeterNo, validateMeterDiscoveryPayload } = deps;
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

  if (astSnap.exists) return no(NOT_REPAIRABLE.ALREADY_HAS_ITS_METER);
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

  return {
    repairable: true,
    code: REPAIRABLE.READY,
    trnId: safeTrnId,
    trnData,
    // What the repair would write, so a dry run can be read before it is run.
    willWrite: {
      ast: `asts/${safeTrnId}`,
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
      message: "This transaction can be repaired. Nothing has been written.",
      willWrite: inspection.willWrite,
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
      deps,
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
        },
      },
      { merge: true },
    );

    return registration;
  });

  // The work is no longer refused, so the office's list must not keep saying it is (RG-R001 s.8).
  try {
    await db.collection(REFUSED_SUBMISSIONS).doc(inspection.trnId).delete();
  } catch (error) {
    logger?.warn?.("repairRegistration ---- refusal record left behind", {
      trnId: inspection.trnId,
      message: error?.message || String(error),
    });
  }

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
    message: "The meter now exists, under the same TRN ID as the original visit.",
  };
}
