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
