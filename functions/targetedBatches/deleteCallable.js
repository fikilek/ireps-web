import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  TARGETED_BATCH_COLLECTIONS,
  buildFailureResult,
  buildSuccessResult,
  chunkArray,
  coerceTimestamp,
  getActorNameFromRequest,
  getSnapshotsInChunks,
  hasMatchingSalesTbRef,
  normalizeSalesId,
  normalizeUpper,
  resolveTargetedBatchCreateAuthority,
  safeArray,
  timestampsEqual,
} from "./helpers.js";

const DELETE_TRANSACTION_ROW_CHUNK = 180;
const DELETE_CLEANUP_WRITE_CHUNK = 400;
const TB_ID_PATTERN = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function getErrorCode(error) {
  return String(error?.code || "").trim() || "TARGETED_BATCH_DELETE_FAILED";
}

function getErrorMessage(error) {
  return (
    String(error?.message || "").trim() ||
    "Targeted Batch deletion failed"
  );
}

function getTbIdFromRequest(data = {}) {
  return normalizeUpper(data?.tbId || data?.id || data?.targetedBatchId);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function getParentExecutionEvidence(parent = {}) {
  const evidence = [];
  const executionStartedRows = Number(
    parent?.counts?.executionStartedRows || 0,
  );
  const completedRows = Number(parent?.counts?.completedRows || 0);
  const executionStatus = normalizeUpper(parent?.execution?.status);

  if (executionStartedRows > 0) {
    evidence.push(`counts.executionStartedRows=${executionStartedRows}`);
  }

  if (completedRows > 0) {
    evidence.push(`counts.completedRows=${completedRows}`);
  }

  if (executionStatus && executionStatus !== "NOT_STARTED") {
    evidence.push(`execution.status=${executionStatus}`);
  }

  if (hasValue(parent?.execution?.startedAt)) {
    evidence.push("execution.startedAt");
  }

  if (hasValue(parent?.execution?.completedAt)) {
    evidence.push("execution.completedAt");
  }

  return evidence;
}

function getRowExecutionEvidence(row = {}) {
  const evidence = [];
  const executionStatus = normalizeUpper(row?.execution?.status);

  if (executionStatus && executionStatus !== "NOT_STARTED") {
    evidence.push(`execution.status=${executionStatus}`);
  }

  if (hasValue(row?.execution?.startedAt)) {
    evidence.push("execution.startedAt");
  }

  if (hasValue(row?.execution?.completedAt)) {
    evidence.push("execution.completedAt");
  }

  if (hasValue(row?.execution?.outcome)) {
    evidence.push("execution.outcome");
  }

  return evidence;
}

function getSalesAllMeterId(row = {}) {
  return normalizeSalesId(
    row?.salesAllMeterId || row?.source?.recordId || row?.meter?.numberNormalized,
  );
}

function getMatchingTbRefs(salesData = {}, tbId) {
  return safeArray(salesData?.tbRefs).filter(
    (reference) => normalizeUpper(reference?.id) === tbId,
  );
}

function assertParentDeletable({ parent, tbId }) {
  const evidence = getParentExecutionEvidence(parent);

  if (evidence.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_ALREADY_STARTED",
      "This Targeted Batch cannot be deleted because execution has already started.",
      { tbId, evidence },
    );
  }
}

function assertRowsDeletable({ rowSnapshots, tbId }) {
  const blockedRows = rowSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({
      tbRowId: snapshot.id,
      evidence: getRowExecutionEvidence(snapshot.data() || {}),
    }))
    .filter((item) => item.evidence.length > 0);

  if (blockedRows.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_ROWS_EXECUTION_STARTED",
      "This Targeted Batch cannot be deleted because one or more TB Rows have entered execution.",
      {
        tbId,
        blockedCount: blockedRows.length,
        blockedRows: blockedRows.slice(0, 20),
      },
    );
  }
}

function assertSalesReferenceCompatible({
  salesSnapshot,
  salesAllMeterId,
  tbId,
  creationDate,
}) {
  if (!salesSnapshot?.exists) {
    throw controlledError(
      "TARGETED_BATCH_SALES_SOURCE_MISSING",
      `Sales source ${salesAllMeterId} was not found while deleting ${tbId}.`,
    );
  }

  const salesData = salesSnapshot.data() || {};

  if (salesData?.tbRefs !== undefined && !Array.isArray(salesData.tbRefs)) {
    throw controlledError(
      "INVALID_SALES_TB_REFS",
      `Sales source ${salesAllMeterId} has an invalid tbRefs field.`,
    );
  }

  const matchingReferences = getMatchingTbRefs(salesData, tbId);

  if (matchingReferences.length > 1) {
    throw controlledError(
      "DUPLICATE_SALES_TB_REFERENCE",
      `Sales source ${salesAllMeterId} contains duplicate references to ${tbId}.`,
    );
  }

  if (matchingReferences.length === 0) {
    throw controlledError(
      "SALES_TB_REFERENCE_MISSING",
      `Sales source ${salesAllMeterId} does not contain the expected ${tbId} reference.`,
    );
  }

  if (!timestampsEqual(matchingReferences[0]?.date, creationDate)) {
    throw controlledError(
      "SALES_TB_REFERENCE_DATE_CONFLICT",
      `Sales source ${salesAllMeterId} has a conflicting reference date for ${tbId}.`,
    );
  }
}

async function getExactLinkedSalesDocs({ db, tbId, creationDate }) {
  const salesTbRef = {
    id: tbId,
    date: creationDate,
  };

  const snapshot = await db
    .collection(TARGETED_BATCH_COLLECTIONS.sales)
    .where("tbRefs", "array-contains", salesTbRef)
    .get();

  return snapshot.docs;
}

async function cleanRemainingSalesReferences({ db, tbId, creationDate }) {
  const salesTbRef = {
    id: tbId,
    date: creationDate,
  };
  const linkedSalesDocs = await getExactLinkedSalesDocs({
    db,
    tbId,
    creationDate,
  });
  let processed = 0;

  for (const [chunkIndex, chunk] of chunkArray(
    linkedSalesDocs,
    DELETE_CLEANUP_WRITE_CHUNK,
  ).entries()) {
    if (chunk.length === 0) continue;

    const batch = db.batch();

    chunk.forEach((salesDoc) => {
      batch.update(salesDoc.ref, {
        tbRefs: FieldValue.arrayRemove(salesTbRef),
      });
    });

    await batch.commit();
    processed += chunk.length;

    logger.info("onDeleteTargetedBatchCallable -- SALES CLEANUP PROGRESS", {
      tbId,
      chunk: chunkIndex + 1,
      chunks: Math.ceil(
        linkedSalesDocs.length / DELETE_CLEANUP_WRITE_CHUNK,
      ),
      processed,
      total: linkedSalesDocs.length,
    });
  }

  return processed;
}

export const onDeleteTargetedBatchCallable = onCall(async (request) => {
  const startedAtMs = Date.now();
  const db = getFirestore();
  const actorUid = request?.auth?.uid || null;
  let actorName = actorUid || "SYSTEM";
  let tbId = null;

  try {
    if (!actorUid) {
      return buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required to delete a Targeted Batch.",
      );
    }

    const authority = await resolveTargetedBatchCreateAuthority({ db, request });
    actorName = getActorNameFromRequest(request, authority.profile);

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_TARGETED_BATCH_DELETE",
        "Only MNG and SPV(MNC) users may delete Targeted Batches.",
        {
          actorRole: authority.role,
          actorRelationshipType: authority.relationshipType,
          actorClientType: authority.clientType,
        },
      );
    }

    tbId = getTbIdFromRequest(request?.data || {});

    if (!TB_ID_PATTERN.test(tbId)) {
      return buildFailureResult(
        "INVALID_TARGETED_BATCH_ID",
        "tbId must follow TGB_YYYYMMDD_HHMMSS_XXXX.",
      );
    }

    const parentRef = db
      .collection(TARGETED_BATCH_COLLECTIONS.uploads)
      .doc(tbId);
    const parentSnapshot = await parentRef.get();

    if (!parentSnapshot.exists) {
      return buildFailureResult(
        "TARGETED_BATCH_NOT_FOUND",
        `Targeted Batch ${tbId} was not found.`,
        { tbId },
      );
    }

    const parent = parentSnapshot.data() || {};
    const creationDate = coerceTimestamp(parent?.metadata?.createdAt);

    if (!creationDate) {
      return buildFailureResult(
        "TARGETED_BATCH_CREATION_DATE_MISSING",
        `Targeted Batch ${tbId} has no valid backend creation date.`,
        { tbId },
      );
    }

    assertParentDeletable({ parent, tbId });

    logger.info("onDeleteTargetedBatchCallable -- START", {
      tbId,
      actorUid,
      actorName,
      expectedRows: Number(
        parent?.creation?.expectedRows || parent?.counts?.totalRows || 0,
      ),
    });

    const rowsSnapshot = await db
      .collection(TARGETED_BATCH_COLLECTIONS.rows)
      .where("tbId", "==", tbId)
      .get();
    const rowDocs = rowsSnapshot.docs;

    assertRowsDeletable({ rowSnapshots: rowDocs, tbId });

    const salesIds = [
      ...new Set(
        rowDocs
          .map((rowDoc) => getSalesAllMeterId(rowDoc.data() || {}))
          .filter(Boolean),
      ),
    ];

    if (salesIds.length !== rowDocs.length) {
      throw controlledError(
        "TARGETED_BATCH_ROW_SALES_MAPPING_INVALID",
        "Every permanent TB Row must have one unique Sales source ID before deletion.",
        {
          tbId,
          rowCount: rowDocs.length,
          uniqueSalesIds: salesIds.length,
        },
      );
    }

    const salesRefs = salesIds.map((salesAllMeterId) =>
      db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(salesAllMeterId),
    );
    const salesSnapshots = await getSnapshotsInChunks({
      db,
      refs: salesRefs,
    });

    salesSnapshots.forEach((salesSnapshot, index) => {
      assertSalesReferenceCompatible({
        salesSnapshot,
        salesAllMeterId: salesIds[index],
        tbId,
        creationDate,
      });
    });

    logger.info("onDeleteTargetedBatchCallable -- PREFLIGHT PASSED", {
      tbId,
      permanentRows: rowDocs.length,
      linkedSalesRecords: salesSnapshots.length,
    });

    const rowChunks = chunkArray(rowDocs, DELETE_TRANSACTION_ROW_CHUNK);
    let deletedRows = 0;
    let unlinkedSalesRecords = 0;
    const salesTbRef = {
      id: tbId,
      date: creationDate,
    };

    for (const [chunkIndex, rowChunk] of rowChunks.entries()) {
      const chunkSalesIds = rowChunk.map((rowDoc) =>
        getSalesAllMeterId(rowDoc.data() || {}),
      );
      const chunkSalesRefs = chunkSalesIds.map((salesAllMeterId) =>
        db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(salesAllMeterId),
      );

      const result = await db.runTransaction(async (transaction) => {
        const latestParentSnapshot = await transaction.get(parentRef);
        const latestRowSnapshots = await transaction.getAll(
          ...rowChunk.map((rowDoc) => rowDoc.ref),
        );
        const latestSalesSnapshots = await transaction.getAll(
          ...chunkSalesRefs,
        );

        if (!latestParentSnapshot.exists) {
          throw controlledError(
            "TARGETED_BATCH_PARENT_MISSING",
            `Targeted Batch ${tbId} disappeared during deletion.`,
          );
        }

        assertParentDeletable({
          parent: latestParentSnapshot.data() || {},
          tbId,
        });
        assertRowsDeletable({
          rowSnapshots: latestRowSnapshots,
          tbId,
        });

        latestSalesSnapshots.forEach((salesSnapshot, index) => {
          assertSalesReferenceCompatible({
            salesSnapshot,
            salesAllMeterId: chunkSalesIds[index],
            tbId,
            creationDate,
          });
        });

        latestSalesSnapshots.forEach((salesSnapshot) => {
          transaction.update(salesSnapshot.ref, {
            tbRefs: FieldValue.arrayRemove(salesTbRef),
          });
        });

        latestRowSnapshots
          .filter((rowSnapshot) => rowSnapshot.exists)
          .forEach((rowSnapshot) => transaction.delete(rowSnapshot.ref));

        return {
          deletedRows: latestRowSnapshots.filter((snapshot) => snapshot.exists)
            .length,
          unlinkedSalesRecords: latestSalesSnapshots.length,
        };
      });

      deletedRows += result.deletedRows;
      unlinkedSalesRecords += result.unlinkedSalesRecords;

      logger.info("onDeleteTargetedBatchCallable -- DELETE PROGRESS", {
        tbId,
        chunk: chunkIndex + 1,
        chunks: rowChunks.length,
        deletedRows,
        totalRows: rowDocs.length,
        unlinkedSalesRecords,
      });
    }

    const cleanedOrphanSalesReferences = await cleanRemainingSalesReferences({
      db,
      tbId,
      creationDate,
    });

    const [remainingRowsSnapshot, remainingSalesDocs] = await Promise.all([
      db
        .collection(TARGETED_BATCH_COLLECTIONS.rows)
        .where("tbId", "==", tbId)
        .get(),
      getExactLinkedSalesDocs({ db, tbId, creationDate }),
    ]);

    if (!remainingRowsSnapshot.empty || remainingSalesDocs.length > 0) {
      throw controlledError(
        "TARGETED_BATCH_DELETE_VERIFICATION_FAILED",
        "Targeted Batch deletion verification found remaining rows or Sales references.",
        {
          tbId,
          remainingRows: remainingRowsSnapshot.size,
          remainingSalesReferences: remainingSalesDocs.length,
        },
      );
    }

    await db.runTransaction(async (transaction) => {
      const latestParentSnapshot = await transaction.get(parentRef);

      if (!latestParentSnapshot.exists) return;

      assertParentDeletable({
        parent: latestParentSnapshot.data() || {},
        tbId,
      });

      transaction.delete(parentRef);
    });

    const elapsedMs = Date.now() - startedAtMs;

    logger.info("onDeleteTargetedBatchCallable -- SUCCESS", {
      tbId,
      deletedRows,
      unlinkedSalesRecords,
      cleanedOrphanSalesReferences,
      actorUid,
      actorName,
      elapsedMs,
    });

    return buildSuccessResult("Targeted Batch deleted successfully", {
      code: "TARGETED_BATCH_DELETED",
      tbId,
      deletedRows,
      unlinkedSalesRecords,
      cleanedOrphanSalesReferences,
      elapsedMs,
    });
  } catch (error) {
    const code = getErrorCode(error);
    const message = getErrorMessage(error);

    logger.error("onDeleteTargetedBatchCallable -- FAILED", {
      tbId,
      code,
      message,
      details: error?.details || null,
      actorUid,
      actorName,
      elapsedMs: Date.now() - startedAtMs,
    });

    return buildFailureResult(code, message, {
      tbId,
      details: error?.details || null,
      elapsedMs: Date.now() - startedAtMs,
    });
  }
});
