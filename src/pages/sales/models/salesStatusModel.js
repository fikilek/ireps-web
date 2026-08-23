export const SALES_STATUSES = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  INTEGRITY_EXCEPTION: "INTEGRITY_EXCEPTION",
});

export const SALES_OPERATIONAL_STATUSES = Object.freeze([
  SALES_STATUSES.NOT_STARTED,
  SALES_STATUSES.IN_PROGRESS,
  SALES_STATUSES.COMPLETED,
]);

export const SALES_STATUS_LABELS = Object.freeze({
  [SALES_STATUSES.NOT_STARTED]: "Not Started",
  [SALES_STATUSES.IN_PROGRESS]: "In Progress",
  [SALES_STATUSES.COMPLETED]: "Completed",
  [SALES_STATUSES.INTEGRITY_EXCEPTION]: "Integrity Exception",
});

export const SALES_STATUS_FILTER_OPTIONS = Object.freeze([
  {
    value: SALES_STATUSES.NOT_STARTED,
    label: SALES_STATUS_LABELS[SALES_STATUSES.NOT_STARTED],
  },
  {
    value: SALES_STATUSES.IN_PROGRESS,
    label: SALES_STATUS_LABELS[SALES_STATUSES.IN_PROGRESS],
  },
  {
    value: SALES_STATUSES.COMPLETED,
    label: SALES_STATUS_LABELS[SALES_STATUSES.COMPLETED],
  },
  {
    value: SALES_STATUSES.INTEGRITY_EXCEPTION,
    label: SALES_STATUS_LABELS[SALES_STATUSES.INTEGRITY_EXCEPTION],
  },
]);

export const SALES_STATUS_SORT_RANKS = Object.freeze({
  [SALES_STATUSES.NOT_STARTED]: 0,
  [SALES_STATUSES.IN_PROGRESS]: 1,
  [SALES_STATUSES.COMPLETED]: 2,
  [SALES_STATUSES.INTEGRITY_EXCEPTION]: 3,
});

const OPERATIONAL_STATUS_SET = new Set(SALES_OPERATIONAL_STATUSES);

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function integrityException(issues = []) {
  return {
    status: SALES_STATUSES.INTEGRITY_EXCEPTION,
    issues: Array.isArray(issues) && issues.length > 0
      ? [...issues]
      : ["tbRefsIntegrity"],
  };
}

export function classifySalesStatus(row = {}) {
  const integrity = row?.tbRefsIntegrity;

  if (!integrity || integrity.valid !== true) {
    return integrityException(integrity?.issues);
  }

  if (!Array.isArray(row?.tbRefs)) {
    return integrityException(["tbRefs"]);
  }

  let hasInProgress = false;

  for (const [index, reference] of row.tbRefs.entries()) {
    const referencePath = `tbRefs.${index}`;

    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      return integrityException([referencePath]);
    }

    const fieldWork = reference?.fieldWork;

    if (fieldWork === undefined || fieldWork === null) continue;
    if (typeof fieldWork !== "object" || Array.isArray(fieldWork)) {
      return integrityException([`${referencePath}.fieldWork`]);
    }

    if (!Object.hasOwn(fieldWork, "status")) continue;

    const rawStatus = fieldWork.status;
    if (typeof rawStatus !== "string") {
      return integrityException([`${referencePath}.fieldWork.status`]);
    }

    const status = normalizeStatus(rawStatus);
    if (rawStatus !== status || !OPERATIONAL_STATUS_SET.has(status)) {
      return integrityException([`${referencePath}.fieldWork.status`]);
    }

    if (status === SALES_STATUSES.COMPLETED) {
      return { status: SALES_STATUSES.COMPLETED, issues: [] };
    }

    if (status === SALES_STATUSES.IN_PROGRESS) hasInProgress = true;
  }

  return {
    status: hasInProgress
      ? SALES_STATUSES.IN_PROGRESS
      : SALES_STATUSES.NOT_STARTED,
    issues: [],
  };
}

export function getSalesStatusLabel(status) {
  return (
    SALES_STATUS_LABELS[status] ||
    SALES_STATUS_LABELS[SALES_STATUSES.INTEGRITY_EXCEPTION]
  );
}

export function getSalesStatusSortRank(status) {
  return (
    SALES_STATUS_SORT_RANKS[status] ??
    SALES_STATUS_SORT_RANKS[SALES_STATUSES.INTEGRITY_EXCEPTION]
  );
}
