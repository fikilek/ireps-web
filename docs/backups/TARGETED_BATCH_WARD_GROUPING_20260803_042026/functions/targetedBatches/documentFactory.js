import {
  TARGETED_BATCH_CREATION_STATES,
  buildTbRowId,
  normalizeMeterNo,
  normalizeMonth,
  normalizeText,
  normalizeUpper,
  safeArray,
} from "./helpers.js";

function asNonNegativeInteger(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.round(numberValue));
}

function asNonNegativeNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, numberValue);
}

function normalizeMonthMap(value = {}, valueMapper = asNonNegativeInteger) {
  return Object.entries(value || {}).reduce((result, [key, itemValue]) => {
    const month = normalizeMonth(key);
    if (month) result[month] = valueMapper(itemValue);
    return result;
  }, {});
}

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
    schemaVersion: "0.1.0",
    id: payload.tbId,
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
    },
    selection: {
      reason: payload.selection.reason,
      salesPeriodFrom: payload.selection.salesPeriodFrom,
      salesPeriodTo: payload.selection.salesPeriodTo,
    },
    validation: {
      status: "PASSED",
      fileDecision: payload.validation.fileDecision,
      errors: payload.validation.errors,
      warnings: payload.validation.warnings,
    },
    creation: {
      state: TARGETED_BATCH_CREATION_STATES.creating,
      fingerprint,
      expectedRows: totalRows,
      createdRows: 0,
      linkedSalesRecords: 0,
      startedAt: creationDate,
      completedAt: null,
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
  draftRow,
  salesSource,
  erfReference,
  salesAllMeterId,
  rowNo,
  creationDate,
  actorUid,
  actorName,
}) {
  const id = buildTbRowId(payload.tbId, rowNo);
  const numberRaw = getFirstText(
    salesSource?.meterNo,
    salesSource?.MeterNumber,
    draftRow?.meterNo,
    salesAllMeterId,
  );
  const numberNormalized = normalizeMeterNo(
    getFirstText(
      salesSource?.meterNoNormalized,
      salesSource?.meterNo,
      salesSource?.MeterNumber,
      draftRow?.meterNoNormalized,
      salesAllMeterId,
    ),
  );
  const masterVisibility = normalizeUpper(
    salesSource?.master?.visibility ||
      draftRow?.masterVisibility ||
      draftRow?.master?.visibility,
  );
  const wardNumbers = safeArray(
    draftRow?.wardNumbers || salesSource?.wardNumbers,
  )
    .map((value) =>
      typeof value === "number" ? value : normalizeText(value),
    )
    .filter((value) => value !== "");
  const sourceLine = Number(
    draftRow?.sourceRow || draftRow?.sourceLine || salesSource?.sourceRow || 0,
  );

  return {
    schemaVersion: "0.1.0",
    id,
    tbId: payload.tbId,
    rowNo,
    salesAllMeterId,
    source: {
      type: payload.source.type,
      recordId: salesAllMeterId,
      sourceLine:
        Number.isInteger(sourceLine) && sourceLine > 0 ? sourceLine : null,
      fileName: getFirstNullableText(
        draftRow?.sourceFileName,
        salesSource?.sourceFileName,
        payload.source.fileName,
      ),
    },
    scope: {
      lmPcode: payload.scope.lmPcode,
      lmName: payload.scope.lmName,
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
      accountNumber: getFirstText(
        draftRow?.accountNumber,
        draftRow?.accountNo,
        salesSource?.accountNumber,
        salesSource?.AccountNumber,
        salesSource?.accountNo,
      ),
      customerName: getFirstText(
        draftRow?.customerName,
        salesSource?.customerName,
        salesSource?.Customer,
        salesSource?.Surname,
      ),
    },
    property: {
      erfNo: getFirstNullableText(erfReference?.erfNo),
    },
    location: {
      erfNo: getFirstNullableText(erfReference?.erfNo),
      addressLine1: getFirstText(
        draftRow?.addressLine1,
        salesSource?.addressLine1,
        salesSource?.AddressLine1,
        salesSource?.PostalAddress1,
      ),
      town: getFirstText(
        draftRow?.town,
        salesSource?.town,
        salesSource?.Town,
        salesSource?.PostalAddressTown,
      ),
      sgCode: getFirstText(salesSource?.sgCode),
      wardNumberLabel: getFirstText(
        draftRow?.wardNumberLabel,
        salesSource?.wardNumberLabel,
        wardNumbers.join(", "),
        "NAv",
      ),
      wardNumbers,
    },
    selection: {
      actionReason: payload.selection.reason,
    },
    salesSnapshot: {
      totalSalesC: asNonNegativeInteger(
        draftRow?.totalSalesC ??
          draftRow?.totalAmountC ??
          salesSource?.totalSalesC ??
          salesSource?.totalAmountC,
      ),
      latestMonthSalesC: asNonNegativeInteger(
        draftRow?.latestMonthSalesC ?? salesSource?.latestMonthSalesC,
      ),
      sales3MonthsC: asNonNegativeInteger(
        draftRow?.sales3MonthsC ?? salesSource?.sales3MonthsC,
      ),
      sales6MonthsC: asNonNegativeInteger(
        draftRow?.sales6MonthsC ?? salesSource?.sales6MonthsC,
      ),
      sales12MonthsC: asNonNegativeInteger(
        draftRow?.sales12MonthsC ??
          draftRow?.latest12MonthsSalesC ??
          salesSource?.sales12MonthsC ??
          salesSource?.latest12MonthsSalesC,
      ),
      monthsWithoutSales: asNonNegativeInteger(
        draftRow?.monthsWithoutSales ?? salesSource?.monthsWithoutSales,
      ),
      lastPositiveSalesMonth: normalizeMonth(
        draftRow?.lastPositiveSalesMonth || salesSource?.lastPositiveSalesMonth,
      ),
      monthlySalesC: normalizeMonthMap(
        draftRow?.monthlySalesC ||
          draftRow?.monthlyTotalsC ||
          salesSource?.monthlySalesC ||
          salesSource?.monthlyTotalsC,
        asNonNegativeInteger,
      ),
      monthlyUnits: normalizeMonthMap(
        draftRow?.monthlyUnits || salesSource?.monthlyUnits,
        asNonNegativeNumber,
      ),
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
      premiseId: getFirstNullableText(draftRow?.premiseId),
      meterId: getFirstNullableText(draftRow?.astId, draftRow?.meterId),
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
