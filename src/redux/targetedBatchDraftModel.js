const TARGETED_BATCH_ID_TIME_ZONE = "Africa/Johannesburg";
const TARGETED_BATCH_ID_RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const TARGETED_BATCH_ID_PATTERN = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;
const TARGETED_BATCH_MAX_ROWS_PER_BATCH = 1000;

export const TARGETED_BATCH_COLLECTIONS = Object.freeze({
  uploads: "tb_uploads",
  rows: "tb_rows",
});

export const TARGETED_BATCH_SOURCE_TYPES = Object.freeze({
  PREPAID_SALES: "PREPAID_SALES",
  CSV_UPLOAD: "CSV_UPLOAD",
});

export const TARGETED_BATCH_PLANNING_MODES = Object.freeze({
  WARD_ERF: "WARD_ERF",
  NON_GPS_STREET: "NON_GPS_STREET",
});

const TARGETED_BATCH_NGP_MAX_ROWS = 20;

export const TARGETED_BATCH_DRAFT_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  READY_FOR_BACKEND: "READY_FOR_BACKEND",
});

export const TARGETED_BATCH_VALIDATION_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  PASSED: "PASSED",
  FAILED: "FAILED",
});

export const TARGETED_BATCH_FILE_DECISIONS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
});

export const TARGETED_BATCH_ROW_DECISIONS = Object.freeze({
  ACCEPT: "ACCEPT",
  REJECT: "REJECT",
});

export const TARGETED_BATCH_UPLOAD_REGISTER_STATUSES = Object.freeze({
  DRAFT: TARGETED_BATCH_DRAFT_STATUSES.DRAFT,
  READY_FOR_BACKEND: TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND,
  REJECTED: TARGETED_BATCH_FILE_DECISIONS.REJECTED,
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

function normalizeAuthoritativeId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
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

function normalizeUppercase(value, fallback = "") {
  const clean = String(value || "").trim().toUpperCase();
  return clean || fallback;
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
  const normalized = normalizeUppercase(value);

  if (normalized === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES) {
    return TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES;
  }

  if (['MANUAL_UPLOAD', 'CSV', 'FILE_UPLOAD'].includes(normalized)) {
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

export function normalizeTargetedBatchPlanningMode(
  value,
  sourceType = TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES,
) {
  if (sourceType !== TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES) {
    return null;
  }

  const normalized = normalizeUppercase(value);

  if (normalized === TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET) {
    return TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET;
  }

  return TARGETED_BATCH_PLANNING_MODES.WARD_ERF;
}

function normalizeFileDecision(value, passed = null) {
  const normalized = normalizeUppercase(value);

  if (normalized === TARGETED_BATCH_FILE_DECISIONS.ACCEPTED) {
    return TARGETED_BATCH_FILE_DECISIONS.ACCEPTED;
  }

  if (normalized === TARGETED_BATCH_FILE_DECISIONS.REJECTED) {
    return TARGETED_BATCH_FILE_DECISIONS.REJECTED;
  }

  if (typeof passed === "boolean") {
    return passed
      ? TARGETED_BATCH_FILE_DECISIONS.ACCEPTED
      : TARGETED_BATCH_FILE_DECISIONS.REJECTED;
  }

  return null;
}

function normalizeRowDecision(value) {
  const normalized = normalizeUppercase(value);

  if (normalized === TARGETED_BATCH_ROW_DECISIONS.ACCEPT) {
    return TARGETED_BATCH_ROW_DECISIONS.ACCEPT;
  }

  if (normalized === TARGETED_BATCH_ROW_DECISIONS.REJECT) {
    return TARGETED_BATCH_ROW_DECISIONS.REJECT;
  }

  return null;
}

function normalizeDraftRows(rows = [], sourceType) {
  return asArray(rows).map((row) => {
    if (sourceType !== TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD) {
      return row;
    }

    const rowDecision = normalizeRowDecision(
      row?.rowDecision ?? row?.assessmentDecision ?? row?.decision,
    );
    const rowDecisionReasons = uniqueStrings(
      row?.rowDecisionReasons ?? row?.rejectionReasons ?? row?.reasons,
    );
    const rowDecisionReason = readFirstString(
      row?.rowDecisionReason,
      row?.rejectionReason,
      rowDecisionReasons.join(" "),
    );

    return {
      ...row,
      rowDecision,
      rowDecisionReason: rowDecisionReason || null,
      rowDecisionReasons,
      assessmentDecision: rowDecision,
      assessmentStatus: rowDecision,
    };
  });
}

function deriveSalesAllMeterIds(rows = []) {
  return uniqueStrings(
    asArray(rows)
      .map((row) =>
        normalizeAuthoritativeId(
          readFirstString(
            row?.salesAllMeterId,
            row?.salesAllMetersId,
            row?.sourceSalesAllMeterId,
            row?.source?.salesAllMeterId,
            row?.master?.id,
            row?.meterNoNormalized,
            row?.meterNo,
            row?.sourceId,
            row?.id,
          ),
        ),
      )
      .filter(
        (value) =>
          value &&
          !/^SALES\d+$/i.test(value) &&
          !/^MANUAL/i.test(value),
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

function deriveCsvRowCounts(rows = []) {
  return asArray(rows).reduce(
    (result, row) => {
      const decision = normalizeRowDecision(
        row?.rowDecision ?? row?.assessmentDecision ?? row?.decision,
      );

      if (decision === TARGETED_BATCH_ROW_DECISIONS.ACCEPT) {
        result.acceptedRows += 1;
      } else if (decision === TARGETED_BATCH_ROW_DECISIONS.REJECT) {
        result.rejectedRows += 1;
      }

      return result;
    },
    { acceptedRows: 0, rejectedRows: 0 },
  );
}

function buildCanonicalValidation(validation = {}, rows = [], sourceType) {
  const totalRows = asArray(rows).length;
  const errors = asArray(validation?.errors);
  const warnings = asArray(validation?.warnings);
  const duplicateRowNos = asArray(validation?.duplicateRowNos);
  const duplicateMeterNos = asArray(validation?.duplicateMeterNos);
  const invalidRowDetails = asArray(validation?.invalidRowDetails);
  const derivedCounts = deriveCsvRowCounts(rows);

  const rejectedRows = safeCount(
    validation?.rejectedRows ?? validation?.invalidRows,
    sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD
      ? derivedCounts.rejectedRows
      : invalidRowDetails.length,
  );
  const acceptedRows = safeCount(
    validation?.acceptedRows ?? validation?.validRows,
    sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD
      ? derivedCounts.acceptedRows
      : Math.max(totalRows - rejectedRows, 0),
  );

  const explicitPassed =
    typeof validation?.passed === "boolean" ? validation.passed : null;
  const passed = explicitPassed ?? errors.length === 0;
  const fileDecision = normalizeFileDecision(
    validation?.fileDecision ?? validation?.decision,
    sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD ? passed : null,
  );
  const status = readFirstString(validation?.status)
    ? normalizeUppercase(validation.status)
    : passed
      ? TARGETED_BATCH_VALIDATION_STATUSES.PASSED
      : TARGETED_BATCH_VALIDATION_STATUSES.FAILED;

  return {
    status,
    passed,
    fileDecision,
    totalRows,
    acceptedRows,
    rejectedRows,
    validRows: acceptedRows,
    invalidRows: rejectedRows,
    rowAssessmentCompleted:
      typeof validation?.rowAssessmentCompleted === "boolean"
        ? validation.rowAssessmentCompleted
        : sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD && passed,
    duplicateRowNos,
    duplicateMeterNos,
    invalidRowDetails,
    errors,
    warnings,
  };
}

function normalizeScopePcode(value) {
  return normalizeUppercase(value);
}

function normalizeWardNumber(value) {
  const text = String(value || "")
    .trim()
    .replace(/^WARD\s*/i, "");

  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.toUpperCase();
}

function normalizeOrderedSalesIds(values = []) {
  return asArray(values).map(normalizeAuthoritativeId);
}

function normalizeProposedBatches({
  payload,
  sourceType,
  planningMode,
  lmPcode,
  lmName,
  fallbackDraftId,
  fallbackDisplayRows,
}) {
  if (sourceType !== TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES) return [];

  let batchInputs = asArray(payload?.proposedBatches);
  const isNgp =
    planningMode === TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET;

  if (!isNgp && batchInputs.length === 0 && fallbackDisplayRows.length > 0) {
    const wardPcodes = uniqueStrings(
      fallbackDisplayRows.map((row) => normalizeScopePcode(row?.wardPcode)),
    );

    if (wardPcodes.length === 1) {
      const firstRow = fallbackDisplayRows[0] || {};
      batchInputs = [
        {
          tbId: fallbackDraftId,
          draftBatchKey: `${wardPcodes[0]}::${fallbackDraftId}`,
          sequence: 1,
          scope: {
            lmPcode,
            lmName,
            wardPcode: wardPcodes[0],
            wardNumber: firstRow?.wardNumber,
            wardName: firstRow?.wardName || firstRow?.wardNumberLabel,
          },
          rows: fallbackDisplayRows,
        },
      ];
    }
  }

  return batchInputs.map((batch, batchIndex) => {
    const tbId = normalizeUppercase(
      readFirstString(batch?.tbId, batch?.id),
    );
    const wardPcode = normalizeScopePcode(
      readFirstString(batch?.scope?.wardPcode, batch?.wardPcode),
    );
    const wardNumber = normalizeWardNumber(
      readFirstString(batch?.scope?.wardNumber, batch?.wardNumber),
    );
    const wardName = readFirstString(
      batch?.scope?.wardName,
      batch?.wardName,
      wardNumber ? `Ward ${wardNumber}` : "",
    );
    const draftBatchKey = readFirstString(
      batch?.draftBatchKey,
      isNgp
        ? tbId
          ? `NGP::${tbId}`
          : ""
        : wardPcode && tbId
          ? `${wardPcode}::${tbId}`
          : "",
    );
    const rows = normalizeDraftRows(batch?.rows, sourceType).map(
      (row, rowIndex) => ({
        ...row,
        rowNo: String(row?.rowNo || rowIndex + 1),
        batchRowNo: String(row?.batchRowNo || row?.rowNo || rowIndex + 1),
        draftBatchKey,
        proposedTbId: tbId,
        batchSequence: safeCount(batch?.sequence, batchIndex + 1),
        lmPcode: normalizeScopePcode(row?.lmPcode || lmPcode),
        wardPcode: isNgp
          ? ""
          : normalizeScopePcode(row?.wardPcode || wardPcode),
        wardNumber: isNgp
          ? ""
          : normalizeWardNumber(row?.wardNumber || wardNumber),
        wardName: isNgp
          ? ""
          : readFirstString(row?.wardName, row?.wardNumberLabel, wardName),
        planning: row?.planning
          ? {
              ...row.planning,
              mode: normalizeTargetedBatchPlanningMode(
                row?.planning?.mode || planningMode,
                sourceType,
              ),
            }
          : isNgp
            ? { mode: planningMode }
            : row?.planning,
      }),
    );
    const explicitIds = normalizeOrderedSalesIds(
      batch?.salesAllMeterIds ?? batch?.authoritativeIds?.salesAllMeterIds,
    );
    const salesAllMeterIds =
      explicitIds.length > 0
        ? explicitIds
        : rows.map((row) =>
            normalizeAuthoritativeId(
              readFirstString(
                row?.salesAllMeterId,
                row?.sourceSalesAllMeterId,
                row?.meterNoNormalized,
                row?.meterNo,
                row?.id,
              ),
            ),
          );

    return {
      draftBatchKey,
      sequence: safeCount(batch?.sequence, batchIndex + 1),
      tbId,
      scope: {
        lmPcode: normalizeScopePcode(batch?.scope?.lmPcode || lmPcode),
        lmName: readFirstString(batch?.scope?.lmName, lmName, "NAv"),
        wardPcode: isNgp ? "" : wardPcode,
        wardNumber: isNgp ? "" : wardNumber,
        wardName: isNgp ? "" : wardName,
      },
      rowCount: rows.length,
      salesAllMeterIds,
      rows,
      validation: {
        status: normalizeUppercase(batch?.validation?.status, "PASSED"),
        oneWardOnly: isNgp ? false : batch?.validation?.oneWardOnly !== false,
      },
    };
  });
}

export function buildTargetedBatchDraft(payload = {}) {
  const sourceType = normalizeTargetedBatchSourceType(
    payload?.source?.type ?? payload?.sourceType,
  );
  const fallbackDisplayRows = normalizeDraftRows(
    payload?.displayRows ?? payload?.rows,
    sourceType,
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

  const lmPcode = normalizeScopePcode(
    readFirstString(payload?.scope?.lmPcode, payload?.lmPcode),
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
  const planningMode = normalizeTargetedBatchPlanningMode(
    payload?.selection?.planningMode ??
      payload?.planningMode ??
      payload?.validation?.planningMode,
    sourceType,
  );
  const salesPeriodFrom =
    payload?.selection?.salesPeriodFrom ?? payload?.salesPeriodFrom ?? null;
  const salesPeriodTo =
    payload?.selection?.salesPeriodTo ?? payload?.salesPeriodTo ?? null;
  const fallbackDraftId =
    normalizeUppercase(payload?.id) || buildTargetedBatchDraftId();
  const proposedBatches = normalizeProposedBatches({
    payload,
    sourceType,
    planningMode,
    lmPcode,
    lmName,
    fallbackDraftId,
    fallbackDisplayRows,
  });
  const displayRows =
    proposedBatches.length > 0
      ? proposedBatches.flatMap((batch) => batch.rows)
      : fallbackDisplayRows;

  const explicitSalesIds = normalizeOrderedSalesIds(
    payload?.authoritativeIds?.salesAllMeterIds ??
      payload?.salesAllMeterIds ??
      payload?.selectedSalesAllMeterIds,
  );
  const explicitUploadRowIds = uniqueStrings(
    payload?.authoritativeIds?.uploadRowIds ?? payload?.uploadRowIds,
  );

  const salesAllMeterIds =
    sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES
      ? proposedBatches.length > 0
        ? proposedBatches.flatMap((batch) => batch.salesAllMeterIds)
        : explicitSalesIds.length > 0
          ? explicitSalesIds
          : deriveSalesAllMeterIds(displayRows)
      : [];
  const uploadRowIds =
    sourceType === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD
      ? explicitUploadRowIds.length > 0
        ? explicitUploadRowIds
        : deriveUploadRowIds(displayRows)
      : [];

  const validation = {
    ...buildCanonicalValidation(payload?.validation, displayRows, sourceType),
    proposedBatchCount: proposedBatches.length,
    planningMode,
    wardGroupingApplied:
      sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES &&
      planningMode === TARGETED_BATCH_PLANNING_MODES.WARD_ERF
        ? payload?.validation?.wardGroupingApplied === true ||
          proposedBatches.length > 0
        : false,
  };
  const now = new Date().toISOString();
  const creationGroupId = readFirstString(
    payload?.creationGroup?.id,
    payload?.creationGroupId,
    proposedBatches.length > 0
      ? proposedBatches[0].tbId.replace(/^TGB_/, "TBCG_")
      : "",
  );

  const canonicalDraft = {
    id: fallbackDraftId,
    status:
      readFirstString(payload?.status) ||
      TARGETED_BATCH_DRAFT_STATUSES.DRAFT,
    createdAt: payload?.createdAt || now,
    confirmedAt: payload?.confirmedAt || null,
    creationGroup: {
      id: creationGroupId || null,
      proposedBatchCount: proposedBatches.length,
    },
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
      planningMode,
    },
    totals: {
      selectedRows: displayRows.length,
      proposedBatches: proposedBatches.length,
    },
    authoritativeIds: {
      salesAllMeterIds,
      uploadRowIds,
    },
    proposedBatches,
    displayRows,
    validation,
  };

  return {
    ...canonicalDraft,
    sourceType: canonicalDraft.source.type,
    sourceLabel: canonicalDraft.source.label,
    sourceId: canonicalDraft.source.sourceId,
    fileName: canonicalDraft.source.fileName,
    lmPcode: canonicalDraft.scope.lmPcode,
    lmName: canonicalDraft.scope.lmName,
    selectionReason: canonicalDraft.selection.reason,
    planningMode: canonicalDraft.selection.planningMode,
    salesPeriodFrom: canonicalDraft.selection.salesPeriodFrom,
    salesPeriodTo: canonicalDraft.selection.salesPeriodTo,
    salesAllMeterIds: canonicalDraft.authoritativeIds.salesAllMeterIds,
    uploadRowIds: canonicalDraft.authoritativeIds.uploadRowIds,
    rows: canonicalDraft.displayRows,
  };
}

export function buildTargetedBatchUploadAudit(payload = {}) {
  const sourceType = normalizeTargetedBatchSourceType(
    payload?.source?.type ?? payload?.sourceType,
  );
  const totalRowsHint = safeCount(
    payload?.totalRows ?? payload?.validation?.totalRows,
    0,
  );
  const validationInput = {
    ...(payload?.validation || {}),
    totalRows: totalRowsHint,
    acceptedRows:
      payload?.acceptedRows ?? payload?.validation?.acceptedRows,
    rejectedRows:
      payload?.rejectedRows ?? payload?.validation?.rejectedRows,
  };
  const validation = buildCanonicalValidation(
    validationInput,
    Array.from({ length: totalRowsHint }),
    sourceType,
  );
  const fileDecision = normalizeFileDecision(
    payload?.fileDecision ?? validation.fileDecision,
    validation.passed,
  );
  const now = new Date().toISOString();

  return {
    id: readFirstString(payload?.id) || buildTargetedBatchDraftId(),
    status:
      fileDecision === TARGETED_BATCH_FILE_DECISIONS.REJECTED
        ? TARGETED_BATCH_FILE_DECISIONS.REJECTED
        : readFirstString(payload?.status) ||
          TARGETED_BATCH_DRAFT_STATUSES.DRAFT,
    createdAt: payload?.createdAt || now,
    source: {
      type: sourceType,
      label: readFirstString(
        payload?.source?.label,
        payload?.sourceLabel,
        getTargetedBatchSourceLabel(sourceType),
      ),
      sourceId:
        readFirstString(payload?.source?.sourceId, payload?.sourceId) || null,
      fileName:
        readFirstString(payload?.source?.fileName, payload?.fileName) || null,
    },
    scope: {
      lmPcode: readFirstString(payload?.scope?.lmPcode, payload?.lmPcode),
      lmName: readFirstString(
        payload?.scope?.lmName,
        payload?.lmName,
        "NAv",
      ),
    },
    fileDecision,
    totalRows: safeCount(
      payload?.totalRows ?? validation.totalRows,
      validation.totalRows,
    ),
    acceptedRows: safeCount(
      payload?.acceptedRows ?? validation.acceptedRows,
      validation.acceptedRows,
    ),
    rejectedRows: safeCount(
      payload?.rejectedRows ?? validation.rejectedRows,
      validation.rejectedRows,
    ),
    rejectionReasons: uniqueStrings(
      payload?.rejectionReasons ?? validation.errors,
    ),
    validation,
  };
}

export function getTargetedBatchDraftView(draft) {
  if (!draft || typeof draft !== "object") return null;
  return buildTargetedBatchDraft(draft);
}

export function getTargetedBatchUploadAuditView(entry) {
  if (!entry || typeof entry !== "object") return null;
  return buildTargetedBatchUploadAudit(entry);
}

export function getTargetedBatchDraftRows(draft) {
  return getTargetedBatchDraftView(draft)?.displayRows || [];
}

export function getTargetedBatchDraftIntegrity(draft) {
  const currentDraft = getTargetedBatchDraftView(draft);

  if (!currentDraft) {
    return {
      canConfirm: false,
      blockers: ["No Targeted Batch draft is available."],
      totalRows: 0,
      proposedBatchCount: 0,
      authoritativeIdCount: 0,
      missingAuthoritativeIdRows: 0,
      duplicateAuthoritativeIds: [],
      acceptedRows: 0,
      rejectedRows: 0,
    };
  }

  const rows = currentDraft.displayRows;
  const blockers = [];
  const isSalesSource =
    currentDraft.source.type === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES;
  const isCsvSource =
    currentDraft.source.type === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD;
  const planningMode = normalizeTargetedBatchPlanningMode(
    currentDraft?.selection?.planningMode,
    currentDraft.source.type,
  );
  const isNgpSales =
    isSalesSource &&
    planningMode === TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET;
  const rowIds = rows.map((row) =>
    normalizeAuthoritativeId(
      row?.salesAllMeterId ||
        row?.sourceSalesAllMeterId ||
        row?.master?.id ||
        row?.meterNoNormalized ||
        row?.meterNo,
    ),
  );
  const counts = rowIds.reduce((result, id) => {
    if (!id) return result;
    result.set(id, (result.get(id) || 0) + 1);
    return result;
  }, new Map());
  const duplicateAuthoritativeIds = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const missingAuthoritativeIdRows = rowIds.filter((id) => !id).length;
  const authoritativeIdCount = new Set(rowIds.filter(Boolean)).size;
  const csvCounts = deriveCsvRowCounts(rows);
  const acceptedRows = isCsvSource
    ? currentDraft.validation.acceptedRows || csvCounts.acceptedRows
    : rows.length;
  const rejectedRows = isCsvSource
    ? currentDraft.validation.rejectedRows || csvCounts.rejectedRows
    : 0;

  if (rows.length === 0) {
    blockers.push("The draft contains no candidate rows.");
  }

  if (!currentDraft.validation?.passed) {
    blockers.push("The draft validation status is not PASSED.");
  }

  if (
    isCsvSource &&
    currentDraft.validation?.fileDecision !==
      TARGETED_BATCH_FILE_DECISIONS.ACCEPTED
  ) {
    blockers.push("The CSV file decision is not ACCEPTED.");
  }

  if (isCsvSource && !currentDraft.validation?.rowAssessmentCompleted) {
    blockers.push("CSV row assessment has not completed.");
  }

  if (isCsvSource && acceptedRows === 0) {
    blockers.push("The accepted CSV file contains no ACCEPT rows.");
  }

  if (isCsvSource) {
    const unassessedRows = rows.filter(
      (row) => !normalizeRowDecision(row?.rowDecision),
    ).length;
    const rejectedWithoutReason = rows.filter(
      (row) =>
        normalizeRowDecision(row?.rowDecision) ===
          TARGETED_BATCH_ROW_DECISIONS.REJECT &&
        !readFirstString(
          row?.rowDecisionReason,
          asArray(row?.rowDecisionReasons).join(" "),
        ),
    ).length;

    if (unassessedRows > 0) {
      blockers.push(`${unassessedRows} CSV row(s) have no ACCEPT/REJECT outcome.`);
    }

    if (rejectedWithoutReason > 0) {
      blockers.push(
        `${rejectedWithoutReason} rejected CSV row(s) have no rejection reason.`,
      );
    }
  }

  if (isSalesSource && missingAuthoritativeIdRows > 0) {
    blockers.push(
      `${missingAuthoritativeIdRows} sales row(s) have no Sales All Meters identity.`,
    );
  }

  if (isSalesSource && duplicateAuthoritativeIds.length > 0) {
    blockers.push(
      `${duplicateAuthoritativeIds.length} duplicate Sales All Meters identity value(s) were found.`,
    );
  }

  if (
    isSalesSource &&
    currentDraft.authoritativeIds.salesAllMeterIds.length !== rows.length
  ) {
    blockers.push(
      "The authoritative Sales All Meters ID count does not match the draft row count.",
    );
  }

  if (isSalesSource) {
    const proposedBatches = asArray(currentDraft.proposedBatches);
    const batchIds = proposedBatches.map((batch) => batch.tbId).filter(Boolean);
    const batchKeys = proposedBatches
      .map((batch) => batch.draftBatchKey)
      .filter(Boolean);
    const proposedSalesIds = [];
    let proposedRowCount = 0;

    if (proposedBatches.length === 0) {
      blockers.push(
        isNgpSales
          ? "The NGP Sales draft has no proposed Targeted Batch."
          : "The Sales draft has no ward-compliant proposed batches.",
      );
    }

    if (isNgpSales && proposedBatches.length !== 1) {
      blockers.push(
        "One NGP operation must create exactly one proposed Targeted Batch.",
      );
    }

    if (!currentDraft.creationGroup?.id) {
      blockers.push("The Sales draft has no creation-group identity.");
    }

    if (new Set(batchIds).size !== batchIds.length) {
      blockers.push("Duplicate proposed Targeted Batch IDs were found.");
    }

    if (new Set(batchKeys).size !== batchKeys.length) {
      blockers.push("Duplicate proposed batch keys were found.");
    }

    proposedBatches.forEach((batch, batchIndex) => {
      const batchLabel = `Proposed batch ${batchIndex + 1}`;
      const batchRows = asArray(batch?.rows);
      const batchSalesIds = normalizeOrderedSalesIds(
        batch?.salesAllMeterIds,
      );
      const wardPcode = normalizeScopePcode(batch?.scope?.wardPcode);
      const wardNumber = normalizeWardNumber(batch?.scope?.wardNumber);

      proposedRowCount += batchRows.length;
      proposedSalesIds.push(...batchSalesIds);

      if (!TARGETED_BATCH_ID_PATTERN.test(batch?.tbId || "")) {
        blockers.push(`${batchLabel} has an invalid Targeted Batch ID.`);
      }

      if (!isNgpSales && (!wardPcode || !wardNumber)) {
        blockers.push(`${batchLabel} has incomplete ward scope.`);
      }

      if (batch?.scope?.lmPcode !== currentDraft.scope.lmPcode) {
        blockers.push(`${batchLabel} does not match the draft LM scope.`);
      }

      if (batchRows.length < 1) {
        blockers.push(`${batchLabel} contains no rows.`);
      }

      const maxRows = isNgpSales
        ? TARGETED_BATCH_NGP_MAX_ROWS
        : TARGETED_BATCH_MAX_ROWS_PER_BATCH;

      if (batchRows.length > maxRows) {
        blockers.push(`${batchLabel} exceeds ${maxRows} rows.`);
      }

      if (batchSalesIds.length !== batchRows.length) {
        blockers.push(
          `${batchLabel} Sales ID count does not match its row count.`,
        );
      }

      batchRows.forEach((row, rowIndex) => {
        const expectedSalesId = batchSalesIds[rowIndex] || "";
        const rowSalesId = normalizeAuthoritativeId(
          row?.salesAllMeterId || row?.sourceSalesAllMeterId,
        );

        if (rowSalesId !== expectedSalesId) {
          blockers.push(
            `${batchLabel} row ${rowIndex + 1} does not match its ordered Sales ID.`,
          );
        }

        if (isNgpSales) {
          const rowPlanningMode = normalizeTargetedBatchPlanningMode(
            row?.planning?.mode,
            currentDraft.source.type,
          );
          const townKey = readFirstString(row?.planning?.townKey);
          const streetKey = readFirstString(row?.planning?.streetKey);

          if (rowPlanningMode !== TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET) {
            blockers.push(
              `${batchLabel} row ${rowIndex + 1} does not carry NGP planning mode.`,
            );
          }

          if (!townKey || !streetKey) {
            blockers.push(
              `${batchLabel} row ${rowIndex + 1} has incomplete NGP Town / street identity.`,
            );
          }
        } else {
          if (normalizeScopePcode(row?.wardPcode) !== wardPcode) {
            blockers.push(
              `${batchLabel} row ${rowIndex + 1} crosses the proposed ward boundary.`,
            );
          }

          if (normalizeWardNumber(row?.wardNumber) !== wardNumber) {
            blockers.push(
              `${batchLabel} row ${rowIndex + 1} has a conflicting ward number.`,
            );
          }
        }

        if (normalizeUppercase(row?.proposedTbId) !== batch?.tbId) {
          blockers.push(
            `${batchLabel} row ${rowIndex + 1} has a conflicting proposed batch ID.`,
          );
        }
      });
    });

    if (proposedRowCount !== rows.length) {
      blockers.push(
        "The proposed batch row total does not match the TB Draft row total.",
      );
    }

    if (proposedSalesIds.length !== rows.length) {
      blockers.push(
        "The proposed batch Sales ID total does not match the TB Draft row total.",
      );
    }

    if (new Set(proposedSalesIds.filter(Boolean)).size !== proposedSalesIds.length) {
      blockers.push(
        "A Sales meter appears in more than one proposed Targeted Batch.",
      );
    }

    const rootIds = currentDraft.authoritativeIds.salesAllMeterIds;
    if (
      rootIds.length !== proposedSalesIds.length ||
      rootIds.some((id, index) => id !== proposedSalesIds[index])
    ) {
      blockers.push(
        "The root Sales ID order does not match the proposed batch plan.",
      );
    }
  }

  return {
    canConfirm: blockers.length === 0,
    blockers: uniqueStrings(blockers),
    totalRows: rows.length,
    proposedBatchCount: currentDraft.proposedBatches?.length || 0,
    authoritativeIdCount,
    missingAuthoritativeIdRows,
    duplicateAuthoritativeIds,
    acceptedRows,
    rejectedRows,
  };
}
