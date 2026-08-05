export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
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

function getLastActivityAtMs(batch = {}) {
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
  const targetType = normalizeUpper(allocation?.targetType) || "UNALLOCATED";
  const targetName = cleanText(allocation?.targetName);

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
      targetId: cleanText(allocation?.targetId) || null,
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
    lastActivityAtMs: getLastActivityAtMs(batch),
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
