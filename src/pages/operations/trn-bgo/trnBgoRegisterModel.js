const TRN_BATCH_STATES = new Set([
  "READY_FOR_BGO",
  "READY_FOR_ALLOCATION",
  "ISSUED",
  "ALLOCATED",
  "ACCEPTED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "USED",
  "PARTIALLY_USED",
]);

export function getTrnBgoBatchStatus(batch = {}) {
  const total = Number(batch?.totalRows || 0);
  const inProgress = Number(batch?.inProgressRows || 0);
  const completed = Number(batch?.completedRows || 0);
  if (total > 0 && completed >= total) return "COMPLETED";
  if (inProgress > 0 || completed > 0) return "IN PROGRESS";
  const state = String(
    batch?.workflowState || batch?.raw?.workflow?.state || batch?.bgoStatus || "",
  )
    .trim()
    .toUpperCase();
  return TRN_BATCH_STATES.has(state) ? state.replace(/_/g, " ") : "NAv";
}

export function getTrnBatchAllocationStatus(batch = {}) {
  const bgoStatus = String(batch?.bgoStatus || "").toUpperCase();
  const workflowState = String(
    batch?.workflowState || batch?.workflow?.state || batch?.raw?.workflow?.state || "",
  ).toUpperCase();
  const hasTarget = Array.isArray(batch?.assignment?.targets) && batch.assignment.targets.length > 0;
  const hasTeamOrSp = Boolean(
    batch?.teamId || batch?.spId || batch?.allocatedTo || batch?.assignedTeamId,
  );

  const isAllocated =
    bgoStatus === "USED" ||
    bgoStatus === "ALLOCATED" ||
    bgoStatus === "PARTIALLY_USED" ||
    workflowState === "ALLOCATED" ||
    workflowState === "IN_PROGRESS" ||
    workflowState === "ISSUED" ||
    workflowState === "ACCEPTED" ||
    hasTarget ||
    hasTeamOrSp;

  if (isAllocated) {
    return {
      label: "Allocated",
      bg: "#eff6ff",
      text: "#1d4ed8",
      border: "#bfdbfe",
    };
  }

  return {
    label: "Unallocated",
    bg: "#fef3c7",
    text: "#b45309",
    border: "#fde68a",
  };
}

function getWardLabel(batch = {}) {
  const wardName = batch?.raw?.wardName || batch?.raw?.scope?.wardName || batch?.wardName;
  const wardPcode =
    batch?.wardPcode || batch?.raw?.scope?.wardPcode || batch?.raw?.parents?.wardPcode || "";
  const match = String(wardPcode).match(/(\d{1,3})$/);
  const wardNo = match ? String(Number(match[1])) : "";

  if (wardNo) return `Ward ${wardNo}`;
  return wardName || "NAv";
}

function getWardNoFormatted(batch = {}) {
  const wardPcode =
    batch?.wardPcode || batch?.raw?.scope?.wardPcode || batch?.raw?.parents?.wardPcode || "";
  const match = String(wardPcode).match(/(\d{1,3})$/);
  if (!match) return "NAv";
  return match[1].padStart(3, "0");
}

function resolveAllocatedTo(batch = {}) {
  const candidate =
    batch?.allocatedTo ||
    batch?.raw?.bgo?.targetName ||
    batch?.assignment?.targets?.[0]?.name ||
    batch?.teamName ||
    batch?.spName ||
    "";
  const text = String(candidate).trim();
  return text || "NAv";
}

export function buildTrnBgoRegisterRow(batch = {}, registerDetails = null) {
  const alloc = getTrnBatchAllocationStatus(batch);
  const isAllocated = alloc.label === "Allocated";
  const workflowState = String(
    batch?.workflowState || batch?.raw?.workflow?.state || "",
  )
    .trim()
    .toUpperCase();
  const inProgress = Number(batch?.inProgressRows || 0);
  const completed = Number(batch?.completedRows || 0);
  const fieldworkStarted =
    inProgress > 0 ||
    completed > 0 ||
    workflowState === "IN_PROGRESS" ||
    workflowState === "COMPLETED";
  const issuedAt = batch?.raw?.workflow?.issuedAt || batch?.workflow?.issuedAt || null;
  const unallocationIntentUnavailable =
    !batch?.contractVersion ||
    !["ISSUED", "ACCEPTED"].includes(workflowState) ||
    !issuedAt;
  const wardPcode =
    batch?.wardPcode || batch?.raw?.scope?.wardPcode || batch?.raw?.parents?.wardPcode || "NAv";
  const geofenceDetail = registerDetails?.[batch.id];
  const geofence = geofenceDetail?.ready ? geofenceDetail.text || "NAv" : "NAv";

  return {
    ...batch,
    batchId: batch.id,
    allocation: isAllocated ? "ALLOCATED" : "NOT ALLOCATED",
    allocatedTo: resolveAllocatedTo(batch),
    batchStatus: getTrnBgoBatchStatus(batch),
    ward: getWardLabel(batch),
    wardNo: getWardNoFormatted(batch),
    wardPcode: wardPcode === "NAv" ? "NAv" : wardPcode,
    geofence,
    isAllocated,
    fieldworkStarted,
    unallocationIntentUnavailable,
    canDelete: inProgress === 0 && completed === 0,
  };
}

export function trnBgoRegisterSearchValue(row = {}) {
  return [
    row.batchId || row.id,
    row.trnType,
    row.fileName,
    row.allocation,
    row.allocatedTo,
    row.batchStatus,
    row.totalRows,
    row.notStartedRows,
    row.inProgressRows,
    row.completedRows,
    row.ward,
    row.wardNo,
    row.wardPcode,
    row.geofence,
  ]
    .filter((value) => value != null)
    .join(" ");
}
