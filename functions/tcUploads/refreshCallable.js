import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

const TC_UPLOADS_COLLECTION = "tc_uploads";
const TC_ROWS_COLLECTION = "tc_rows";
const ASTS_COLLECTION = "asts";
const USERS_COLLECTION = "users";

const TC_ALLOWED_ROLES = ["SPU", "ADM", "MNG", "SPV"];
const TC_ACTIVE_WORKFLOW_STATES = [
  "ISSUED",
  "ACCEPTED",
  "REASSIGNED",
  "IN_PROGRESS",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  if (value === undefined || value === null) return "NAv";

  const text = String(value).trim();
  return text || "NAv";
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function getUserRole(userData = {}) {
  return normalizeUpper(
    userData?.profile?.employment?.role ||
      userData?.employment?.role ||
      userData?.role ||
      "",
  );
}

function getActorName(caller, userData = {}) {
  return (
    userData?.profile?.displayName ||
    userData?.displayName ||
    caller?.token?.name ||
    caller?.token?.email ||
    caller?.displayName ||
    caller?.uid ||
    "SYSTEM"
  );
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to refresh TC geofence readiness.",
    );
  }
}

async function getCallerData({ db, uid }) {
  const userSnapshot = await db.collection(USERS_COLLECTION).doc(uid).get();

  if (!userSnapshot.exists) return {};

  return userSnapshot.data() || {};
}

function assertCanRefreshTc({ callerData }) {
  const role = getUserRole(callerData);

  if (!TC_ALLOWED_ROLES.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only SPU, ADM, MNG, or SPV users may refresh TC readiness.",
    );
  }

  return role;
}

function normalizeGeoFenceRefs(refs = []) {
  const seenIds = new Set();

  return asArray(refs)
    .map((ref) => ({
      id: normalizeText(ref?.id),
      name: normalizeText(ref?.name || ref?.description || ref?.id),
    }))
    .filter((ref) => {
      if (!ref.id || ref.id === "NAv" || seenIds.has(ref.id)) return false;
      seenIds.add(ref.id);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveAstId(row = {}) {
  const candidates = [
    row?.ast?.id,
    row?.ast?.astId,
    row?.backend?.astId,
    row?.astId,
    row?.sourceAstId,
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text && text !== "NAv") return text;
  }

  return "";
}

function getActiveSameOperationLifecycle({ trnType, astData }) {
  const lifecycle = astData?.trnActiveLifecycle || null;

  if (!lifecycle) return null;

  const lifecycleTrnType = normalizeUpper(lifecycle?.trnType);
  const requestedTrnType = normalizeUpper(trnType);
  const workflowState = normalizeUpper(lifecycle?.workflowState);

  if (lifecycleTrnType !== requestedTrnType) return null;
  if (!TC_ACTIVE_WORKFLOW_STATES.includes(workflowState)) return null;

  return {
    trnId: lifecycle?.trnId || "NAv",
    trnType: lifecycleTrnType,
    workflowState,
    updatedAt: lifecycle?.updatedAt || null,
    updatedByUser: lifecycle?.updatedByUser || "NAv",
  };
}

function buildBgoReadiness({
  frontendValid,
  matched,
  eligible,
  duplicateMeterNo,
  activeSameOperationLifecycle,
  geofenceRefs,
}) {
  if (!frontendValid) {
    return {
      ready: false,
      readinessState: "FRONTEND_INVALID",
      reason: "Frontend validation failed.",
    };
  }

  if (!matched) {
    return {
      ready: false,
      readinessState: "NOT_FOUND",
      reason: "Meter was not found in iREPS.",
    };
  }

  if (!eligible) {
    return {
      ready: false,
      readinessState: "NOT_ELIGIBLE",
      reason: "Meter is not eligible for the selected operation.",
    };
  }

  if (duplicateMeterNo) {
    return {
      ready: false,
      readinessState: "DUPLICATE_METER_IN_UPLOAD",
      reason: "Meter number appears more than once in this TC upload.",
    };
  }

  if (activeSameOperationLifecycle) {
    return {
      ready: false,
      readinessState: "BLOCKED_ACTIVE_SAME_OPERATION_TRN",
      reason: "Meter already has active/pending work for the same operation.",
    };
  }

  if (!Array.isArray(geofenceRefs) || geofenceRefs.length === 0) {
    return {
      ready: false,
      readinessState: "NEEDS_GEOFENCE",
      reason: "Matched meter has no geofenceRefs.",
    };
  }

  return {
    ready: true,
    readinessState: "READY_FOR_BGO",
    reason: "Ready for BGO.",
  };
}

function reasonCodesForReadiness(readiness) {
  if (readiness?.ready === true) return [];
  if (!readiness?.readinessState) return [];
  return [readiness.readinessState];
}

function buildAstPatchFromCurrentAst(rowAst = {}, currentAstData = {}) {
  const accessData = currentAstData?.accessData || {};
  const parents = accessData?.parents || currentAstData?.parents || {};

  return {
    ...rowAst,
    id: normalizeText(currentAstData?.id || rowAst?.id || rowAst?.astId),
    astId: normalizeText(currentAstData?.id || rowAst?.astId || rowAst?.id),
    astNo: normalizeText(
      currentAstData?.astData?.astNo ||
        currentAstData?.master?.id ||
        rowAst?.astNo,
    ),
    premiseId: normalizeText(
      accessData?.premiseId ||
        accessData?.premise?.id ||
        currentAstData?.premiseId ||
        rowAst?.premiseId,
    ),
    statusState: normalizeText(
      currentAstData?.status?.state ||
        currentAstData?.status?.id ||
        rowAst?.statusState,
    ),
    meterType: normalizeText(
      currentAstData?.meterType ||
        currentAstData?.serviceType ||
        currentAstData?.astData?.meter?.serviceType ||
        rowAst?.meterType,
    ),
    erfNo: normalizeText(accessData?.erfNo || currentAstData?.erfNo || rowAst?.erfNo),
    erfId: normalizeText(accessData?.erfId || currentAstData?.erfId || rowAst?.erfId),
    wardPcode: normalizeText(parents?.wardPcode || rowAst?.wardPcode),
    geofenceRefs: normalizeGeoFenceRefs(currentAstData?.geofenceRefs),
  };
}

function buildRefreshedRow({ rowSnapshot, upload, astDataById, now, actorUid, actorName }) {
  const row = rowSnapshot.data() || {};
  const astId = resolveAstId(row);
  const astData = astId ? astDataById.get(astId) || null : null;
  const currentAstData = astData ? { ...astData, id: astId } : null;
  const currentGeoFenceRefs = currentAstData
    ? normalizeGeoFenceRefs(currentAstData?.geofenceRefs)
    : normalizeGeoFenceRefs(row?.geofenceRefs || row?.ast?.geofenceRefs);

  const frontendValid = row?.frontend?.valid === true;
  const matched = row?.backend?.matched === true;
  const eligible = row?.backend?.eligible === true;
  const duplicateMeterNo = row?.backend?.duplicateMeterNo === true;
  const activeSameOperationLifecycle = currentAstData
    ? getActiveSameOperationLifecycle({
        trnType: upload?.trnType,
        astData: currentAstData,
      })
    : row?.backend?.activeLifecycle || null;

  const readiness = buildBgoReadiness({
    frontendValid,
    matched,
    eligible,
    duplicateMeterNo,
    activeSameOperationLifecycle,
    geofenceRefs: currentGeoFenceRefs,
  });

  const existingBgo = row?.bgo || {};
  const used = existingBgo?.used === true || Boolean(existingBgo?.batchId);

  const rowPatch = {
    geofenceRefs: currentGeoFenceRefs,
    ast: currentAstData
      ? buildAstPatchFromCurrentAst(row?.ast || {}, currentAstData)
      : {
          ...(row?.ast || {}),
          geofenceRefs: currentGeoFenceRefs,
        },
    backend: {
      ...(row?.backend || {}),
      alreadyHasActiveSameOperationTrn: Boolean(activeSameOperationLifecycle),
      activeLifecycle: activeSameOperationLifecycle || null,
      reasonCodes: reasonCodesForReadiness(readiness),
      message: readiness.reason,
    },
    bgo: {
      ...existingBgo,
      ready: readiness.ready,
      readinessState: readiness.readinessState,
      readinessReason: readiness.reason,
      used,
      batchId: existingBgo?.batchId || null,
      usedAt: existingBgo?.usedAt || null,
    },
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };

  const nextRow = {
    ...row,
    ...rowPatch,
    metadata: {
      ...(row?.metadata || {}),
      updatedAt: now,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    },
  };

  const beforeState = row?.bgo?.readinessState || "NAv";
  const beforeReady = row?.bgo?.ready === true;
  const beforeGeoFenceIds = normalizeGeoFenceRefs(row?.geofenceRefs)
    .map((ref) => ref.id)
    .join("|");
  const afterGeoFenceIds = currentGeoFenceRefs.map((ref) => ref.id).join("|");

  const changed =
    beforeState !== readiness.readinessState ||
    beforeReady !== readiness.ready ||
    beforeGeoFenceIds !== afterGeoFenceIds ||
    row?.backend?.alreadyHasActiveSameOperationTrn !==
      Boolean(activeSameOperationLifecycle);

  return {
    id: rowSnapshot.id,
    ref: rowSnapshot.ref,
    patch: rowPatch,
    nextRow,
    changed,
    beforeState,
    afterState: readiness.readinessState,
  };
}

function summarizeRows(rowDocs = []) {
  const summary = {
    totalRows: rowDocs.length,
    validRows: rowDocs.filter((row) => row?.frontend?.valid).length,
    invalidRows: rowDocs.filter((row) => !row?.frontend?.valid).length,
    foundRows: rowDocs.filter((row) => row?.backend?.matched).length,
    notFoundRows: rowDocs.filter((row) => row?.backend?.notFound).length,
    withGeofenceRows: rowDocs.filter(
      (row) => normalizeGeoFenceRefs(row?.geofenceRefs).length > 0,
    ).length,
    withoutGeofenceRows: rowDocs.filter(
      (row) => normalizeGeoFenceRefs(row?.geofenceRefs).length === 0,
    ).length,
    readyRows: rowDocs.filter((row) => row?.bgo?.ready).length,
    usedRows: rowDocs.filter((row) => row?.bgo?.used).length,
    needsGeofenceRows: rowDocs.filter(
      (row) => row?.bgo?.readinessState === "NEEDS_GEOFENCE",
    ).length,
    notEligibleRows: rowDocs.filter(
      (row) => row?.bgo?.readinessState === "NOT_ELIGIBLE",
    ).length,
    blockedActiveSameOperationRows: rowDocs.filter(
      (row) => row?.bgo?.readinessState === "BLOCKED_ACTIVE_SAME_OPERATION_TRN",
    ).length,
    duplicateMeterRows: rowDocs.filter(
      (row) => row?.bgo?.readinessState === "DUPLICATE_METER_IN_UPLOAD",
    ).length,
  };

  summary.remainingRows = Math.max(summary.readyRows - summary.usedRows, 0);
  return summary;
}

function buildGeofenceBreakdown(rowDocs = []) {
  const countMap = new Map();

  rowDocs.forEach((row) => {
    normalizeGeoFenceRefs(row?.geofenceRefs).forEach((ref) => {
      if (!ref?.id) return;

      const current = countMap.get(ref.id) || {
        id: ref.id,
        name: ref.name || ref.id,
        count: 0,
      };

      current.count += 1;
      countMap.set(ref.id, current);
    });
  });

  return Array.from(countMap.values()).sort((a, b) => b.count - a.count);
}

function getValidationState(summary) {
  if (summary.invalidRows === 0 && summary.readyRows === summary.totalRows) {
    return "VALIDATED";
  }

  return "VALIDATED_WITH_EXCEPTIONS";
}

function getBgoStatus(summary) {
  if (summary.readyRows > 0) return "READY_FOR_BGO";
  return "NOT_READY";
}

async function fetchAstDataById({ db, astIds }) {
  const uniqueAstIds = Array.from(new Set(astIds.filter(Boolean)));
  const astDataById = new Map();

  for (let index = 0; index < uniqueAstIds.length; index += 300) {
    const astIdChunk = uniqueAstIds.slice(index, index + 300);
    const astRefs = astIdChunk.map((astId) => db.collection(ASTS_COLLECTION).doc(astId));
    const astSnapshots = await db.getAll(...astRefs);

    astSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;
      astDataById.set(snapshot.id, snapshot.data() || {});
    });
  }

  return astDataById;
}

async function commitRowUpdates({ db, refreshedRows }) {
  let changedRows = 0;

  for (let index = 0; index < refreshedRows.length; index += 400) {
    const rowChunk = refreshedRows.slice(index, index + 400);
    const batch = db.batch();
    let hasWrites = false;

    rowChunk.forEach((item) => {
      if (!item.changed) return;
      batch.update(item.ref, item.patch);
      hasWrites = true;
      changedRows += 1;
    });

    if (hasWrites) {
      await batch.commit();
    }
  }

  return changedRows;
}

export const onRefreshTcUploadGeofenceReadinessCallable = onCall(async (request) => {
  const db = getFirestore();
  requireAuth(request);

  const caller = request.auth;
  const callerData = await getCallerData({ db, uid: caller.uid });
  const role = assertCanRefreshTc({ callerData });
  const actorName = getActorName(caller, callerData);
  const now = new Date().toISOString();

  const tcId = String(request.data?.tcId || "").trim();

  if (!tcId) {
    throw new HttpsError("invalid-argument", "tcId is required.");
  }

  const uploadRef = db.collection(TC_UPLOADS_COLLECTION).doc(tcId);
  const uploadSnapshot = await uploadRef.get();

  if (!uploadSnapshot.exists) {
    throw new HttpsError("not-found", `TC upload ${tcId} was not found.`);
  }

  const upload = {
    id: uploadSnapshot.id,
    ...(uploadSnapshot.data() || {}),
  };

  const rowSnapshot = await db
    .collection(TC_ROWS_COLLECTION)
    .where("tcId", "==", tcId)
    .get();

  const astIds = rowSnapshot.docs.map((rowDoc) => resolveAstId(rowDoc.data() || {}));
  const astDataById = await fetchAstDataById({ db, astIds });

  const refreshedRows = rowSnapshot.docs.map((rowDoc) =>
    buildRefreshedRow({
      rowSnapshot: rowDoc,
      upload,
      astDataById,
      now,
      actorUid: caller.uid,
      actorName,
    }),
  );

  const changedRows = await commitRowUpdates({ db, refreshedRows });
  const nextRows = refreshedRows.map((item) => item.nextRow);
  const summary = summarizeRows(nextRows);
  const geofenceBreakdown = buildGeofenceBreakdown(nextRows);
  const validationState = getValidationState(summary);
  const bgoStatus = getBgoStatus(summary);

  await uploadRef.update({
    ...summary,
    validationState,
    bgoStatus,
    writeState: "READY",
    summary: {
      totalMeters: summary.totalRows,
      validatedMeters: summary.validRows,
      invalidatedMeters: summary.invalidRows,
      foundMeters: summary.foundRows,
      notFoundMeters: summary.notFoundRows,
      withGeofenceMeters: summary.withGeofenceRows,
      withoutGeofenceMeters: summary.withoutGeofenceRows,
      readyForBgo: summary.readyRows,
      needsGeofence: summary.needsGeofenceRows,
      notEligibleRows: summary.notEligibleRows,
      blockedActiveSameOperationRows: summary.blockedActiveSameOperationRows,
      duplicateMeterRows: summary.duplicateMeterRows,
      geofenceBreakdown,
    },
    repair: {
      lastGeofenceReadinessRefreshAt: now,
      lastGeofenceReadinessRefreshByUid: caller.uid,
      lastGeofenceReadinessRefreshByUser: actorName,
      lastGeofenceReadinessRefreshChangedRows: changedRows,
    },
    "metadata.updatedAt": now,
    "metadata.updatedByUid": caller.uid,
    "metadata.updatedByUser": actorName,
  });

  return {
    success: true,
    code: "TC_GEOFENCE_READINESS_REFRESHED",
    tcId,
    role,
    totalRows: refreshedRows.length,
    changedRows,
    readyRows: summary.readyRows,
    needsGeofenceRows: summary.needsGeofenceRows,
    message: `TC geofence readiness refreshed. ${changedRows} row(s) changed.`,
  };
});
