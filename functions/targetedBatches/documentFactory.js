import {
  TARGETED_BATCH_CREATION_STATES,
  buildTbRowId,
  normalizeMeterNo,
  normalizeMonth,
  normalizeText,
} from "./helpers.js";






function getFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function getFirstNullableText(...values) {
  return getFirstText(...values) || null;
}

function buildMetadata({ creationDate, actorUid, actorName }) {
  return {
    createdAt: creationDate,
    createdByUid: actorUid,
    createdByUser: actorName,
    updatedAt: creationDate,
    updatedByUid: actorUid,
    updatedByUser: actorName,
  };
}

export function buildTargetedBatchParentDoc({
  payload,
  fingerprint,
  creationDate,
  actorUid,
  actorName,
}) {
  const totalRows = payload.expectedRows;

  return {
    schemaVersion: "0.3.0",
    id: payload.tbId,
    geofenceId: payload.geofenceId,
    status: "READY_FOR_ALLOCATION",
    source: {
      type: payload.source.type,
      label: payload.source.label,
      sourceId: payload.source.sourceId,
      fileName: payload.source.fileName,
    },
    scope: {
      lmPcode: payload.scope.lmPcode,
      lmName: payload.scope.lmName,
      wardPcode: payload.scope.wardPcode,
      wardNumber: payload.scope.wardNumber,
      wardName: payload.scope.wardName,
    },
    creationGroup: {
      id: payload.creationGroupId,
      batchCount: 1,
    },
    selection: {
      reason: payload.selection.reason,
      salesPeriodFrom: payload.selection.salesPeriodFrom,
      salesPeriodTo: payload.selection.salesPeriodTo,
      planningMode: payload.selection.planningMode || "WARD_ERF",
    },
    validation: {
      status: "PASSED",
      fileDecision: payload.validation.fileDecision,
      errors: payload.validation.errors,
      warnings: payload.validation.warnings,
    },
    creation: {
      state: TARGETED_BATCH_CREATION_STATES.ready,
      fingerprint,
      expectedRows: totalRows,
      createdRows: totalRows,
      linkedSalesRecords: totalRows,
      startedAt: creationDate,
      completedAt: creationDate,
      failureCode: null,
      failureMessage: null,
    },
    counts: {
      totalRows,
      acceptedRows: totalRows,
      rejectedRows: 0,
      allocatableRows: totalRows,
      allocatedRows: 0,
      unallocatedRows: totalRows,
      executionStartedRows: 0,
      completedRows: 0,
    },
    allocation: {
      status: "NOT_STARTED",
      completedAt: null,
    },
    acceptance: {
      status: "NOT_READY",
      acceptedAt: null,
      acceptedByUid: null,
      acceptedByUser: null,
      rejectedAt: null,
      rejectedByUid: null,
      rejectedByUser: null,
      rejectReason: "",
    },
    execution: {
      status: "NOT_STARTED",
      startedAt: null,
      completedAt: null,
    },
    finalReport: {
      status: "DRAFT",
      generatedAt: null,
      reportId: null,
    },
    metadata: {
      ...buildMetadata({ creationDate, actorUid, actorName }),
      confirmedAt: creationDate,
    },
  };
}

export function buildTargetedBatchRowDoc({
  payload,
  draftRow: _draftRow,
  salesSource,
  erfReference,
  salesAllMeterId,
  rowNo,
  creationDate,
  actorUid,
  actorName,
}) {
  const id = buildTbRowId(payload.tbId, rowNo);
  const numberRaw = getFirstText(salesSource.meterNo);
  const numberNormalized = normalizeMeterNo(salesSource.meterNoNormalized);
  const masterVisibility = salesSource.master?.visibility;
  const sourceLine = salesSource.sourceRow;
  const months = salesSource.monthlySalesC ?? salesSource.monthlyTotalsC;
  if (!months || typeof months !== "object" || Array.isArray(months) || Object.entries(months).some(([month, value]) => !normalizeMonth(month) || !Number.isInteger(value) || value < 0)) throw new Error("Fresh Sales monthly totals are missing or invalid");
  const monthKeys = Object.keys(months).sort().reverse();
  const sumMonths = n => monthKeys.slice(0, n).reduce((total, month) => total + months[month], 0);
  const lastPositiveSalesMonth = monthKeys.find(month => months[month] > 0) || null;
  const ngp = payload.source.type === "PREPAID_SALES_NON_GPS";
  const planningKey = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const townKey = ngp ? planningKey(salesSource.town) : null;
  const streetKey = ngp ? `${townKey}::${planningKey(salesSource.adr?.strName)}` : null;

  return {
    schemaVersion: "0.3.0",
    id,
    tbId: payload.tbId,
    rowNo,
    salesAllMeterId,
    source: {
      type: payload.source.type,
      recordId: salesAllMeterId,
      sourceLine:
        Number.isInteger(sourceLine) && sourceLine > 0 ? sourceLine : null,
      fileName: getFirstNullableText(salesSource.sourceFileName),
    },
    scope: {
      lmPcode: payload.scope.lmPcode,
      lmName: payload.scope.lmName,
      wardPcode: payload.scope.wardPcode,
      wardNumber: payload.scope.wardNumber,
      wardName: payload.scope.wardName,
    },
    decision: {
      status: "ACCEPT",
      reasons: [],
    },
    meter: {
      numberRaw,
      numberNormalized,
      masterVisibility: ["VISIBLE", "INVISIBLE"].includes(masterVisibility)
        ? masterVisibility
        : null,
    },
    customer: {
      accountNumber: getFirstText(salesSource.accountNo, salesSource.accountNumber),
      customerName: getFirstText(salesSource.customerName, salesSource.customerSurname),
    },
    property: {
      erfNo: getFirstNullableText(erfReference?.erfNo),
    },
    location: {
      erfNo: getFirstNullableText(erfReference?.erfNo),
      addressLine1: getFirstText(salesSource.addressLine1),
      town: getFirstText(salesSource.town),
      strNo: getFirstText(salesSource.adr?.strNo),
      strName: getFirstText(salesSource.adr?.strName),
      strType: getFirstText(salesSource.adr?.strType),
      sgCode: getFirstText(salesSource?.sgCode),
      wardNumberLabel: getFirstText(
        payload.scope.wardName,
        payload.scope.wardNumber
          ? `Ward ${payload.scope.wardNumber}`
          : "",
        "NAv",
      ),
      wardNumbers: payload.scope.wardNumber
        ? [payload.scope.wardNumber]
        : [],
    },
    selection: {
      actionReason: payload.selection.reason,
      planningMode: payload.selection.planningMode || "WARD_ERF",
      townKey,
      streetKey,
    },
    salesSnapshot: {
      totalSalesC: sumMonths(monthKeys.length),
      latestMonthSalesC: sumMonths(1),
      sales3MonthsC: sumMonths(3),
      sales6MonthsC: sumMonths(6),
      sales12MonthsC: sumMonths(12),
      monthsWithoutSales: lastPositiveSalesMonth ? monthKeys.indexOf(lastPositiveSalesMonth) : monthKeys.length,
      lastPositiveSalesMonth,
      monthlySalesC: { ...months },
      monthlyUnits: strictMonthlyUnits(salesSource.monthlyUnits),
    },
    allocation: {
      allocatable: true,
      status: "UNALLOCATED",
      targetType: null,
      targetId: null,
      targetName: null,
      allocatedAt: null,
      allocatedByUid: null,
      allocatedByUser: null,
    },
    execution: {
      status: "NOT_STARTED",
      startedAt: null,
      completedAt: null,
      outcome: null,
    },
    refs: {
      erfId: getFirstNullableText(erfReference?.erfId),
      premiseId: null,
      meterId: null,
      trnId: null,
    },
    metadata: buildMetadata({ creationDate, actorUid, actorName }),
  };
}

export function buildSalesTbRef({ tbId, creationDate }) {
  return {
    id: tbId,
    date: creationDate,
  };
}

export function buildCreationReadyPatch({
  completedAt,
  expectedRows,
  actorUid,
  actorName,
}) {
  return {
    status: "READY_FOR_ALLOCATION",
    "creation.state": TARGETED_BATCH_CREATION_STATES.ready,
    "creation.createdRows": expectedRows,
    "creation.linkedSalesRecords": expectedRows,
    "creation.completedAt": completedAt,
    "creation.failureCode": null,
    "creation.failureMessage": null,
    "metadata.updatedAt": completedAt,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

export function buildCreationRetryPatch({ startedAt, actorUid, actorName }) {
  return {
    "creation.state": TARGETED_BATCH_CREATION_STATES.creating,
    "creation.completedAt": null,
    "creation.failureCode": null,
    "creation.failureMessage": null,
    "metadata.updatedAt": startedAt,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

export function buildCreationFailurePatch({
  failedAt,
  code,
  message,
  actorUid,
  actorName,
}) {
  return {
    "creation.state": TARGETED_BATCH_CREATION_STATES.failed,
    "creation.completedAt": null,
    "creation.failureCode": code || "TARGETED_BATCH_CREATE_FAILED",
    "creation.failureMessage": normalizeText(message).slice(0, 1000),
    "metadata.updatedAt": failedAt,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

function strictMonthlyUnits(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([month, units]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || typeof units !== "number" || !Number.isFinite(units) || units < 0)) throw new Error("Sales monthly units are invalid");
  return { ...value };
}
