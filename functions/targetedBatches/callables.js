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
  TARGETED_BATCH_PLANNING_MODES,
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
  validateAuthoritativeErfDocument,
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

function buildRowValidationFailure({
  payload,
  salesAllMeterId,
  salesRef,
  salesDocumentExists,
  validation,
}) {
  return {
    tbId: payload.tbId,
    wardPcode: payload.scope.wardPcode,
    salesAllMeterId,
    salesRef,
    salesDocumentExists: Boolean(salesDocumentExists),
    failureCode: getErrorCode(validation),
  };
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

  if (parentData?.scope?.wardPcode !== payload.scope.wardPcode) {
    throw controlledError(
      "TARGETED_BATCH_WARD_SCOPE_CONFLICT",
      "The existing Targeted Batch belongs to a different ward.",
    );
  }

  if (parentData?.creationGroup?.id !== payload.creationGroupId) {
    throw controlledError(
      "TARGETED_BATCH_CREATION_GROUP_CONFLICT",
      "The existing Targeted Batch belongs to a different creation group.",
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
  const rowById = new Map(
    rowSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
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

function isNgpPayload(payload = {}) {
  return (
    String(payload?.selection?.planningMode || "")
      .trim()
      .toUpperCase() === TARGETED_BATCH_PLANNING_MODES.nonGpsStreet
  );
}

function buildBatchFingerprint(payload) {
  return buildCreationFingerprint({
    tbId: payload.tbId,
    lmPcode: payload.scope.lmPcode,
    wardPcode: isNgpPayload(payload)
      ? TARGETED_BATCH_PLANNING_MODES.nonGpsStreet
      : payload.scope.wardPcode,
    creationGroupId: payload.creationGroupId,
    salesAllMeterIds: payload.salesAllMeterIds,
  });
}

async function preflightPermanentBatch({ db, payload }) {
  const requestedRowCount = payload.expectedRows;
  const ngpPayload = isNgpPayload(payload);
  const parentRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.uploads)
    .doc(payload.tbId);
  const salesRefs = payload.salesAllMeterIds.map((salesAllMeterId) =>
    db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(salesAllMeterId),
  );
  const salesSnapshots = await getSnapshotsInChunks({ db, refs: salesRefs });
  const failedRows = [];
  const candidateSalesRecords = [];

  payload.salesAllMeterIds.forEach((salesAllMeterId, index) => {
    const salesSnapshot = salesSnapshots[index];
    const validation = validateAuthoritativeSalesDocument({
      snapshot: salesSnapshot,
      expectedSalesId: salesAllMeterId,
      expectedLmPcode: payload.scope.lmPcode,
      expectedTbId: payload.tbId,
      planningMode: payload.selection.planningMode,
      draftRow: payload.rows[index],
    });

    if (!validation.ok) {
      failedRows.push(
        buildRowValidationFailure({
          payload,
          salesAllMeterId,
          salesRef: salesSnapshot?.ref || salesRefs[index],
          salesDocumentExists: salesSnapshot?.exists,
          validation,
        }),
      );
      return;
    }

    candidateSalesRecords.push({
      originalIndex: index,
      salesAllMeterId,
      salesRef: salesSnapshot.ref,
      salesSource: validation.source,
      erfReference: validation.erfReference,
      ngpPlanning: validation.ngpPlanning || null,
      draftRow: payload.rows[index],
    });
  });

  if (ngpPayload && failedRows.length > 0) {
    throw controlledError(
      "NGP_TARGETED_BATCH_SOURCE_CHANGED",
      `The NGP Targeted Batch was not created because ${failedRows.length} selected Sales target${
        failedRows.length === 1 ? "" : "s"
      } changed or became ineligible after selection. Refresh NGP planning and select the batch again.`,
      {
        tbId: payload.tbId,
        failureCount: failedRows.length,
        failedRows: failedRows.slice(0, 20),
      },
    );
  }

  let salesRecords = [];
  let confirmedScope = payload.scope;

  if (ngpPayload) {
    salesRecords = candidateSalesRecords.map((record) => ({
      ...record,
      erfReference: null,
      erfScope: null,
      erfSource: null,
    }));
  } else {
    const uniqueErfIds = [
      ...new Set(
        candidateSalesRecords.map((record) => record.erfReference.erfId),
      ),
    ];
    const erfRefs = uniqueErfIds.map((erfId) =>
      db.collection(TARGETED_BATCH_COLLECTIONS.erfs).doc(erfId),
    );
    const erfSnapshots = await getSnapshotsInChunks({ db, refs: erfRefs });
    const erfSnapshotsById = new Map(
      erfSnapshots.map((snapshot) => [snapshot.id, snapshot]),
    );

    candidateSalesRecords.forEach((record) => {
      const erfId = record.erfReference.erfId;
      const validation = validateAuthoritativeErfDocument({
        snapshot: erfSnapshotsById.get(erfId),
        expectedErfId: erfId,
        expectedErfNo: record.erfReference.erfNo,
        expectedLmPcode: payload.scope.lmPcode,
        expectedWardPcode: payload.scope.wardPcode,
        expectedWardNumber: payload.scope.wardNumber,
      });

      if (!validation.ok) {
        failedRows.push(
          buildRowValidationFailure({
            payload,
            salesAllMeterId: record.salesAllMeterId,
            salesRef: record.salesRef,
            salesDocumentExists: true,
            validation,
          }),
        );
        return;
      }

      salesRecords.push({
        ...record,
        erfReference: {
          ...record.erfReference,
          erfNo: validation.erfNo,
        },
        erfScope: validation.scope,
        erfSource: validation.source,
      });
    });

    const authoritativeScope = salesRecords[0]?.erfScope;

    if (salesRecords.length > 0 && !authoritativeScope) {
      throw controlledError(
        "TARGETED_BATCH_AUTHORITATIVE_SCOPE_MISSING",
        `Targeted Batch ${payload.tbId} has no authoritative ward scope.`,
      );
    }

    if (authoritativeScope) {
      const scopeConflict = salesRecords.some(
        (record) =>
          record.erfScope.lmPcode !== authoritativeScope.lmPcode ||
          record.erfScope.wardPcode !== authoritativeScope.wardPcode ||
          record.erfScope.wardNumber !== authoritativeScope.wardNumber,
      );

      if (scopeConflict) {
        throw controlledError(
          "TARGETED_BATCH_AUTHORITATIVE_WARD_CONFLICT",
          `Targeted Batch ${payload.tbId} resolves to more than one authoritative ward.`,
        );
      }

      confirmedScope = {
        ...payload.scope,
        ...authoritativeScope,
      };
    }
  }

  if (salesRecords.length === 0) {
    const parentSnapshot = await parentRef.get();

    if (parentSnapshot.exists) {
      throw controlledError(
        "TARGETED_BATCH_EXISTING_PARENT_WITH_NO_ELIGIBLE_ROWS",
        `Targeted Batch ${payload.tbId} already exists, but the current request has no eligible rows.`,
        { tbId: payload.tbId },
      );
    }

    return {
      skipped: true,
      payload: {
        ...payload,
        salesAllMeterIds: [],
        rows: [],
        expectedRows: 0,
      },
      requestedRowCount,
      failedRows,
      salesRecords: [],
    };
  }

  if (ngpPayload && salesRecords.length !== requestedRowCount) {
    throw controlledError(
      "NGP_TARGETED_BATCH_ROW_COUNT_CHANGED",
      "The NGP Targeted Batch source population changed before creation. Refresh NGP planning and select the batch again.",
      {
        tbId: payload.tbId,
        requestedRowCount,
        eligibleRowCount: salesRecords.length,
      },
    );
  }

  const confirmedPayload = {
    ...payload,
    salesAllMeterIds: salesRecords.map((record) => record.salesAllMeterId),
    rows: salesRecords.map((record) => record.draftRow),
    expectedRows: salesRecords.length,
    scope: confirmedScope,
  };
  const fingerprint = buildBatchFingerprint(confirmedPayload);
  const expectedRowIds = confirmedPayload.rows.map((row, index) =>
    buildTbRowId(confirmedPayload.tbId, index + 1),
  );
  const rowRefs = expectedRowIds.map((rowId) =>
    db.collection(TARGETED_BATCH_COLLECTIONS.rows).doc(rowId),
  );
  const [parentSnapshot, existingRowSnapshots] = await Promise.all([
    parentRef.get(),
    getSnapshotsInChunks({ db, refs: rowRefs }),
  ]);
  const parentPreflight = validateExistingParent({
    parentData: parentSnapshot.exists ? parentSnapshot.data() || {} : null,
    payload: confirmedPayload,
    fingerprint,
  });

  assertExistingSalesReferencesCompatible({
    salesRecords,
    tbId: confirmedPayload.tbId,
    parentExists: parentPreflight.exists,
    creationDate: parentPreflight.creationDate,
  });

  const provisionalRows = confirmedPayload.rows.map((draftRow, index) => ({
    id: expectedRowIds[index],
    tbId: confirmedPayload.tbId,
    rowNo: index + 1,
    salesAllMeterId: confirmedPayload.salesAllMeterIds[index],
    source: {
      recordId: confirmedPayload.salesAllMeterIds[index],
    },
    scope: confirmedPayload.scope,
  }));

  assertExistingRowsCompatible({
    existingRowSnapshots,
    expectedRows: provisionalRows,
    salesAllMeterIds: confirmedPayload.salesAllMeterIds,
    creationDate: parentPreflight.creationDate,
    parentExists: parentPreflight.exists,
  });

  return {
    skipped: false,
    payload: confirmedPayload,
    requestedRowCount,
    failedRows,
    fingerprint,
    parentRef,
    parentPreflight,
    salesRecords,
    existingRowSnapshots,
  };
}

async function createPreflightedBatch({
  db,
  context,
  actorUid,
  actorName,
}) {
  const {
    payload,
    requestedRowCount,
    failedRows,
    fingerprint,
    parentRef,
    salesRecords,
    existingRowSnapshots,
  } = context;
  let parentInitialized = false;

  try {
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
        erfReference: salesRecord.erfReference,
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

      return {
        tbId: payload.tbId,
        wardPcode: payload.scope.wardPcode,
        wardNumber: payload.scope.wardNumber,
        wardName: payload.scope.wardName,
        rowCount: payload.expectedRows,
        expectedRows: payload.expectedRows,
        requestedRowCount,
        failedRowCount: failedRows.length,
        creationState: TARGETED_BATCH_CREATION_STATES.ready,
        code:
          failedRows.length > 0
            ? "TARGETED_BATCH_PARTIALLY_ALREADY_READY"
            : "TARGETED_BATCH_ALREADY_READY",
        creationDate: timestampToIso(creationDate),
        ...verification,
      };
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
        creationGroupId: payload.creationGroupId,
        tbId: payload.tbId,
        wardPcode: payload.scope.wardPcode,
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

    return {
      tbId: payload.tbId,
      wardPcode: payload.scope.wardPcode,
      wardNumber: payload.scope.wardNumber,
      wardName: payload.scope.wardName,
      rowCount: payload.expectedRows,
      expectedRows: payload.expectedRows,
      requestedRowCount,
      failedRowCount: failedRows.length,
      creationState: TARGETED_BATCH_CREATION_STATES.ready,
      code:
        failedRows.length > 0
          ? "TARGETED_BATCH_PARTIALLY_CREATED"
          : "TARGETED_BATCH_CREATED",
      creationDate: timestampToIso(creationDate),
      ...verification,
    };
  } catch (error) {
    if (parentInitialized) {
      await markCreationFailed({
        db,
        parentRef,
        fingerprint,
        error,
        actorUid,
        actorName,
      });
    }

    throw error;
  }
}

export const onCreateTargetedBatchCallable = onCall(async (request) => {
  const startedAtMs = Date.now();
  const db = getFirestore();
  const actorUid = request?.auth?.uid || null;
  let actorName = actorUid || "SYSTEM";
  let creationGroupId = null;
  const completedBatches = [];
  const skippedBatches = [];
  const rowValidationFailures = [];

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
      return buildFailureResult(payloadCheck.code, payloadCheck.message, {
        errors: payloadCheck.errors || [],
      });
    }

    creationGroupId = payloadCheck.creationGroupId;
    const ngpCreation =
      payloadCheck.selection?.planningMode ===
      TARGETED_BATCH_PLANNING_MODES.nonGpsStreet;

    logger.info("onCreateTargetedBatchCallable -- GROUP START", {
      creationGroupId,
      expectedBatches: payloadCheck.expectedBatches,
      expectedRows: payloadCheck.expectedRows,
      lmPcode: payloadCheck.scope.lmPcode,
      actorUid,
    });

    const preflightContexts = [];

    for (const batchPayload of payloadCheck.proposedBatches) {
      const context = await preflightPermanentBatch({
        db,
        payload: batchPayload,
      });
      rowValidationFailures.push(...context.failedRows);

      if (context.skipped) {
        skippedBatches.push({
          tbId: batchPayload.tbId,
          wardPcode: batchPayload.scope.wardPcode,
          wardNumber: batchPayload.scope.wardNumber,
          wardName: batchPayload.scope.wardName,
          requestedRowCount: context.requestedRowCount,
          createdRowCount: 0,
          failedRowCount: context.failedRows.length,
          code: "TARGETED_BATCH_SKIPPED_NO_ELIGIBLE_ROWS",
        });

        logger.warn(
          "onCreateTargetedBatchCallable -- BATCH PREFLIGHT NO ELIGIBLE ROWS",
          {
            creationGroupId,
            tbId: batchPayload.tbId,
            wardPcode: batchPayload.scope.wardPcode,
            requestedRows: context.requestedRowCount,
            failedRows: context.failedRows.length,
          },
        );
        continue;
      }

      preflightContexts.push(context);

      logger.info("onCreateTargetedBatchCallable -- BATCH PREFLIGHT PASSED", {
        creationGroupId,
        tbId: context.payload.tbId,
        wardPcode: context.payload.scope.wardPcode,
        requestedRows: context.requestedRowCount,
        eligibleRows: context.payload.expectedRows,
        failedRows: context.failedRows.length,
        parentExists: context.parentPreflight.exists,
        parentState: context.parentPreflight.state,
      });
    }

    const eligibleRowCount = preflightContexts.reduce(
      (sum, context) => sum + context.payload.expectedRows,
      0,
    );

    logger.info("onCreateTargetedBatchCallable -- GROUP PREFLIGHT PASSED", {
      creationGroupId,
      validatedBatches: preflightContexts.length,
      skippedBatches: skippedBatches.length,
      requestedRows: payloadCheck.expectedRows,
      eligibleRows: eligibleRowCount,
      failedRows: rowValidationFailures.length,
    });

    for (const context of preflightContexts) {
      const batchResult = await createPreflightedBatch({
        db,
        context,
        actorUid,
        actorName,
      });
      completedBatches.push(batchResult);

      logger.info("onCreateTargetedBatchCallable -- BATCH READY", {
        creationGroupId,
        ...batchResult,
      });
    }

    const elapsedMs = Date.now() - startedAtMs;
    const createdRowCount = completedBatches.reduce(
      (sum, batch) => sum + Number(batch.rowCount || 0),
      0,
    );
    const failedRowCount = rowValidationFailures.length;
    const firstBatchId = completedBatches[0]?.tbId || null;
    const groupCode =
      failedRowCount === 0
        ? "TARGETED_BATCH_GROUP_CREATED"
        : completedBatches.length > 0
          ? "TARGETED_BATCH_GROUP_PARTIALLY_CREATED"
          : "TARGETED_BATCH_GROUP_NO_ELIGIBLE_ROWS";
    const message =
      failedRowCount === 0
        ? ngpCreation
          ? `${completedBatches.length} NGP Targeted Batch${
              completedBatches.length === 1 ? "" : "es"
            } created successfully`
          : `${completedBatches.length} ward-scoped Targeted Batch${
              completedBatches.length === 1 ? "" : "es"
            } created successfully`
        : completedBatches.length > 0
          ? `${createdRowCount} Sales record${
              createdRowCount === 1 ? " was" : "s were"
            } batched and ${failedRowCount} record${
              failedRowCount === 1 ? " was" : "s were"
            } flagged`
          : `No Targeted Batch was created. ${failedRowCount} Sales record${
              failedRowCount === 1 ? " was" : "s were"
            } flagged`;

    logger.info("onCreateTargetedBatchCallable -- GROUP SUCCESS", {
      creationGroupId,
      groupCode,
      createdBatchCount: completedBatches.length,
      skippedBatchCount: skippedBatches.length,
      requestedRowCount: payloadCheck.expectedRows,
      createdRowCount,
      failedRowCount,
      elapsedMs,
    });

    return buildSuccessResult(message, {
      code: groupCode,
      creationState:
        completedBatches.length > 0
          ? TARGETED_BATCH_CREATION_STATES.ready
          : null,
      creationGroupId,
      requestedRowCount: payloadCheck.expectedRows,
      createdBatchCount: completedBatches.length,
      skippedBatchCount: skippedBatches.length,
      createdRowCount,
      failedRowCount,
      batches: completedBatches,
      skippedBatches,
      failedRows: rowValidationFailures.map((failure) => ({
        tbId: failure.tbId,
        salesAllMeterId: failure.salesAllMeterId,
        failureCode: failure.failureCode,
      })),
      tbId: completedBatches.length === 1 ? firstBatchId : null,
      expectedRows: createdRowCount,
      elapsedMs,
    });

  } catch (error) {
    const code = getErrorCode(error);
    const message = getErrorMessage(error);
    const elapsedMs = Date.now() - startedAtMs;

    logger.error("onCreateTargetedBatchCallable -- GROUP FAILED", {
      creationGroupId,
      code,
      message,
      details: error?.details || null,
      completedBatchIds: completedBatches.map((batch) => batch.tbId),
      elapsedMs,
    });

    return buildFailureResult(code, message, {
      creationGroupId,
      creationState:
        completedBatches.length > 0
          ? TARGETED_BATCH_CREATION_STATES.failed
          : null,
      completedBatchCount: completedBatches.length,
      completedBatches,
      skippedBatches,
      failedRowCount: rowValidationFailures.length,
      details: error?.details || null,
      elapsedMs,
    });
  }
});
