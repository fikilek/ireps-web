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
