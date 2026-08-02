import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";

import {
  TARGETED_BATCH_COLLECTIONS,
  TARGETED_BATCH_CREATION_STATES,
  buildCreationFingerprint,
  buildFailureResult,
  buildSuccessResult,
  buildTbRowId,
  chunkArray,
  coerceTimestamp,
  getActorNameFromRequest,
  getSnapshotsInChunks,
  hasMatchingSalesTbRef,
  resolveTargetedBatchCreateAuthority,
  timestampToIso,
  timestampsEqual,
  validateAuthoritativeSalesDocument,
  validateCreateTargetedBatchPayload,
  validateExistingTbRow,
} from "./helpers.js";

import {
  buildCreationFailurePatch,
  buildCreationReadyPatch,
  buildCreationRetryPatch,
  buildSalesTbRef,
  buildTargetedBatchParentDoc,
  buildTargetedBatchRowDoc,
} from "./documentFactory.js";

const ROWS_PER_WRITE_CHUNK = 190;

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function getErrorCode(error) {
  const value = String(error?.code || "").trim();
  return value || "TARGETED_BATCH_CREATE_FAILED";
}

function getErrorMessage(error) {
  return (
    String(error?.message || "").trim() ||
    "Targeted Batch creation failed"
  );
}

function validateExistingParent({ parentData, payload, fingerprint }) {
  if (!parentData) {
    return {
      exists: false,
      state: null,
      creationDate: null,
    };
  }

  if (String(parentData?.id || "").trim().toUpperCase() !== payload.tbId) {
    throw controlledError(
      "TARGETED_BATCH_PARENT_CONFLICT",
      "The existing Targeted Batch parent has a conflicting identity.",
    );
  }

  if (parentData?.creation?.fingerprint !== fingerprint) {
    throw controlledError(
      "TARGETED_BATCH_FINGERPRINT_CONFLICT",
      "The existing Targeted Batch ID belongs to a different source-record mapping.",
    );
  }

  if (Number(parentData?.creation?.expectedRows) !== payload.expectedRows) {
    throw controlledError(
      "TARGETED_BATCH_ROW_COUNT_CONFLICT",
      "The existing Targeted Batch has a different expected row count.",
    );
  }

  if (parentData?.scope?.lmPcode !== payload.scope.lmPcode) {
    throw controlledError(
      "TARGETED_BATCH_LM_SCOPE_CONFLICT",
      "The existing Targeted Batch belongs to a different Local Municipality.",
    );
  }

  const state = String(parentData?.creation?.state || "").toUpperCase();
  const supportedStates = Object.values(TARGETED_BATCH_CREATION_STATES);

  if (!supportedStates.includes(state)) {
    throw controlledError(
      "TARGETED_BATCH_CREATION_STATE_CONFLICT",
      "The existing Targeted Batch has an unsupported creation state.",
    );
  }

  const creationDate = coerceTimestamp(parentData?.metadata?.createdAt);

  if (!creationDate) {
    throw controlledError(
      "TARGETED_BATCH_CREATION_DATE_MISSING",
      "The existing Targeted Batch has no valid backend creation date.",
    );
  }

  return {
    exists: true,
    state,
    creationDate,
  };
}

async function ensureParentCreationState({
  db,
  parentRef,
  payload,
  fingerprint,
  proposedCreationDate,
  actorUid,
  actorName,
}) {
  return db.runTransaction(async (transaction) => {
    const parentSnapshot = await transaction.get(parentRef);

    if (!parentSnapshot.exists) {
      const parentDoc = buildTargetedBatchParentDoc({
        payload,
        fingerprint,
        creationDate: proposedCreationDate,
        actorUid,
        actorName,
      });

      transaction.create(parentRef, parentDoc);

      return {
        created: true,
        alreadyReady: false,
        creationDate: proposedCreationDate,
      };
    }

    const existing = validateExistingParent({
      parentData: parentSnapshot.data() || {},
      payload,
      fingerprint,
    });

    if (existing.state === TARGETED_BATCH_CREATION_STATES.ready) {
      return {
        created: false,
        alreadyReady: true,
        creationDate: existing.creationDate,
      };
    }

    transaction.update(
      parentRef,
      buildCreationRetryPatch({
        startedAt: Timestamp.now(),
        actorUid,
        actorName,
      }),
    );

    return {
      created: false,
      alreadyReady: false,
      creationDate: existing.creationDate,
    };
  });
}

async function markCreationFailed({
  db,
  parentRef,
  fingerprint,
  error,
  actorUid,
  actorName,
}) {
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(parentRef);
      if (!snapshot.exists) return;

      const data = snapshot.data() || {};
      if (data?.creation?.fingerprint !== fingerprint) return;
      if (data?.creation?.state === TARGETED_BATCH_CREATION_STATES.ready) return;

      transaction.update(
        parentRef,
        buildCreationFailurePatch({
          failedAt: Timestamp.now(),
          code: getErrorCode(error),
          message: getErrorMessage(error),
          actorUid,
          actorName,
        }),
      );
    });
  } catch (markError) {
    logger.error("onCreateTargetedBatchCallable -- FAILURE STATE UPDATE FAILED", {
      tbId: parentRef.id,
      message: markError?.message || String(markError),
    });
  }
}

function assertExistingSalesReferencesCompatible({
  salesRecords,
  tbId,
  parentExists,
  creationDate,
}) {
  salesRecords.forEach((record) => {
    const matchingReferences = (record.salesSource?.tbRefs || []).filter(
      (reference) =>
        String(reference?.id || "").trim().toUpperCase() === tbId,
    );

    if (matchingReferences.length > 1) {
      throw controlledError(
        "DUPLICATE_SALES_TB_REFERENCE",
        `Sales source ${record.salesAllMeterId} contains duplicate references to ${tbId}.`,
      );
    }

    if (!parentExists && matchingReferences.length > 0) {
      throw controlledError(
        "ORPHAN_SALES_TB_REFERENCE",
        `Sales source ${record.salesAllMeterId} references ${tbId} without its parent batch.`,
      );
    }

    if (
      parentExists &&
      matchingReferences.length === 1 &&
      !timestampsEqual(matchingReferences[0]?.date, creationDate)
    ) {
      throw controlledError(
        "SALES_TB_REFERENCE_DATE_CONFLICT",
        `Sales source ${record.salesAllMeterId} has a conflicting date for ${tbId}.`,
      );
    }
  });
}

function assertExistingRowsCompatible({
  existingRowSnapshots,
  expectedRows,
  salesAllMeterIds,
  creationDate,
  parentExists,
}) {
  const existingById = new Map(
    existingRowSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot]),
  );

  if (!parentExists && existingById.size > 0) {
    throw controlledError(
      "TARGETED_BATCH_ORPHAN_ROW_CONFLICT",
      "Permanent TB Rows already exist without the expected Targeted Batch parent.",
      { existingRows: [...existingById.keys()].slice(0, 20) },
    );
  }

  expectedRows.forEach((expectedRow, index) => {
    const existingSnapshot = existingById.get(expectedRow.id);
    if (!existingSnapshot) return;

    const existingData = existingSnapshot.data() || {};
    const mappingMatches = validateExistingTbRow({
      existing: existingData,
      expectedRow,
      expectedSalesId: salesAllMeterIds[index],
    });

    if (!mappingMatches) {
      throw controlledError(
        "TARGETED_BATCH_ROW_CONFLICT",
        `Existing TB Row ${expectedRow.id} conflicts with the confirmed Draft mapping.`,
      );
    }

    if (
      creationDate &&
      !timestampsEqual(existingData?.metadata?.createdAt, creationDate)
    ) {
      throw controlledError(
        "TARGETED_BATCH_ROW_DATE_CONFLICT",
        `Existing TB Row ${expectedRow.id} has a conflicting creation date.`,
      );
    }
  });

  return existingById;
}

async function verifyPermanentCreation({
  db,
  rowRecords,
  salesRecords,
  payload,
  creationDate,
}) {
  const rowSnapshots = await getSnapshotsInChunks({
    db,
    refs: rowRecords.map((record) => record.rowRef),
  });
  const salesSnapshots = await getSnapshotsInChunks({
    db,
    refs: salesRecords.map((record) => record.salesRef),
  });
  const rowById = new Map(rowSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const salesById = new Map(
    salesSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  const failures = [];

  rowRecords.forEach((record, index) => {
    const rowSnapshot = rowById.get(record.rowDoc.id);
    const salesSnapshot = salesById.get(record.salesAllMeterId);

    if (!rowSnapshot?.exists) {
      failures.push(`Missing TB Row ${record.rowDoc.id}`);
    } else {
      const rowData = rowSnapshot.data() || {};
      const mappingMatches = validateExistingTbRow({
        existing: rowData,
        expectedRow: record.rowDoc,
        expectedSalesId: record.salesAllMeterId,
      });

      if (!mappingMatches) {
        failures.push(`Conflicting TB Row ${record.rowDoc.id}`);
      }

      if (!timestampsEqual(rowData?.metadata?.createdAt, creationDate)) {
        failures.push(`Creation date mismatch on TB Row ${record.rowDoc.id}`);
      }
    }

    if (!salesSnapshot?.exists) {
      failures.push(`Missing Sales source ${record.salesAllMeterId}`);
    } else if (
      !hasMatchingSalesTbRef({
        salesData: salesSnapshot.data() || {},
        tbId: payload.tbId,
        creationDate,
      })
    ) {
      failures.push(`Missing Sales tbRefs link for ${record.salesAllMeterId}`);
    }

    if (index >= payload.expectedRows) {
      failures.push(`Unexpected verification row at index ${index}`);
    }
  });

  if (failures.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_VERIFICATION_FAILED",
      `Permanent Targeted Batch verification failed: ${failures
        .slice(0, 10)
        .join("; ")}`,
      {
        failureCount: failures.length,
        failures: failures.slice(0, 20),
      },
    );
  }

  return {
    createdRows: rowRecords.length,
    linkedSalesRecords: salesRecords.length,
  };
}

export const onCreateTargetedBatchCallable = onCall(async (request) => {
  const startedAtMs = Date.now();
  const db = getFirestore();
  let parentRef = null;
  let fingerprint = null;
  let actorUid = request?.auth?.uid || null;
  let actorName = actorUid || "SYSTEM";
  let parentInitialized = false;

  try {
    if (!actorUid) {
      return buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required to create a Targeted Batch.",
      );
    }

    const authority = await resolveTargetedBatchCreateAuthority({ db, request });
    actorName = getActorNameFromRequest(request, authority.profile);

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_TARGETED_BATCH_ORIGINATOR",
        "Only MNG and SPV(MNC) users may create Targeted Batches.",
        {
          actorRole: authority.role,
          actorRelationshipType: authority.relationshipType,
          actorClientType: authority.clientType,
        },
      );
    }

    const payloadCheck = validateCreateTargetedBatchPayload(request?.data || {});

    if (!payloadCheck.ok) {
      return buildFailureResult(
        payloadCheck.code,
        payloadCheck.message,
        { errors: payloadCheck.errors || [] },
      );
    }

    const payload = payloadCheck;
    fingerprint = buildCreationFingerprint({
      tbId: payload.tbId,
      lmPcode: payload.scope.lmPcode,
      salesAllMeterIds: payload.salesAllMeterIds,
    });
    parentRef = db.collection(TARGETED_BATCH_COLLECTIONS.uploads).doc(payload.tbId);

    logger.info("onCreateTargetedBatchCallable -- START", {
      tbId: payload.tbId,
      expectedRows: payload.expectedRows,
      lmPcode: payload.scope.lmPcode,
      salesCollection: TARGETED_BATCH_COLLECTIONS.sales,
      actorUid,
    });

    const salesRefs = payload.salesAllMeterIds.map((salesAllMeterId) =>
      db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(salesAllMeterId),
    );
    const expectedRowIds = payload.rows.map((row, index) =>
      buildTbRowId(payload.tbId, index + 1),
    );
    const rowRefs = expectedRowIds.map((rowId) =>
      db.collection(TARGETED_BATCH_COLLECTIONS.rows).doc(rowId),
    );

    const [parentSnapshot, salesSnapshots, existingRowSnapshots] =
      await Promise.all([
        parentRef.get(),
        getSnapshotsInChunks({ db, refs: salesRefs }),
        getSnapshotsInChunks({ db, refs: rowRefs }),
      ]);

    const parentPreflight = validateExistingParent({
      parentData: parentSnapshot.exists ? parentSnapshot.data() || {} : null,
      payload,
      fingerprint,
    });

    const salesRecords = payload.salesAllMeterIds.map(
      (salesAllMeterId, index) => {
        const salesSnapshot = salesSnapshots[index];
        const validation = validateAuthoritativeSalesDocument({
          snapshot: salesSnapshot,
          expectedSalesId: salesAllMeterId,
          expectedLmPcode: payload.scope.lmPcode,
          draftRow: payload.rows[index],
        });

        if (!validation.ok) {
          throw controlledError(validation.code, validation.message);
        }

        return {
          salesAllMeterId,
          salesRef: salesSnapshot.ref,
          salesSource: validation.source,
        };
      },
    );

    assertExistingSalesReferencesCompatible({
      salesRecords,
      tbId: payload.tbId,
      parentExists: parentPreflight.exists,
      creationDate: parentPreflight.creationDate,
    });

    const provisionalRows = payload.rows.map((draftRow, index) => ({
      id: expectedRowIds[index],
      tbId: payload.tbId,
      rowNo: index + 1,
      salesAllMeterId: payload.salesAllMeterIds[index],
      source: {
        recordId: payload.salesAllMeterIds[index],
      },
    }));

    assertExistingRowsCompatible({
      existingRowSnapshots,
      expectedRows: provisionalRows,
      salesAllMeterIds: payload.salesAllMeterIds,
      creationDate: parentPreflight.creationDate,
      parentExists: parentPreflight.exists,
    });

    logger.info("onCreateTargetedBatchCallable -- PREFLIGHT PASSED", {
      tbId: payload.tbId,
      validatedSalesRecords: salesRecords.length,
      existingRows: existingRowSnapshots.filter((snapshot) => snapshot.exists)
        .length,
      parentExists: parentPreflight.exists,
      parentState: parentPreflight.state,
    });

    const parentState = await ensureParentCreationState({
      db,
      parentRef,
      payload,
      fingerprint,
      proposedCreationDate: Timestamp.now(),
      actorUid,
      actorName,
    });
    parentInitialized = true;
    const creationDate = parentState.creationDate;

    const rowRecords = payload.rows.map((draftRow, index) => {
      const salesRecord = salesRecords[index];
      const rowDoc = buildTargetedBatchRowDoc({
        payload,
        draftRow,
        salesSource: salesRecord.salesSource,
        salesAllMeterId: salesRecord.salesAllMeterId,
        rowNo: index + 1,
        creationDate,
        actorUid,
        actorName,
      });

      return {
        ...salesRecord,
        rowDoc,
        rowRef: db.collection(TARGETED_BATCH_COLLECTIONS.rows).doc(rowDoc.id),
      };
    });

    assertExistingRowsCompatible({
      existingRowSnapshots,
      expectedRows: rowRecords.map((record) => record.rowDoc),
      salesAllMeterIds: payload.salesAllMeterIds,
      creationDate,
      parentExists: true,
    });

    if (parentState.alreadyReady) {
      const verification = await verifyPermanentCreation({
        db,
        rowRecords,
        salesRecords,
        payload,
        creationDate,
      });

      logger.info("onCreateTargetedBatchCallable -- IDEMPOTENT SUCCESS", {
        tbId: payload.tbId,
        ...verification,
        elapsedMs: Date.now() - startedAtMs,
      });

      return buildSuccessResult(
        "Targeted Batch already exists and is verified as ready",
        {
          code: "TARGETED_BATCH_ALREADY_READY",
          tbId: payload.tbId,
          creationState: TARGETED_BATCH_CREATION_STATES.ready,
          expectedRows: payload.expectedRows,
          ...verification,
          creationDate: timestampToIso(creationDate),
          elapsedMs: Date.now() - startedAtMs,
        },
      );
    }

    const salesTbRef = buildSalesTbRef({
      tbId: payload.tbId,
      creationDate,
    });
    const writeChunks = chunkArray(rowRecords, ROWS_PER_WRITE_CHUNK);
    let processedRows = 0;

    for (const [chunkIndex, chunk] of writeChunks.entries()) {
      await db.runTransaction(async (transaction) => {
        const currentRowSnapshots = await transaction.getAll(
          ...chunk.map((record) => record.rowRef),
        );
        const currentRowsById = new Map(
          currentRowSnapshots
            .filter((snapshot) => snapshot.exists)
            .map((snapshot) => [snapshot.id, snapshot]),
        );

        chunk.forEach((record) => {
          const currentRowSnapshot = currentRowsById.get(record.rowDoc.id);

          if (currentRowSnapshot) {
            const currentRow = currentRowSnapshot.data() || {};
            const mappingMatches = validateExistingTbRow({
              existing: currentRow,
              expectedRow: record.rowDoc,
              expectedSalesId: record.salesAllMeterId,
            });

            if (
              !mappingMatches ||
              !timestampsEqual(currentRow?.metadata?.createdAt, creationDate)
            ) {
              throw controlledError(
                "TARGETED_BATCH_ROW_CONFLICT",
                `Existing TB Row ${record.rowDoc.id} conflicts with the confirmed Draft mapping.`,
              );
            }
          } else {
            transaction.create(record.rowRef, record.rowDoc);
          }

          transaction.update(record.salesRef, {
            tbRefs: FieldValue.arrayUnion(salesTbRef),
          });
        });
      });

      processedRows += chunk.length;

      logger.info("onCreateTargetedBatchCallable -- WRITE PROGRESS", {
        tbId: payload.tbId,
        chunk: chunkIndex + 1,
        chunks: writeChunks.length,
        processedRows,
        expectedRows: payload.expectedRows,
      });
    }

    const verification = await verifyPermanentCreation({
      db,
      rowRecords,
      salesRecords,
      payload,
      creationDate,
    });
    const completedAt = Timestamp.now();

    await db.runTransaction(async (transaction) => {
      const latestParentSnapshot = await transaction.get(parentRef);

      if (!latestParentSnapshot.exists) {
        throw controlledError(
          "TARGETED_BATCH_PARENT_MISSING",
          "The Targeted Batch parent disappeared before finalisation.",
        );
      }

      const latestParent = validateExistingParent({
        parentData: latestParentSnapshot.data() || {},
        payload,
        fingerprint,
      });

      if (latestParent.state !== TARGETED_BATCH_CREATION_STATES.ready) {
        transaction.update(
          parentRef,
          buildCreationReadyPatch({
            completedAt,
            expectedRows: payload.expectedRows,
            actorUid,
            actorName,
          }),
        );
      }
    });

    const elapsedMs = Date.now() - startedAtMs;

    logger.info("onCreateTargetedBatchCallable -- SUCCESS", {
      tbId: payload.tbId,
      expectedRows: payload.expectedRows,
      ...verification,
      elapsedMs,
    });

    return buildSuccessResult("Targeted Batch created successfully", {
      code: "TARGETED_BATCH_CREATED",
      tbId: payload.tbId,
      creationState: TARGETED_BATCH_CREATION_STATES.ready,
      expectedRows: payload.expectedRows,
      ...verification,
      creationDate: timestampToIso(creationDate),
      elapsedMs,
    });
  } catch (error) {
    const code = getErrorCode(error);
    const message = getErrorMessage(error);

    logger.error("onCreateTargetedBatchCallable -- FAILED", {
      tbId: parentRef?.id || null,
      code,
      message,
      details: error?.details || null,
      elapsedMs: Date.now() - startedAtMs,
    });

    if (parentInitialized && parentRef && fingerprint) {
      await markCreationFailed({
        db,
        parentRef,
        fingerprint,
        error,
        actorUid,
        actorName,
      });
    }

    return buildFailureResult(code, message, {
      tbId: parentRef?.id || null,
      creationState: parentInitialized
        ? TARGETED_BATCH_CREATION_STATES.failed
        : null,
      details: error?.details || null,
      elapsedMs: Date.now() - startedAtMs,
    });
  }
});
