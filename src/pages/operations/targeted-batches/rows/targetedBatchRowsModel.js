import {
  TARGETED_BATCH_ROW_DECISIONS,
  TARGETED_BATCH_SOURCE_TYPES,
} from "../../../../redux/targetedBatchDraftModel";

export const TB_ROW_NOT_APPLICABLE = "NOT_APPLICABLE";
export const TB_ROW_NOT_STARTED = "NOT_STARTED";

export const TARGETED_BATCH_ROW_LIFECYCLE_FIELDS = Object.freeze([
  "tbRowId",
  "outcome",
  "rejectionReason",
  "allocationStatus",
  "allocationTarget",
  "fieldAcceptanceStatus",
  "premiseStatus",
  "premiseId",
  "meterDiscoveryStatus",
  "meterDiscoveryTrnId",
  "completionStatus",
  "astId",
]);

export const TB_ROW_FILTER_DEFAULTS = Object.freeze({
  search: "",
  meterNo: "",
  accountCustomer: "",
  town: "",
  outcome: "ALL",
  astMatchStatus: "ALL",
  proposedTrnType: "ALL",
  allocationStatus: "ALL",
  premiseStatus: "ALL",
  meterDiscoveryStatus: "ALL",
  completionStatus: "ALL",
});

function asText(value) {
  return String(value ?? "").trim();
}

function asUpper(value, fallback = "") {
  return asText(value).toUpperCase() || fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function normalizeOutcome(row, sourceType) {
  const explicitOutcome = asUpper(
    row?.rowDecision ?? row?.assessmentDecision ?? row?.decision,
  );

  if (explicitOutcome === TARGETED_BATCH_ROW_DECISIONS.ACCEPT) {
    return TARGETED_BATCH_ROW_DECISIONS.ACCEPT;
  }

  if (explicitOutcome === TARGETED_BATCH_ROW_DECISIONS.REJECT) {
    return TARGETED_BATCH_ROW_DECISIONS.REJECT;
  }

  // A Prepaid Sales draft contains only the meters deliberately selected by the
  // user. They become operational candidates when the batch is confirmed.
  if (
    sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES ||
    sourceType === "PREPAID_SALES_NON_GPS"
  ) {
    return TARGETED_BATCH_ROW_DECISIONS.ACCEPT;
  }

  return "UNASSESSED";
}

function normalizeAllocationTarget(row) {
  const targetType = asUpper(
    row?.allocationTargetType ??
      row?.allocation?.targetType ??
      row?.assignment?.targetType,
  );
  const targetId = firstText(
    row?.allocationTargetId,
    row?.allocation?.targetId,
    row?.assignment?.targetId,
    row?.teamId,
    row?.serviceProviderId,
  );
  const targetName = firstText(
    row?.allocationTargetName,
    row?.allocation?.targetName,
    row?.assignment?.targetName,
    row?.teamName,
    row?.serviceProviderName,
  );

  if (!targetId && !targetName) return null;

  const displayType =
    targetType === "SERVICE_PROVIDER" || targetType === "SP"
      ? "SP"
      : targetType || "TEAM/SP";

  return {
    type: displayType,
    id: targetId || null,
    name: targetName || null,
    label: [displayType, targetName || targetId].filter(Boolean).join(" · "),
  };
}

function normalizeLifecycleStatus({ explicit, hasReference, fallback }) {
  const normalized = asUpper(explicit);
  if (normalized) return normalized;
  if (hasReference) return "CREATED";
  return fallback;
}

export function normalizeTargetedBatchRow({ row = {}, index, batch }) {
  const sourceType = batch?.source?.type || batch?.sourceType || "";
  const outcome = normalizeOutcome(row, sourceType);
  const rejected = outcome === TARGETED_BATCH_ROW_DECISIONS.REJECT;
  const allocationTarget = normalizeAllocationTarget(row);
  const tbRowId = firstText(row?.tbRowId, row?.uploadRowId);
  const premiseId = firstText(
    row?.premiseId,
    row?.premise?.id,
    row?.references?.premiseId,
  );
  const meterDiscoveryTrnId = firstText(
    row?.meterDiscoveryTrnId,
    row?.mdTrnId,
    row?.meterDiscovery?.trnId,
    row?.references?.meterDiscoveryTrnId,
  );
  const astId = firstText(row?.astId, row?.ast?.id, row?.references?.astId);
  const salesAllMeterId = firstText(
    row?.salesAllMeterId,
    row?.sourceSalesAllMeterId,
  );
  const rejectionReason = firstText(
    row?.rowDecisionReason,
    row?.rejectionReason,
    Array.isArray(row?.rowDecisionReasons)
      ? row.rowDecisionReasons.join(" ")
      : "",
  );

  const explicitAllocationStatus = asUpper(
    row?.allocationStatus ??
      row?.allocation?.status ??
      row?.assignment?.status,
  );
  const allocationStatus = rejected
    ? TB_ROW_NOT_APPLICABLE
    : explicitAllocationStatus ||
      (allocationTarget ? "ALLOCATED" : "NOT_ALLOCATED");
  const explicitFieldAcceptanceStatus = asUpper(
    row?.fieldAcceptanceStatus ??
      row?.acceptanceStatus ??
      row?.allocation?.acceptanceStatus,
  );
  const fieldAcceptanceStatus = rejected
    ? TB_ROW_NOT_APPLICABLE
    : explicitFieldAcceptanceStatus ||
      (row?.acceptedAt
        ? "ACCEPTED"
        : row?.rejectedAt
          ? "REJECTED"
          : "NOT_RELEASED");
  const explicitPremiseStatus = asUpper(
    row?.premiseStatus ?? row?.premise?.status,
  );
  const premiseStatus = rejected
    ? TB_ROW_NOT_APPLICABLE
    : explicitPremiseStatus || (premiseId ? "LINKED" : TB_ROW_NOT_STARTED);
  const meterDiscoveryStatus = rejected
    ? TB_ROW_NOT_APPLICABLE
    : normalizeLifecycleStatus({
        explicit:
          row?.meterDiscoveryStatus ??
          row?.mdStatus ??
          row?.meterDiscovery?.status,
        hasReference: Boolean(meterDiscoveryTrnId),
        fallback: TB_ROW_NOT_STARTED,
      });
  const explicitCompletionStatus = asUpper(
    row?.completionStatus ??
      row?.workflowStatus ??
      row?.lifecycle?.completionStatus,
  );
  const completionStatus = rejected
    ? TB_ROW_NOT_APPLICABLE
    : explicitCompletionStatus ||
      (row?.completedAt ? "COMPLETED" : TB_ROW_NOT_STARTED);

  const rowNo = firstText(row?.rowNo) || String(index + 1);
  const sourceReference = salesAllMeterId
    ? `Sales All Meters · ${salesAllMeterId}`
    : row?.sourceLine
      ? `CSV line ${row.sourceLine}`
      : "NAv";

  return {
    rowKey:
      tbRowId ||
      salesAllMeterId ||
      firstText(row?.id) ||
      `${batch?.id || "TB"}-${rowNo}-${index}`,
    tbRowId: tbRowId || null,
    rowNo,
    sourceLine: row?.sourceLine ?? null,
    sourceReference,
    sourceType,
    outcome,
    rejectionReason: rejected ? rejectionReason || "Reason missing" : null,
    meterNo: firstText(row?.meterNo, row?.meterNoNormalized),
    accountNumber: firstText(row?.accountNumber, row?.accountNo),
    customerName: firstText(row?.customerName),
    address: firstText(row?.addressLine1, row?.premiseAddress),
    town: firstText(row?.town),
    sgCode: firstText(row?.standNumber, row?.sgCode),
    actionReason: firstText(row?.actionReason, batch?.selection?.reason),
    astMatchStatus: asUpper(row?.astMatchStatus, "NOT_CHECKED"),
    proposedTrnType: asUpper(row?.proposedTrnType, "NOT_SET"),
    allocationStatus,
    allocationTarget,
    fieldAcceptanceStatus,
    premiseStatus,
    premiseId: premiseId || null,
    meterDiscoveryStatus,
    meterDiscoveryTrnId: meterDiscoveryTrnId || null,
    completionStatus,
    astId: astId || null,
    salesAllMeterId: salesAllMeterId || null,
    totalSalesC:
      row?.totalSalesC === null || row?.totalSalesC === undefined
        ? null
        : Number(row.totalSalesC),
  };
}

export function buildTargetedBatchRows(batch) {
  const rows = Array.isArray(batch?.displayRows)
    ? batch.displayRows
    : Array.isArray(batch?.rows)
      ? batch.rows
      : [];

  return rows.map((row, index) =>
    normalizeTargetedBatchRow({ row, index, batch }),
  );
}

function includesText(value, query) {
  if (!query) return true;
  return asUpper(value).includes(asUpper(query));
}

export function filterTargetedBatchRows(rows, filters) {
  const currentFilters = { ...TB_ROW_FILTER_DEFAULTS, ...(filters || {}) };

  return rows.filter((row) => {
    const searchableValues = [
      row.rowNo,
      row.tbRowId,
      row.meterNo,
      row.accountNumber,
      row.customerName,
      row.address,
      row.town,
      row.sgCode,
      row.actionReason,
      row.rejectionReason,
      row.sourceReference,
      row.premiseId,
      row.meterDiscoveryTrnId,
      row.astId,
      row.allocationTarget?.label,
    ];

    if (
      currentFilters.search &&
      !searchableValues.some((value) => includesText(value, currentFilters.search))
    ) {
      return false;
    }

    if (!includesText(row.meterNo, currentFilters.meterNo)) return false;

    if (
      currentFilters.accountCustomer &&
      ![row.accountNumber, row.customerName].some((value) =>
        includesText(value, currentFilters.accountCustomer),
      )
    ) {
      return false;
    }

    if (!includesText(row.town, currentFilters.town)) return false;

    const exactFilters = [
      ["outcome", row.outcome],
      ["astMatchStatus", row.astMatchStatus],
      ["proposedTrnType", row.proposedTrnType],
      ["allocationStatus", row.allocationStatus],
      ["premiseStatus", row.premiseStatus],
      ["meterDiscoveryStatus", row.meterDiscoveryStatus],
      ["completionStatus", row.completionStatus],
    ];

    return exactFilters.every(([filterKey, rowValue]) => {
      const selectedValue = currentFilters[filterKey];
      return selectedValue === "ALL" || selectedValue === rowValue;
    });
  });
}

export function buildTargetedBatchRowFilterOptions(rows) {
  function uniqueValues(key) {
    return Array.from(
      new Set(rows.map((row) => row?.[key]).filter(Boolean)),
    ).sort((left, right) => String(left).localeCompare(String(right)));
  }

  return {
    outcome: uniqueValues("outcome"),
    astMatchStatus: uniqueValues("astMatchStatus"),
    proposedTrnType: uniqueValues("proposedTrnType"),
    allocationStatus: uniqueValues("allocationStatus"),
    premiseStatus: uniqueValues("premiseStatus"),
    meterDiscoveryStatus: uniqueValues("meterDiscoveryStatus"),
    completionStatus: uniqueValues("completionStatus"),
  };
}

export function buildTargetedBatchRowsSummary(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;

      if (row.outcome === TARGETED_BATCH_ROW_DECISIONS.ACCEPT) {
        summary.accepted += 1;
      }

      if (row.outcome === TARGETED_BATCH_ROW_DECISIONS.REJECT) {
        summary.rejected += 1;
      }

      if (row.allocationStatus === "ALLOCATED" || row.allocationTarget) {
        summary.allocated += 1;
      }

      if (row.premiseId) summary.premiseLinked += 1;

      if (
        row.meterDiscoveryStatus === "COMPLETED" ||
        row.meterDiscoveryStatus === "PASSED"
      ) {
        summary.meterDiscoveryCompleted += 1;
      }

      if (row.completionStatus === "COMPLETED") {
        summary.completed += 1;
      }

      if (
        row.outcome === TARGETED_BATCH_ROW_DECISIONS.ACCEPT &&
        row.allocationStatus !== TB_ROW_NOT_APPLICABLE
      ) {
        summary.allocatable += 1;
      }

      return summary;
    },
    {
      total: 0,
      accepted: 0,
      rejected: 0,
      allocatable: 0,
      allocated: 0,
      premiseLinked: 0,
      meterDiscoveryCompleted: 0,
      completed: 0,
    },
  );
}
