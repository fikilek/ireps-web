import { calculateTbQaStatus } from "./premiseQaReview.js";

const cleanText = (value) => String(value ?? "").trim();

/**
 * Reads all linked tb_rows for a Meter TRN and their parent batches BEFORE any transaction writes.
 * Must be called in the READ phase of the Firestore transaction.
 */
export async function readMeterQaTbRowPlan(tx, db, trnId, trn) {
  const cleanTrnId = cleanText(trnId);
  if (!cleanTrnId) return { rows: [], batchPlans: [] };

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

  const rows = Array.from(rowDocsMap.values());
  if (rows.length === 0) {
    return { rows: [], batchPlans: [] };
  }

  // Collect unique tbIds to read parent batch docs and all sibling rows in the READ phase
  const uniqueTbIds = [
    ...new Set(
      rows
        .map((r) => cleanText(r.data?.tbId))
        .filter(Boolean)
    ),
  ];

  const batchPlans = await Promise.all(
    uniqueTbIds.map(async (tbId) => {
      const parentRef = db.doc(`tb_uploads/${tbId}`);
      const [parentSnap, tbRowsSnap] = await Promise.all([
        tx.get(parentRef),
        tx.get(db.collection("tb_rows").where("tbId", "==", tbId)),
      ]);
      return {
        tbId,
        parentRef: parentSnap.exists ? parentRef : null,
        tbRows: tbRowsSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
      };
    })
  );

  return { rows, batchPlans };
}

/**
 * Applies QA status updates to tb_rows planned during the read phase
 * and updates parent batch qaPassRows and qaFailRows counts.
 * Called in the WRITE phase of the Firestore transaction.
 */
export function applyMeterQaTbRowWrites(tx, plan, qaState, reviewerDetails = {}) {
  if (!plan?.rows || plan.rows.length === 0) return { projectedCount: 0 };

  const nowIso = new Date().toISOString();
  const normQaState = String(qaState || "QA_PENDING").trim().toUpperCase().replace(/ /g, "_");

  const updatedRowIds = new Set();
  const calculatedTbStatusByRowId = new Map();

  for (const { ref, data: row } of plan.rows) {
    const rowId = ref.id;
    updatedRowIds.add(rowId);

    const calculatedTbStatus = calculateTbQaStatus(
      row.qa?.premiseStatus,
      normQaState,
      row.execution?.status
    );
    calculatedTbStatusByRowId.set(rowId, calculatedTbStatus);

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

  // Update parent batches' qaPassRows and qaFailRows counts
  if (Array.isArray(plan.batchPlans)) {
    const norm = (s) => String(s || "").trim().toUpperCase().replace(/ /g, "_");

    for (const batchPlan of plan.batchPlans) {
      if (!batchPlan.parentRef || !Array.isArray(batchPlan.tbRows)) continue;

      let qaPassRows = 0;
      let qaFailRows = 0;

      for (const r of batchPlan.tbRows) {
        const isThisRow = updatedRowIds.has(r.id);
        const pStatus = norm(r.qa?.premiseStatus);
        const mStatus = norm(isThisRow ? normQaState : r.qa?.meterStatus);
        const execStatus = norm(r.execution?.status);
        const tbStatus = norm(
          isThisRow
            ? calculatedTbStatusByRowId.get(r.id)
            : (r.qa?.tbStatus || calculateTbQaStatus(pStatus, mStatus, execStatus))
        );

        if (tbStatus === "QA_FAIL" || pStatus === "QA_FAIL" || mStatus === "QA_FAIL") {
          qaFailRows += 1;
        } else if (execStatus === "COMPLETED") {
          if (tbStatus === "QA_PASS" || (pStatus === "QA_PASS" && mStatus === "QA_PASS")) {
            qaPassRows += 1;
          }
        }
      }

      tx.update(batchPlan.parentRef, {
        "counts.qaPassRows": qaPassRows,
        "counts.qaFailRows": qaFailRows,
        "metadata.updatedAt": nowIso,
      });
    }
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

