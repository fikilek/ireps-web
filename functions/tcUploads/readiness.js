import { getFirestore } from "firebase-admin/firestore";

export const TC_READY_FOR_BGO = "READY_FOR_BGO";
export const TC_NOT_READY_FOR_BGO = "NOT_READY_FOR_BGO";
export const TC_NOT_FOUND = "NOT_FOUND";
export const TC_NEEDS_GEOFENCE = "NEEDS_GEOFENCE";
export const TC_NOT_ELIGIBLE = "NOT_ELIGIBLE";
export const TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN =
  "BLOCKED_ACTIVE_SAME_OPERATION_TRN";
export const TC_DUPLICATE_METER_IN_UPLOAD = "DUPLICATE_METER_IN_UPLOAD";
export const TC_FRONTEND_INVALID = "FRONTEND_INVALID";
export const TC_USED_BY_BGO = "USED_BY_BGO";

const NAV_VALUES = new Set(["", "NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function hasMeaningfulValue(value) {
  return !NAV_VALUES.has(normalizeUpper(value));
}

function uniqueStrings(values = []) {
  const seen = new Set();

  return asArray(values)
    .map((item) => normalizeUpper(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function uniqueWarnings(values = []) {
  const seen = new Set();

  return asArray(values)
    .map((item) => normalizeText(item))
    .filter((item) => {
      const key = normalizeUpper(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeTcGeoFenceRefs(value = []) {
  const seen = new Set();

  return asArray(value)
    .map((item) => {
      const id = normalizeText(item?.id || item?.geoFenceId || item?.geofenceId);
      const name = normalizeText(item?.name || item?.label || id);

      if (!id && !name) return null;

      return {
        id: id || name,
        name: name || id,
      };
    })
    .filter((item) => {
      if (!item?.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function isTcRowUsedByBgo(row = {}) {
  return (
    row?.bgo?.used === true ||
    hasMeaningfulValue(row?.bgo?.batchId) ||
    hasMeaningfulValue(row?.batchId) ||
    hasMeaningfulValue(row?.bgoRowId) ||
    hasMeaningfulValue(row?.trnId)
  );
}

function getDuplicateFlag(row = {}) {
  const reasonCodes = uniqueStrings(row?.backend?.reasonCodes || []);

  return (
    row?.backend?.duplicateMeterNo === true ||
    row?.backend?.duplicateMeterInUpload === true ||
    row?.backend?.duplicateInUpload === true ||
    row?.frontend?.duplicateMeterNo === true ||
    row?.frontend?.duplicateMeterInUpload === true ||
    row?.frontend?.duplicateInUpload === true ||
    reasonCodes.includes(TC_DUPLICATE_METER_IN_UPLOAD)
  );
}

function getActiveSameOperationFlag(row = {}) {
  const reasonCodes = uniqueStrings(row?.backend?.reasonCodes || []);

  return (
    row?.backend?.alreadyHasActiveSameOperationTrn === true ||
    Boolean(row?.backend?.activeLifecycle) ||
    reasonCodes.includes(TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN) ||
    reasonCodes.includes("ACTIVE_SAME_OPERATION_TRN_EXISTS")
  );
}

function getEligibilityReasonCode(row = {}) {
  const reasonCodes = uniqueStrings(row?.backend?.reasonCodes || []);

  return (
    normalizeUpper(row?.backend?.eligibilityCode) ||
    reasonCodes.find(
      (code) =>
        code.includes("NOT_ELIGIBLE") ||
        code.includes("STATUS_NOT_ELIGIBLE") ||
        code === TC_NOT_ELIGIBLE,
    ) ||
    TC_NOT_ELIGIBLE
  );
}

function addReason(reasonCodes, code) {
  const cleanCode = normalizeUpper(code);
  if (!cleanCode) return reasonCodes;
  if (reasonCodes.includes(cleanCode)) return reasonCodes;
  return [...reasonCodes, cleanCode];
}

function getReadinessReason({ row = {}, readinessState, ready }) {
  if (ready) return "Ready for BGO.";

  if (readinessState === TC_FRONTEND_INVALID) {
    return "Row failed frontend validation.";
  }

  if (readinessState === TC_NOT_FOUND) {
    return "Meter was not found in iREPS.";
  }

  if (readinessState === TC_DUPLICATE_METER_IN_UPLOAD) {
    return "Meter number appears more than once in this TC upload.";
  }

  if (readinessState === TC_NOT_ELIGIBLE) {
    return (
      row?.backend?.eligibilityMessage ||
      asArray(row?.backend?.errors)[0] ||
      "Meter is not eligible for the selected operation."
    );
  }

  if (readinessState === TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN) {
    return "Meter already has active same-operation work. Close or cancel that work first.";
  }

  if (readinessState === TC_NEEDS_GEOFENCE) {
    return "Matched meter has no geofenceRefs.";
  }

  if (readinessState === TC_USED_BY_BGO) {
    return "This TC row has already been used by BGO.";
  }

  return "Row is not ready for BGO.";
}

export function evaluateTcRowBgoReadiness({ row = {}, geofenceRefs = null } = {}) {
  const refs = normalizeTcGeoFenceRefs(
    geofenceRefs === null ? row?.geofenceRefs || [] : geofenceRefs,
  );
  const hasGeofence = refs.length > 0;
  const used = isTcRowUsedByBgo(row);
  const frontendValid = row?.frontend?.valid !== false;
  const matched = row?.backend?.matched === true && row?.backend?.notFound !== true;
  const notFound = row?.backend?.notFound === true || row?.backend?.matched === false;
  const eligible = row?.backend?.eligible === true && row?.backend?.notEligible !== true;
  const duplicateMeterNo = getDuplicateFlag(row);
  const activeSameOperation = getActiveSameOperationFlag(row);

  let reasonCodes = [];
  let warnings = uniqueWarnings(row?.backend?.warnings || []).filter((warning) => {
    const text = normalizeUpper(warning);

    return (
      !text.includes("NO GEOFENCE") &&
      !text.includes("NO_GEOFENCE") &&
      !text.includes("GEOFENCEREFS") &&
      !text.includes("GEOFENCE REFS")
    );
  });

  if (!frontendValid) {
    reasonCodes = addReason(reasonCodes, TC_FRONTEND_INVALID);
  }

  if (notFound || !matched) {
    reasonCodes = addReason(reasonCodes, TC_NOT_FOUND);
  }

  if (duplicateMeterNo) {
    reasonCodes = addReason(reasonCodes, TC_DUPLICATE_METER_IN_UPLOAD);
  }

  if (matched && !eligible) {
    reasonCodes = addReason(reasonCodes, getEligibilityReasonCode(row));
  }

  if (activeSameOperation) {
    reasonCodes = addReason(reasonCodes, TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN);
  }

  if (matched && eligible && !hasGeofence) {
    reasonCodes = addReason(reasonCodes, TC_NEEDS_GEOFENCE);
    warnings = uniqueWarnings([...warnings, "Matched meter has no geofenceRefs."]);
  }

  if (used) {
    reasonCodes = addReason(reasonCodes, TC_USED_BY_BGO);
  }

  const ready =
    frontendValid &&
    matched &&
    eligible &&
    hasGeofence &&
    !duplicateMeterNo &&
    !activeSameOperation &&
    !used &&
    reasonCodes.length === 0;

  let readinessState = TC_NOT_READY_FOR_BGO;

  if (ready) {
    readinessState = TC_READY_FOR_BGO;
  } else if (!frontendValid) {
    readinessState = TC_FRONTEND_INVALID;
  } else if (notFound || !matched) {
    readinessState = TC_NOT_FOUND;
  } else if (duplicateMeterNo) {
    readinessState = TC_DUPLICATE_METER_IN_UPLOAD;
  } else if (!eligible) {
    readinessState = TC_NOT_ELIGIBLE;
  } else if (activeSameOperation) {
    readinessState = TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN;
  } else if (!hasGeofence) {
    readinessState = TC_NEEDS_GEOFENCE;
  } else if (used) {
    readinessState = TC_USED_BY_BGO;
  }

  const readinessReason = getReadinessReason({
    row,
    readinessState,
    ready,
  });

  return {
    ready,
    readinessState,
    readinessReason,
    reasonCodes: ready ? [] : reasonCodes,
    warnings: ready ? [] : warnings,
    geofenceRefs: refs,
    checks: {
      frontendValid,
      matched,
      notFound,
      eligible,
      duplicateMeterNo,
      activeSameOperation,
      hasGeofence,
      used,
    },
  };
}

export function applyTcRowBgoReadiness({
  row = {},
  geofenceRefs = null,
  now = new Date().toISOString(),
  updatedByUid = "SYSTEM",
  updatedByUser = "TC BGO Readiness Evaluator",
} = {}) {
  const decision = evaluateTcRowBgoReadiness({ row, geofenceRefs });

  return {
    ...row,
    geofenceRefs: decision.geofenceRefs,
    backend: {
      ...(row?.backend || {}),
      reasonCodes: decision.reasonCodes,
      warnings: decision.warnings,
      message: decision.readinessReason,
      geofenceRefsCount: decision.geofenceRefs.length,
      bgoEvaluation: {
        ...decision.checks,
        evaluatedAt: now,
        evaluatedBy: updatedByUser,
      },
    },
    bgo: {
      ...(row?.bgo || {}),
      ready: decision.ready,
      readinessState: decision.readinessState,
      readinessReason: decision.readinessReason,
      updatedAt: now,
      updatedByUid,
      updatedByUser,
    },
  };
}

export function isTcRowReadyForBgo(row = {}) {
  return (
    row?.bgo?.ready === true &&
    row?.bgo?.readinessState === TC_READY_FOR_BGO &&
    !isTcRowUsedByBgo(row)
  );
}

function buildTcGeofenceBreakdown(rows = []) {
  const geofenceMap = new Map();

  rows.forEach((row) => {
    normalizeTcGeoFenceRefs(row?.geofenceRefs || []).forEach((ref) => {
      const current = geofenceMap.get(ref.id) || {
        id: ref.id,
        name: ref.name || ref.id,
        count: 0,
      };

      current.count += 1;
      geofenceMap.set(ref.id, current);
    });
  });

  return Array.from(geofenceMap.values()).sort((left, right) =>
    String(left.name).localeCompare(String(right.name)),
  );
}

export function buildTcUploadSummaryFromRows(rows = []) {
  const totalRows = rows.length;
  const validRows = rows.filter((row) => row?.frontend?.valid !== false).length;
  const invalidRows = Math.max(totalRows - validRows, 0);
  const foundRows = rows.filter((row) => row?.backend?.matched === true).length;
  const notFoundRows = rows.filter(
    (row) => row?.backend?.notFound === true || row?.backend?.matched === false,
  ).length;
  const eligibleRows = rows.filter((row) => row?.backend?.eligible === true).length;
  const notEligibleRows = rows.filter(
    (row) => row?.backend?.notEligible === true || row?.bgo?.readinessState === TC_NOT_ELIGIBLE,
  ).length;
  const withGeofenceRows = rows.filter(
    (row) =>
      row?.backend?.matched === true &&
      normalizeTcGeoFenceRefs(row?.geofenceRefs || []).length > 0,
  ).length;
  const withoutGeofenceRows = rows.filter(
    (row) =>
      row?.backend?.matched === true &&
      normalizeTcGeoFenceRefs(row?.geofenceRefs || []).length === 0,
  ).length;
  const readyRows = rows.filter((row) => isTcRowReadyForBgo(row)).length;
  const usedRows = rows.filter((row) => isTcRowUsedByBgo(row)).length;
  const remainingRows = Math.max(readyRows - usedRows, 0);
  const needsGeofenceRows = rows.filter(
    (row) => row?.bgo?.readinessState === TC_NEEDS_GEOFENCE,
  ).length;
  const blockedActiveSameOperationRows = rows.filter(
    (row) => row?.bgo?.readinessState === TC_BLOCKED_ACTIVE_SAME_OPERATION_TRN,
  ).length;
  const duplicateMeterRows = rows.filter(
    (row) => row?.bgo?.readinessState === TC_DUPLICATE_METER_IN_UPLOAD,
  ).length;

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
    usedRows,
    remainingRows,
    needsGeofenceRows,
    blockedActiveSameOperationRows,
    duplicateMeterRows,
    validationState,
    bgoStatus,
    writeState: "READY",
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
      usedRows,
      remainingRows,
      needsGeofenceRows,
      blockedActiveSameOperationRows,
      duplicateMeterRows,
      totalMeters: totalRows,
      validatedMeters: validRows,
      invalidatedMeters: invalidRows,
      foundMeters: foundRows,
      notFoundMeters: notFoundRows,
      withGeofenceMeters: withGeofenceRows,
      withoutGeofenceMeters: withoutGeofenceRows,
      readyForBgo: readyRows,
      needsGeofence: needsGeofenceRows,
      geofenceBreakdown: buildTcGeofenceBreakdown(rows),
    },
  };
}

async function getRowsForTcUploadSummary({ db, tcId }) {
  const rowDocMap = new Map();
  const queries = [
    db.collection("tc_rows").where("tcId", "==", tcId),
    db.collection("tc_rows").where("upload.tcId", "==", tcId),
  ];

  for (const rowsQuery of queries) {
    const snapshot = await rowsQuery.get();

    snapshot.docs.forEach((doc) => {
      rowDocMap.set(doc.id, doc);
    });
  }

  return Array.from(rowDocMap.values()).map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));
}

export async function refreshTcUploadSummariesForTcIds({
  db = null,
  tcIds = [],
  now = new Date().toISOString(),
  updatedByUid = "SYSTEM",
  updatedByUser = "TC BGO Readiness Evaluator",
} = {}) {
  const firestore = db || getFirestore();
  const cleanTcIds = Array.from(
    new Set(
      asArray(tcIds)
        .map((id) => normalizeText(id))
        .filter((id) => hasMeaningfulValue(id)),
    ),
  );

  let uploadsUpdated = 0;

  for (const tcId of cleanTcIds) {
    const uploadRef = firestore.collection("tc_uploads").doc(tcId);
    const uploadSnap = await uploadRef.get();

    if (!uploadSnap.exists) continue;

    const rows = await getRowsForTcUploadSummary({ db: firestore, tcId });
    const summaryPatch = buildTcUploadSummaryFromRows(rows);

    await uploadRef.update({
      ...summaryPatch,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": updatedByUid,
      "metadata.updatedByUser": updatedByUser,
    });

    uploadsUpdated += 1;
  }

  return {
    uploadsUpdated,
    tcIds: cleanTcIds,
  };
}
