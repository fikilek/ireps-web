// Targeted Batch rule TB-R066 (1.3.71): a replaced meter carries its batch row with it.
//
// A meter on a batch row is found, and later replaced: the old one comes out (Meter Removal) and a new one
// goes in (Meter Installation), whether that follows a finding (MN-R001 6.1) or the worker starts it from
// the meter card. Until this rule nothing told the batch, so My Work Orders kept showing the number that had
// been taken away and its AST button opened a meter that is no longer there (owner, 2026-09-23, ERF 5187:
// meter 04297749733 discovered, removed, replaced by 07134286754).
//
// What this does, after the installation is committed:
//  1. finds every batch row still pointing at the replaced meter's record (`refs.meterId`);
//  2. points the row and the Sales record's own field work at the NEW meter, so the card opens it;
//  3. records the number now standing at the address (`execution.foundMeterNo`), which My Work Orders shows
//     under the number the batch was sent for, and keeps the number that was replaced beside it;
//  4. leaves the status alone. A Completed row stays Completed, and the Sales meter stays Completed and
//     VISIBLE (owner's decision, 2026-09-23): it was found, and the work was done.
//
// The work itself is already committed when this runs, so a failure here is never allowed to fail the
// worker's submission: it is logged for the office instead, exactly as TB-R063 does.
import { TARGETED_BATCH_COLLECTIONS } from "./helpers.js";

export const RULE = "TB-R066";

const text = (value) => String(value ?? "").trim();
const sameNumber = (a, b) =>
  text(a).replace(/\s+/g, "").toUpperCase() === text(b).replace(/\s+/g, "").toUpperCase();

// The field work a Sales record keeps for one batch, as the phone reads it
// (getTargetedBatchRowsCallable → fieldWorkMeterId).
function moveFieldWorkToNewMeter({ reference, newAstId, newMeterNo, replacedMeterNo, installationTrnId, at }) {
  const fieldWork = reference?.fieldWork || {};

  return {
    ...reference,
    fieldWork: {
      ...fieldWork,
      meterId: newAstId,
      trnId: installationTrnId || newAstId,
      discoveredMeterNo: newMeterNo || fieldWork.discoveredMeterNo || "",
      replacedMeterNo: replacedMeterNo || fieldWork.discoveredMeterNo || "",
      meterMatch: sameNumber(newMeterNo, fieldWork.targetedMeterNo),
      updatedAt: at,
    },
  };
}

async function settleRowForReplacement({
  db,
  rowId,
  salesId,
  replacedAstId,
  replacedMeterNo,
  newAstId,
  newMeterNo,
  installationTrnId,
  at,
}) {
  const rowRef = db.collection(TARGETED_BATCH_COLLECTIONS.rows).doc(rowId);
  const salesRef = salesId
    ? db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(salesId)
    : null;

  return db.runTransaction(async (tx) => {
    // Firestore wants every read before any write, so both documents are read
    // first and written afterwards.
    const rowSnap = await tx.get(rowRef);
    const salesSnap = salesRef ? await tx.get(salesRef) : null;

    if (!rowSnap.exists) return { rowId, decision: "SKIP", code: "ROW_MISSING" };

    const row = rowSnap.data() || {};

    // Already carried: a repeat writes nothing.
    if (text(row?.refs?.meterId) !== text(replacedAstId)) {
      return { rowId, decision: "SKIP", code: "ALREADY_CARRIED" };
    }

    tx.update(rowRef, {
      "refs.meterId": newAstId,
      "refs.trnId": installationTrnId || newAstId,
      "execution.foundMeterNo": newMeterNo || null,
      "execution.replacedMeterNo": replacedMeterNo || null,
      "metadata.updatedAt": at,
    });

    if (!salesSnap?.exists) return { rowId, decision: "RECORD", code: "ROW_ONLY" };

    const sales = salesSnap.data() || {};
    const tbRefs = Array.isArray(sales?.tbRefs) ? sales.tbRefs : [];
    let touched = false;

    const nextRefs = tbRefs.map((reference) => {
      const belongsHere =
        text(reference?.rowId) === text(rowId) ||
        text(reference?.fieldWork?.meterId) === text(replacedAstId);

      if (!belongsHere) return reference;

      touched = true;
      return moveFieldWorkToNewMeter({
        reference,
        newAstId,
        newMeterNo,
        replacedMeterNo,
        installationTrnId,
        at,
      });
    });

    if (touched) {
      tx.update(salesRef, {
        tbRefs: nextRefs,
        "metadata.updatedAt": at,
      });
    }

    return {
      rowId,
      salesId,
      decision: "RECORD",
      code: touched ? "ROW_AND_SALES" : "ROW_ONLY",
    };
  });
}

export async function recordReplacedMeter({
  db,
  replacedAstId,
  replacedMeterNo = "",
  newAstId,
  newMeterNo = "",
  installationTrnId = "",
  at = new Date().toISOString(),
  log = null,
}) {
  const results = [];

  try {
    const replaced = text(replacedAstId);
    const installed = text(newAstId);

    if (!replaced || !installed || replaced === installed) return results;

    const rows = await db
      .collection(TARGETED_BATCH_COLLECTIONS.rows)
      .where("refs.meterId", "==", replaced)
      .get();

    for (const rowDoc of rows.docs || []) {
      const row = rowDoc.data() || {};

      try {
        const result = await settleRowForReplacement({
          db,
          rowId: rowDoc.id,
          salesId: text(row?.salesAllMeterId),
          replacedAstId: replaced,
          replacedMeterNo: text(replacedMeterNo),
          newAstId: installed,
          newMeterNo: text(newMeterNo),
          installationTrnId: text(installationTrnId),
          at,
        });

        results.push(result);

        log?.info?.(`${RULE}: a replaced meter carried its batch row`, {
          rule: RULE,
          code: `TB_R066_${result.code}`,
          rowId: result.rowId,
          salesId: result.salesId ?? null,
          replacedMeterNo: text(replacedMeterNo),
          newMeterNo: text(newMeterNo),
        });
      } catch (error) {
        results.push({
          rowId: rowDoc.id,
          decision: "LOG",
          code: "TRANSACTION_FAILED",
          detail: error?.message || String(error),
        });

        log?.error?.(
          `${RULE}: a replaced meter could not carry its batch row, for the office`,
          {
            rule: RULE,
            code: "TB_R066_TRANSACTION_FAILED",
            rowId: rowDoc.id,
            replacedAstId: replaced,
            newAstId: installed,
            detail: error?.message || String(error),
          },
        );
      }
    }
  } catch (error) {
    log?.error?.(
      `${RULE}: a replaced meter could not be checked against the batches, for the office`,
      {
        rule: RULE,
        code: "TB_R066_CHECK_FAILED",
        replacedAstId: text(replacedAstId),
        newAstId: text(newAstId),
        detail: error?.message || String(error),
      },
    );
  }

  return results;
}
