function isMeaningful(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  return Boolean(s) && s.toUpperCase() !== "NAV" && s.toUpperCase() !== "NONE";
}

function firstMeaningful(...values) {
  for (const val of values) {
    if (isMeaningful(val)) return String(val).trim();
  }
  return "";
}

function formatAddressValue(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return isMeaningful(addr) ? addr.trim() : "";
  if (typeof addr === "object") {
    const parts = [addr.strNo, addr.strName, addr.strType, addr.suburbName]
      .map((v) => String(v ?? "").trim())
      .filter((v) => v && v.toUpperCase() !== "NAV");
    return parts.join(" ");
  }
  return "";
}

function liveTrnStatusMessage(state = "", naCount = 0) {
  const upper = String(state || "").trim().toUpperCase();
  if (upper === "QA PASS") return "QA Passed";
  if (upper === "QA FAIL") return "QA Failed";
  if (upper === "COMPLETED") return "Execution completed";
  if (upper === "IN_PROGRESS") return naCount > 0 ? `In progress (${naCount} NA)` : "In progress";
  if (upper === "ACCEPTED") return "Accepted by field";
  if (upper === "ISSUED") return "Issued / Allocated";
  if (upper === "CREATED") return "Created / Ready for allocation";
  return "";
}

export function buildTrnBgoDisplayRows({ rawRows = [], childTrns = [], activeBatch = null } = {}) {
  const trnById = new Map(
    (Array.isArray(childTrns) ? childTrns : [])
      .filter((t) => t?.id)
      .map((t) => [t.id, t]),
  );

  return (Array.isArray(rawRows) ? rawRows : []).map((row, index) => {
    const rowNo = row.rowNo ?? index + 1;
    const trnId = firstMeaningful(
      row.trnId,
      row.raw?.trnId,
      row.childTrnId,
      row.bgo?.trnId,
    );
    const liveTrn = trnId ? trnById.get(trnId) || null : null;

    const meterNo = firstMeaningful(
      liveTrn?.ast?.astData?.astNo,
      row.input?.meterNo,
      row.meterNo,
      row.ast?.meterNo,
      row.ast?.astNo,
    ) || "NAv";

    const meterType = firstMeaningful(
      liveTrn?.ast?.astData?.meter?.type,
      liveTrn?.meterType,
      row.ast?.meterType,
      row.raw?.ast?.meterType,
      row.input?.meterType,
    ) || "NAv";

    const meterPhase = firstMeaningful(
      liveTrn?.ast?.astData?.meter?.phase,
      liveTrn?.ast?.astData?.meter?.phaseType,
      row.ast?.meterPhase,
      row.raw?.ast?.meterPhase,
      row.input?.meterPhase,
    ) || "NAv";

    const address =
      formatAddressValue(liveTrn?.accessData?.premise?.address) ||
      formatAddressValue(row.premise?.address) ||
      formatAddressValue(row.raw?.premise?.address) ||
      firstMeaningful(row.input?.premiseAddress, row.address) ||
      "NAv";

    const erfNo = firstMeaningful(
      liveTrn?.accessData?.erfNo,
      row.premise?.erfNo,
      row.input?.erfNo,
      row.ast?.erfNo,
      row.erfNo,
    ) || "NAv";

    const accountNo = firstMeaningful(
      row.input?.accountNo,
      row.input?.linkedAccountNo,
      row.accountNo,
    ) || "NAv";

    const actionReason = firstMeaningful(
      row.input?.reason,
      row.input?.actionReason,
      row.actionReason,
    ) || "NAv";

    const meterStatus = String(
      firstMeaningful(
        liveTrn?.status?.state,
        row.ast?.statusState,
        row.ast?.meterStatus,
        row.input?.meterStatus,
        "CONNECTED",
      ),
    ).toUpperCase();

    const isEligible = row.backend?.eligible === true;
    const validationState = isEligible
      ? "ELIGIBLE"
      : (row.backend?.eligibilityCode || row.backend?.state || (row.backend?.matched ? "ELIGIBLE" : "NOT_ELIGIBLE"));

    const isReady = row.bgo?.ready === true || (isEligible && !row.backend?.alreadyHasActiveSameOperationTrn);
    const readinessState = isReady
      ? "READY_FOR_BGO"
      : (row.bgo?.readinessState || (row.backend?.alreadyHasActiveSameOperationTrn ? "BLOCKED" : "NOT_READY"));

    const activeTrnId = firstMeaningful(
      liveTrn?.id,
      trnId,
      row.backend?.activeLifecycle?.trnId,
    ) || "None";

    const activeTrnState = firstMeaningful(
      liveTrn?.workflow?.state,
      row.backend?.activeLifecycle?.workflowState,
    );

    const rawNaCount =
      liveTrn?.noAccessCount ??
      (Array.isArray(liveTrn?.noAccessTrnIds) ? liveTrn.noAccessTrnIds.length : 0);
    const naCount = Number.isFinite(Number(rawNaCount)) ? Math.max(0, Number(rawNaCount)) : 0;

    const updatedAt = firstMeaningful(
      liveTrn?.metadata?.updatedAt,
      liveTrn?.workflow?.completedAt,
      liveTrn?.workflow?.executionStartedAt,
      row.raw?.metadata?.updatedAt,
      row.metadata?.updatedAt,
    );

    const blockingMessage =
      firstMeaningful(
        row.backend?.errors?.[0],
        row.bgo?.readinessReason,
        row.backend?.message,
        liveTrnStatusMessage(activeTrnState, naCount),
      ) || (isReady ? "Ready for batch allocation" : "Not ready");

    const reasonCode =
      row.backend?.reasonCodes?.[0] ||
      (row.backend?.alreadyHasActiveSameOperationTrn ? "BLOCKED_ACTIVE_SAME_OPERATION_TRN" : "");

    const wardNo = firstMeaningful(
      liveTrn?.accessData?.parents?.wardPcode,
      row.premise?.wardNo,
      row.premise?.wardPcode,
      row.input?.wardNo,
      row.wardPcode,
      row.raw?.wardPcode,
      activeBatch?.wardPcode,
    ) || "NAv";

    const geofenceName = firstMeaningful(
      row.geofenceRefs?.[0]?.name,
      row.ast?.geofenceRefs?.[0]?.name,
      row.geofenceName,
      activeBatch?.summary?.geofenceBreakdown?.[0]?.name,
    ) || "NAv";

    return {
      id: row.id || `row_${index}`,
      rowNo,
      meterNo,
      meterType,
      meterPhase,
      address,
      erfNo,
      accountNo,
      actionReason,
      meterStatus,
      isEligible,
      validationState,
      isReady,
      readinessState,
      blockingMessage,
      reasonCode,
      activeTrnId,
      activeTrnState,
      naCount,
      updatedAt,
      wardNo,
      geofenceName,
      raw: row,
      liveTrn,
    };
  });
}

export function formatBatchAllocatedTo(batch = null, childTrns = []) {
  const fromBatchTarget = batch?.assignment?.targets?.[0];
  const fromChildTarget = Array.isArray(childTrns)
    ? childTrns.find((t) => t?.assignment?.targets?.[0])?.assignment?.targets?.[0]
    : null;
  const target = fromBatchTarget || fromChildTarget || batch?.target || null;
  const name = String(
    target?.name ||
      target?.label ||
      target?.targetName ||
      batch?.targetName ||
      batch?.bgo?.targetName ||
      target?.id ||
      "",
  ).trim();
  if (!name || name.toUpperCase() === "NAV") return "Unallocated";
  const type = String(target?.type || target?.targetType || "").trim().toUpperCase();
  return type && !name.toUpperCase().startsWith(`${type}:`) ? `${type}: ${name}` : name;
}
