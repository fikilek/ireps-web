import { calculateTbQaStatus } from "./premiseQaReview.js";

const cleanText = (value) => String(value ?? "").trim();

/**
 * Reads all linked tb_rows for a Meter TRN BEFORE any transaction writes.
 * Must be called in the READ phase of the Firestore transaction.
 */
export async function readMeterQaTbRowPlan(tx, db, trnId, trn) {
  const cleanTrnId = cleanText(trnId);
  if (!cleanTrnId) return { rows: [] };

  const rowDocsMap = new Map();

  // 1. Check targetedBatchContext.rowId if present
  const directRowId = cleanText(trn?.targetedBatchContext?.rowId);
  if (directRowId) {
    const directDoc = await tx.get(db.doc(`tb_rows/${directRowId}`));
    if (directDoc.exists) {
      rowDocsMap.set(directDoc.id, { ref: directDoc.ref, data: directDoc.data() || {} });
    }
  }

  // 2. Query tb_rows where refs.meterId == trnId
  const meterRowsSnap = await tx.get(
    db.collection("tb_rows").where("refs.meterId", "==", cleanTrnId)
  );
  meterRowsSnap.docs.forEach((doc) =>
    rowDocsMap.set(doc.id, { ref: doc.ref, data: doc.data() || {} })
  );

  // 3. Query tb_rows where refs.trnId == trnId
  const trnRowsSnap = await tx.get(
    db.collection("tb_rows").where("refs.trnId", "==", cleanTrnId)
  );
  trnRowsSnap.docs.forEach((doc) =>
    rowDocsMap.set(doc.id, { ref: doc.ref, data: doc.data() || {} })
  );

  return { rows: Array.from(rowDocsMap.values()) };
}

/**
 * Applies QA status updates to tb_rows planned during the read phase.
 * Called in the WRITE phase of the Firestore transaction.
 */
export function applyMeterQaTbRowWrites(tx, plan, qaState, reviewerDetails = {}) {
  if (!plan?.rows || plan.rows.length === 0) return { projectedCount: 0 };

  const nowIso = new Date().toISOString();
  const normQaState = String(qaState || "QA_PENDING").trim().toUpperCase().replace(/ /g, "_");

  for (const { ref, data: row } of plan.rows) {
    const calculatedTbStatus = calculateTbQaStatus(
      row.qa?.premiseStatus,
      normQaState,
      row.execution?.status
    );

    const updateData = {
      "qa.meterStatus": normQaState,
      "qa.meterReviewedAt": reviewerDetails.reviewedAt || nowIso,
      "qa.meterReviewedByUser": reviewerDetails.reviewedByUser || null,
      "qa.meterReasonCode": reviewerDetails.reasonCode || null,
      "qa.meterReasonLabel": reviewerDetails.reasonLabel || null,
      "qa.tbStatus": calculatedTbStatus,
      "qa.finalStatus": calculatedTbStatus,
      qaFinalStatus: calculatedTbStatus,
      "metadata.updatedAt": nowIso,
      "metadata.updatedByUid": reviewerDetails.reviewedByUid || "SYSTEM",
      "metadata.updatedByUser": reviewerDetails.reviewedByUser || "SYSTEM",
    };

    tx.update(ref, updateData);
  }

  return { projectedCount: plan.rows.length };
}

/**
 * Convenience composite function for non-transactional contexts or when
 * caller has not yet performed writes.
 */
export async function projectMeterQaToTbRows(tx, db, trnId, trn, qaState, reviewerDetails = {}) {
  const plan = await readMeterQaTbRowPlan(tx, db, trnId, trn);
  return applyMeterQaTbRowWrites(tx, plan, qaState, reviewerDetails);
}
