const NOT_STARTED_VALUES = new Set([
  "",
  "NOT_STARTED",
  "NOT STARTED",
  "PENDING",
  "READY",
  "READY_FOR_ALLOCATION",
]);

const FOUND_OUTCOMES = new Set([
  "FOUND",
  "METER_FOUND",
  "METER MATCH",
  "METER_MATCH",
  "MATCHED",
  "SUCCESS",
  "SUCCESSFUL",
  "ACCESS_YES",
  "METER_DIFFERENT",
  "METER DIFFERENT",
  "MISMATCH",
]);

const DIFFERENT_OUTCOMES = new Set([
  "METER_DIFFERENT",
  "METER DIFFERENT",
  "METER_MISMATCH",
  "METER MISMATCH",
  "DIFFERENT_METER",
  "DIFFERENT METER",
  "MISMATCH",
]);

const NO_ACCESS_OUTCOMES = new Set([
  "NO_ACCESS",
  "NO ACCESS",
  "ACCESS_NO",
  "ACCESS NO",
]);

export const TB_DASHBOARD_FILTER_ALL = "ALL";

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function hasValue(value) {
  if (value === null || value === undefined) return false;

  const text = String(value).trim().toUpperCase();

  return !["", "NAV", "N/A", "NA", "NULL", "UNDEFINED"].includes(text);
}

export function timestampToIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }

  if (typeof value?.__time__ === "string") return value.__time__;

  return null;
}

export function getActiveLmPcode(activeWorkbase = {}) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

export function getActiveLmName(activeWorkbase = {}) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.label ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv"
  );
}

export function getBatchId(batch = {}) {
  return batch?.id || batch?.tbId || "NAv";
}

export function getBatchUpdatedAt(batch = {}) {
  return (
    timestampToIso(batch?.metadata?.updatedAt) ||
    timestampToIso(batch?.metadata?.createdAt) ||
    timestampToIso(batch?.creation?.completedAt) ||
    null
  );
}

export function getBatchWorkflowStatus(batch = {}) {
  return normalizeUpper(batch?.status) || "NAv";
}

export function getBatchAllocationStatus(batch = {}) {
  const status = normalizeUpper(
    batch?.allocation?.status ||
      (batch?.status === "ALLOCATED" ? "ALLOCATED" : ""),
  );

  return status || "NOT_STARTED";
}

export function getBatchExecutionStatus(batch = {}) {
  return normalizeUpper(batch?.execution?.status) || "NOT_STARTED";
}

export function getBatchTarget(batch = {}) {
  const allocation = batch?.allocation || {};
  const target = allocation?.target || {};
  const id = allocation?.targetId || target?.id || null;

  if (!id) {
    return {
      id: null,
      type: null,
      name: "Not allocated",
      memberCount: 0,
    };
  }

  return {
    id,
    type: normalizeUpper(allocation?.targetType || target?.type || "TEAM"),
    name:
      allocation?.targetName ||
      target?.name ||
      target?.label ||
      id,
    memberCount: asNumber(
      allocation?.memberCount || target?.memberCount,
    ),
  };
}

export function isBatchAllocated(batch = {}) {
  return Boolean(getBatchTarget(batch).id) ||
    getBatchAllocationStatus(batch) === "ALLOCATED" ||
    normalizeUpper(batch?.status) === "ALLOCATED";
}

export function groupRowsByTbId(rows = []) {
  return asArray(rows).reduce((groups, row) => {
    const tbId = String(row?.tbId || "").trim();
    if (!tbId) return groups;

    if (!groups[tbId]) groups[tbId] = [];
    groups[tbId].push(row);

    return groups;
  }, {});
}

function firstMeaningful(values = []) {
  return values.find(hasValue) || null;
}

function normalizeMeterNumber(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function getOriginalMeterNumber(row = {}) {
  return firstMeaningful([
    row?.meter?.numberNormalized,
    row?.meter?.numberRaw,
    row?.salesAllMeterId,
    row?.source?.recordId,
  ]);
}

function getFoundMeterNumber(row = {}) {
  return firstMeaningful([
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
    row?.fieldResult?.foundMeterNoNormalized,
    row?.fieldResult?.foundMeterNo,
    row?.fieldResult?.meterNo,
    row?.result?.foundMeterNoNormalized,
    row?.result?.foundMeterNo,
    row?.result?.meterNo,
  ]);
}

function getExecutionOutcome(row = {}) {
  const value = firstMeaningful([
    row?.execution?.outcome,
    row?.execution?.outcomeCode,
    row?.execution?.result?.outcome,
    row?.execution?.result?.outcomeCode,
    row?.executionOutcome?.outcome,
    row?.executionOutcome?.code,
    row?.fieldResult?.outcome,
    row?.fieldResult?.outcomeCode,
    row?.result?.outcome,
    row?.result?.outcomeCode,
    row?.outcome,
  ]);

  return normalizeUpper(value);
}

function getExecutionAccess(row = {}) {
  return normalizeUpper(
    firstMeaningful([
      row?.execution?.access,
      row?.execution?.accessResult,
      row?.execution?.result?.access,
      row?.executionOutcome?.access,
      row?.fieldResult?.access,
      row?.result?.access,
      row?.access,
    ]),
  );
}

function getExecutionStatus(row = {}) {
  return normalizeUpper(
    firstMeaningful([
      row?.execution?.status,
      row?.workflow?.state,
      row?.workflowState,
      row?.status,
    ]),
  );
}

function hasExecutionActivity(row = {}) {
  const status = getExecutionStatus(row);

  return (
    !NOT_STARTED_VALUES.has(status) ||
    hasValue(row?.execution?.startedAt) ||
    hasValue(row?.execution?.completedAt) ||
    hasValue(getExecutionOutcome(row)) ||
    hasValue(row?.refs?.trnId)
  );
}

function isMeterFound(row = {}) {
  const foundMeterNumber = getFoundMeterNumber(row);
  const outcome = getExecutionOutcome(row);

  return hasValue(foundMeterNumber) || FOUND_OUTCOMES.has(outcome);
}

function isMeterDifferent(row = {}) {
  const original = normalizeMeterNumber(getOriginalMeterNumber(row));
  const found = normalizeMeterNumber(getFoundMeterNumber(row));
  const outcome = getExecutionOutcome(row);

  if (DIFFERENT_OUTCOMES.has(outcome)) return true;

  return Boolean(original && found && original !== found);
}

function isNoAccess(row = {}) {
  const outcome = getExecutionOutcome(row);
  const access = getExecutionAccess(row);

  return NO_ACCESS_OUTCOMES.has(outcome) || access === "NO";
}

function getPremiseId(row = {}) {
  return firstMeaningful([
    row?.refs?.premiseId,
    row?.execution?.premiseId,
    row?.execution?.result?.premiseId,
    row?.fieldResult?.premiseId,
    row?.result?.premiseId,
  ]);
}

export function buildTargetedBatchMetrics(batch = {}, rows = []) {
  const safeRows = asArray(rows);
  const batchTotal = asNumber(
    batch?.counts?.acceptedRows || batch?.counts?.totalRows,
  );
  const originalMeters = Math.max(batchTotal, safeRows.length);

  const metersFound = safeRows.filter(isMeterFound).length;
  const metersDifferent = safeRows.filter(isMeterDifferent).length;
  const noAccess = safeRows.filter(isNoAccess).length;

  const premiseIds = new Set(
    safeRows
      .filter((row) => hasExecutionActivity(row) || hasValue(getPremiseId(row)))
      .map(getPremiseId)
      .filter(hasValue),
  );

  return {
    originalMeters,
    metersFound,
    metersDifferent,
    premisesInProgress: premiseIds.size,
    noAccess,
  };
}

export function buildCoverageBar(value, total, slots = 12) {
  const totalNumber = asNumber(total);
  if (!totalNumber) return "░".repeat(slots);

  const ratio = Math.max(0, Math.min(1, asNumber(value) / totalNumber));
  const filledSlots = Math.max(
    ratio > 0 ? 1 : 0,
    Math.min(slots, Math.round(ratio * slots)),
  );

  return `${"█".repeat(filledSlots)}${"░".repeat(slots - filledSlots)}`;
}

export function formatCoveragePercent(value, total) {
  const totalNumber = asNumber(total);
  if (!totalNumber) return "0%";

  const percent = Math.max(
    0,
    Math.min(100, (asNumber(value) / totalNumber) * 100),
  );
  const rounded = Math.round(percent * 10) / 10;

  return Number.isInteger(rounded)
    ? `${rounded}%`
    : `${rounded.toFixed(1)}%`;
}

export function sortBatchesByUpdatedDesc(left, right) {
  return String(getBatchUpdatedAt(right) || "").localeCompare(
    String(getBatchUpdatedAt(left) || ""),
  );
}
