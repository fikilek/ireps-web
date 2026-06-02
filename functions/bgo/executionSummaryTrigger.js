import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  getBgoBatchIdFromTrn,
  hasBgoExecutionSummaryRelevantChange,
  refreshBgoBatchDerivedExecutionSummary,
} from "./executionSummary.js";

/* =====================================================
   BGO CHILD TRN EXECUTION SUMMARY TRIGGER
   -----------------------------------------------------
   DATA CONTRACT:
   - trns owns live execution state.
   - this trigger mirrors execution counts into
     bgo_batches.derivedExecutionSummary.
   - it does not write execution counts into tc_uploads or tc_rows.
===================================================== */

export const onBgoChildTrnExecutionSummaryWritten = onDocumentWritten(
  "trns/{trnId}",
  async (event) => {
    const beforeSnap = event.data?.before || null;
    const afterSnap = event.data?.after || null;
    const beforeData = beforeSnap?.exists ? beforeSnap.data() || {} : null;
    const afterData = afterSnap?.exists ? afterSnap.data() || {} : null;

    const batchIds = Array.from(
      new Set(
        [getBgoBatchIdFromTrn(beforeData || {}), getBgoBatchIdFromTrn(afterData || {})]
          .map((batchId) => String(batchId || "").trim())
          .filter(Boolean),
      ),
    );

    if (batchIds.length === 0) return null;

    if (
      !hasBgoExecutionSummaryRelevantChange({
        beforeData,
        afterData,
      })
    ) {
      return null;
    }

    const db = getFirestore();
    const now = new Date().toISOString();

    for (const batchId of batchIds) {
      await refreshBgoBatchDerivedExecutionSummary({
        db,
        batchId,
        now,
        reason: "BGO_CHILD_TRN_WRITTEN",
      });
    }

    logger.info("onBgoChildTrnExecutionSummaryWritten -- refreshed", {
      trnId: event.params?.trnId || "NAv",
      batchIds,
    });

    return null;
  },
);
