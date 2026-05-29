import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  TC_ALLOWED_ROLES,
  getActorName,
  getUserRole,
} from "./helpers.js";

const REGION = "us-central1";

const TC_UPLOADS_COLLECTION = "tc_uploads";
const TC_ROWS_COLLECTION = "tc_rows";
const TC_UPLOAD_DEDUPE_COLLECTION = "tc_upload_dedupe";
const TC_UPLOAD_DELETIONS_COLLECTION = "tc_upload_deletions";
const TC_REPORTS_COLLECTION = "tc_reports";
const TC_REPORT_ROWS_COLLECTION = "tc_report_rows";
const BGO_ROWS_COLLECTION = "bgo_rows";
const TRNS_COLLECTION = "trns";
const USERS_COLLECTION = "users";

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to delete a TC upload.",
    );
  }
}

async function getCallerData({ db, uid }) {
  const userSnapshot = await db.collection(USERS_COLLECTION).doc(uid).get();

  if (!userSnapshot.exists) {
    return {};
  }

  return userSnapshot.data() || {};
}

function assertCanDeleteTcUpload({ callerData }) {
  const role = getUserRole(callerData);

  if (!TC_ALLOWED_ROLES.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only SPU, ADM, MNG, or SPV users may delete TC uploads.",
    );
  }

  return role;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function hasMeaningfulValue(value) {
  const text = normalizeText(value);

  if (!text) return false;

  const upper = text.toUpperCase();

  return !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(
    upper,
  );
}

function uniqueDocs(docs = []) {
  const docMap = new Map();

  docs.forEach((docSnapshot) => {
    if (!docSnapshot?.id) return;
    docMap.set(docSnapshot.ref.path, docSnapshot);
  });

  return Array.from(docMap.values());
}

function chunkArray(items = [], chunkSize = 450) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

async function getDocsByTcIdFields({ db, collectionName, tcId, fields }) {
  const docs = [];

  for (const field of fields) {
    try {
      const snapshot = await db
        .collection(collectionName)
        .where(field, "==", tcId)
        .get();

      docs.push(...snapshot.docs);
    } catch (error) {
      logger.warn("getDocsByTcIdFields query skipped", {
        collectionName,
        field,
        tcId,
        message: error?.message || String(error),
      });
    }
  }

  return uniqueDocs(docs);
}

async function getTcRowDocs({ db, tcId }) {
  return getDocsByTcIdFields({
    db,
    collectionName: TC_ROWS_COLLECTION,
    tcId,
    fields: ["tcId", "upload.tcId"],
  });
}

function getRowUsageEvidence(rowData = {}) {
  const evidence = [];

  if (rowData?.bgo?.used === true) {
    evidence.push("bgo.used");
  }

  if (hasMeaningfulValue(rowData?.bgo?.batchId)) {
    evidence.push("bgo.batchId");
  }

  if (hasMeaningfulValue(rowData?.batchId)) {
    evidence.push("batchId");
  }

  if (hasMeaningfulValue(rowData?.bgo?.bgoRowId)) {
    evidence.push("bgo.bgoRowId");
  }

  if (hasMeaningfulValue(rowData?.bgoRowId)) {
    evidence.push("bgoRowId");
  }

  if (hasMeaningfulValue(rowData?.bgo?.trnId)) {
    evidence.push("bgo.trnId");
  }

  if (hasMeaningfulValue(rowData?.trnId)) {
    evidence.push("trnId");
  }

  return evidence;
}

async function getBgoRowDocs({ db, tcId }) {
  return getDocsByTcIdFields({
    db,
    collectionName: BGO_ROWS_COLLECTION,
    tcId,
    fields: ["tcId", "upload.tcId", "bgo.tcId", "source.tcId"],
  });
}

async function getTrnDocsForTcUpload({ db, tcId }) {
  return getDocsByTcIdFields({
    db,
    collectionName: TRNS_COLLECTION,
    tcId,
    fields: [
      "tcId",
      "upload.tcId",
      "origin.tcId",
      "bgo.tcId",
      "bucket.tcId",
      "tc.tcId",
    ],
  });
}

async function getTcReportRowDocs({ db, tcId }) {
  return getDocsByTcIdFields({
    db,
    collectionName: TC_REPORT_ROWS_COLLECTION,
    tcId,
    fields: ["tcId", "upload.tcId"],
  });
}

async function deleteRefsInBatches({ db, refs }) {
  let deleted = 0;

  for (const refChunk of chunkArray(refs, 450)) {
    if (refChunk.length === 0) continue;

    const batch = db.batch();

    refChunk.forEach((ref) => batch.delete(ref));

    await batch.commit();
    deleted += refChunk.length;
  }

  return deleted;
}

function buildDeletionAuditDoc({
  tcId,
  uploadData,
  rowCount,
  reportRowCount,
  caller,
  actorName,
  role,
  now,
}) {
  return {
    id: tcId,
    tcId,
    deletedAt: now,
    deletedByUid: caller.uid,
    deletedByUser: actorName,
    deletedByRole: role,
    reason: "USER_DELETED_BEFORE_BGO",
    deletedCounts: {
      tcRows: rowCount,
      tcReportRows: reportRowCount,
    },
    uploadSnapshot: {
      id: uploadData?.id || tcId,
      fileName: uploadData?.fileName || "NAv",
      trnType: uploadData?.trnType || "NAv",
      trnCode: uploadData?.trnCode || "NAv",
      lmPcode: uploadData?.lmPcode || "NAv",
      wardPcode: uploadData?.wardPcode || "NAv",
      totalRows: uploadData?.totalRows || 0,
      readyRows: uploadData?.readyRows || 0,
      usedRows: uploadData?.usedRows || 0,
      bgoStatus: uploadData?.bgoStatus || "NAv",
      validationState: uploadData?.validationState || "NAv",
      dedupeFingerprint: uploadData?.dedupe?.fingerprint || null,
    },
    metadata: {
      createdAt: now,
      createdByUid: caller.uid,
      createdByUser: actorName,
      updatedAt: now,
      updatedByUid: caller.uid,
      updatedByUser: actorName,
    },
  };
}

export const onDeleteTcUploadCallable = onCall(
  { region: REGION, timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    requireAuth(request);

    const db = getFirestore();
    const caller = request.auth;
    const callerData = await getCallerData({ db, uid: caller.uid });
    const actorName = getActorName(caller, callerData);
    const role = assertCanDeleteTcUpload({ callerData });
    const now = new Date().toISOString();

    const tcId = normalizeText(request.data?.tcId);

    if (!tcId) {
      throw new HttpsError(
        "invalid-argument",
        "tcId is required to delete a TC upload.",
      );
    }

    const uploadRef = db.collection(TC_UPLOADS_COLLECTION).doc(tcId);
    const uploadSnapshot = await uploadRef.get();

    if (!uploadSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        `TC upload ${tcId} was not found.`,
      );
    }

    const uploadData = {
      id: uploadSnapshot.id,
      ...(uploadSnapshot.data() || {}),
    };

    const rowDocs = await getTcRowDocs({ db, tcId });
    const rowUsageEvidence = rowDocs
      .map((rowDoc) => ({
        id: rowDoc.id,
        evidence: getRowUsageEvidence(rowDoc.data() || {}),
      }))
      .filter((item) => item.evidence.length > 0);

    if (rowUsageEvidence.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "This TC upload cannot be deleted because one or more TC rows already have BGO/TRN usage evidence.",
        {
          tcId,
          blockedBy: "TC_ROW_USAGE",
          rows: rowUsageEvidence.slice(0, 20),
        },
      );
    }

    const bgoRowDocs = await getBgoRowDocs({ db, tcId });

    if (bgoRowDocs.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "This TC upload cannot be deleted because BGO rows already exist for it.",
        {
          tcId,
          blockedBy: "BGO_ROWS_EXIST",
          count: bgoRowDocs.length,
        },
      );
    }

    const trnDocs = await getTrnDocsForTcUpload({ db, tcId });

    if (trnDocs.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "This TC upload cannot be deleted because TRNs already exist for it.",
        {
          tcId,
          blockedBy: "TRNS_EXIST",
          count: trnDocs.length,
        },
      );
    }

    const reportRows = await getTcReportRowDocs({ db, tcId });
    const reportRef = db.collection(TC_REPORTS_COLLECTION).doc(tcId);
    const reportSnapshot = await reportRef.get();
    const dedupeFingerprint = uploadData?.dedupe?.fingerprint;

    const refsToDelete = [
      ...rowDocs.map((rowDoc) => rowDoc.ref),
      ...reportRows.map((reportRowDoc) => reportRowDoc.ref),
      uploadRef,
    ];

    if (reportSnapshot.exists) {
      refsToDelete.push(reportRef);
    }

    if (hasMeaningfulValue(dedupeFingerprint)) {
      refsToDelete.push(
        db.collection(TC_UPLOAD_DEDUPE_COLLECTION).doc(dedupeFingerprint),
      );
    }

    await db
      .collection(TC_UPLOAD_DELETIONS_COLLECTION)
      .doc(tcId)
      .set(
        buildDeletionAuditDoc({
          tcId,
          uploadData,
          rowCount: rowDocs.length,
          reportRowCount: reportRows.length,
          caller,
          actorName,
          role,
          now,
        }),
      );

    const deletedDocuments = await deleteRefsInBatches({
      db,
      refs: refsToDelete,
    });

    logger.info("onDeleteTcUploadCallable -- deleted", {
      tcId,
      deletedDocuments,
      rowCount: rowDocs.length,
      reportRowCount: reportRows.length,
      dedupeDeleted: hasMeaningfulValue(dedupeFingerprint),
      deletedByUid: caller.uid,
      deletedByUser: actorName,
    });

    return {
      success: true,
      code: "TC_UPLOAD_DELETED",
      tcId,
      deletedDocuments,
      deletedRows: rowDocs.length,
      deletedReportRows: reportRows.length,
      dedupeDeleted: hasMeaningfulValue(dedupeFingerprint),
      message: "TC upload and TC rows deleted successfully.",
    };
  },
);
