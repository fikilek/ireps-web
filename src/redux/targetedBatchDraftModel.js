const TARGETED_BATCH_ID_TIME_ZONE = "Africa/Johannesburg";
const TARGETED_BATCH_ID_RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const TARGETED_BATCH_COLLECTIONS = Object.freeze({
  uploads: "tb_uploads",
  rows: "tb_rows",
});

export const TARGETED_BATCH_SOURCE_TYPES = Object.freeze({
  PREPAID_SALES: "PREPAID_SALES",
  CSV_UPLOAD: "CSV_UPLOAD",
});

export const TARGETED_BATCH_DRAFT_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  READY_FOR_BACKEND: "READY_FOR_BACKEND",
});

export const TARGETED_BATCH_VALIDATION_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  PASSED: "PASSED",
  FAILED: "FAILED",
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      asArray(values)
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function safeCount(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.floor(numberValue)
    : fallback;
}

function getSouthAfricanDateTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TARGETED_BATCH_ID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return parts.reduce((result, part) => {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }

    return result;
  }, {});
}

function getRandomIndex(maxExclusive) {
  if (globalThis.crypto?.getRandomValues) {
    const randomValue = new Uint32Array(1);
    globalThis.crypto.getRandomValues(randomValue);
    return randomValue[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function buildRandomSuffix(length = 4) {
  return Array.from({ length }, () =>
    TARGETED_BATCH_ID_RANDOM_ALPHABET.charAt(
      getRandomIndex(TARGETED_BATCH_ID_RANDOM_ALPHABET.length),
    ),
  ).join("");
}

export function buildTargetedBatchDraftId(date = new Date()) {
  const { year, month, day, hour, minute, second } =
    getSouthAfricanDateTimeParts(date);
  const datePart = `${year}${month}${day}`;
  const timePart = `${hour}${minute}${second}`;
  const randomPart = buildRandomSuffix(4);

  return `TGB_${datePart}_${timePart}_${randomPart}`;
}

export function normalizeTargetedBatchSourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  if (normalized === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES) {
    return TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES;
  }

  if (["MANUAL_UPLOAD", "CSV", "FILE_UPLOAD"].includes(normalized)) {
    return TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD;
  }

  if (normalized === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD) {
    return TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD;
  }

  return TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD;
}

export function getTargetedBatchSourceLabel(sourceType) {
  return sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES
    ? "Prepaid Sales"
    : "CSV Upload";
}

function deriveSalesAllMeterIds(rows = []) {
  return uniqueStrings(
    asArray(rows)
      .map((row) =>
        readFirstString(
          row?.salesAllMeterId,
          row?.salesAllMetersId,
          row?.sourceSalesAllMeterId,
          row?.source?.salesAllMeterId,
          row?.sourceId,
          row?.id,
        ),
      )
      .filter(
        (value) =>
          value &&
          !/^SALES_\d+$/i.test(value) &&
          !/^MANUAL_/i.test(value),
      ),
  );
}

function deriveUploadRowIds(rows = []) {
  return uniqueStrings(
    asArray(rows).map((row) =>
      readFirstString(
        row?.uploadRowId,
        row?.tbRowId,
        row?.sourceUploadRowId,
        row?.source?.uploadRowId,
      ),
    ),
  );
}

function buildCanonicalValidation(validation = {}, totalRows = 0) {
  const errors = asArray(validation?.errors);
  const warnings = asArray(validation?.warnings);
  const duplicateRowNos = asArray(validation?.duplicateRowNos);
  const duplicateMeterNos = asArray(validation?.duplicateMeterNos);
  const invalidRowDetails = asArray(validation?.invalidRowDetails);

  const rejectedRows = safeCount(
    validation?.rejectedRows ?? validation?.invalidRows,
    invalidRowDetails.length,
  );
  const acceptedRows = safeCount(
    validation?.acceptedRows ?? validation?.validRows,
    Math.max(totalRows - rejectedRows, 0),
  );

  const explicitPassed =
    typeof validation?.passed === "boolean" ? validation.passed : null;
  const passed = explicitPassed ?? errors.length === 0;
  const status = readFirstString(validation?.status)
    ? String(validation.status).trim().toUpperCase()
    : passed
      ? TARGETED_BATCH_VALIDATION_STATUSES.PASSED
      : TARGETED_BATCH_VALIDATION_STATUSES.FAILED;

  return {
    status,
    passed,
    totalRows,
    acceptedRows,
    rejectedRows,
    validRows: acceptedRows,
    invalidRows: rejectedRows,
    duplicateRowNos,
    duplicateMeterNos,
    invalidRowDetails,
    errors,
    warnings,
  };
}

export function buildTargetedBatchDraft(payload = {}) {
  const displayRows = asArray(payload?.displayRows ?? payload?.rows);
  const sourceType = normalizeTargetedBatchSourceType(
    payload?.source?.type ?? payload?.sourceType,
  );
  const sourceLabel = readFirstString(
    payload?.source?.label,
    payload?.sourceLabel,
    getTargetedBatchSourceLabel(sourceType),
  );
  const sourceId = readFirstString(
    payload?.source?.sourceId,
    payload?.sourceId,
  );
  const fileName = readFirstString(
    payload?.source?.fileName,
    payload?.fileName,
  );

  const lmPcode = readFirstString(
    payload?.scope?.lmPcode,
    payload?.lmPcode,
  );
  const lmName = readFirstString(
    payload?.scope?.lmName,
    payload?.lmName,
    "NAv",
  );

  const selectionReason = readFirstString(
    payload?.selection?.reason,
    payload?.selectionReason,
    "NAv",
  );
  const salesPeriodFrom =
    payload?.selection?.salesPeriodFrom ?? payload?.salesPeriodFrom ?? null;
  const salesPeriodTo =
    payload?.selection?.salesPeriodTo ?? payload?.salesPeriodTo ?? null;

  const explicitSalesIds = uniqueStrings(
    payload?.authoritativeIds?.salesAllMeterIds ??
      payload?.salesAllMeterIds ??
      payload?.selectedSalesAllMeterIds,
  );
  const explicitUploadRowIds = uniqueStrings(
    payload?.authoritativeIds?.uploadRowIds ?? payload?.uploadRowIds,
  );

  const salesAllMeterIds =
    sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES
      ? explicitSalesIds.length > 0
        ? explicitSalesIds
        : deriveSalesAllMeterIds(displayRows)
      : [];
  const uploadRowIds =
    sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD
      ? explicitUploadRowIds.length > 0
        ? explicitUploadRowIds
        : deriveUploadRowIds(displayRows)
      : [];

  const validation = buildCanonicalValidation(
    payload?.validation,
    displayRows.length,
  );
  const now = new Date().toISOString();

  const canonicalDraft = {
    id: readFirstString(payload?.id) || buildTargetedBatchDraftId(),
    status:
      readFirstString(payload?.status) ||
      TARGETED_BATCH_DRAFT_STATUSES.DRAFT,
    createdAt: payload?.createdAt || now,
    confirmedAt: payload?.confirmedAt || null,
    source: {
      type: sourceType,
      label: sourceLabel,
      sourceId: sourceId || null,
      fileName: fileName || null,
    },
    scope: {
      lmPcode,
      lmName,
    },
    selection: {
      reason: selectionReason,
      salesPeriodFrom,
      salesPeriodTo,
    },
    authoritativeIds: {
      salesAllMeterIds,
      uploadRowIds,
    },
    displayRows,
    validation,
  };

  // Temporary compatibility aliases keep the existing TB pages working while
  // later packages migrate them to the canonical nested contract.
  return {
    ...canonicalDraft,
    sourceType: canonicalDraft.source.type,
    sourceLabel: canonicalDraft.source.label,
    sourceId: canonicalDraft.source.sourceId,
    fileName: canonicalDraft.source.fileName,
    lmPcode: canonicalDraft.scope.lmPcode,
    lmName: canonicalDraft.scope.lmName,
    selectionReason: canonicalDraft.selection.reason,
    salesPeriodFrom: canonicalDraft.selection.salesPeriodFrom,
    salesPeriodTo: canonicalDraft.selection.salesPeriodTo,
    salesAllMeterIds: canonicalDraft.authoritativeIds.salesAllMeterIds,
    uploadRowIds: canonicalDraft.authoritativeIds.uploadRowIds,
    rows: canonicalDraft.displayRows,
  };
}

export function getTargetedBatchDraftView(draft) {
  if (!draft || typeof draft !== "object") return null;
  return buildTargetedBatchDraft(draft);
}

export function getTargetedBatchDraftRows(draft) {
  return getTargetedBatchDraftView(draft)?.displayRows || [];
}
