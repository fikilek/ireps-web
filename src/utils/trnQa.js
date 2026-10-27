import { formatSastDateTime } from "./formatSastDateTime.js";

export const TRN_QA_STATUS_OPTIONS = [
  "QA PENDING",
  "QA PASS",
  "QA FAIL",
  "QA NAv",
];

export function getTrnUpdatedByUser(row = {}) {
  if (!row) return "NAv";
  if (row.qa?.lastAmendment?.byUser) return row.qa.lastAmendment.byUser;
  const state = String(row.workflowState || row.workflow?.state || "").trim().toUpperCase();
  if (["QA PASS", "QA FAIL"].includes(state) && row.qa?.reviewedByUser) {
    return row.qa.reviewedByUser;
  }
  return row.updatedByUser || row.completedByUser || row.metadata?.updatedByUser || row.createdByUser || "NAv";
}

export function formatQaStatusDate(value) {
  if (!value || value === "NAv") return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getTrnHistoryCount(row = {}) {
  if (!row) return 0;
  if (typeof row.qa?.historyCount === "number") return row.qa.historyCount;
  if (typeof row.historyCount === "number") return row.historyCount;
  if (Array.isArray(row.qaHistory)) return row.qaHistory.length;
  if (Array.isArray(row.qa?.history)) return row.qa.history.length;
  const amendments = Array.isArray(row.qa?.amendments)
    ? row.qa.amendments.length
    : (row.qa?.lastAmendment ? 1 : 0);
  const reviews = (row.qa?.reviewedByUser || row.qa?.reviewedAt) ? 1 : 0;
  return amendments + reviews;
}
