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
  const seen = new Set();

  rows.forEach((row) => {
    const batchId = String(row?.bgoBatchId || row?.batchId || "").trim();
    if (!batchId) return;

    const state = String(row?.workflow?.state || "").trim().toUpperCase();
    if (state === "CANCELLED") return;
    const key = row.id ? `${batchId}:${row.id}` : null;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);

    const counts = countsByBatchId.get(batchId) || { total: 0, inProgress: 0, completed: 0 };
    counts.total += 1;
    if (state === "IN_PROGRESS") counts.inProgress += 1;
    else if (state === "COMPLETED") counts.completed += 1;
    countsByBatchId.set(batchId, counts);
  });

  return countsByBatchId;
}

export function buildMdBgoRegisterRow(batch, countsByBatchId, stream) {
  const status = getAllocationStatus(batch);
  const targetType = batch.targetType || batch.target?.type || batch.raw?.bgo?.targetType || "";
  const targetId = batch.targetId || batch.target?.id || batch.raw?.bgo?.targetId || "";
  const issuedAt = batch.raw?.workflow?.issuedAt;
  const issuedAtMillis = typeof issuedAt?.toMillis === "function"
    ? issuedAt.toMillis()
    : issuedAt instanceof Date ? issuedAt.getTime() : Date.parse(issuedAt);
  const counts = stream.ready && !stream.error ? countsByBatchId.get(batch.id) || { total: 0, inProgress: 0, completed: 0 } : null;
  return {
    ...batch,
    batchId: batch.id,
    allocation: status === "READY_FOR_ALLOCATION" ? "NOT ALLOCATED" : "ALLOCATED",
    allocatedTo: batch.targetName || batch.target?.name || "NAv",
    batchStatus: getMdBgoBatchStatus(batch),
    total: counts?.total ?? null,
    notStarted: counts ? counts.total - counts.inProgress - counts.completed : null,
    inProgress: counts?.inProgress ?? null,
    completed: counts?.completed ?? null,
    ward: getWardLabel(batch),
    wardNo: getWardNoFormatted(batch),
    wardPcode: batch.scope?.wardPcode || "NAv",
    geofence: batch.geofenceName || batch.geofenceRef?.name || "NAv",
    createdBy: batch.metadata?.createdByUser || batch.createdByUser || "NAv",
    isAllocated: status !== "READY_FOR_ALLOCATION",
    fieldworkStarted: status === "IN_PROGRESS" || status === "COMPLETED",
    unallocationIntentUnavailable: !["TEAM", "SP"].includes(String(targetType).toUpperCase()) || !targetId || String(targetId).toUpperCase() === "NAV" || !Number.isFinite(issuedAtMillis),
    intentTargetType: targetType,
    intentTargetId: targetId,
    canDelete: status === "READY_FOR_ALLOCATION" || status === "ALLOCATED",
  };
}

export function mdBgoRegisterSearchValue(row) {
  return [row.batchId, row.allocation, row.allocatedTo, row.batchStatus, row.total,
    row.notStarted, row.inProgress, row.completed, row.ward, row.wardNo, row.wardPcode, row.geofence, row.createdBy].filter((value) => value != null).join(" ");
}

function getWardLabel(batch = {}) {
  const wardName = batch?.scope?.wardName;
  const wardPcode = batch?.scope?.wardPcode || "";
  const match = wardPcode.match(/(\d{1,3})$/);
  const wardNo = match ? String(Number(match[1])) : "";

  if (wardNo) return `Ward ${wardNo}`;
  return wardName || "NAv";
}

function getWardNoFormatted(batch = {}) {
  const wardPcode = batch?.scope?.wardPcode || "";
  const match = wardPcode.match(/(\d{1,3})$/);
  if (!match) return "NAv";
  return match[1].padStart(3, "0");
}

export function isBmdBatch(batch = {}) {
  const batchMode = String(
    batch?.batchMode || batch?.raw?.bgo?.batchMode || batch?.bgo?.batchMode || "",
  ).toUpperCase();
  const opType = String(
    batch?.operationType || batch?.trnType || batch?.raw?.operationType || "",
  ).toUpperCase();
  return batchMode === "BMD" || opType === "METER_DISCOVERY";
}

export function getAllocationStatus(batch = {}) {
  const workflowState = String(
    batch?.workflowState || batch?.raw?.workflow?.state || "",
  ).toUpperCase();
  const targetId = String(
    batch?.targetId || batch?.target?.id || batch?.raw?.bgo?.targetId || "",
  ).trim();
  const hasTarget = Boolean(targetId && targetId.toUpperCase() !== "NAV");

  if (workflowState === "COMPLETED") return "COMPLETED";
  if (workflowState === "IN_PROGRESS") return "IN_PROGRESS";
  if (["ALLOCATED", "ISSUED", "ACCEPTED", "REJECTED"].includes(workflowState) || hasTarget) return "ALLOCATED";
  if (workflowState === "READY_FOR_ALLOCATION" && !hasTarget) return "READY_FOR_ALLOCATION";
  return "ALLOCATION_REVIEW";
}
