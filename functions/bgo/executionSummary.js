import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";

import { BGO_COLLECTIONS, normalizeUpper } from "./helpers.js";

/* =====================================================
   BGO DERIVED EXECUTION SUMMARY
   -----------------------------------------------------
   DATA CONTRACT:
   - trns is the execution source of truth.
   - bgo_batches owns BGO bucket/control state.
   - bgo_batches.derivedExecutionSummary is a backend-maintained mirror
     recalculated from child TRNs.
   - tc_uploads/tc_rows must not be used as live execution truth.
===================================================== */

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function normalizeOutcome(value) {
  return normalizeUpper(value || "NAv");
}

function hasExecutionOutcome(trnData = {}) {
  if (!trnData?.executionOutcome) return false;
  if (typeof trnData.executionOutcome !== "object") return true;
  return Object.keys(trnData.executionOutcome).length > 0;
}

function getExecutionOutcomeCode(trnData = {}) {
  return normalizeOutcome(
    trnData?.executionOutcome?.outcome ||
      trnData?.executionOutcome?.code ||
      trnData?.executionOutcomeCode ||
      trnData?.outcome,
  );
}

function getWorkflowState(trnData = {}) {
  return normalizeUpper(trnData?.workflow?.state || trnData?.workflowState || "");
}

export function getBgoBatchIdFromTrn(trnData = {}) {
  return readFirstString(
    trnData?.bgo?.batchId,
    trnData?.bgo?.bgoBatchId,
    trnData?.refs?.bgoBatchId,
    trnData?.refs?.batchId,
    trnData?.bucket?.batchId,
    trnData?.origin?.bgoBatchId,
  );
}

function getExecutionSignature(trnData = {}) {
  if (!trnData) return "NO_TRN";

  return JSON.stringify({
    batchId: getBgoBatchIdFromTrn(trnData),
    workflowState: trnData?.workflow?.state || null,
    executionStartedAt: trnData?.workflow?.executionStartedAt || null,
    completedAt: trnData?.workflow?.completedAt || null,
    completedByUid: trnData?.workflow?.completedByUid || null,
    completedByUser: trnData?.workflow?.completedByUser || null,
    cancelledAt: trnData?.workflow?.cancelledAt || null,
    rejectedAt: trnData?.workflow?.rejectedAt || null,
    executionOutcome: trnData?.executionOutcome || null,
  });
}

export function hasBgoExecutionSummaryRelevantChange({
  beforeData = null,
  afterData = null,
} = {}) {
  return getExecutionSignature(beforeData) !== getExecutionSignature(afterData);
}

async function getBgoChildTrnSnapsForSummary({ db, batchId }) {
  const trnsRef = db.collection(BGO_COLLECTIONS.trns);
  const queries = [
    trnsRef.where("bgo.batchId", "==", batchId),
    trnsRef.where("bgo.bgoBatchId", "==", batchId),
    trnsRef.where("refs.bgoBatchId", "==", batchId),
    trnsRef.where("refs.batchId", "==", batchId),
    trnsRef.where("bucket.batchId", "==", batchId),
  ];

  const docsByPath = new Map();

  for (const trnQuery of queries) {
    const snapshot = await trnQuery.get();

    snapshot.docs.forEach((doc) => {
      docsByPath.set(doc.ref.path, doc);
    });
  }

  return Array.from(docsByPath.values());
}

function buildDerivedExecutionSummary({ childSnaps = [], now }) {
  const counts = {
    totalChildTrns: childSnaps.length,
    totalNotExecuted: 0,
    totalAccepted: 0,
    totalInProgress: 0,
    totalCompleted: 0,
    totalSuccess: 0,
    totalNoAccess: 0,
    totalNoReading: 0,
    totalCancelled: 0,
    totalRejected: 0,
  };

  childSnaps.forEach((childSnap) => {
    const trnData = childSnap.data() || {};
    const workflowState = getWorkflowState(trnData);
    const outcomeCode = getExecutionOutcomeCode(trnData);
    const completed =
      workflowState === "COMPLETED" ||
      Boolean(trnData?.workflow?.completedAt) ||
      hasExecutionOutcome(trnData);
    const cancelled = workflowState === "CANCELLED" || workflowState === "CANCELED";
    const rejected = workflowState === "REJECTED";

    if (workflowState === "ACCEPTED") counts.totalAccepted += 1;
    if (workflowState === "IN_PROGRESS") counts.totalInProgress += 1;
    if (completed) counts.totalCompleted += 1;
    if (cancelled) counts.totalCancelled += 1;
    if (rejected) counts.totalRejected += 1;

    if (completed) {
      if (trnData?.executionOutcome?.success === true || outcomeCode === "SUCCESS") {
        counts.totalSuccess += 1;
      }

      if (outcomeCode === "NO_ACCESS") {
        counts.totalNoAccess += 1;
      }

      if (outcomeCode === "NO_READING") {
        counts.totalNoReading += 1;
      }
    }
  });

  counts.totalNotExecuted = Math.max(
    counts.totalChildTrns -
      counts.totalCompleted -
      counts.totalCancelled -
      counts.totalRejected,
    0,
  );

  return {
    sourceCollection: BGO_COLLECTIONS.trns,
    sourceField: "bgo.batchId",
    derivedAt: now,
    ...counts,
  };
}

export async function refreshBgoBatchDerivedExecutionSummary({
  db,
  batchId,
  now = new Date().toISOString(),
  reason = "BGO_DERIVED_EXECUTION_SUMMARY_REFRESH",
} = {}) {
  const cleanBatchId = String(batchId || "").trim();

  if (!cleanBatchId) {
    return {
      updated: false,
      batchId: "NAv",
      reason: "MISSING_BATCH_ID",
    };
  }

  const batchRef = db.collection(BGO_COLLECTIONS.batches).doc(cleanBatchId);
  const batchSnap = await batchRef.get();

  if (!batchSnap.exists) {
    logger.warn("refreshBgoBatchDerivedExecutionSummary -- batch missing", {
      batchId: cleanBatchId,
      reason,
    });

    return {
      updated: false,
      batchId: cleanBatchId,
      reason: "BGO_BATCH_NOT_FOUND",
    };
  }

  const childSnaps = await getBgoChildTrnSnapsForSummary({
    db,
    batchId: cleanBatchId,
  });

  const derivedExecutionSummary = buildDerivedExecutionSummary({
    childSnaps,
    now,
  });

  await batchRef.update({
    // Remove the ambiguous/current-design summary map whenever the batch is touched
    // by the new data contract. batchReleaseSummary + derivedExecutionSummary are
    // now the truthful named fields.
    summary: FieldValue.delete(),
    derivedExecutionSummary,
  });

  logger.info("refreshBgoBatchDerivedExecutionSummary -- updated", {
    batchId: cleanBatchId,
    reason,
    ...derivedExecutionSummary,
  });

  return {
    updated: true,
    batchId: cleanBatchId,
    childTrnCount: childSnaps.length,
    derivedExecutionSummary,
  };
}

export async function refreshBgoBatchDerivedExecutionSummaries({
  db,
  batchIds = [],
  now = new Date().toISOString(),
  reason = "BGO_DERIVED_EXECUTION_SUMMARY_REFRESH",
} = {}) {
  const cleanBatchIds = Array.from(
    new Set(batchIds.map((batchId) => String(batchId || "").trim()).filter(Boolean)),
  );

  const results = [];

  for (const batchId of cleanBatchIds) {
    results.push(
      await refreshBgoBatchDerivedExecutionSummary({
        db,
        batchId,
        now,
        reason,
      }),
    );
  }

  return {
    refreshedBatchCount: results.filter((result) => result?.updated).length,
    results,
  };
}
