// Targeted Batch rules TB-R054 (1.3.45): Sales Reporting counts the batch rows, one status per
// row, so Sales Rows = Not Started + In Progress + Completed for every batch and for the cards.

export const EMPTY_PROGRESS = Object.freeze({ total: 0, notStarted: 0, inProgress: 0, completed: 0 });
export const COUNT_FILTER_KEYS = Object.freeze(["totalRows", "notStarted", "inProgress", "completed"]);

// "ready" only once the batch list, every batch row and every Sales meter have been read;
// "error" when any of them cannot be read; otherwise "counting". Never an old number.
export function getReportingCountsState({
  hasWorkbase = true,
  batchesStatus = "",
  batchesFailed = false,
  rowCountSources = {},
  rowCountsFailed = false,
} = {}) {
  if (!hasWorkbase) return "ready";
  if (batchesFailed || rowCountsFailed || rowCountSources?.rows === "error") return "error";
  if (batchesStatus !== "ready") return "counting";
  return rowCountSources?.rows === "ready" &&
    ["ready", "error"].includes(rowCountSources?.sales)
    ? "ready"
    : "counting";
}

export function withRowCounts(batch, countsByBatch, countsState) {
  return {
    ...batch,
    progress:
      countsState === "ready"
        ? countsByBatch?.[batch?.id] || EMPTY_PROGRESS
        : null,
  };
}

export function hasCountFilter(filters = {}) {
  return COUNT_FILTER_KEYS.some((key) => String(filters?.[key] ?? "").trim() !== "");
}

// The cards add up the batches the table shows after its filters. Until the batch list is read,
// or while a count filter waits for the counts, which batches are shown is not known, so no
// card shows a number.
export function summarizeReportingCards(
  shownBatches = [],
  { countsState, listPending = false, batchesReady = true } = {},
) {
  const summary = {
    batches: listPending || !batchesReady ? null : shownBatches.length,
    rows: null,
    notStarted: null,
    inProgress: null,
    completed: null,
  };
  if (countsState !== "ready") return summary;

  summary.rows = 0;
  summary.notStarted = 0;
  summary.inProgress = 0;
  summary.completed = 0;
  for (const batch of shownBatches) {
    const progress = batch?.progress || EMPTY_PROGRESS;
    summary.rows += progress.total;
    summary.notStarted += progress.notStarted;
    summary.inProgress += progress.inProgress;
    summary.completed += progress.completed;
  }
  return summary;
}

// Targeted Batch rules TB-R054 (1.3.59): the Batch Status column. Not ready, Waiting and Rejected say
// whether the team has taken the batch; once they have accepted it, the status says how far the work is,
// worked out from the same row counts the table shows (owner, 2026-09-19).
export const BATCH_STATUS_VALUES = Object.freeze([
  "NOT_READY",
  "WAITING",
  "ACCEPTED_NOT_STARTED",
  "ACCEPTED_IN_PROGRESS",
  "ACCEPTED_COMPLETED",
  "REJECTED",
]);

export const BATCH_STATUS_LABELS = Object.freeze({
  NOT_READY: "Not ready",
  WAITING: "Waiting",
  ACCEPTED_NOT_STARTED: "Accepted · Not Started",
  ACCEPTED_IN_PROGRESS: "Accepted · In Progress",
  ACCEPTED_COMPLETED: "Accepted · Completed",
  REJECTED: "Rejected",
});

// The work of an accepted batch, from its rows: Completed when every row is completed, In Progress when
// any row has been started, otherwise Not Started. A batch with no rows counts as Not Started.
export function batchWorkStatus(progress = {}) {
  const total = Number(progress?.total || 0);
  const completed = Number(progress?.completed || 0);
  const inProgress = Number(progress?.inProgress || 0);
  if (total > 0 && completed >= total) return "COMPLETED";
  return completed > 0 || inProgress > 0 ? "IN_PROGRESS" : "NOT_STARTED";
}

// One value per batch for the column, the sort and the filter. While the rows are still being counted an
// accepted batch has no work status yet, so it stays "ACCEPTED" and the column says "Counting…".
export function batchStatusValue(batch, countsState = "ready") {
  const acceptance = String(batch?.acceptance?.status ?? "").trim().toUpperCase() || "NOT_READY";
  if (acceptance !== "ACCEPTED") return BATCH_STATUS_VALUES.includes(acceptance) ? acceptance : "NOT_READY";
  if (countsState !== "ready" || !batch?.progress) return "ACCEPTED";
  return `ACCEPTED_${batchWorkStatus(batch.progress)}`;
}

export function batchStatusLabel(value) {
  return BATCH_STATUS_LABELS[value] || (value === "ACCEPTED" ? "Accepted · Counting…" : "NAv");
}

// The three accepted values need the row counts, so a filter on them waits like a count filter (TB-R054).
export function hasCountsDependentFilter(filters = {}) {
  return hasCountFilter(filters) || String(filters?.batchStatus ?? "").startsWith("ACCEPTED_");
}

// The small line under an ACCEPTED badge: how far the accepted batch's work is.
export function batchWorkStatusLabel(value) {
  const label = BATCH_STATUS_LABELS[value];
  return label ? label.replace("Accepted · ", "") : "Counting…";
}
