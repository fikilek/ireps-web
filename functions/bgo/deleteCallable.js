import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  BGO_COLLECTIONS,
  BGO_CHILD_RELEASE_STATES,
  buildFailureResult,
  buildSuccessResult,
  buildUpdateMetadataPatch,
  commitWriteJobsInChunks,
  getActorNameFromRequest,
  hasMeaningfulValue,
  normalizeUpper,
  resolveBgoCreateAuthority,
} from "./helpers.js";

import { refreshTcUploadSummariesForTcIds } from "../tcUploads/readiness.js";

function getWorkflowState(data = {}) {
  return normalizeUpper(data?.workflow?.state || data?.workflowState || "");
}

function getReleaseState(data = {}) {
  return normalizeUpper(
    data?.bgo?.releaseState ||
      data?.workflow?.releaseState ||
      data?.releaseState ||
      "",
  );
}

function getBgoBatchIdFromRequest(data = {}) {
  return String(data?.bgoBatchId || data?.batchId || data?.id || "").trim();
}

function getTcRowIdFromBgoRow(row = {}) {
  return (
    row?.tcRowId ||
    row?.refs?.tcRowId ||
    row?.bgo?.tcRowId ||
    row?.origin?.tcRowId ||
    ""
  );
}

function getTrnIdFromBgoRow(row = {}) {
  return row?.trnId || row?.refs?.trnId || row?.trn?.id || row?.bgo?.trnId || "";
}

function getAstIdFromBgoRow(row = {}) {
  return row?.refs?.astId || row?.ast?.id || row?.astId || "";
}

function getTcIdFromBgoBatch(batch = {}) {
  return (
    batch?.tcId ||
    batch?.origin?.tcId ||
    batch?.bgo?.tcId ||
    batch?.refs?.tcUploadId ||
    "NAv"
  );
}

function hasAcceptedOrReleasedBatch(batch = {}) {
  const workflow = batch?.workflow || {};
  const state = getWorkflowState(batch);

  return (
    state !== "ISSUED" ||
    Boolean(workflow?.acceptedAt) ||
    Boolean(workflow?.acceptedByUid) ||
    Boolean(workflow?.releasedAt) ||
    Boolean(workflow?.cancelledAt) ||
    Boolean(workflow?.completedAt)
  );
}

function isBgoRowStillWaiting(row = {}) {
  const state = getWorkflowState(row);
  const releaseState = getReleaseState(row);

  const waitingStates = [
    "WAITING_BATCH_ACCEPTANCE",
    "ISSUED",
    "NAV",
    "",
  ];

  return (
    waitingStates.includes(state) &&
    (!releaseState || releaseState === BGO_CHILD_RELEASE_STATES.waiting)
  );
}

function isChildTrnStillDeletable(trn = {}) {
  const state = getWorkflowState(trn);
  const releaseState = getReleaseState(trn);
  const workflow = trn?.workflow || {};

  return (
    ["ISSUED", BGO_CHILD_RELEASE_STATES.waiting].includes(state) &&
    (!releaseState || releaseState === BGO_CHILD_RELEASE_STATES.waiting) &&
    !workflow?.acceptedAt &&
    !workflow?.acceptedByUid &&
    !workflow?.executionStartedAt &&
    !workflow?.completedAt &&
    !workflow?.cancelledAt
  );
}

async function getHistoryDocs(ref) {
  const historySnap = await ref.collection("history").get();
  return historySnap.docs;
}

async function getNotificationDocsForBatch({ db, bgoBatchId }) {
  const snapshot = await db
    .collection(BGO_COLLECTIONS.notifications)
    .where("bgo.batchId", "==", bgoBatchId)
    .get();

  return snapshot.docs;
}


async function getBgoChildTrnDocsForBatch({ db, bgoBatchId }) {
  const trnsRef = db.collection(BGO_COLLECTIONS.trns);
  const queries = [
    trnsRef.where("bgo.batchId", "==", bgoBatchId),
    trnsRef.where("bgo.bgoBatchId", "==", bgoBatchId),
    trnsRef.where("refs.bgoBatchId", "==", bgoBatchId),
    trnsRef.where("refs.batchId", "==", bgoBatchId),
    trnsRef.where("bucket.batchId", "==", bgoBatchId),
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


function isBmdBgoBatch(batch = {}) {
  return (
    normalizeUpper(batch?.bgo?.batchMode) === "BMD" ||
    (normalizeUpper(batch?.operationType) === "METER_DISCOVERY" &&
      normalizeUpper(batch?.origin?.sourceModule) === "BULK_METER_DISCOVERY")
  );
}

async function getDocsLinkedToBgoBatch({ db, collectionName, bgoBatchId, fields = [] }) {
  const docsByPath = new Map();

  for (const field of fields) {
    try {
      const snapshot = await db
        .collection(collectionName)
        .where(field, "==", bgoBatchId)
        .limit(1000)
        .get();

      snapshot.docs.forEach((doc) => {
        docsByPath.set(doc.ref.path, doc);
      });
    } catch (error) {
      logger.warn("getDocsLinkedToBgoBatch -- query skipped", {
        collectionName,
        field,
        bgoBatchId,
        message: error?.message || String(error),
      });
    }
  }

  return Array.from(docsByPath.values());
}

async function getBmdCreatedWorkDocs({ db, bgoBatchId }) {
  const linkFields = [
    "bgo.batchId",
    "bgo.bgoBatchId",
    "refs.bgoBatchId",
    "refs.batchId",
    "origin.bgoBatchId",
    "bucket.batchId",
    "bmd.batchId",
    "bmd.bgoBatchId",
  ];

  const [trnDocs, premiseDocs, astDocs] = await Promise.all([
    getDocsLinkedToBgoBatch({
      db,
      collectionName: BGO_COLLECTIONS.trns,
      bgoBatchId,
      fields: linkFields,
    }),
    getDocsLinkedToBgoBatch({
      db,
      collectionName: BGO_COLLECTIONS.premises,
      bgoBatchId,
      fields: linkFields,
    }),
    getDocsLinkedToBgoBatch({
      db,
      collectionName: BGO_COLLECTIONS.asts,
      bgoBatchId,
      fields: linkFields,
    }),
  ]);

  return {
    trnDocs,
    premiseDocs,
    astDocs,
    total: trnDocs.length + premiseDocs.length + astDocs.length,
  };
}

function buildTcRowRestorePatch({ bgoBatchId, now, actorUid, actorName }) {
  return {
    "bgo.ready": true,
    "bgo.readinessState": "READY_FOR_BGO",
    "bgo.readinessReason": "BGO_DELETED_READY_AGAIN",
    "bgo.used": false,
    "bgo.usedAt": null,
    "bgo.usedByUid": null,
    "bgo.usedByUser": null,
    "bgo.batchId": null,
    "bgo.bgoBatchId": null,
    "bgo.bgoRowId": null,
    "bgo.trnId": null,
    "bgo.target": null,
    "bgo.selectedGeofenceRef": null,
    "bgo.deletedBgoBatchId": bgoBatchId,
    "bgo.restoredAt": now,
    "bgo.restoredByUid": actorUid || "NAv",
    "bgo.restoredByUser": actorName || "NAv",
    ...buildUpdateMetadataPatch({ now, actorUid, actorName }),
  };
}

export const onDeleteUnacceptedBgoCallable = onCall(async (request) => {
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

    const authority = await resolveBgoCreateAuthority({ db, request });

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_BGO_DELETE",
        "Only MNG and SPV(MNC) can delete unaccepted BGO batches",
        {
          actorRole: authority.role,
          actorRelationshipType: authority.relationshipType,
          actorClientType: authority.clientType,
        },
      );
    }

    const bgoBatchId = getBgoBatchIdFromRequest(data);

    if (!bgoBatchId) {
      return buildFailureResult(
        "INVALID_BGO_BATCH_ID",
        "bgoBatchId is required",
      );
    }

    logger.info("onDeleteUnacceptedBgoCallable -- START", {
      bgoBatchId,
      actorUid,
    });

    const bgoBatchRef = db.collection(BGO_COLLECTIONS.batches).doc(bgoBatchId);
    const bgoBatchSnap = await bgoBatchRef.get();

    if (!bgoBatchSnap.exists) {
      return buildFailureResult(
        "BGO_BATCH_NOT_FOUND",
        "The selected BGO batch was not found",
        { bgoBatchId },
      );
    }

    const bgoBatch = bgoBatchSnap.data() || {};
    const tcId = getTcIdFromBgoBatch(bgoBatch);

    if (hasAcceptedOrReleasedBatch(bgoBatch)) {
      return buildFailureResult(
        "BGO_BATCH_NOT_DELETABLE",
        "Only ISSUED BGO batches that have not been accepted, released, cancelled, or completed can be deleted",
        {
          bgoBatchId,
          workflowState: getWorkflowState(bgoBatch),
        },
      );
    }


    if (isBmdBgoBatch(bgoBatch)) {
      const linkedWorkDocs = await getBmdCreatedWorkDocs({ db, bgoBatchId });

      if (linkedWorkDocs.total > 0) {
        return buildFailureResult(
          "BMD_BGO_HAS_CREATED_WORK",
          "This MD BGO allocation cannot be removed because a premise or meter has already been created under it",
          {
            bgoBatchId,
            linkedTrns: linkedWorkDocs.trnDocs.length,
            linkedPremises: linkedWorkDocs.premiseDocs.length,
            linkedMeters: linkedWorkDocs.astDocs.length,
          },
        );
      }

      const batchHistoryDocs = await getHistoryDocs(bgoBatchRef);
      const notificationDocs = await getNotificationDocsForBatch({
        db,
        bgoBatchId,
      });

      const writeJobs = [];

      batchHistoryDocs.forEach((historyDoc) => {
        writeJobs.push((batch) => batch.delete(historyDoc.ref));
      });

      notificationDocs.forEach((notificationDoc) => {
        writeJobs.push((batch) => batch.delete(notificationDoc.ref));
      });

      writeJobs.push((batch) => batch.delete(bgoBatchRef));

      const committedWrites = await commitWriteJobsInChunks({
        db,
        writeJobs,
        chunkSize: 380,
      });

      const elapsedMs = Date.now() - startedAtMs;

      logger.info("onDeleteUnacceptedBgoCallable -- BMD SUCCESS", {
        bgoBatchId,
        committedWrites,
        elapsedMs,
      });

      return buildSuccessResult("MD BGO allocation removed successfully", {
        bgoBatchId,
        deletedBgoRows: 0,
        deletedChildTrns: 0,
        restoredTcRows: 0,
        committedWrites,
        elapsedMs,
      });
    }

    const bgoTrnDocs = await getBgoChildTrnDocsForBatch({ db, bgoBatchId });
    const bgoRows = bgoTrnDocs.map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      data: doc.data() || {},
    }));

    const blockedRows = bgoRows
      .filter((row) => !isBgoRowStillWaiting(row.data))
      .map((row) => ({
        bgoRowId: row.id,
        workflowState: getWorkflowState(row.data),
        releaseState: getReleaseState(row.data),
      }));

    if (blockedRows.length > 0) {
      return buildFailureResult(
        "BGO_ROWS_ALREADY_RELEASED",
        "This BGO batch has rows that are no longer waiting for batch acceptance",
        {
          bgoBatchId,
          blockedRows: blockedRows.slice(0, 20),
          blockedCount: blockedRows.length,
        },
      );
    }

    const trnIds = [...new Set(bgoRows.map((row) => row.id).filter(Boolean))];
    const trnRefs = bgoRows.map((row) => row.ref);
    const blockedTrns = [];

    bgoRows.forEach((row) => {
      const trnData = row.data || {};

      if (!isChildTrnStillDeletable(trnData)) {
        blockedTrns.push({
          trnId: row.id,
          workflowState: getWorkflowState(trnData),
          releaseState: getReleaseState(trnData),
        });
      }
    });

    if (blockedTrns.length > 0) {
      return buildFailureResult(
        "BGO_CHILD_TRNS_NOT_DELETABLE",
        "This BGO batch has child TRNs that are no longer safe to delete",
        {
          bgoBatchId,
          blockedTrns: blockedTrns.slice(0, 20),
          blockedCount: blockedTrns.length,
        },
      );
    }

    const tcRowIds = [
      ...new Set(
        bgoRows
          .map((row) => getTcRowIdFromBgoRow(row.data))
          .filter((id) => hasMeaningfulValue(id)),
      ),
    ];

    const astIds = [
      ...new Set(
        bgoRows
          .map((row) => getAstIdFromBgoRow(row.data))
          .filter((id) => hasMeaningfulValue(id)),
      ),
    ];

    const tcRowRefs = tcRowIds.map((tcRowId) =>
      db.collection(BGO_COLLECTIONS.tcRows).doc(tcRowId),
    );

    const astRefs = astIds.map((astId) =>
      db.collection(BGO_COLLECTIONS.asts).doc(astId),
    );

    const [tcRowSnaps, astSnaps] = await Promise.all([
      tcRowRefs.length ? db.getAll(...tcRowRefs) : [],
      astRefs.length ? db.getAll(...astRefs) : [],
    ]);

    const astSnapById = new Map(astSnaps.map((snap) => [snap.id, snap]));

    const batchHistoryDocs = await getHistoryDocs(bgoBatchRef);
    const trnHistoryGroups = await Promise.all(
      trnRefs.map(async (trnRef) => ({
        trnId: trnRef.id,
        docs: await getHistoryDocs(trnRef),
      })),
    );
    const notificationDocs = await getNotificationDocsForBatch({
      db,
      bgoBatchId,
    });

    const writeJobs = [];

    batchHistoryDocs.forEach((historyDoc) => {
      writeJobs.push((batch) => batch.delete(historyDoc.ref));
    });

    trnHistoryGroups.forEach((group) => {
      group.docs.forEach((historyDoc) => {
        writeJobs.push((batch) => batch.delete(historyDoc.ref));
      });
    });

    notificationDocs.forEach((notificationDoc) => {
      writeJobs.push((batch) => batch.delete(notificationDoc.ref));
    });

    trnRefs.forEach((trnRef) => {
      writeJobs.push((batch) => batch.delete(trnRef));
    });

    tcRowSnaps.forEach((tcRowSnap) => {
      if (!tcRowSnap.exists) return;

      const tcRowData = tcRowSnap.data() || {};
      const rowBatchId =
        tcRowData?.bgo?.batchId ||
        tcRowData?.bgo?.bgoBatchId ||
        tcRowData?.batchId ||
        "";

      if (rowBatchId !== bgoBatchId) return;

      writeJobs.push((batch) =>
        batch.update(
          tcRowSnap.ref,
          buildTcRowRestorePatch({
            bgoBatchId,
            now,
            actorUid,
            actorName,
          }),
        ),
      );
    });

    bgoRows.forEach((row) => {
      const astId = getAstIdFromBgoRow(row.data);
      const trnId = getTrnIdFromBgoRow(row.data);
      const astSnap = astSnapById.get(astId);

      if (!astSnap?.exists) return;

      const astData = astSnap.data() || {};
      const activeTrnId = astData?.trnActiveLifecycle?.trnId || "";

      if (activeTrnId !== trnId) return;

      writeJobs.push((batch) =>
        batch.update(astSnap.ref, {
          trnActiveLifecycle: FieldValue.delete(),
          ...buildUpdateMetadataPatch({ now, actorUid, actorName }),
        }),
      );
    });

    writeJobs.push((batch) => batch.delete(bgoBatchRef));

    const committedWrites = await commitWriteJobsInChunks({
      db,
      writeJobs,
      chunkSize: 380,
    });

    if (hasMeaningfulValue(tcId)) {
      await refreshTcUploadSummariesForTcIds({
        db,
        tcIds: [tcId],
        now,
        updatedByUid: actorUid,
        updatedByUser: actorName,
      });
    }

    const elapsedMs = Date.now() - startedAtMs;

    logger.info("onDeleteUnacceptedBgoCallable -- SUCCESS", {
      bgoBatchId,
      tcId,
      deletedBgoRows: bgoRows.length,
      deletedChildTrns: trnIds.length,
      restoredTcRows: tcRowIds.length,
      committedWrites,
      elapsedMs,
    });

    return buildSuccessResult("Unaccepted BGO batch deleted successfully", {
      bgoBatchId,
      tcId,
      deletedBgoRows: bgoRows.length,
      deletedChildTrns: trnIds.length,
      restoredTcRows: tcRowIds.length,
      committedWrites,
      elapsedMs,
    });
  } catch (error) {
    logger.error("onDeleteUnacceptedBgoCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
      code: error?.code || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to delete unaccepted BGO batch",
    );
  }
});
