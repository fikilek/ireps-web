// /functions/geofences/membership.js

/* eslint-disable no-undef */

import { getFirestore } from "firebase-admin/firestore";

import {
  appendGeoFenceRef,
  doesEntityBelongToGeoFence,
  extractAstPoint,
  extractErfPoint,
  extractPremisePoint,
  normalizeGeoFenceRefs,
} from "./helpers.js";

/* =====================================================
   GENERIC HELPERS
   ===================================================== */

export const chunkArray = (items = [], size = 200) => {
  if (!Array.isArray(items) || !items.length) return [];
  if (!Number.isFinite(size) || size <= 0) return [items];

  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

export const primitiveArraysEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }

  return true;
};

export const geoFenceRefsEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (left[i]?.id !== right[i]?.id) return false;
    if (left[i]?.name !== right[i]?.name) return false;
  }

  return true;
};

function hasGeoFenceRef(item = {}, geoFenceId = "") {
  const refs = Array.isArray(item?.geofenceRefs) ? item.geofenceRefs : [];

  return refs.some((ref) => ref?.id === geoFenceId);
}

export const buildMembershipUpdate = ({
  docRef,
  existingGeoFenceRefs,
  geoFenceId,
  geoFenceName,
}) => {
  const currentGeoFenceRefs = normalizeGeoFenceRefs(existingGeoFenceRefs || []);

  const nextGeoFenceRefs = normalizeGeoFenceRefs(
    appendGeoFenceRef(currentGeoFenceRefs, {
      id: geoFenceId,
      name: geoFenceName,
    }),
  );

  const refsUnchanged = geoFenceRefsEqual(
    currentGeoFenceRefs,
    nextGeoFenceRefs,
  );

  if (refsUnchanged) {
    return null;
  }

  return {
    ref: docRef,
    data: {
      geofenceRefs: nextGeoFenceRefs,
    },
  };
};

/* =====================================================
   COLLECT ENTITY UPDATES
   ===================================================== */

export const collectGeoFenceErfUpdates = ({
  erfDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const erfDoc of erfDocs) {
    const erfData = erfDoc.data() || {};
    const point = extractErfPoint(erfData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: erfDoc.ref,
      existingGeoFenceRefs: erfData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};

export const collectGeoFencePremiseUpdates = ({
  premiseDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const premiseDoc of premiseDocs) {
    const premiseData = premiseDoc.data() || {};
    const point = extractPremisePoint(premiseData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: premiseDoc.ref,
      existingGeoFenceRefs: premiseData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};

export const collectGeoFenceAstUpdates = ({
  astDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const astDoc of astDocs) {
    const astData = astDoc.data() || {};
    const point = extractAstPoint(astData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: astDoc.ref,
      existingGeoFenceRefs: astData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};


/* =====================================================
   TC ROW MEMBERSHIP / READINESS REFRESH
   ===================================================== */

const TC_NEEDS_GEOFENCE_CODES = new Set([
  "NEEDS_GEOFENCE",
  "NO_GEOFENCE",
]);

const TC_NOT_READY_FOR_BGO = "NOT_READY_FOR_BGO";
const TC_READY_FOR_BGO = "READY_FOR_BGO";

function normalizeScopeValue(value) {
  const text = String(value || "").trim();
  if (!text || text === "NAv" || text === "NAV") return "NAv";
  return text;
}

function normalizeTcReasonCodes(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function getTcRowTcId(row = {}) {
  return String(row?.tcId || row?.upload?.tcId || "").trim();
}

function getTcRowAstId(row = {}) {
  return String(
    row?.astId ||
      row?.ast?.id ||
      row?.ast?.astId ||
      row?.backend?.astId ||
      row?.backend?.matchedAstId ||
      "",
  ).trim();
}

function getTcRowLmPcode(row = {}) {
  return normalizeScopeValue(
    row?.ast?.parents?.lmPcode ||
      row?.ast?.accessData?.parents?.lmPcode ||
      row?.ast?.lmPcode ||
      row?.upload?.lmPcode ||
      row?.parents?.lmPcode,
  );
}

function getTcRowWardPcode(row = {}) {
  return normalizeScopeValue(
    row?.ast?.parents?.wardPcode ||
      row?.ast?.accessData?.parents?.wardPcode ||
      row?.ast?.wardPcode ||
      row?.upload?.wardPcode ||
      row?.parents?.wardPcode,
  );
}

function getCoordinatePoint(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function extractTcRowPoint(tcRow = {}, astDataById = new Map()) {
  const directPoint =
    getCoordinatePoint(tcRow?.ast?.gps) ||
    getCoordinatePoint(tcRow?.ast?.location?.gps) ||
    getCoordinatePoint(tcRow?.ast?.ast?.location?.gps) ||
    getCoordinatePoint(tcRow?.ast?.astData?.location?.gps);

  if (directPoint) return directPoint;

  const astId = getTcRowAstId(tcRow);
  const astData = astId ? astDataById.get(astId) : null;

  return extractAstPoint(astData || {});
}

function shouldSkipTcRowForGeoFenceRefresh(row = {}) {
  if (row?.backend?.matched !== true) return true;
  if (row?.bgo?.used === true) return true;
  if (row?.bgo?.batchId) return true;
  if (row?.batchId) return true;

  return false;
}

function isTcRowInGeoFenceScope(row = {}, lmPcode, wardPcode) {
  const rowLmPcode = getTcRowLmPcode(row);
  const rowWardPcode = getTcRowWardPcode(row);

  if (rowLmPcode !== "NAv" && rowLmPcode !== lmPcode) {
    return false;
  }

  if (rowWardPcode !== "NAv" && rowWardPcode !== wardPcode) {
    return false;
  }

  return true;
}

function buildNextTcBgoPatch({ row = {}, nextGeoFenceRefs = [], now }) {
  const currentReasonCodes = normalizeTcReasonCodes(row?.backend?.reasonCodes);
  const nextReasonCodes = currentReasonCodes.filter(
    (code) => !TC_NEEDS_GEOFENCE_CODES.has(code),
  );

  const hasFatalFrontendError = row?.frontend?.valid !== true;
  const isMatched = row?.backend?.matched === true;
  const isEligible = row?.backend?.eligible === true;
  const hasActiveSameOperationTrn =
    row?.backend?.alreadyHasActiveSameOperationTrn === true;
  const isDuplicateInUpload =
    row?.backend?.duplicateMeterInUpload === true ||
    row?.backend?.duplicateInUpload === true ||
    nextReasonCodes.includes("DUPLICATE_METER_IN_UPLOAD");
  const isUsed = row?.bgo?.used === true || Boolean(row?.bgo?.batchId);
  const hasGeofence = nextGeoFenceRefs.length > 0;

  const canBecomeReady =
    hasGeofence &&
    !hasFatalFrontendError &&
    isMatched &&
    isEligible &&
    !hasActiveSameOperationTrn &&
    !isDuplicateInUpload &&
    !isUsed &&
    nextReasonCodes.length === 0;

  if (canBecomeReady) {
    return {
      "backend.reasonCodes": [],
      "backend.message": "Ready for BGO.",
      "bgo.ready": true,
      "bgo.readinessState": TC_READY_FOR_BGO,
      "bgo.readinessReason": "Ready for BGO.",
      "bgo.updatedAt": now,
      "bgo.updatedByUid": "SYSTEM",
      "bgo.updatedByUser": "onGeoFenceCreated",
    };
  }

  const nextReadinessState = nextReasonCodes[0] || TC_NOT_READY_FOR_BGO;

  return {
    "backend.reasonCodes": nextReasonCodes,
    "bgo.ready": false,
    "bgo.readinessState": nextReadinessState,
    "bgo.readinessReason":
      nextReasonCodes.length > 0
        ? nextReasonCodes.join(", ")
        : "Row is not ready for BGO.",
    "bgo.updatedAt": now,
    "bgo.updatedByUid": "SYSTEM",
    "bgo.updatedByUser": "onGeoFenceCreated",
  };
}

export const collectGeoFenceTcRowUpdates = ({
  tcRowDocs = [],
  astDocs = [],
  geoFenceId,
  geoFenceName,
  lmPcode,
  wardPcode,
  bbox,
  polygonPoints,
}) => {
  const updates = [];
  const now = new Date().toISOString();
  const astDataById = new Map(
    (Array.isArray(astDocs) ? astDocs : []).map((astDoc) => [
      astDoc.id,
      astDoc.data() || {},
    ]),
  );

  for (const tcRowDoc of tcRowDocs) {
    const row = tcRowDoc.data() || {};

    if (shouldSkipTcRowForGeoFenceRefresh(row)) continue;
    if (!isTcRowInGeoFenceScope(row, lmPcode, wardPcode)) continue;

    const point = extractTcRowPoint(row, astDataById);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const currentGeoFenceRefs = normalizeGeoFenceRefs(row?.geofenceRefs || []);
    const nextGeoFenceRefs = normalizeGeoFenceRefs(
      appendGeoFenceRef(currentGeoFenceRefs, {
        id: geoFenceId,
        name: geoFenceName,
      }),
    );

    const refsUnchanged = geoFenceRefsEqual(
      currentGeoFenceRefs,
      nextGeoFenceRefs,
    );

    const readinessPatch = buildNextTcBgoPatch({
      row,
      nextGeoFenceRefs,
      now,
    });

    if (refsUnchanged && row?.bgo?.readinessState === TC_READY_FOR_BGO) {
      continue;
    }

    const updateData = {
      geofenceRefs: nextGeoFenceRefs,
      "ast.geofenceRefs": nextGeoFenceRefs,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "onGeoFenceCreated",
      ...readinessPatch,
    };

    updates.push({
      ref: tcRowDoc.ref,
      data: updateData,
      tcId: getTcRowTcId(row),
    });
  }

  return updates;
};

/* =====================================================
   COMMIT UPDATES IN BATCHES
   ===================================================== */

export const commitGeoFenceMembershipUpdates = async ({
  db,
  updates = [],
  batchSize = 200,
}) => {
  if (!db) {
    db = getFirestore();
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return {
      batchesCommitted: 0,
      docsUpdated: 0,
    };
  }

  const chunks = chunkArray(updates, batchSize);
  let batchesCommitted = 0;
  let docsUpdated = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const update of chunk) {
      batch.update(update.ref, update.data);
    }

    await batch.commit();

    batchesCommitted += 1;
    docsUpdated += chunk.length;
  }

  return {
    batchesCommitted,
    docsUpdated,
  };
};

/* =====================================================
   RECOMPUTE AUTHORITATIVE COUNTS
   ===================================================== */

export const recomputeGeoFenceCounts = async ({
  db,
  geoFenceId,
  lmPcode,
  wardPcode,
}) => {
  if (!db) {
    db = getFirestore();
  }

  const erfSnapshot = await db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("admin.ward.pcode", "==", wardPcode)
    .get();

  const premiseSnapshot = await db
    .collection("premises")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode)
    .get();

  const astSnapshot = await db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .get();

  const erfs = erfSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  const premises = premiseSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  const meters = astSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  return {
    erfs,
    premises,
    meters,
  };
};


/* =====================================================
   TC UPLOAD SUMMARY REFRESH
   ===================================================== */

function hasTcRowGeoFence(row = {}) {
  return normalizeGeoFenceRefs(row?.geofenceRefs || []).length > 0;
}

function isTcRowUsedByBgo(row = {}) {
  return row?.bgo?.used === true || Boolean(row?.bgo?.batchId || row?.batchId);
}

function buildTcGeofenceBreakdown(rows = []) {
  const map = new Map();

  for (const row of rows) {
    for (const ref of normalizeGeoFenceRefs(row?.geofenceRefs || [])) {
      const key = ref.id;
      const current = map.get(key) || {
        id: ref.id,
        name: ref.name || ref.id,
        count: 0,
      };

      current.count += 1;
      map.set(key, current);
    }
  }

  return Array.from(map.values()).sort((left, right) =>
    String(left.name).localeCompare(String(right.name)),
  );
}

function buildTcUploadSummaryFromRows(rows = []) {
  const totalRows = rows.length;
  const validRows = rows.filter((row) => row?.frontend?.valid === true).length;
  const invalidRows = totalRows - validRows;
  const foundRows = rows.filter((row) => row?.backend?.matched === true).length;
  const notFoundRows = rows.filter(
    (row) => row?.backend?.notFound === true || row?.backend?.matched === false,
  ).length;
  const eligibleRows = rows.filter(
    (row) => row?.backend?.eligible === true,
  ).length;
  const notEligibleRows = rows.filter(
    (row) => row?.backend?.notEligible === true,
  ).length;
  const withGeofenceRows = rows.filter(
    (row) => row?.backend?.matched === true && hasTcRowGeoFence(row),
  ).length;
  const withoutGeofenceRows = rows.filter(
    (row) => row?.backend?.matched === true && !hasTcRowGeoFence(row),
  ).length;
  const readyRows = rows.filter((row) => row?.bgo?.ready === true).length;
  const usedRows = rows.filter(isTcRowUsedByBgo).length;
  const remainingRows = Math.max(readyRows - usedRows, 0);
  const needsGeofenceRows = rows.filter(
    (row) =>
      row?.backend?.matched === true &&
      row?.backend?.eligible === true &&
      row?.backend?.alreadyHasActiveSameOperationTrn !== true &&
      !isTcRowUsedByBgo(row) &&
      !hasTcRowGeoFence(row),
  ).length;
  const blockedActiveSameOperationRows = rows.filter(
    (row) => row?.backend?.alreadyHasActiveSameOperationTrn === true,
  ).length;
  const duplicateMeterRows = rows.filter((row) => {
    const reasonCodes = normalizeTcReasonCodes(row?.backend?.reasonCodes);

    return (
      row?.backend?.duplicateMeterInUpload === true ||
      row?.backend?.duplicateInUpload === true ||
      reasonCodes.includes("DUPLICATE_METER_IN_UPLOAD")
    );
  }).length;

  const validationState =
    invalidRows > 0 ||
    notFoundRows > 0 ||
    notEligibleRows > 0 ||
    needsGeofenceRows > 0 ||
    blockedActiveSameOperationRows > 0 ||
    duplicateMeterRows > 0
      ? "VALIDATED_WITH_EXCEPTIONS"
      : "VALIDATED";

  const bgoStatus = readyRows > 0 ? TC_READY_FOR_BGO : TC_NOT_READY_FOR_BGO;

  return {
    totalRows,
    validRows,
    invalidRows,
    foundRows,
    notFoundRows,
    eligibleRows,
    notEligibleRows,
    withGeofenceRows,
    withoutGeofenceRows,
    readyRows,
    remainingRows,
    usedRows,
    needsGeofenceRows,
    blockedActiveSameOperationRows,
    duplicateMeterRows,
    validationState,
    bgoStatus,
    writeState: readyRows > 0 ? "READY" : "REVIEW_REQUIRED",
    summary: {
      totalRows,
      validRows,
      invalidRows,
      foundRows,
      notFoundRows,
      eligibleRows,
      notEligibleRows,
      withGeofenceRows,
      withoutGeofenceRows,
      readyRows,
      remainingRows,
      usedRows,
      needsGeofenceRows,
      blockedActiveSameOperationRows,
      duplicateMeterRows,
      geofenceBreakdown: buildTcGeofenceBreakdown(rows),
    },
  };
}

export const refreshTcUploadSummariesForTcIds = async ({
  db,
  tcIds = [],
}) => {
  if (!db) {
    db = getFirestore();
  }

  const cleanTcIds = Array.from(
    new Set(
      (Array.isArray(tcIds) ? tcIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );

  if (cleanTcIds.length === 0) {
    return {
      uploadsUpdated: 0,
      tcIds: [],
    };
  }

  let uploadsUpdated = 0;
  const now = new Date().toISOString();

  for (const tcId of cleanTcIds) {
    const rowsSnapshot = await db
      .collection("tc_rows")
      .where("tcId", "==", tcId)
      .get();

    const rows = rowsSnapshot.docs.map((rowDoc) => rowDoc.data() || {});
    const nextSummary = buildTcUploadSummaryFromRows(rows);

    await db.collection("tc_uploads").doc(tcId).update({
      ...nextSummary,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "onGeoFenceCreated",
    });

    uploadsUpdated += 1;
  }

  return {
    uploadsUpdated,
    tcIds: cleanTcIds,
  };
};
