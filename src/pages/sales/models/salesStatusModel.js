import { classifySalesWorkStatus, inspectSalesTbRefsIntegrity } from "../../../../functions/salesAllMeters/sales-batch-policy.js";

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

export function classifySalesStatus(row = {}) {
  const integrity = inspectSalesTbRefsIntegrity(row.tbRefs);
  return { status: classifySalesWorkStatus(row), issues: integrity.issues };
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
