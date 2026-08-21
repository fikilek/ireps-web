export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

export function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && text !== "NAv") return text;
  }

  return "";
}

export function toMillis(value) {
  if (!value) return 0;

  if (typeof value?.toMillis === "function") {
    const milliseconds = Number(value.toMillis());
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (typeof value?.toDate === "function") {
    const milliseconds = value.toDate().getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (Number.isFinite(Number(value?.seconds))) {
    const seconds = Number(value.seconds);
    const nanoseconds = Number(value?.nanoseconds || 0);
    return seconds * 1000 + nanoseconds / 1_000_000;
  }

  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function asNonNegativeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

function getSalesPeriodLabel(from, to) {
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || "NAv";
}

function getWardLabel(scope = {}) {
  return (
    cleanText(scope?.wardName) ||
    cleanText(scope?.wardNumber) ||
    cleanText(scope?.wardPcode) ||
    "NAv"
  );
}

function getTargetLabel(targetType, targetName) {
  if (!targetName) return "Unallocated";
  return `${targetType} • ${targetName}`;
}

function getProgress(counts = {}) {
  const total = asNonNegativeNumber(counts?.totalRows);
  const started = Math.min(
    total,
    asNonNegativeNumber(counts?.executionStartedRows),
  );
  const completed = Math.min(
    total,
    asNonNegativeNumber(counts?.completedRows),
  );

  return {
    total,
    notStarted: Math.max(total - started, 0),
    inProgress: Math.max(started - completed, 0),
    completed,
  };
}

function getBatchLastActivityAtMs(batch = {}) {
  return [
    batch?.metadata?.updatedAt,
    batch?.execution?.completedAt,
    batch?.execution?.startedAt,
    batch?.acceptance?.acceptedAt,
    batch?.acceptance?.rejectedAt,
    batch?.allocation?.completedAt,
    batch?.metadata?.createdAt,
  ].reduce(
    (latestMilliseconds, value) =>
      Math.max(latestMilliseconds, toMillis(value)),
    0,
  );
}

export function normalizeTargetedBatchHeader(id, batch = {}) {
  const scope = batch?.scope || {};
  const selection = batch?.selection || {};
  const allocation = batch?.allocation || {};
  const acceptance = batch?.acceptance || {};
  const execution = batch?.execution || {};

  const salesPeriodFrom = cleanText(selection?.salesPeriodFrom);
  const salesPeriodTo = cleanText(selection?.salesPeriodTo);
  const allocationTarget = allocation?.target || {};
  const targetType =
    normalizeUpper(allocation?.targetType || allocationTarget?.type) ||
    "UNALLOCATED";
  const targetName = firstText(
    allocation?.targetName,
    allocationTarget?.name,
  );
  const targetId = firstText(
    allocation?.targetId,
    allocationTarget?.id,
  );

  return {
    id: cleanText(id || batch?.id),
    schemaVersion: "0.2.0",

    scope: {
      lmPcode: cleanText(scope?.lmPcode),
      lmName: cleanText(scope?.lmName),
      wardPcode: cleanText(scope?.wardPcode),
      wardNumber: cleanText(scope?.wardNumber),
      wardName: cleanText(scope?.wardName),
      wardLabel: getWardLabel(scope),
    },

    selection: {
      reason: cleanText(selection?.reason),
      salesPeriodFrom,
      salesPeriodTo,
      salesPeriodLabel: getSalesPeriodLabel(
        salesPeriodFrom,
        salesPeriodTo,
      ),
    },

    allocation: {
      status: normalizeUpper(allocation?.status) || "UNALLOCATED",
      targetType,
      targetId: targetId || null,
      targetName: targetName || null,
      targetLabel: getTargetLabel(targetType, targetName),
      memberCount: asNonNegativeNumber(allocation?.memberCount),
    },

    acceptance: {
      status: normalizeUpper(acceptance?.status) || "NOT_READY",
      acceptedAtMs: toMillis(acceptance?.acceptedAt) || null,
      rejectedAtMs: toMillis(acceptance?.rejectedAt) || null,
    },

    execution: {
      status: normalizeUpper(execution?.status) || "NOT_STARTED",
      startedAtMs: toMillis(execution?.startedAt) || null,
      completedAtMs: toMillis(execution?.completedAt) || null,
    },

    progress: getProgress(batch?.counts),

    createdAtMs: toMillis(batch?.metadata?.createdAt),
    updatedAtMs: toMillis(batch?.metadata?.updatedAt),
    lastActivityAtMs: getBatchLastActivityAtMs(batch),
  };
}

export function sortTargetedBatchHeaders(left, right) {
  const createdAtComparison =
    Number(right?.createdAtMs || 0) - Number(left?.createdAtMs || 0);

  if (createdAtComparison !== 0) return createdAtComparison;

  return cleanText(left?.id).localeCompare(cleanText(right?.id), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildTargetedBatchHeaders(documentSnapshots = []) {
  return documentSnapshots
    .map((documentSnapshot) =>
      normalizeTargetedBatchHeader(
        documentSnapshot.id,
        documentSnapshot.data(),
      ),
    )
    .sort(sortTargetedBatchHeaders);
}

export function uniqueNonBlank(values = []) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function normalizeMeter(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeAddressPart(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "").trim();
}

function normalizeBooleanMatch(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  const normalized = normalizeUpper(value);

  if (["TRUE", "YES", "MATCH", "MATCHED"].includes(normalized)) {
    return "TRUE";
  }

  if (["FALSE", "NO", "MISMATCH", "NOT_MATCHED"].includes(normalized)) {
    return "FALSE";
  }

  return null;
}

function getBatchReference(sales = {}, tbId, rowId) {
  const refs = Array.isArray(sales?.tbRefs) ? sales.tbRefs : [];
  const normalizedTbId = cleanText(tbId);
  const normalizedRowId = cleanText(rowId);

  return (
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId &&
        cleanText(reference?.rowId || reference?.tbRowId) === normalizedRowId,
    ) ||
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId,
    ) ||
    null
  );
}

function getFieldWork(reference = {}) {
  const fieldWork = reference?.fieldWork;

  return fieldWork &&
    typeof fieldWork === "object" &&
    !Array.isArray(fieldWork)
    ? fieldWork
    : {};
}

function getWard(row = {}, batch = {}) {
  return (
    firstText(
      row?.location?.wardNumberLabel,
      row?.scope?.wardName,
      row?.scope?.wardNumber,
      row?.scope?.wardPcode,
      batch?.scope?.wardName,
      batch?.scope?.wardNumber,
      batch?.scope?.wardPcode,
    ) || "NAv"
  );
}

function getOriginalMeter(row = {}, sales = {}) {
  return (
    firstText(
      row?.meter?.numberRaw,
      row?.meter?.numberNormalized,
      sales?.meterNo,
      sales?.meterNoNormalized,
      sales?.MeterNumber,
      row?.salesAllMeterId,
    ) || "NAv"
  );
}

function getFieldMeterNumber(fieldWork = {}, row = {}) {
  return firstText(
    fieldWork?.discoveredMeterNo,
    fieldWork?.discoveredMeterNumber,
    fieldWork?.foundMeterNo,
    fieldWork?.foundMeterNumber,
    fieldWork?.meterNo,
    fieldWork?.meterNumber,
    row?.execution?.foundMeterNoNormalized,
    row?.execution?.foundMeterNumberNormalized,
    row?.execution?.foundMeterNo,
    row?.execution?.foundMeterNumber,
    row?.execution?.meterNoFound,
    row?.execution?.meterNumberFound,
    row?.execution?.foundMeter?.numberNormalized,
    row?.execution?.foundMeter?.number,
    row?.execution?.result?.meterNoNormalized,
    row?.execution?.result?.meterNumberNormalized,
    row?.execution?.result?.meterNo,
    row?.execution?.result?.meterNumber,
  );
}

function getFieldMeterId(row = {}, fieldWork = {}) {
  return firstText(
    fieldWork?.meterId,
    row?.refs?.meterId,
    row?.execution?.meterId,
    row?.execution?.result?.meterId,
    row?.execution?.foundMeter?.id,
  );
}

function getPremiseId(row = {}, fieldWork = {}) {
  return firstText(
    fieldWork?.premiseId,
    row?.refs?.premiseId,
    row?.execution?.premiseId,
    row?.execution?.result?.premiseId,
  );
}

function getErfId(row = {}, fieldWork = {}) {
  return firstText(
    row?.refs?.erfId,
    fieldWork?.erfId,
    row?.execution?.erfId,
    row?.execution?.result?.erfId,
  );
}

function getOriginalAddress(row = {}, sales = {}) {
  const addressLine1 = firstText(
    row?.location?.addressLine1,
    sales?.addressLine1,
    sales?.AddressLine1,
    sales?.PostalAddress1,
  );
  const addressLine2 = firstText(
    row?.location?.addressLine2,
    sales?.addressLine2,
    sales?.AddressLine2,
    sales?.PostalAddress2,
  );
  const town = firstText(
    row?.location?.town,
    sales?.town,
    sales?.Town,
    sales?.PostalAddressTown,
  );

  return [addressLine1, addressLine2, town].filter(Boolean).join(", ") || "NAv";
}

function getFieldAddress(premise = {}) {
  const address = premise?.address || {};
  const street = [
    cleanText(address?.strNo),
    cleanText(address?.strName),
    cleanText(address?.strType),
  ]
    .filter((part) => part && part !== "NAv")
    .join(" ");

  return (
    firstText(
      street,
      premise?.addressText,
      premise?.location?.addressLine1,
    ) || ""
  );
}

function parseStreetNumberAndName(value) {
  const firstAddressSegment = cleanText(value).split(",")[0].trim();

  if (!firstAddressSegment) {
    return {
      strNo: "",
      strName: "",
    };
  }

  const parts = firstAddressSegment
    .split(/\s+/)
    .map(cleanText)
    .filter(Boolean);

  return {
    strNo: parts[0] || "",
    strName: parts.slice(1).join(" "),
  };
}

function getOriginalAddressParts(row = {}, sales = {}) {
  const explicitStrNo = firstText(
    row?.location?.strNo,
    row?.location?.address?.strNo,
    sales?.strNo,
    sales?.address?.strNo,
  );
  const explicitStrName = firstText(
    row?.location?.strName,
    row?.location?.address?.strName,
    sales?.strName,
    sales?.address?.strName,
  );

  if (explicitStrNo || explicitStrName) {
    return {
      strNo: explicitStrNo,
      strName: explicitStrName,
    };
  }

  return parseStreetNumberAndName(
    firstText(
      row?.location?.addressLine1,
      sales?.addressLine1,
      sales?.AddressLine1,
      sales?.PostalAddress1,
    ),
  );
}

function getFieldAddressParts(premise = {}) {
  const address = premise?.address || {};

  return {
    strNo: cleanText(address?.strNo),
    strName: cleanText(address?.strName),
  };
}

function getMeterMatch({ originalMeter, fieldMeter, fieldWork }) {
  const explicit = normalizeBooleanMatch(fieldWork?.meterMatch);
  if (explicit) return explicit;

  const original = normalizeMeter(originalMeter);
  const field = normalizeMeter(fieldMeter);

  if (!field || !original) return "PENDING";
  return original === field ? "TRUE" : "FALSE";
}

function getAddressMatch({ originalAddressParts, fieldAddressParts }) {
  const originalStrNo = normalizeAddressPart(originalAddressParts?.strNo);
  const originalStrName = normalizeAddressPart(originalAddressParts?.strName);
  const fieldStrNo = normalizeAddressPart(fieldAddressParts?.strNo);
  const fieldStrName = normalizeAddressPart(fieldAddressParts?.strName);

  if (!originalStrNo || !originalStrName || !fieldStrNo || !fieldStrName) {
    return "PENDING";
  }

  return originalStrNo === fieldStrNo && originalStrName === fieldStrName
    ? "TRUE"
    : "FALSE";
}

function getExecutionStatus(row = {}, fieldWork = {}) {
  return (
    normalizeUpper(firstText(fieldWork?.status, row?.execution?.status)) ||
    "NOT_STARTED"
  );
}

function getNoAccessCount(fieldWork = {}) {
  return Array.isArray(fieldWork?.noAccess) ? fieldWork.noAccess.length : 0;
}

function getLastActivityAtMs(row = {}, fieldWork = {}, reference = {}) {
  return [
    fieldWork?.updatedAt,
    fieldWork?.submittedAt,
    reference?.date,
    reference?.updatedAt,
    row?.execution?.completedAt,
    row?.execution?.startedAt,
    row?.metadata?.updatedAt,
    row?.metadata?.createdAt,
  ].reduce(
    (latestMilliseconds, value) =>
      Math.max(latestMilliseconds, toMillis(value)),
    0,
  );
}

function getCategoryOrReason(row = {}) {
  return (
    firstText(
      row?.selection?.category,
      row?.selection?.categoryCode,
      row?.selection?.actionReason,
      row?.selection?.reason,
    ) || "NAv"
  );
}

function getAccount(row = {}, sales = {}) {
  return (
    firstText(
      row?.customer?.accountNumber,
      sales?.accountNumber,
      sales?.AccountNumber,
    ) || "NAv"
  );
}

function getCustomer(row = {}, sales = {}) {
  return firstText(row?.customer?.customerName, sales?.customerName) || "NAv";
}

function getSgCode(row = {}, sales = {}) {
  return (
    firstText(
      row?.location?.sgCode,
      row?.location?.standNumber,
      sales?.sgCode,
      sales?.standNumber,
    ) || "NAv"
  );
}

function getAttemptReason(attempt = {}) {
  return (
    firstText(
      attempt?.accessData?.access?.reason,
      attempt?.accessData?.reason,
      attempt?.reason,
    ) || "NAv"
  );
}

function getAttemptUser(attempt = {}) {
  return (
    firstText(
      attempt?.metadata?.createdByUser,
      attempt?.metadata?.updatedByUser,
      attempt?.metadata?.createdByUid,
    ) || "NAv"
  );
}

function getAttemptDate(attempt = {}) {
  return (
    attempt?.capturedAt ||
    attempt?.metadata?.createdAt ||
    attempt?.metadata?.updatedAt
  );
}

function getAttemptPoint(attempt = {}) {
  const gps = attempt?.location?.gps || attempt?.location || {};
  const lat = Number(gps?.lat);
  const lng = Number(gps?.lng);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function getAttemptMediaUrls(attempt = {}) {
  return (Array.isArray(attempt?.media) ? attempt.media : [])
    .filter((item) => item?.tag === "noAccessPhoto")
    .map((item) => firstText(item?.url, item?.uri))
    .filter(Boolean);
}

function normalizeNoAccessAttempt(attempt = {}) {
  return {
    id: cleanText(attempt?.id),
    capturedAtMs: toMillis(getAttemptDate(attempt)) || null,
    reason: getAttemptReason(attempt),
    capturedBy: getAttemptUser(attempt),
    point: getAttemptPoint(attempt),
    mediaUrls: getAttemptMediaUrls(attempt),
  };
}

function buildAttemptsByRowId(noAccessTrns = []) {
  const attemptsByRowId = {};

  noAccessTrns.forEach((attempt) => {
    if (normalizeUpper(attempt?.accessData?.access?.hasAccess) !== "NO") {
      return;
    }

    const rowId = cleanText(attempt?.targetedBatchContext?.rowId);
    if (!rowId) return;

    if (!attemptsByRowId[rowId]) attemptsByRowId[rowId] = [];
    attemptsByRowId[rowId].push(normalizeNoAccessAttempt(attempt));
  });

  Object.values(attemptsByRowId).forEach((attempts) => {
    attempts.sort(
      (left, right) =>
        Number(left?.capturedAtMs || 0) - Number(right?.capturedAtMs || 0),
    );
  });

  return attemptsByRowId;
}

export function getTargetedBatchSalesIds(rows = []) {
  return uniqueNonBlank(rows.map((row) => row?.salesAllMeterId));
}

export function getTargetedBatchPremiseIds({
  rows = [],
  salesById = {},
  tbId = "",
}) {
  return uniqueNonBlank(
    rows.map((row) => {
      const sales = salesById[cleanText(row?.salesAllMeterId)] || {};
      const reference = getBatchReference(sales, tbId, row?.id);
      return getPremiseId(row, getFieldWork(reference));
    }),
  );
}

export function getSalesOperationalPremiseIds({
  rows = [],
  salesById = {},
}) {
  return uniqueNonBlank(
    rows.map((row) => {
      const tbId = cleanText(row?.tbId);
      const sales = salesById[cleanText(row?.salesAllMeterId)] || {};
      const reference = getBatchReference(sales, tbId, row?.id);
      return getPremiseId(row, getFieldWork(reference));
    }),
  );
}

export function normalizeTargetedBatchReportRow({
  row = {},
  batch = {},
  salesById = {},
  premiseById = {},
  attemptsByRowId = {},
  tbId = "",
}) {
  const salesId = cleanText(row?.salesAllMeterId);
  const sales = salesById[salesId] || {};
  const reference = getBatchReference(sales, tbId, row?.id);
  const fieldWork = getFieldWork(reference);
  const premiseId = getPremiseId(row, fieldWork);
  const premise = premiseById[premiseId] || {};
  const originalMeterNumber = getOriginalMeter(row, sales);
  const fieldMeterNumber = getFieldMeterNumber(fieldWork, row);
  const fieldMeterId = getFieldMeterId(row, fieldWork);
  const erfId = getErfId(row, fieldWork);
  const originalAddress = getOriginalAddress(row, sales);
  const fieldAddress = getFieldAddress(premise);
  const originalAddressParts = getOriginalAddressParts(row, sales);
  const fieldAddressParts = getFieldAddressParts(premise);
  const noAccessCount = getNoAccessCount(fieldWork);
  const noAccessAttempts = attemptsByRowId[cleanText(row?.id)] || [];

  return {
    id: cleanText(row?.id),
    tbId: cleanText(tbId || row?.tbId),
    rowNo: Number(row?.rowNo || 0),

    scope: {
      lmPcode: firstText(row?.scope?.lmPcode, batch?.scope?.lmPcode),
      wardPcode: firstText(row?.scope?.wardPcode, batch?.scope?.wardPcode),
      wardLabel: getWard(row, batch),
    },

    source: {
      salesId,
      accountNumber: getAccount(row, sales),
      customerName: getCustomer(row, sales),
      sgCode: getSgCode(row, sales),
      categoryReason: getCategoryOrReason(row),
    },

    originalMeter: {
      number: originalMeterNumber,
      normalizedNumber: normalizeMeter(originalMeterNumber) || null,
    },

    fieldMeter: {
      id: fieldMeterId || null,
      number: fieldMeterNumber || null,
      normalizedNumber: normalizeMeter(fieldMeterNumber) || null,
      type: null,
      state: null,
      point: null,
      hasMeter: Boolean(fieldMeterId || fieldMeterNumber),
      canOpenMap: Boolean(fieldMeterId && fieldMeterNumber),
      linkSource: fieldMeterId
        ? cleanText(fieldWork?.meterId)
          ? "sales.tbRefs.fieldWork.meterId"
          : cleanText(row?.refs?.meterId)
            ? "tb_rows.refs.meterId"
            : "execution"
        : null,
    },

    premise: {
      id: premiseId || null,
      address: fieldAddress || null,
      point: null,
      status: premiseId ? "LINKED" : "PENDING",
      linkSource: premiseId
        ? cleanText(fieldWork?.premiseId)
          ? "sales.tbRefs.fieldWork.premiseId"
          : cleanText(row?.refs?.premiseId)
            ? "tb_rows.refs.premiseId"
            : "execution"
        : null,
    },

    erf: {
      id: erfId || null,
      number: null,
      geometry: null,
      centroid: null,
      linkSource: erfId
        ? cleanText(row?.refs?.erfId)
          ? "tb_rows.refs.erfId"
          : "execution"
        : null,
    },

    comparison: {
      meterMatch: getMeterMatch({
        originalMeter: originalMeterNumber,
        fieldMeter: fieldMeterNumber,
        fieldWork,
      }),
      addressMatch: getAddressMatch({
        originalAddressParts,
        fieldAddressParts,
      }),
    },

    addresses: {
      original: originalAddress,
      field: fieldAddress || null,
    },

    execution: {
      status: getExecutionStatus(row, fieldWork),
      lastActivityAtMs: getLastActivityAtMs(row, fieldWork, reference) || null,
    },

    noAccess: {
      count: noAccessCount,
      attempts: noAccessAttempts,
      detailedAttemptsAvailable:
        noAccessCount === 0 || noAccessAttempts.length > 0,
    },

    linkage: {
      salesIdSource: salesId ? "tb_rows.salesAllMeterId" : null,
      premiseIdSource: premiseId
        ? cleanText(fieldWork?.premiseId)
          ? "sales.tbRefs.fieldWork.premiseId"
          : cleanText(row?.refs?.premiseId)
            ? "tb_rows.refs.premiseId"
            : "execution"
        : null,
      meterIdSource: fieldMeterId
        ? cleanText(fieldWork?.meterId)
          ? "sales.tbRefs.fieldWork.meterId"
          : cleanText(row?.refs?.meterId)
            ? "tb_rows.refs.meterId"
            : "execution"
        : null,
      erfIdSource: erfId
        ? cleanText(row?.refs?.erfId)
          ? "tb_rows.refs.erfId"
          : "execution"
        : null,
    },
  };
}

export function summarizeTargetedBatchReportRows(rows = []) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;

      if (row?.execution?.status === "COMPLETED") {
        summary.completed += 1;
      } else if (row?.execution?.status === "IN_PROGRESS") {
        summary.inProgress += 1;
      } else {
        summary.notStarted += 1;
      }

      if (
        row?.fieldMeter?.linkSource ===
        "sales.tbRefs.fieldWork.meterId"
      ) {
        summary.metersDiscovered += 1;
      }
      summary.noAccessAttempts += Number(row?.noAccess?.count || 0);

      return summary;
    },
    {
      total: 0,
      notStarted: 0,
      inProgress: 0,
      completed: 0,
      metersDiscovered: 0,
      noAccessAttempts: 0,
    },
  );
}

export function buildTargetedBatchReport({
  tbId = "",
  batch = null,
  rows = [],
  salesById = {},
  premiseById = {},
  noAccessTrns = [],
}) {
  const attemptsByRowId = buildAttemptsByRowId(noAccessTrns);
  const normalizedRows = rows
    .map((row) =>
      normalizeTargetedBatchReportRow({
        row,
        batch: batch || {},
        salesById,
        premiseById,
        attemptsByRowId,
        tbId,
      }),
    )
    .sort((left, right) => {
      const rowNumberDifference = Number(left?.rowNo || 0) - Number(right?.rowNo || 0);
      if (rowNumberDifference !== 0) return rowNumberDifference;
      return cleanText(left?.id).localeCompare(cleanText(right?.id));
    });

  return {
    batch: batch ? normalizeTargetedBatchHeader(tbId, batch) : null,
    rows: normalizedRows,
    summary: summarizeTargetedBatchReportRows(normalizedRows),
  };
}

const SALES_STATS_UNASSIGNED_WARD = "Ward Not Assigned";
const SALES_STATS_UNASSIGNED_GEOFENCE_ID = "__GEOFENCE_NOT_ASSIGNED__";
const SALES_STATS_UNASSIGNED_GEOFENCE_NAME = "Geofence Not Assigned";
const SALES_STATS_UNCATEGORISED = "Uncategorised";

function getOperationalWard(sales = {}, row = {}, batch = {}) {
  return (
    firstText(
      row?.location?.wardNumberLabel,
      row?.scope?.wardName,
      row?.scope?.wardNumber,
      sales?.wardNumberLabel,
      batch?.scope?.wardName,
      batch?.scope?.wardNumber,
    ) || SALES_STATS_UNASSIGNED_WARD
  );
}

export function getOperationalSalesCategory(sales = {}) {
  return firstText(sales?.leakageCategory) || SALES_STATS_UNCATEGORISED;
}

function getOperationalGeofenceRefs(sales = {}) {
  const refs = Array.isArray(sales?.geofenceRefs) ? sales.geofenceRefs : [];
  const seen = new Set();

  const normalized = refs
    .map((reference) => {
      const id = cleanText(reference?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);

      return {
        id,
        name: firstText(reference?.name, id) || id,
      };
    })
    .filter(Boolean);

  return normalized.length
    ? normalized
    : [
        {
          id: SALES_STATS_UNASSIGNED_GEOFENCE_ID,
          name: SALES_STATS_UNASSIGNED_GEOFENCE_NAME,
        },
      ];
}

function getOperationalAllocation(row = {}, batch = {}) {
  const targetType = firstText(
    row?.allocation?.targetType,
    batch?.allocation?.targetType,
  );
  const targetId = firstText(
    row?.allocation?.targetId,
    batch?.allocation?.targetId,
  );
  const targetName = firstText(
    row?.allocation?.targetName,
    batch?.allocation?.targetName,
  );
  const key =
    targetType || targetName || targetId
      ? `${targetType || "TARGET"}::${targetId || targetName}`
      : "UNALLOCATED";

  return {
    key,
    targetType: targetType || "UNALLOCATED",
    targetId: targetId || null,
    targetName: targetName || "Unallocated",
    label:
      targetType || targetName
        ? `${targetType || "TARGET"} • ${targetName || targetId}`
        : "Unallocated",
  };
}

export function buildSalesOperationalStatsReadModel({
  batches = [],
  rows = [],
  salesById = {},
  premiseById = {},
}) {
  const batchById = Object.fromEntries(
    batches.map((batch) => [cleanText(batch?.id), batch]),
  );
  const normalizedBatches = batches
    .map((batch) => normalizeTargetedBatchHeader(batch?.id, batch))
    .sort(sortTargetedBatchHeaders);
  const normalizedBatchById = Object.fromEntries(
    normalizedBatches.map((batch) => [batch.id, batch]),
  );

  const normalizedRows = rows
    .map((row) => {
      const tbId = cleanText(row?.tbId);
      const batch = batchById[tbId] || {};
      const salesId = cleanText(row?.salesAllMeterId);
      const sales = salesById[salesId] || {};
      const batchHeader = normalizedBatchById[tbId] || null;
      const normalizedRow = normalizeTargetedBatchReportRow({
        row,
        batch,
        salesById,
        premiseById,
        tbId,
      });

      return {
        ...normalizedRow,
        analytics: {
          ward: getOperationalWard(sales, row, batch),
          category: getOperationalSalesCategory(sales),
          geofenceRefs: getOperationalGeofenceRefs(sales),
          salesPeriod:
            batchHeader?.selection?.salesPeriodLabel || "NAv",
          allocation: getOperationalAllocation(row, batch),
        },
        batchContext: batchHeader
          ? {
              id: batchHeader.id,
              updatedAtMs: batchHeader.updatedAtMs || null,
              lastActivityAtMs: batchHeader.lastActivityAtMs || null,
              wardLabel: batchHeader.scope.wardLabel,
              salesPeriodLabel: batchHeader.selection.salesPeriodLabel,
              allocation: batchHeader.allocation,
            }
          : {
              id: tbId,
              updatedAtMs: null,
              lastActivityAtMs: null,
              wardLabel: "NAv",
              salesPeriodLabel: "NAv",
              allocation: null,
            },
      };
    })
    .sort((left, right) => {
      const batchComparison = cleanText(left?.tbId).localeCompare(
        cleanText(right?.tbId),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (batchComparison !== 0) return batchComparison;

      const rowNumberComparison =
        Number(left?.rowNo || 0) - Number(right?.rowNo || 0);
      if (rowNumberComparison !== 0) return rowNumberComparison;

      return cleanText(left?.id).localeCompare(cleanText(right?.id));
    });

  return {
    batches: normalizedBatches,
    rows: normalizedRows,
  };
}

const TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT = 20;

function toFiniteCoordinate(value, minimum, maximum) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) &&
    numericValue >= minimum &&
    numericValue <= maximum
    ? numericValue
    : null;
}

function normalizeSpatialPoint(value) {
  const latitude = toFiniteCoordinate(
    value?.lat ?? value?.latitude,
    -90,
    90,
  );
  const longitude = toFiniteCoordinate(
    value?.lng ?? value?.longitude,
    -180,
    180,
  );

  if (latitude === null || longitude === null) return null;

  return {
    lat: latitude,
    lng: longitude,
  };
}

function normalizeTargetedBatchCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;

  const lng = toFiniteCoordinate(value[0], -180, 180);
  const lat = toFiniteCoordinate(value[1], -90, 90);

  return lng === null || lat === null ? null : [lng, lat];
}

function normalizeTargetedBatchLinearRing(value) {
  if (!Array.isArray(value)) return null;

  const ring = value
    .map(normalizeTargetedBatchCoordinatePair)
    .filter(Boolean);

  return ring.length >= 4 ? ring : null;
}

function normalizeTargetedBatchPolygonCoordinates(value) {
  if (!Array.isArray(value)) return null;

  const rings = value.map(normalizeTargetedBatchLinearRing);

  return rings.length > 0 && rings.every(Boolean) ? rings : null;
}

function parseTargetedBatchErfGeometry(value) {
  if (!value) return null;

  let geometry = value;

  if (typeof value === "string") {
    try {
      geometry = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  if (!geometry || typeof geometry !== "object") return null;

  if (geometry?.type === "Polygon") {
    const coordinates = normalizeTargetedBatchPolygonCoordinates(
      geometry?.coordinates,
    );

    return coordinates
      ? {
          type: "Polygon",
          coordinates,
        }
      : null;
  }

  if (geometry?.type === "MultiPolygon") {
    if (!Array.isArray(geometry?.coordinates)) return null;

    const coordinates = geometry.coordinates.map(
      normalizeTargetedBatchPolygonCoordinates,
    );

    return coordinates.length > 0 && coordinates.every(Boolean)
      ? {
          type: "MultiPolygon",
          coordinates,
        }
      : null;
  }

  return null;
}

function buildTargetedBatchErfNumber(erf = {}) {
  const explicitErfNumber = firstText(
    erf?.erfNo,
    erf?.erf?.erfNo,
    erf?.erf?.number,
  );

  if (explicitErfNumber) return explicitErfNumber;

  const parcelNumber = firstText(
    erf?.sg?.parcelNo,
    erf?.sg?.parcelNumber,
  );

  if (!parcelNumber) return null;

  const portion = Number(erf?.sg?.portion ?? 0);

  return Number.isFinite(portion) && portion > 0
    ? `${parcelNumber}/${portion}`
    : parcelNumber;
}

function buildTargetedBatchPremiseAddress(premise = {}) {
  const address = premise?.address || {};

  return (
    [
      address?.strNo,
      address?.strName,
      address?.strType,
      address?.suburbName,
      address?.town,
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" ") || null
  );
}

function getTargetedBatchMeterPoint(meter = {}) {
  return normalizeSpatialPoint(
    meter?.ast?.location?.gps ||
      meter?.location?.gps ||
      meter?.gps ||
      null,
  );
}

function getTargetedBatchMeterNumber(meter = {}) {
  return (
    firstText(
      meter?.ast?.astData?.astNo,
      meter?.astData?.astNo,
      meter?.meterNo,
      meter?.meterNumber,
    ) || null
  );
}

function getTargetedBatchMeterType(meter = {}) {
  return (
    firstText(
      meter?.accessData?.meterType,
      meter?.ast?.astData?.astType,
      meter?.astData?.astType,
      meter?.meterType,
    ) || null
  );
}

function getTargetedBatchMeterState(meter = {}) {
  return (
    firstText(
      meter?.status?.state,
      meter?.ast?.status?.state,
      meter?.statusState,
      typeof meter?.status === "string" ? meter.status : null,
    ) || null
  );
}

function buildRowIdLookup(links, fieldName) {
  const rowIdsByFeatureId = new Map();

  links.forEach((link) => {
    const featureId = cleanText(link?.[fieldName]);
    const rowId = cleanText(link?.rowId);

    if (!featureId || !rowId) return;

    if (!rowIdsByFeatureId.has(featureId)) {
      rowIdsByFeatureId.set(featureId, []);
    }

    rowIdsByFeatureId.get(featureId).push(rowId);
  });

  rowIdsByFeatureId.forEach((rowIds, featureId) => {
    rowIdsByFeatureId.set(featureId, uniqueNonBlank(rowIds));
  });

  return rowIdsByFeatureId;
}

function buildLinkedIdLookup(links, sourceField, targetField) {
  const linkedIdsBySourceId = new Map();

  links.forEach((link) => {
    const sourceId = cleanText(link?.[sourceField]);
    const targetId = cleanText(link?.[targetField]);

    if (!sourceId || !targetId) return;

    if (!linkedIdsBySourceId.has(sourceId)) {
      linkedIdsBySourceId.set(sourceId, []);
    }

    linkedIdsBySourceId.get(sourceId).push(targetId);
  });

  linkedIdsBySourceId.forEach((linkedIds, sourceId) => {
    linkedIdsBySourceId.set(sourceId, uniqueNonBlank(linkedIds));
  });

  return linkedIdsBySourceId;
}

function takeDiagnosticSample(values = []) {
  return values.slice(0, TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT);
}

export function getTargetedBatchMapMembership(rows = []) {
  const links = rows
    .map((row) => ({
      rowId: cleanText(row?.id),
      rowNo: Number(row?.rowNo || 0),
      erfId: cleanText(row?.refs?.erfId) || null,
      premiseId: cleanText(row?.refs?.premiseId) || null,
      meterId: cleanText(row?.refs?.meterId) || null,
    }))
    .sort((left, right) => {
      const rowNumberDifference =
        Number(left?.rowNo || 0) - Number(right?.rowNo || 0);

      if (rowNumberDifference !== 0) return rowNumberDifference;

      return cleanText(left?.rowId).localeCompare(
        cleanText(right?.rowId),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );
    });

  return {
    rowCount: links.length,
    links,
    erfIds: uniqueNonBlank(links.map((link) => link.erfId)),
    premiseIds: uniqueNonBlank(links.map((link) => link.premiseId)),
    meterIds: uniqueNonBlank(links.map((link) => link.meterId)),
  };
}

export function buildTargetedBatchMapReadModel({
  tbId = "",
  expectedLmPcode = "",
  batch = null,
  rows = [],
  erfById = {},
  premiseById = {},
  meterById = {},
}) {
  const membership = getTargetedBatchMapMembership(rows);
  const erfRowIds = buildRowIdLookup(membership.links, "erfId");
  const premiseRowIds = buildRowIdLookup(membership.links, "premiseId");
  const meterRowIds = buildRowIdLookup(membership.links, "meterId");
  const meterPremiseIds = buildLinkedIdLookup(
    membership.links,
    "meterId",
    "premiseId",
  );
  const meterErfIds = buildLinkedIdLookup(
    membership.links,
    "meterId",
    "erfId",
  );

  const erfs = membership.erfIds
    .map((erfId) => {
      const erf = erfById[erfId];
      if (!erf) return null;

      return {
        id: erfId,
        number: buildTargetedBatchErfNumber(erf),
        type: firstText(erf?.erf?.type, erf?.type) || null,
        state: firstText(erf?.erf?.status, erf?.status) || null,
        geometry: parseTargetedBatchErfGeometry(erf?.geometry),
        centroid: normalizeSpatialPoint(erf?.centroid),
        rowIds: erfRowIds.get(erfId) || [],
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      cleanText(left?.number || left?.id).localeCompare(
        cleanText(right?.number || right?.id),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );

  const premises = membership.premiseIds
    .map((premiseId) => {
      const premise = premiseById[premiseId];
      if (!premise) return null;

      return {
        id: premiseId,
        erfId:
          firstText(
            premise?.erfId,
            premise?.erf?.id,
            premise?.parents?.erfId,
          ) || null,
        erfNumber:
          firstText(
            premise?.erfNo,
            premise?.erf?.erfNo,
            premise?.erf?.number,
          ) || null,
        address: buildTargetedBatchPremiseAddress(premise),
        propertyType:
          firstText(
            premise?.propertyType?.type,
            premise?.propertyTypeLabel,
          ) || null,
        occupancyState:
          firstText(
            premise?.occupancy?.status,
            premise?.occupancyStatus,
          ) || null,
        point: normalizeSpatialPoint(
          premise?.geometry?.centroid ||
            (premise?.lat != null || premise?.lng != null
              ? {
                  lat: premise?.lat,
                  lng: premise?.lng,
                }
              : null),
        ),
        rowIds: premiseRowIds.get(premiseId) || [],
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      cleanText(left?.address || left?.id).localeCompare(
        cleanText(right?.address || right?.id),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );

  const meters = membership.meterIds
    .map((meterId) => {
      const meter = meterById[meterId];
      if (!meter) return null;

      const linkedPremiseIds = meterPremiseIds.get(meterId) || [];
      const linkedErfIds = meterErfIds.get(meterId) || [];

      return {
        id: meterId,
        entityId:
          firstText(
            meter?.ast?.astData?.astId,
            meter?.astData?.astId,
            meter?.meterId,
            meter?.id,
          ) || meterId,
        number: getTargetedBatchMeterNumber(meter),
        type: getTargetedBatchMeterType(meter),
        state: getTargetedBatchMeterState(meter),
        point: getTargetedBatchMeterPoint(meter),
        linkedPremiseId:
          linkedPremiseIds.length === 1 ? linkedPremiseIds[0] : null,
        linkedErfId: linkedErfIds.length === 1 ? linkedErfIds[0] : null,
        linkedPremiseIds,
        linkedErfIds,
        rowIds: meterRowIds.get(meterId) || [],
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      cleanText(left?.number || left?.id).localeCompare(
        cleanText(right?.number || right?.id),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );

  const foundErfIds = new Set(erfs.map((erf) => erf.id));
  const foundPremiseIds = new Set(
    premises.map((premise) => premise.id),
  );
  const foundMeterIds = new Set(meters.map((meter) => meter.id));

  const missingErfIds = membership.erfIds.filter(
    (erfId) => !foundErfIds.has(erfId),
  );
  const missingPremiseIds = membership.premiseIds.filter(
    (premiseId) => !foundPremiseIds.has(premiseId),
  );
  const missingMeterIds = membership.meterIds.filter(
    (meterId) => !foundMeterIds.has(meterId),
  );

  const rowIdsMissingErfRef = membership.links
    .filter((link) => !link.erfId)
    .map((link) => link.rowId)
    .filter(Boolean);
  const rowIdsMissingPremiseRef = membership.links
    .filter((link) => !link.premiseId)
    .map((link) => link.rowId)
    .filter(Boolean);
  const rowIdsMissingMeterRef = membership.links
    .filter((link) => !link.meterId)
    .map((link) => link.rowId)
    .filter(Boolean);

  const normalizedBatch = batch
    ? normalizeTargetedBatchHeader(tbId || batch?.id, batch)
    : null;
  const normalizedExpectedLmPcode = cleanText(expectedLmPcode);
  const batchLmPcode = cleanText(normalizedBatch?.scope?.lmPcode);

  return {
    batch: normalizedBatch,

    membership,

    erfs,
    premises,
    meters,

    diagnostics: {
      rows: membership.rowCount,

      erfRefs: membership.erfIds.length,
      erfsFound: erfs.length,
      erfsWithGeometry: erfs.filter((erf) => erf.geometry).length,
      erfsWithCentroid: erfs.filter((erf) => erf.centroid).length,
      rowsMissingErfRef: rowIdsMissingErfRef.length,
      missingErfCount: missingErfIds.length,
      missingErfIds: takeDiagnosticSample(missingErfIds),
      missingErfIdsTruncated:
        missingErfIds.length > TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,
      rowIdsMissingErfRef: takeDiagnosticSample(rowIdsMissingErfRef),
      rowIdsMissingErfRefTruncated:
        rowIdsMissingErfRef.length >
        TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,

      premiseRefs: membership.premiseIds.length,
      premisesFound: premises.length,
      premisesWithGps: premises.filter((premise) => premise.point).length,
      rowsMissingPremiseRef: rowIdsMissingPremiseRef.length,
      missingPremiseCount: missingPremiseIds.length,
      missingPremiseIds: takeDiagnosticSample(missingPremiseIds),
      missingPremiseIdsTruncated:
        missingPremiseIds.length >
        TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,
      rowIdsMissingPremiseRef: takeDiagnosticSample(
        rowIdsMissingPremiseRef,
      ),
      rowIdsMissingPremiseRefTruncated:
        rowIdsMissingPremiseRef.length >
        TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,

      meterRefs: membership.meterIds.length,
      metersFound: meters.length,
      metersWithGps: meters.filter((meter) => meter.point).length,
      metersWithAmbiguousPremiseLinks: meters.filter(
        (meter) => meter.linkedPremiseIds.length > 1,
      ).length,
      metersWithAmbiguousErfLinks: meters.filter(
        (meter) => meter.linkedErfIds.length > 1,
      ).length,
      rowsMissingMeterRef: rowIdsMissingMeterRef.length,
      missingMeterCount: missingMeterIds.length,
      missingMeterIds: takeDiagnosticSample(missingMeterIds),
      missingMeterIdsTruncated:
        missingMeterIds.length >
        TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,
      rowIdsMissingMeterRef: takeDiagnosticSample(rowIdsMissingMeterRef),
      rowIdsMissingMeterRefTruncated:
        rowIdsMissingMeterRef.length >
        TARGETED_BATCH_MAP_DIAGNOSTIC_ID_LIMIT,

      expectedLmPcode: normalizedExpectedLmPcode || null,
      batchLmPcode: batchLmPcode || null,
      lmPcodeMatches:
        normalizedExpectedLmPcode && batchLmPcode
          ? normalizedExpectedLmPcode === batchLmPcode
          : null,
    },
  };
}

