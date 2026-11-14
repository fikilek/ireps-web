export function trnBgoProgress(rows) {
  const counts = {};
  const seen = new Set();
  for (const row of rows) {
    const batchId = row?.origin?.trnBgo?.batchId;
    if (!batchId || seen.has(row.id)) continue;
    seen.add(row.id);
    const count = counts[batchId] ||= { notStartedRows: 0, inProgressRows: 0, completedRows: 0, total: 0 };
    count.total++;
    const state = String(row.workflow?.state || "").toUpperCase();
    if (["CREATED", "ISSUED", "ACCEPTED", "READY_FOR_ALLOCATION", "ALLOCATED", "REJECTED"].includes(state)) count.notStartedRows++;
    else if (state === "IN_PROGRESS") count.inProgressRows++;
    else if (state === "COMPLETED") count.completedRows++;
  }
  return counts;
}
