// f01: a capture never dies in silence.
//
// The phone shows MISSION SUCCESS the moment the transaction is written. Everything that makes the
// capture real — the meter, the meter master, the link to the premise, the Sales record, the batch
// row — happens afterwards, in onMeterDiscoveryCreated. When that step failed it wrote a log line
// and stopped. The transaction stayed, nothing else existed, and nobody was told.
//
// Two harms, and the second is the worse one. The worker believes the meter is done and walks away,
// so it is sent to somebody again. And the numbers stop balancing for good: a transaction with no
// asset behind it is counted by everything that reads transactions and by nothing that reads meters
// (owner, 2026-09-28, after a capture died this way on TEST).
//
// So the reason is written onto the capture itself. The office can find every one of them and read
// why, and the phone can be told. It is the transaction that failed, so it is the transaction that
// says so.
import * as logger from "firebase-functions/logger";

export const CAPTURE_FAILED_FIELD = "derived.failure";

// What a worker or an office clerk should read. The code stays for us; the sentence is for them.
const PLAIN_REASONS = Object.freeze({
  MISSING_METER_NUMBER: "The capture arrived without a meter number.",
  MISSING_PREMISE: "The capture arrived without a premise.",
  PREMISE_NOT_FOUND: "The premise this meter was captured on no longer exists.",
  INVALID_PAYLOAD: "The capture did not pass its checks.",
  INVALID_METER_TYPE: "The capture is neither a water nor an electricity meter.",
  MISSING_METER_DETAILS: "The capture arrived without any meter details.",
  METER_MASTER_CONFLICT: "This meter number is already registered on another meter.",
  MM_AST_REFERENCE_CONFLICT:
    "This meter number is already registered on another meter.",
  MM_LM_CONFLICT:
    "This meter number is already registered in another municipality.",
  MM_METER_TYPE_CONFLICT:
    "This meter number is already registered as the other kind of meter.",
  SALES_CONFLICT: "The Sales record for this meter could not be matched.",
  TARGETED_BATCH_CONTEXT_INVALID:
    "The batch this work was filed under could not be read.",
  // RG-R001 1.1.0 section 6: three refusals the server is right to make, and was making in silence.
  // The owner, 2026-09-28: "this is ok, it must just give feedback to the FWR."
  OUTDATED_APP_NORMALISATION:
    "This version of iREPS cannot send this work. Update the app and submit it again — the work is safe on the phone.",
  INVALID_SERVICE_BUCKET:
    "iREPS could not tell whether this is a water or an electricity meter. Nothing was saved. Tell the office.",
  METER_IN_ANOTHER_TEAMS_BATCH:
    "This meter is in another team's batch, so only that team can work on it. Nothing was saved.",
  BATCH_CHECK_UNAVAILABLE:
    "iREPS could not check which batch this meter is in. Nothing was saved. Please try again.",
});

// The same refusal code can mean two different things to a worker, so the field that is missing
// decides the sentence. RG-R001 1.1.0 section 6.
const MISSING_FIELD_REASONS = Object.freeze([
  [
    /accessData\.erf(Id|No)/i,
    "This premise has no ERF number, so the meter cannot be registered on it. Tell the office the premise and the address.",
  ],
  [
    /serviceProvider/i,
    "Your user is not linked to a service provider yet, so work cannot be submitted. Ask the office to fix your user.",
  ],
  [
    /accessData\.parents/i,
    "This premise is missing its ward or municipality, so the meter cannot be registered on it. Tell the office the premise and the address.",
  ],
  [
    /accessData\.premise\.(address|propertyType)/i,
    "This premise has no address recorded, so the meter cannot be registered on it. Tell the office the premise and the ERF number.",
  ],
]);

export function plainReason(code, fallback = "") {
  return (
    PLAIN_REASONS[String(code || "").trim().toUpperCase()] ||
    fallback ||
    "This capture could not be completed."
  );
}

/**
 * The sentence for a worker, given the code AND the message it came with. Use this wherever a worker
 * or an office clerk reads the refusal; `plainReason` alone cannot tell two missing fields apart.
 */
export function plainReasonFor({ code, message = "" } = {}) {
  const safeCode = String(code || "").trim().toUpperCase();
  const safeMessage = String(message || "");

  if (safeCode === "MISSING_REQUIRED_FIELD" || safeCode === "MISSING_REQUIRED_PARENT") {
    const hit = MISSING_FIELD_REASONS.find(([pattern]) =>
      pattern.test(safeMessage),
    );
    if (hit) return hit[1];
  }

  // Every meter master refusal is about one thing to a worker: this number belongs to another meter.
  // Without this, the database's own wording reached the phone.
  if (safeCode.startsWith("MM_") && !PLAIN_REASONS[safeCode]) {
    return PLAIN_REASONS.METER_MASTER_CONFLICT;
  }

  return plainReason(safeCode, safeMessage);
}

/**
 * Write on the capture why it never became a meter.
 *
 * Never throws: a failure to record a failure must not replace it with a worse one. It is called
 * from the one place that knows the capture is dead, so if this cannot write, the log line that was
 * always there is still there.
 */
export async function recordCaptureFailure({
  db,
  trnId,
  code,
  message = "",
  details = null,
  now = new Date().toISOString(),
}) {
  const safeTrnId = String(trnId || "").trim();
  const safeCode = String(code || "UNKNOWN").trim().toUpperCase();

  if (!db || !safeTrnId) return { recorded: false };

  const failure = {
    code: safeCode,
    // The sentence a person reads. The message we threw is kept beside it, never in place of it.
    reason: plainReason(safeCode, message),
    detail: String(message || "").trim() || "NAv",
    at: now,
    ...(details ? { details } : {}),
  };

  try {
    await db.collection("trns").doc(safeTrnId).set(
      { derived: { failure } },
      { merge: true },
    );

    logger.error("captureOutcome ---- the capture never became a meter", {
      trnId: safeTrnId,
      code: safeCode,
      reason: failure.reason,
    });

    return { recorded: true, failure };
  } catch (error) {
    logger.error("captureOutcome ---- could not record the failure", {
      trnId: safeTrnId,
      code: safeCode,
      message: error?.message || String(error),
    });

    return { recorded: false, failure };
  }
}
