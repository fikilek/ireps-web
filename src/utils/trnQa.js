import { formatSastDateTime } from "./formatSastDateTime.js";

export const TRN_QA_STATUS_OPTIONS = [
  "QA PENDING",
  "QA PASS",
  "QA FAIL",
  "QA NAv",
];

function firstMeaningfulUser(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;
    if (["NAV", "N/AV", "N/A", "-"].includes(value.toUpperCase())) continue;
    return value;
  }
  return "NAv";
}

export function getTrnUpdatedByUser(row = {}) {
  if (!row) return "NAv";
  const lastAmendmentBy = firstMeaningfulUser(row.qa?.lastAmendment?.byUser);
  if (lastAmendmentBy !== "NAv") return lastAmendmentBy;
  const state = String(row.workflowState || row.workflow?.state || "").trim().toUpperCase();
  if (["QA PASS", "QA FAIL"].includes(state)) {
    const reviewedBy = firstMeaningfulUser(row.qa?.reviewedByUser);
    if (reviewedBy !== "NAv") return reviewedBy;
  }
  return firstMeaningfulUser(
    row.updatedByUser,
    row.completedByUser,
    row.metadata?.updatedByUser,
    row.createdByUser,
  );
}

const UNSUBMITTED_REGISTRY_STATES = new Set([
  "CREATED",
  "ISSUED",
  "ACCEPTED",
  "IN_PROGRESS",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

export function isNoAccessTrnRow(row = {}) {
  const hasAccess = String(
    row?.hasAccess ?? row?.accessData?.access?.hasAccess ?? "",
  )
    .trim()
    .toUpperCase();
  return hasAccess === "NO";
}

export function isSubmittedRegistryTrn(row = {}) {
  if (!row) return false;
  const state = String(row.workflowState || row.workflow?.state || "")
    .trim()
    .toUpperCase();
  const hasAccess = String(
    row.hasAccess ?? row.accessData?.access?.hasAccess ?? "",
  )
    .trim()
    .toUpperCase();
  // Always include explicit No Access visits. Check unsubmitted workflow states BEFORE
  // hasAccess === "YES", because buildLifecycleInstructionTrnPayload defaults unexecuted
  // office instructions to accessData.access.hasAccess = "yes" at creation time.
  if (hasAccess === "NO") return true;
  if (state && UNSUBMITTED_REGISTRY_STATES.has(state)) return false;
  if (hasAccess === "YES") return true;
  if (["COMPLETED", "QA PASS", "QA FAIL"].includes(state)) return true;
  const channel = String(row.originChannel || row.origin?.channel || "")
    .trim()
    .toUpperCase();
  return channel !== "OFFICE";
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
