import { createHash } from "node:crypto";

export const TC_ALLOWED_ROLES = ["SPU", "ADM", "MNG", "SPV"];

export const TC_ACTIVE_WORKFLOW_STATES = [
  "ISSUED",
  "ACCEPTED",
  "REASSIGNED",
  "IN_PROGRESS",
];

export const TC_TRN_TYPE_TO_CODE = {
  METER_DISCONNECTION: "MDCN",
  METER_RECONNECTION: "MRCN",
  METER_REMOVAL: "MREM",
  METER_READING: "MREAD",
  METER_INSPECTION: "MINSP",
};

export const TC_SUPPORTED_TRN_TYPES = Object.keys(TC_TRN_TYPE_TO_CODE);

export const TC_UPLOAD_FINGERPRINT_VERSION =
  "TC_UPLOAD_V1_TRNTYPE_LM_NORMALIZED_ROWS";

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

export function normalizeMeterNo(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function normalizeTrnType(value) {
  return normalizeUpper(value);
}

export function getTrnCodeForType(trnType) {
  return TC_TRN_TYPE_TO_CODE[normalizeTrnType(trnType)] || null;
}

export function chunkArray(items = [], size = 300) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function getActorName(caller, userData = {}) {
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

export function getUserRole(userData = {}) {
  return normalizeUpper(
    userData?.profile?.employment?.role ||
      userData?.employment?.role ||
      userData?.role ||
      "",
  );
}

export function buildFlatMetadata({ caller, actorName, now }) {
  return {
    createdAt: now,
    createdByUid: caller?.uid || "SYSTEM",
    createdByUser: actorName || "SYSTEM",
    updatedAt: now,
    updatedByUid: caller?.uid || "SYSTEM",
    updatedByUser: actorName || "SYSTEM",
  };
}

export function buildUpdateMetadata({ caller, actorName, now }) {
  return {
    updatedAt: now,
    updatedByUid: caller?.uid || "SYSTEM",
    updatedByUser: actorName || "SYSTEM",
  };
}

function getSastDateParts(date = new Date()) {
  const sastDate = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  const year = String(sastDate.getUTCFullYear());
  const month = String(sastDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(sastDate.getUTCDate()).padStart(2, "0");
  const hour = String(sastDate.getUTCHours()).padStart(2, "0");
  const minute = String(sastDate.getUTCMinutes()).padStart(2, "0");
  const second = String(sastDate.getUTCSeconds()).padStart(2, "0");

  return {
    yyyymmdd: `${year}${month}${day}`,
    hhmmss: `${hour}${minute}${second}`,
  };
}

export function buildTcUploadId({ date = new Date(), lmPcode, trnCode }) {
  const { yyyymmdd, hhmmss } = getSastDateParts(date);

  return `TC_${yyyymmdd}_${hhmmss}_${normalizeUpper(lmPcode)}_${normalizeUpper(
    trnCode,
  )}`;
}

export function buildTcRowId({ tcId, rowNo }) {
  const paddedRowNo = String(rowNo).padStart(6, "0");
  return `${tcId}_R${paddedRowNo}`;
}

export function normalizeOptionalWardPcode(value) {
  const text = normalizeText(value || "NAv");

  if (!text || text.toUpperCase() === "NAV") {
    return "NAv";
  }

  return normalizeUpper(text);
}

function normalizeRowInput(row = {}, index = 0) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : row || {};
  const rowNoText = normalizeText(raw?.rowNo ?? row?.rowNo ?? "");
  const meterNoRaw = normalizeText(raw?.meterNo ?? row?.meterNo ?? "");
  const meterNoNormalized = normalizeMeterNo(meterNoRaw);

  const input = {};

  Object.entries(raw).forEach(([key, value]) => {
    input[key] = normalizeText(value);
  });

  input.rowNo = rowNoText;
  input.meterNo = meterNoRaw;

  return {
    csvLineNumber: Number(row?.rowNumber || index + 2),
    rowNoText,
    rowNo: Number(rowNoText),
    input,
    meterNoRaw,
    meterNoNormalized,
  };
}

export function validateAndNormalizeTcRows(rows = []) {
  const errors = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      rows: [],
      errors: ["At least one TC row is required."],
      duplicateMeterNoSet: new Set(),
    };
  }

  const normalizedRows = rows.map(normalizeRowInput);
  const rowNoCounts = new Map();
  const meterNoCounts = new Map();

  normalizedRows.forEach((row) => {
    if (!row.rowNoText) {
      errors.push(`CSV line ${row.csvLineNumber}: rowNo is required.`);
      return;
    }

    if (!/^\d+$/.test(row.rowNoText) || Number(row.rowNoText) <= 0) {
      errors.push(
        `CSV line ${row.csvLineNumber}: rowNo must be a positive number.`,
      );
      return;
    }

    rowNoCounts.set(row.rowNoText, (rowNoCounts.get(row.rowNoText) || 0) + 1);
  });

  normalizedRows.forEach((row) => {
    if (!row.meterNoNormalized) {
      errors.push(`Row ${row.rowNoText || row.csvLineNumber}: meterNo is required.`);
      return;
    }

    meterNoCounts.set(
      row.meterNoNormalized,
      (meterNoCounts.get(row.meterNoNormalized) || 0) + 1,
    );
  });

  const duplicateRowNos = Array.from(rowNoCounts.entries()).filter(
    ([, count]) => count > 1,
  );

  duplicateRowNos.forEach(([rowNo]) => {
    errors.push(`rowNo ${rowNo} is duplicated. rowNo must be unique.`);
  });

  const expectedRowNos = Array.from(
    { length: normalizedRows.length },
    (_, index) => String(index + 1),
  );

  const missingRowNos = expectedRowNos.filter(
    (rowNo) => !rowNoCounts.has(rowNo),
  );

  if (missingRowNos.length > 0) {
    const shownMissing = missingRowNos.slice(0, 20).join(", ");
    const extraText =
      missingRowNos.length > 20
        ? ` and ${missingRowNos.length - 20} more`
        : "";

    errors.push(
      `rowNo sequence must be continuous from 1 to ${normalizedRows.length}. ` +
        `Missing rowNo value(s): ${shownMissing}${extraText}.`,
    );
  }

  normalizedRows.forEach((row) => {
    if (Number.isFinite(row.rowNo) && row.rowNo > normalizedRows.length) {
      errors.push(
        `Row ${row.rowNo}: rowNo is outside the expected sequence ` +
          `1-${normalizedRows.length}.`,
      );
    }
  });

  const duplicateMeterNoSet = new Set(
    Array.from(meterNoCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([meterNo]) => meterNo),
  );

  return {
    ok: errors.length === 0,
    rows: normalizedRows,
    errors,
    duplicateMeterNoSet,
  };
}

function normalizeFingerprintInputValue(value) {
  return normalizeText(value).toUpperCase();
}

function buildNormalizedFingerprintRows(rows = []) {
  return rows
    .map((row) => {
      const normalizedInput = {};

      Object.keys(row.input || {})
        .sort()
        .forEach((key) => {
          normalizedInput[key] = normalizeFingerprintInputValue(row.input[key]);
        });

      return {
        rowNo: Number(row.rowNo || 0),
        meterNo: normalizeMeterNo(row.meterNoNormalized || row.input?.meterNo),
        input: normalizedInput,
      };
    })
    .sort((a, b) => a.rowNo - b.rowNo);
}

export function buildTcUploadFingerprint({ trnType, lmPcode, rows = [] }) {
  const payload = {
    version: TC_UPLOAD_FINGERPRINT_VERSION,
    trnType: normalizeTrnType(trnType),
    lmPcode: normalizeUpper(lmPcode),
    rows: buildNormalizedFingerprintRows(rows),
  };

  const canonicalPayload = JSON.stringify(payload);
  const fingerprint = createHash("sha256")
    .update(canonicalPayload)
    .digest("hex");

  return {
    fingerprint,
    canonicalPayload,
    version: TC_UPLOAD_FINGERPRINT_VERSION,
  };
}

export function normalizeGeoFenceRefs(refs = []) {
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
    });
}

export function getAstStatusState(astData = {}) {
  return normalizeUpper(astData?.status?.state || astData?.status || "NAv");
}

export function getAstMeterType(astData = {}) {
  return normalizeText(astData?.meterType || astData?.ast?.meterType || "NAv");
}

export function getAstNo(astData = {}) {
  return (
    normalizeText(astData?.ast?.astData?.astNo) ||
    normalizeText(astData?.astData?.astNo) ||
    normalizeText(astData?.master?.id) ||
    "NAv"
  );
}

function getAstMeterKind(astData = {}) {
  return normalizeUpper(
    astData?.ast?.astData?.meter?.kind ||
      astData?.ast?.astData?.meter?.type ||
      astData?.ast?.astData?.meterKind ||
      astData?.ast?.astData?.meterType ||
      astData?.meterKind ||
      "",
  );
}

function isExplicitPrepaidMeter(astData = {}) {
  const meterKind = getAstMeterKind(astData);
  return meterKind.includes("PREPAID") || meterKind.includes("TOKEN");
}

export function getAstSummary({ astId, astData, meterNo }) {
  const accessData = astData?.accessData || {};
  const parents = accessData?.parents || {};

  return {
    id: astId || null,
    astNo: astId ? getAstNo(astData) : null,
    meterNo: normalizeMeterNo(meterNo || astData?.master?.id || getAstNo(astData)),
    meterType: astId ? getAstMeterType(astData) : null,
    statusState: astId ? getAstStatusState(astData) : null,
    erfNo: astId ? accessData?.erfNo || null : null,
    erfId: astId ? accessData?.erfId || null : null,
    premiseId: astId ? accessData?.premise?.id || null : null,
    lmPcode: astId ? parents?.lmPcode || null : null,
    wardPcode: astId ? parents?.wardPcode || null : null,
  };
}

export function getEligibilityResult({ trnType, astData }) {
  const normalizedTrnType = normalizeTrnType(trnType);
  const statusState = getAstStatusState(astData);

  if (!statusState || statusState === "NAv") {
    return {
      eligible: false,
      code: "UNKNOWN_METER_STATUS",
      message: "Meter status could not be resolved.",
    };
  }

  if (normalizedTrnType === "METER_DISCONNECTION") {
    if (statusState === "CONNECTED") {
      return { eligible: true, code: "ELIGIBLE", message: "Eligible." };
    }

    return {
      eligible: false,
      code: "STATUS_NOT_ELIGIBLE_FOR_DCN",
      message:
        `Meter is ${statusState} and cannot be selected for ` +
        "METER_DISCONNECTION.",
    };
  }

  if (normalizedTrnType === "METER_RECONNECTION") {
    if (statusState === "DISCONNECTED") {
      return { eligible: true, code: "ELIGIBLE", message: "Eligible." };
    }

    return {
      eligible: false,
      code: "STATUS_NOT_ELIGIBLE_FOR_RCN",
      message:
        `Meter is ${statusState} and cannot be selected for ` +
        "METER_RECONNECTION.",
    };
  }

  if (normalizedTrnType === "METER_REMOVAL") {
    if (["FIELD", "CONNECTED", "DISCONNECTED"].includes(statusState)) {
      return { eligible: true, code: "ELIGIBLE", message: "Eligible." };
    }

    return {
      eligible: false,
      code: "STATUS_NOT_ELIGIBLE_FOR_REM",
      message:
        `Meter is ${statusState} and cannot be selected for ` +
        "METER_REMOVAL.",
    };
  }

  if (normalizedTrnType === "METER_READING") {
    if (["REMOVED", "DECOMMISSIONED"].includes(statusState)) {
      return {
        eligible: false,
        code: "STATUS_NOT_ELIGIBLE_FOR_MREAD",
        message:
          `Meter is ${statusState} and cannot be selected for ` +
          "METER_READING.",
      };
    }

    if (isExplicitPrepaidMeter(astData)) {
      return {
        eligible: false,
        code: "PREPAID_NOT_SUPPORTED_FOR_MREAD_V1",
        message:
          "Prepaid/token meters are not supported for MREAD v1 TC upload.",
      };
    }

    return { eligible: true, code: "ELIGIBLE", message: "Eligible." };
  }

  if (normalizedTrnType === "METER_INSPECTION") {
    if (statusState !== "DECOMMISSIONED") {
      return { eligible: true, code: "ELIGIBLE", message: "Eligible." };
    }

    return {
      eligible: false,
      code: "STATUS_NOT_ELIGIBLE_FOR_INSP",
      message: "DECOMMISSIONED meters cannot be selected for METER_INSPECTION.",
    };
  }

  return {
    eligible: false,
    code: "UNSUPPORTED_TRN_TYPE",
    message: `${normalizedTrnType} is not supported by TC Uploads v1.`,
  };
}

export function getActiveSameOperationLifecycle({ trnType, astData }) {
  const lifecycle = astData?.trnActiveLifecycle || null;

  if (!lifecycle) return null;

  const lifecycleTrnType = normalizeTrnType(lifecycle?.trnType);
  const requestedTrnType = normalizeTrnType(trnType);
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

export function buildBgoReadiness({
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
