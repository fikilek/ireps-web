import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildBgoBatchId,
  buildFailureResult,
  buildSuccessResult,
  buildUpdateMetadataPatch,
  commitWriteJobsInChunks,
  getActorNameFromRequest,
  getAstIdFromRow,
  getPremiseIdFromRow,
  getTcIdFromRow,
  getTcRowTrnType,
  hasMeaningfulValue,
  isTcRowReadyForBgo,
  normalizeGeofenceRef,
  resolveBgoCreateAuthority,
  safeArray,
  selectedGeofenceBelongsToRow,
  validateCreateBgoPayload,
  isBmdBgoCreatePayload,
  buildBmdBgoBatchId,
  validateCreateBmdBgoPayload,
  assertNoDuplicateRowUseAcrossAllocations,
  BGO_COLLECTIONS,
} from "./helpers.js";

import {
  buildBgoBatchDoc,
  buildBgoBatchHistoryDoc,
  buildBgoNotificationRecord,
  buildBgoRowAndChildTrnDocs,
  buildTcRowBgoPatch,
  buildBmdBgoBatchDoc,
  buildBmdBgoBatchHistoryDoc,
  buildBmdBgoNotificationRecord,
} from "./trnFactory.js";

import { refreshBgoBatchDerivedExecutionSummaries } from "./executionSummary.js";

import {
  applyTcRowBgoReadiness,
  isTcRowReadyForBgo as isResolvedTcRowReadyForBgo,
  normalizeTcGeoFenceRefs,
  refreshTcUploadSummariesForTcIds,
} from "../tcUploads/readiness.js";

import {
  getActiveSameOperationLifecycle as getTcActiveSameOperationLifecycle,
  getEligibilityResult as getTcEligibilityResult,
} from "../tcUploads/helpers.js";

import {
  validateLifecycleInstructionAssignment,
} from "../meterLifecycle/helpers.js";

function mapDocsById(snaps = []) {
  const result = new Map();

  snaps.forEach((snap) => {
    if (snap?.exists) {
      result.set(snap.id, snap);
    }
  });

  return result;
}

function findAllocationForRowId(allocations = [], tcRowId) {
  return (
    allocations.find((allocation) => allocation.tcRowIds.includes(tcRowId)) ||
    null
  );
}

function getTargetForAllocation(allocation = {}) {
  return allocation.target || null;
}

function buildAllocationInstruction(allocation = {}, trnType) {
  return allocation.instruction || {
    code: trnType,
    text: `${trnType} bulk geofence allocation`,
    notes: "NAv",
    mediaRequired: true,
  };
}

function getBgoStatusAfterCreate({ upload = {}, selectedCount = 0 }) {
  const readyRows = Number(upload?.readyRows || upload?.summary?.readyRows || 0);
  const remainingAfter = Math.max(readyRows - selectedCount, 0);

  if (remainingAfter === 0) return "USED";
  return "PARTIALLY_USED";
}

function collectRefsById({ db, collectionName, ids = [] }) {
  return [...new Set(ids.filter(Boolean))].map((id) =>
    db.collection(collectionName).doc(id),
  );
}

function getBatchRowRecords({
  db,
  allocation,
  tcId,
  tcUpload,
  trnType,
  rowDocsById,
  astDocsById,
  premiseDocsById,
  bgoBatchId,
  trnTimestampBaseMs,
  trnTimestampOffsetStart = 0,
  actorUid,
  actorName,
  now,
}) {
  const geofenceRef = allocation.geofenceRef;
  const target = getTargetForAllocation(allocation);

  const rowRecords = [];
  const trnIds = [];

  for (const [rowIndex, tcRowId] of allocation.tcRowIds.entries()) {
    const rowSnap = rowDocsById.get(tcRowId);
    const rowData = rowSnap.data() || {};
    const astId = getAstIdFromRow(rowData);
    const premiseId = getPremiseIdFromRow(rowData);
    const astSnap = astDocsById.get(astId);
    const premiseSnap = premiseDocsById.get(premiseId);

    const rowRecord = buildBgoRowAndChildTrnDocs({
      tcId,
      rowDoc: rowSnap,
      rowData,
      astId,
      astDoc: astSnap.data() || {},
      premiseId,
      premiseData: premiseSnap.data() || {},
      trnType,
      geofenceRef,
      target,
      bgoBatchId,
      trnTimestampMs:
        trnTimestampBaseMs + trnTimestampOffsetStart + rowIndex,
      now,
      actorUid,
      actorName,
    });

    rowRecords.push(rowRecord);
    trnIds.push(rowRecord.trnId);
  }

  const batchDoc = buildBgoBatchDoc({
    bgoBatchId,
    tcId,
    tcUpload,
    trnType,
    geofenceRef,
    target,
    rowCount: allocation.tcRowIds.length,
    trnIds,
    now,
    actorUid,
    actorName,
  });

  const batchHistoryDoc = buildBgoBatchHistoryDoc({
    bgoBatchId,
    trnType,
    geofenceRef,
    rowCount: allocation.tcRowIds.length,
    trnCount: trnIds.length,
    actorUid,
    actorName,
    now,
  });

  const notificationDoc = buildBgoNotificationRecord({
    bgoBatchId,
    trnType,
    target,
    geofenceRef,
    rowCount: allocation.tcRowIds.length,
    actorUid,
    actorName,
    now,
  });

  return {
    batchDoc,
    batchHistoryDoc,
    notificationDoc,
    rowRecords,
    trnIds,
    nextTrnTimestampOffset:
      trnTimestampOffsetStart + allocation.tcRowIds.length,
  };
}

async function validateExistingOutputDocs({
  db,
  plannedBatchIds = [],
  plannedTrnIds = [],
}) {
  const refs = [
    ...plannedBatchIds.map((id) =>
      db.collection(BGO_COLLECTIONS.batches).doc(id),
    ),
    ...plannedTrnIds.map((id) => db.collection(BGO_COLLECTIONS.trns).doc(id)),
  ];

  if (refs.length === 0) return null;

  const snaps = await db.getAll(...refs);
  const existing = snaps.filter((snap) => snap.exists);

  if (existing.length === 0) return null;

  return existing.map((snap) => snap.ref.path);
}

function getAstStatusStateForBgoReadiness(astDoc = {}) {
  return String(astDoc?.status?.state || astDoc?.status || "NAv").toUpperCase();
}

function getAstNoForBgoReadiness(astDoc = {}, fallbackValue = "NAv") {
  return (
    astDoc?.ast?.astData?.astNo ||
    astDoc?.astData?.astNo ||
    astDoc?.master?.id ||
    fallbackValue ||
    "NAv"
  );
}

function getAstMeterTypeForBgoReadiness(astDoc = {}, fallbackValue = "NAv") {
  return (
    astDoc?.meterType ||
    astDoc?.ast?.meterType ||
    astDoc?.ast?.astData?.meterType ||
    astDoc?.astData?.meterType ||
    fallbackValue ||
    "NAv"
  );
}

function buildBgoCreateFinalReadinessPatch({
  rowData = {},
  astId,
  astDoc = {},
  trnType,
  now,
  actorUid,
  actorName,
}) {
  const currentGeoFenceRefs = normalizeTcGeoFenceRefs(astDoc?.geofenceRefs || []);
  const eligibility = getTcEligibilityResult({ trnType, astData: astDoc });
  const activeLifecycle = getTcActiveSameOperationLifecycle({
    trnType,
    astData: astDoc,
  });

  const astNo = getAstNoForBgoReadiness(astDoc, rowData?.ast?.astNo);
  const meterType = getAstMeterTypeForBgoReadiness(astDoc, rowData?.ast?.meterType);
  const statusState = getAstStatusStateForBgoReadiness(astDoc);

  const nextRowForEvaluation = {
    ...rowData,
    ast: {
      ...(rowData?.ast || {}),
      id: astId,
      astId,
      astNo,
      meterNo: astNo,
      meterType,
      statusState,
      geofenceRefs: currentGeoFenceRefs,
    },
    geofenceRefs: currentGeoFenceRefs,
    backend: {
      ...(rowData?.backend || {}),
      eligible: eligibility.eligible === true,
      notEligible: eligibility.eligible !== true,
      eligibilityCode: eligibility.code || null,
      eligibilityMessage: eligibility.message || null,
      alreadyHasActiveSameOperationTrn: Boolean(activeLifecycle),
      activeLifecycle,
      trnType,
    },
  };

  // IMPORTANT:
  // Do not manually set bgo.ready in multiple places.
  // Always run the official BGO readiness resolver so TC rows have one truth:
  // BGO READY or BGO NOT READY with a reason.
  const evaluatedRow = applyTcRowBgoReadiness({
    row: nextRowForEvaluation,
    geofenceRefs: currentGeoFenceRefs,
    now,
    updatedByUid: actorUid,
    updatedByUser: actorName,
  });

  const patch = {
    geofenceRefs: evaluatedRow.geofenceRefs,
    ast: evaluatedRow.ast,
    backend: {
      ...(evaluatedRow?.backend || {}),
      refreshedFromAstAt: now,
      refreshReason: "BGO_CREATE_FINAL_READINESS_CHECK",
      finalBgoCreateCheck: {
        checkedAt: now,
        checkedByUid: actorUid,
        checkedByUser: actorName,
        astId,
        statusState,
        meterType,
        geofenceRefsCount: currentGeoFenceRefs.length,
      },
    },
    bgo: evaluatedRow.bgo,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };

  return {
    evaluatedRow: {
      ...evaluatedRow,
      metadata: {
        ...(evaluatedRow?.metadata || {}),
        updatedAt: now,
        updatedByUid: actorUid,
        updatedByUser: actorName,
      },
    },
    patch,
  };
}

async function commitFinalReadinessUpdates({ db, rowUpdates = [] }) {
  const writeJobs = rowUpdates.map((item) => (batch) => {
    batch.update(item.ref, item.patch);
  });

  if (writeJobs.length === 0) return 0;

  return commitWriteJobsInChunks({
    db,
    writeJobs,
    chunkSize: 380,
  });
}

function normalizeBgoPatchId(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const upper = text.toUpperCase();
  if (["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(upper)) {
    return "";
  }

  return text;
}

function getRowAstIdForBgoRefresh(row = {}) {
  return normalizeBgoPatchId(
    getAstIdFromRow(row) ||
      row?.ast?.id ||
      row?.ast?.astId ||
      row?.backend?.astId ||
      row?.astId ||
      row?.sourceAstId,
  );
}

function getRowTcIdForBgoRefresh(row = {}) {
  return normalizeBgoPatchId(
    getTcIdFromRow(row) || row?.tcId || row?.upload?.tcId,
  );
}

function getRowGeofenceIdsForBgoRefresh(row = {}) {
  return normalizeTcGeoFenceRefs(row?.geofenceRefs || [])
    .map((ref) => normalizeBgoPatchId(ref?.id || ref?.name))
    .filter(Boolean);
}

function hasBgoReadinessMeaningfulChange({ beforeRow = {}, afterRow = {} }) {
  const beforeBgo = beforeRow?.bgo || {};
  const afterBgo = afterRow?.bgo || {};
  const beforeBackend = beforeRow?.backend || {};
  const afterBackend = afterRow?.backend || {};
  const beforeGeofenceIds = getRowGeofenceIdsForBgoRefresh(beforeRow).join("|");
  const afterGeofenceIds = getRowGeofenceIdsForBgoRefresh(afterRow).join("|");

  return (
    beforeBgo.ready !== afterBgo.ready ||
    beforeBgo.readinessState !== afterBgo.readinessState ||
    beforeBgo.readinessReason !== afterBgo.readinessReason ||
    beforeBackend.alreadyHasActiveSameOperationTrn !==
      afterBackend.alreadyHasActiveSameOperationTrn ||
    beforeGeofenceIds !== afterGeofenceIds
  );
}

async function getTcRowsLinkedToAstIds({ db, astIds = [] }) {
  const rowDocMap = new Map();
  const cleanAstIds = Array.from(
    new Set(astIds.map(normalizeBgoPatchId).filter(Boolean)),
  );

  const fields = [
    "ast.id",
    "ast.astId",
    "backend.astId",
    "astId",
    "sourceAstId",
  ];

  for (let index = 0; index < cleanAstIds.length; index += 30) {
    const astIdChunk = cleanAstIds.slice(index, index + 30);

    for (const field of fields) {
      try {
        const snapshot = await db
          .collection(BGO_COLLECTIONS.tcRows)
          .where(field, "in", astIdChunk)
          .get();

        snapshot.docs.forEach((doc) => {
          rowDocMap.set(doc.ref.path, doc);
        });
      } catch (error) {
        logger.warn("getTcRowsLinkedToAstIds query skipped", {
          field,
          astIdCount: astIdChunk.length,
          message: error?.message || String(error),
        });
      }
    }
  }

  return Array.from(rowDocMap.values());
}

async function refreshImpactedTcRowsAfterBgoCreate({
  db,
  tcId,
  trnType,
  astIds = [],
  selectedTcRowIds = [],
  now,
  actorUid,
  actorName,
}) {
  const selectedRowIdSet = new Set(selectedTcRowIds.filter(Boolean));
  const cleanAstIds = Array.from(
    new Set(astIds.map(normalizeBgoPatchId).filter(Boolean)),
  );

  if (cleanAstIds.length === 0) {
    return {
      refreshedRows: 0,
      changedRows: 0,
      overlappingReadyRowsUpdated: 0,
      affectedTcIds: [],
      affectedGeofenceGroups: [],
    };
  }

  const astRefs = cleanAstIds.map((astId) =>
    db.collection(BGO_COLLECTIONS.asts).doc(astId),
  );
  const astSnaps = await db.getAll(...astRefs);
  const latestAstDocsById = mapDocsById(astSnaps);
  const linkedRowDocs = await getTcRowsLinkedToAstIds({ db, astIds: cleanAstIds });
  const rowUpdates = [];
  const affectedTcIdSet = new Set([tcId]);
  const affectedGeofenceGroupMap = new Map();
  let changedRows = 0;
  let overlappingReadyRowsUpdated = 0;

  for (const rowSnap of linkedRowDocs) {
    const rowData = rowSnap.data() || {};
    const astId = getRowAstIdForBgoRefresh(rowData);
    const astSnap = latestAstDocsById.get(astId);

    if (!astId || !astSnap?.exists) continue;

    const rowTcId = getRowTcIdForBgoRefresh(rowData);
    const rowTrnType =
      getTcRowTrnType(rowData, rowData?.upload || { trnType }) || trnType;
    const wasReady = isResolvedTcRowReadyForBgo(rowData);
    const wasSelectedForThisAllocation = selectedRowIdSet.has(rowSnap.id);
    const beforeGeofenceIds = getRowGeofenceIdsForBgoRefresh(rowData);
    const latestAstDoc = astSnap.data() || {};
    const refreshed = buildBgoCreateFinalReadinessPatch({
      rowData,
      astId,
      astDoc: latestAstDoc,
      trnType: rowTrnType,
      now,
      actorUid,
      actorName,
    });
    const nextRow = refreshed.evaluatedRow;
    const isNowReady = isResolvedTcRowReadyForBgo(nextRow);
    const changed = hasBgoReadinessMeaningfulChange({
      beforeRow: rowData,
      afterRow: nextRow,
    });

    if (rowTcId) affectedTcIdSet.add(rowTcId);

    if (wasReady && !isNowReady && !wasSelectedForThisAllocation) {
      overlappingReadyRowsUpdated += 1;

      beforeGeofenceIds.forEach((geofenceId) => {
        const key = `${rowTcId || tcId}::${geofenceId}`;
        const current = affectedGeofenceGroupMap.get(key) || {
          tcId: rowTcId || tcId,
          geofenceId,
          affectedRows: 0,
        };

        current.affectedRows += 1;
        affectedGeofenceGroupMap.set(key, current);
      });
    }

    if (!changed) continue;

    rowUpdates.push({
      ref: rowSnap.ref,
      patch: {
        ...refreshed.patch,
        backend: {
          ...(refreshed.patch.backend || {}),
          refreshReason: "BGO_CREATE_POST_SUCCESS_IMPACT_REFRESH",
          postBgoCreateImpactRefresh: {
            refreshedAt: now,
            refreshedByUid: actorUid,
            refreshedByUser: actorName,
            sourceTcId: tcId,
            sourceTrnType: trnType,
            selectedInSourceAllocation: wasSelectedForThisAllocation,
          },
        },
      },
    });
    changedRows += 1;
  }

  if (rowUpdates.length > 0) {
    await commitFinalReadinessUpdates({ db, rowUpdates });
  }

  return {
    refreshedRows: linkedRowDocs.length,
    changedRows,
    overlappingReadyRowsUpdated,
    affectedTcIds: Array.from(affectedTcIdSet).filter(Boolean),
    affectedGeofenceGroups: Array.from(affectedGeofenceGroupMap.values()),
  };
}


async function createBmdBgoBatch({
  db,
  data,
  now,
  actorUid,
  actorName,
}) {
  const payloadCheck = validateCreateBmdBgoPayload(data);

  if (!payloadCheck.ok) {
    return buildFailureResult(payloadCheck.code, payloadCheck.message);
  }

  const { trnType, scope, geofenceRef, target, worklist, summary } = payloadCheck;

  const bgoBatchId = buildBmdBgoBatchId({
    lmPcode: scope.lmPcode,
    wardPcode: scope.wardPcode,
    geofenceId: geofenceRef.id,
    targetType: target.type,
    targetId: target.id,
  });

  logger.info("onCreateBgoCallable -- BMD START", {
    bgoBatchId,
    trnType,
    lmPcode: scope.lmPcode,
    wardPcode: scope.wardPcode,
    geofenceId: geofenceRef.id,
    target,
    erfCount: summary.erfCount,
    premiseCount: summary.premiseCount,
    meterCount: summary.meterCount,
    actorUid,
  });

  const existingOutputPaths = await validateExistingOutputDocs({
    db,
    plannedBatchIds: [bgoBatchId],
    plannedTrnIds: [],
  });

  if (existingOutputPaths) {
    return buildFailureResult(
      "BMD_BGO_BATCH_ALREADY_EXISTS",
      "A BMD-BGO batch already exists for this LM/Ward/geofence/target. Review existing BMD allocation before creating another.",
      {
        bgoBatchId,
        existingOutputPaths: existingOutputPaths.slice(0, 20),
        existingCount: existingOutputPaths.length,
      },
    );
  }

  const batchDoc = buildBmdBgoBatchDoc({
    bgoBatchId,
    trnType,
    scope,
    geofenceRef,
    target,
    worklist,
    summary,
    now,
    actorUid,
    actorName,
  });

  const historyDoc = buildBmdBgoBatchHistoryDoc({
    bgoBatchId,
    geofenceRef,
    target,
    summary,
    actorUid,
    actorName,
    now,
  });

  const notificationDoc = buildBmdBgoNotificationRecord({
    bgoBatchId,
    target,
    geofenceRef,
    summary,
    actorUid,
    actorName,
    now,
  });

  const writeJobs = [];

  writeJobs.push((batch) => {
    const batchRef = db.collection(BGO_COLLECTIONS.batches).doc(bgoBatchId);
    batch.create(batchRef, batchDoc);
  });

  writeJobs.push((batch) => {
    const historyRef = db
      .collection(BGO_COLLECTIONS.batches)
      .doc(bgoBatchId)
      .collection("history")
      .doc();

    batch.set(historyRef, historyDoc);
  });

  writeJobs.push((batch) => {
    const notificationRef = db.collection(BGO_COLLECTIONS.notifications).doc();
    batch.set(notificationRef, notificationDoc);
  });

  const committedWrites = await commitWriteJobsInChunks({
    db,
    writeJobs,
    chunkSize: 380,
  });

  logger.info("onCreateBgoCallable -- BMD SUCCESS", {
    bgoBatchId,
    committedWrites,
    actorUid,
  });

  return buildSuccessResult("BMD-BGO batch created successfully", {
    batchMode: "BMD",
    bgoBatchId,
    bgoBatchIds: [bgoBatchId],
    createdBgoBatchCount: 1,
    createdBgoRowCount: 0,
    createdChildTrnCount: 0,
    trnIds: [],
    committedWrites,
    summary,
  });
}

export const onCreateBgoCallable = onCall(async (request) => {
  const startedAtMs = Date.now();

  try {
    const db = getFirestore();
    const data = request?.data || {};
    const authContext = request?.auth || null;

    if (!authContext?.uid) {
      return buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required",
      );
    }

    const actorUid = authContext.uid;
    const actorName = getActorNameFromRequest(request);
    const now = new Date().toISOString();
    const trnTimestampBaseMs = Date.now();
    let trnTimestampOffset = 0;

    const authority = await resolveBgoCreateAuthority({ db, request });

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_BGO_ORIGINATOR",
        "Only MNG and SPV(MNC) can create BGO batches",
        {
          actorRole: authority.role,
          actorRelationshipType: authority.relationshipType,
          actorClientType: authority.clientType,
        },
      );
    }

    if (isBmdBgoCreatePayload(data)) {
      return await createBmdBgoBatch({
        db,
        data,
        now,
        actorUid,
        actorName,
      });
    }

    const payloadCheck = validateCreateBgoPayload(data);

    if (!payloadCheck.ok) {
      return buildFailureResult(payloadCheck.code, payloadCheck.message);
    }

    const { tcId, trnType, allocations } = payloadCheck;

    const selectedTcRowIds = assertNoDuplicateRowUseAcrossAllocations(
      allocations,
    );

    logger.info("onCreateBgoCallable -- START", {
      tcId,
      trnType,
      allocationCount: allocations.length,
      selectedRows: selectedTcRowIds.length,
      actorUid,
    });

    const tcUploadRef = db.collection(BGO_COLLECTIONS.tcUploads).doc(tcId);
    const rowRefs = selectedTcRowIds.map((tcRowId) =>
      db.collection(BGO_COLLECTIONS.tcRows).doc(tcRowId),
    );

    const [tcUploadSnap, ...rowSnaps] = await db.getAll(tcUploadRef, ...rowRefs);

    if (!tcUploadSnap.exists) {
      return buildFailureResult(
        "TC_UPLOAD_NOT_FOUND",
        "The selected TC upload was not found",
        { tcId },
      );
    }

    const tcUpload = tcUploadSnap.data() || {};
    const uploadTrnType = String(tcUpload?.trnType || "").trim().toUpperCase();

    if (uploadTrnType && uploadTrnType !== trnType) {
      return buildFailureResult(
        "BGO_TRN_TYPE_MISMATCH",
        "BGO trnType does not match the TC upload trnType",
        {
          tcId,
          uploadTrnType,
          requestedTrnType: trnType,
        },
      );
    }

    const missingRowIds = [];
    const rowDocsById = new Map();

    rowSnaps.forEach((snap, index) => {
      const requestedRowId = selectedTcRowIds[index];

      if (!snap.exists) {
        missingRowIds.push(requestedRowId);
        return;
      }

      rowDocsById.set(snap.id, snap);
    });

    if (missingRowIds.length > 0) {
      return buildFailureResult(
        "TC_ROWS_NOT_FOUND",
        "Some selected TC rows were not found",
        { missingRowIds },
      );
    }

    const astIds = [];
    const premiseIds = [];

    for (const tcRowId of selectedTcRowIds) {
      const rowSnap = rowDocsById.get(tcRowId);
      const rowData = rowSnap.data() || {};
      const rowTcId = getTcIdFromRow(rowData);
      const rowTrnType = getTcRowTrnType(rowData, tcUpload);
      const allocation = findAllocationForRowId(allocations, tcRowId);
      const geofenceRef = allocation?.geofenceRef || null;

      if (rowTcId !== tcId) {
        return buildFailureResult(
          "TC_ROW_UPLOAD_MISMATCH",
          "A selected TC row does not belong to the selected TC upload",
          {
            tcId,
            tcRowId,
            rowTcId,
          },
        );
      }

      if (rowTrnType !== trnType) {
        return buildFailureResult(
          "TC_ROW_TRN_TYPE_MISMATCH",
          "A selected TC row does not match the BGO operation type",
          {
            tcId,
            tcRowId,
            rowTrnType,
            trnType,
          },
        );
      }

      if (!isTcRowReadyForBgo(rowData)) {
        return buildFailureResult(
          "TC_ROW_NOT_READY_FOR_BGO",
          "A selected TC row is not READY_FOR_BGO",
          {
            tcId,
            tcRowId,
            readinessState: rowData?.bgo?.readinessState || "NAv",
            used: rowData?.bgo?.used === true,
            batchId: rowData?.bgo?.batchId || null,
          },
        );
      }

      if (!selectedGeofenceBelongsToRow({ row: rowData, geofenceRef })) {
        return buildFailureResult(
          "BGO_GEOFENCE_NOT_ON_TC_ROW",
          "Selected BGO geofence is not present on a selected TC row",
          {
            tcId,
            tcRowId,
            geofenceRef,
          },
        );
      }

      const astId = getAstIdFromRow(rowData);
      const premiseId = getPremiseIdFromRow(rowData);

      if (!hasMeaningfulValue(astId)) {
        return buildFailureResult(
          "TC_ROW_MISSING_AST_ID",
          "A selected TC row does not have a valid AST id",
          { tcId, tcRowId },
        );
      }

      if (!hasMeaningfulValue(premiseId)) {
        return buildFailureResult(
          "TC_ROW_MISSING_PREMISE_ID",
          "A selected TC row does not have a valid premise id",
          { tcId, tcRowId, astId },
        );
      }

      astIds.push(astId);
      premiseIds.push(premiseId);
    }

    const astRefs = collectRefsById({
      db,
      collectionName: BGO_COLLECTIONS.asts,
      ids: astIds,
    });

    const premiseRefs = collectRefsById({
      db,
      collectionName: BGO_COLLECTIONS.premises,
      ids: premiseIds,
    });

    const [astSnaps, premiseSnaps] = await Promise.all([
      astRefs.length ? db.getAll(...astRefs) : [],
      premiseRefs.length ? db.getAll(...premiseRefs) : [],
    ]);

    const astDocsById = mapDocsById(astSnaps);
    const premiseDocsById = mapDocsById(premiseSnaps);

    const finalReadinessUpdates = [];
    const finalReadinessFailures = [];

    for (const tcRowId of selectedTcRowIds) {
      const originalRowSnap = rowDocsById.get(tcRowId);
      const rowData = originalRowSnap.data() || {};
      const astId = getAstIdFromRow(rowData);
      const premiseId = getPremiseIdFromRow(rowData);
      const astSnap = astDocsById.get(astId);
      const premiseSnap = premiseDocsById.get(premiseId);

      if (!astSnap?.exists) {
        return buildFailureResult(
          "AST_NOT_FOUND",
          "A selected TC row points to an AST that no longer exists",
          { tcId, tcRowId, astId },
        );
      }

      if (!premiseSnap?.exists) {
        return buildFailureResult(
          "PREMISE_NOT_FOUND",
          "A selected TC row points to a premise that no longer exists",
          { tcId, tcRowId, premiseId },
        );
      }

      const astDoc = astSnap.data() || {};
      const allocation = findAllocationForRowId(allocations, tcRowId);
      const geofenceRef = allocation?.geofenceRef || null;
      const finalReadiness = buildBgoCreateFinalReadinessPatch({
        rowData,
        astId,
        astDoc,
        trnType,
        now,
        actorUid,
        actorName,
      });

      finalReadinessUpdates.push({
        ref: originalRowSnap.ref,
        patch: finalReadiness.patch,
      });

      const selectedGeofenceStillBelongs = selectedGeofenceBelongsToRow({
        row: finalReadiness.evaluatedRow,
        geofenceRef,
      });

      if (
        !isResolvedTcRowReadyForBgo(finalReadiness.evaluatedRow) ||
        !selectedGeofenceStillBelongs
      ) {
        finalReadinessFailures.push({
          tcRowId,
          astId,
          readinessState:
            finalReadiness.evaluatedRow?.bgo?.readinessState || "NAv",
          readinessReason:
            finalReadiness.evaluatedRow?.bgo?.readinessReason || "NAv",
          selectedGeofenceStillBelongs,
          geofenceRef,
        });
      }

      rowDocsById.set(tcRowId, {
        id: originalRowSnap.id,
        ref: originalRowSnap.ref,
        exists: originalRowSnap.exists,
        data: () => finalReadiness.evaluatedRow,
      });
    }

    if (finalReadinessFailures.length > 0) {
      const committedFinalReadinessUpdates = await commitFinalReadinessUpdates({
        db,
        rowUpdates: finalReadinessUpdates,
      });

      await refreshTcUploadSummariesForTcIds({
        db,
        tcIds: [tcId],
        now,
        updatedByUid: actorUid,
        updatedByUser: actorName,
      });

      return buildFailureResult(
        "BGO_ROWS_REFRESHED_REVIEW_REQUIRED",
        "Some rows are no longer BGO ready. The rows were refreshed. Please review and try again.",
        {
          tcId,
          changedRows: finalReadinessUpdates.length,
          committedFinalReadinessUpdates,
          failedRows: finalReadinessFailures.slice(0, 30),
          failedRowCount: finalReadinessFailures.length,
        },
      );
    }

    if (finalReadinessUpdates.length > 0) {
      await commitFinalReadinessUpdates({
        db,
        rowUpdates: finalReadinessUpdates,
      });
    }

    const plannedBatchIds = [];
    const plannedTrnIds = [];
    const writeJobs = [];
    const createdBatchIds = [];
    const createdTrnIds = [];

    for (const allocation of allocations) {
      const target = getTargetForAllocation(allocation);
      const assignmentCheck = validateLifecycleInstructionAssignment(
        {
          targets: [target],
          instruction: buildAllocationInstruction(allocation, trnType),
        },
        trnType,
      );

      if (!assignmentCheck.ok) {
        return buildFailureResult(
          assignmentCheck.code,
          assignmentCheck.message,
          {
            tcId,
            geofenceRef: allocation.geofenceRef,
            target,
          },
        );
      }

      const bgoBatchId = buildBgoBatchId({
        tcId,
        geofenceId: allocation.geofenceRef?.id,
      });

      plannedBatchIds.push(bgoBatchId);

      const batchRecords = getBatchRowRecords({
        db,
        allocation,
        tcId,
        tcUpload,
        trnType,
        rowDocsById,
        astDocsById,
        premiseDocsById,
        bgoBatchId,
        trnTimestampBaseMs,
        trnTimestampOffsetStart: trnTimestampOffset,
        actorUid,
        actorName,
        now,
      });

      trnTimestampOffset = batchRecords.nextTrnTimestampOffset;

      batchRecords.rowRecords.forEach((rowRecord) => {
        plannedTrnIds.push(rowRecord.trnId);
      });

      createdBatchIds.push(bgoBatchId);
      createdTrnIds.push(...batchRecords.trnIds);

      writeJobs.push((batch) => {
        const batchRef = db.collection(BGO_COLLECTIONS.batches).doc(bgoBatchId);
        batch.create(batchRef, batchRecords.batchDoc);
      });

      writeJobs.push((batch) => {
        const historyRef = db
          .collection(BGO_COLLECTIONS.batches)
          .doc(bgoBatchId)
          .collection("history")
          .doc();

        batch.set(historyRef, batchRecords.batchHistoryDoc);
      });

      writeJobs.push((batch) => {
        const notificationRef = db.collection(BGO_COLLECTIONS.notifications).doc();
        batch.set(notificationRef, batchRecords.notificationDoc);
      });

      for (const rowRecord of batchRecords.rowRecords) {
        const tcRowId = rowRecord.tcRowId || rowRecord.childTrnDoc?.bgo?.tcRowId;
        const astId = rowRecord.childTrnDoc?.refs?.astId || rowRecord.childTrnDoc?.astId;
        const astRef = db.collection(BGO_COLLECTIONS.asts).doc(astId);
        const trnRef = db.collection(BGO_COLLECTIONS.trns).doc(rowRecord.trnId);
        const tcRowRef = db.collection(BGO_COLLECTIONS.tcRows).doc(tcRowId);

        writeJobs.push((batch) => {
          batch.create(trnRef, rowRecord.childTrnDoc);
        });

        writeJobs.push((batch) => {
          const childHistoryRef = trnRef.collection("history").doc();
          batch.set(childHistoryRef, rowRecord.childHistoryDoc);
        });

        writeJobs.push((batch) => {
          batch.update(
            tcRowRef,
            buildTcRowBgoPatch({
              bgoBatchId,
              // BGO row = TRN. Keep bgoRowId as an alias to the TRN id for
              // existing UI/result wording, but do not create bgo_rows docs.
              bgoRowId: rowRecord.trnId,
              trnId: rowRecord.trnId,
              geofenceRef: allocation.geofenceRef,
              target,
              now,
              actorUid,
              actorName,
            }),
          );
        });

        writeJobs.push((batch) => {
          batch.update(astRef, {
            trnActiveLifecycle: rowRecord.astActiveLifecycle,
            ...buildUpdateMetadataPatch({
              now,
              actorUid,
              actorName,
            }),
          });
        });
      }
    }

    const existingOutputPaths = await validateExistingOutputDocs({
      db,
      plannedBatchIds,
      plannedTrnIds,
    });

    if (existingOutputPaths) {
      return buildFailureResult(
        "BGO_OUTPUT_ALREADY_EXISTS",
        "Some BGO output documents already exist. Refresh the BGO page before trying again.",
        {
          existingOutputPaths: existingOutputPaths.slice(0, 20),
          existingCount: existingOutputPaths.length,
        },
      );
    }

    const committedWrites = await commitWriteJobsInChunks({
      db,
      writeJobs,
      chunkSize: 380,
    });

    const postCreateReadinessRefresh =
      await refreshImpactedTcRowsAfterBgoCreate({
        db,
        tcId,
        trnType,
        astIds,
        selectedTcRowIds,
        now,
        actorUid,
        actorName,
      });

    await tcUploadRef.update({
      bgoStatus: getBgoStatusAfterCreate({
        upload: tcUpload,
        selectedCount: selectedTcRowIds.length,
      }),
      "bgo.lastBatchCreatedAt": now,
      "bgo.lastBatchCreatedByUid": actorUid,
      "bgo.lastBatchCreatedByUser": actorName,
      "bgo.lastCreatedBatchIds": createdBatchIds,
      "bgo.lastCreatedTrnIds": createdTrnIds,
      ...buildUpdateMetadataPatch({
        now,
        actorUid,
        actorName,
      }),
    });

    await refreshTcUploadSummariesForTcIds({
      db,
      tcIds: postCreateReadinessRefresh.affectedTcIds?.length
        ? postCreateReadinessRefresh.affectedTcIds
        : [tcId],
      now,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    });

    // DATA CONTRACT:
    // BGO child TRNs are the execution source of truth.
    // Immediately calculate the batch execution mirror after BGO create so
    // new bgo_batches documents are truthful from birth.
    const derivedExecutionSummaryRefresh =
      await refreshBgoBatchDerivedExecutionSummaries({
        db,
        batchIds: createdBatchIds,
        now,
        reason: "BGO_CREATE_COMPLETE",
      });

    const elapsedMs = Date.now() - startedAtMs;

    logger.info("onCreateBgoCallable -- SUCCESS", {
      tcId,
      trnType,
      createdBatchCount: createdBatchIds.length,
      createdBgoRowCount: createdTrnIds.length,
      createdChildTrnCount: createdTrnIds.length,
      committedWrites,
      postCreateReadinessRefresh,
      derivedExecutionSummaryRefresh,
      elapsedMs,
    });

    return buildSuccessResult("BGO created successfully", {
      tcId,
      trnType,
      createdBgoBatchCount: createdBatchIds.length,
      createdBgoRowCount: createdTrnIds.length,
      createdChildTrnCount: createdTrnIds.length,
      bgoBatchIds: createdBatchIds,
      // BGO rows are the MLCT TRNs. This alias preserves the response shape.
      bgoRowIds: createdTrnIds,
      trnIds: createdTrnIds,
      committedWrites,
      readinessRefresh: {
        ...postCreateReadinessRefresh,
        message:
          postCreateReadinessRefresh.overlappingReadyRowsUpdated > 0
            ? `${postCreateReadinessRefresh.overlappingReadyRowsUpdated} TC row(s) from this allocation also appeared in other BGO ready group(s). Those rows were automatically refreshed.`
            : "TC row BGO readiness was refreshed after allocation.",
      },
      derivedExecutionSummaryRefresh,
      elapsedMs,
    });
  } catch (error) {
    logger.error("onCreateBgoCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
      code: error?.code || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to create BGO",
    );
  }
});
