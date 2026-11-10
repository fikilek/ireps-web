const BATCH_STATES = new Set([
  "READY_FOR_ALLOCATION",
  "ISSUED",
  "ALLOCATED",
  "ACCEPTED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export function getMdBgoBatchStatus(batch = {}) {
  const state = String(batch?.workflowState || batch?.raw?.workflow?.state || "")
    .trim()
    .toUpperCase();
  return BATCH_STATES.has(state) ? state.replace(/_/g, " ") : "NAv";
}

export function getMdBgoRowStatusCounts(rows = []) {
  const countsByBatchId = new Map();

  rows.forEach((row) => {
    const batchId = String(row?.bgoBatchId || row?.batchId || "").trim();
    if (!batchId) return;

    const state = String(row?.workflow?.state || "").trim().toUpperCase();
    if (state !== "IN_PROGRESS" && state !== "COMPLETED") return;

    const counts = countsByBatchId.get(batchId) || { inProgress: 0, completed: 0 };
    if (state === "IN_PROGRESS") counts.inProgress += 1;
    else counts.completed += 1;
    countsByBatchId.set(batchId, counts);
  });

  return countsByBatchId;
}
