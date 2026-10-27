import { calculateTbQaStatus } from "./premiseQaReview.js";

const cleanText = (value) => String(value ?? "").trim();

/**
 * Projects a Meter TRN's QA status to any linked tb_rows documents.
 * Can be called inside a Firestore transaction.
 */
export async function projectMeterQaToTbRows(tx, db, trnId, trn, qaState, reviewerDetails = {}) {
  const cleanTrnId = cleanText(trnId);
  if (!cleanTrnId) return { projectedCount: 0 };

  const rowDocsMap = new Map();

  // 1. Check targetedBatchContext.rowId if present
  const directRowId = cleanText(trn?.targetedBatchContext?.rowId);
  if (directRowId) {
    const directDoc = await tx.get(db.doc(`tb_rows/${directRowId}`));
    if (directDoc.exists) {
      rowDocsMap.set(directDoc.id, directDoc);
    }
  }

  // 2. Query tb_rows where refs.meterId == trnId
  const meterRowsSnap = await tx.get(
    db.collection("tb_rows").where("refs.meterId", "==", cleanTrnId)
  );
  meterRowsSnap.docs.forEach((doc) => rowDocsMap.set(doc.id, doc));

  // 3. Query tb_rows where refs.trnId == trnId
  const trnRowsSnap = await tx.get(
    db.collection("tb_rows").where("refs.trnId", "==", cleanTrnId)
  );
  trnRowsSnap.docs.forEach((doc) => rowDocsMap.set(doc.id, doc));

  if (rowDocsMap.size === 0) {
    return { projectedCount: 0 };
  }

  const nowIso = new Date().toISOString();
  const normQaState = String(qaState || "QA_PENDING").trim().toUpperCase().replace(/ /g, "_");

  for (const [rowId, rowDoc] of rowDocsMap.entries()) {
    const row = rowDoc.data() || {};
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
      "metadata.updatedAt": nowIso,
      "metadata.updatedByUid": reviewerDetails.reviewedByUid || "SYSTEM",
      "metadata.updatedByUser": reviewerDetails.reviewedByUser || "SYSTEM",
    };

    tx.update(rowDoc.ref, updateData);
  }

  return { projectedCount: rowDocsMap.size };
}
