export const ALL_FILTER = "ALL";
export const UNASSIGNED_WARD = "Ward Not Assigned";
export const UNASSIGNED_GEOFENCE_ID = "__GEOFENCE_NOT_ASSIGNED__";
export const UNASSIGNED_GEOFENCE_NAME = "Geofence Not Assigned";
export const UNCATEGORISED = "Uncategorised";

export const SALES_CATEGORY_ORDER = Object.freeze([
  "Normal - No Leakage Flag",
  "CAT1 - Zero Purchaser",
  "CAT2 - Ghost Purchaser (1-3 mo)",
  "CAT3 - Micro Purchaser (<R400)",
  "CAT4 - Long Gap (4+ months)",
  "CAT5 - Stopped Purchasing",
  "CAT6 - Low kWh per Rand",
  "CAT8 - Energy Without Purchase",
  UNCATEGORISED,
]);

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

export function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && text !== "NAv") return text;
  }

  return "";
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export function formatPercent(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? `${numberValue.toFixed(1)}%` : "0.0%";
}

export function getRate(trueCount, falseCount) {
  const positive = Number(trueCount || 0);
  const negative = Number(falseCount || 0);
  const denominator = positive + negative;

  return denominator > 0 ? (positive / denominator) * 100 : 0;
}

export function getCompletionRate(completed, total) {
  const denominator = Number(total || 0);
  return denominator > 0 ? (Number(completed || 0) / denominator) * 100 : 0;
}

export function getActiveLmPcode(activeWorkbase) {
  return cleanText(
    activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId,
  );
}

export function getActiveWorkbaseName(activeWorkbase) {
  return firstText(
    activeWorkbase?.name,
    activeWorkbase?.lmName,
    activeWorkbase?.id,
    activeWorkbase?.pcode,
  ) || "NAv";
}

export function getSalesPeriod(row = {}) {
  const from = cleanText(row?.salesPeriodFrom);
  const to = cleanText(row?.salesPeriodTo);

  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || "NAv";
}

export function getBatchSalesPeriod(batch = {}) {
  const from = cleanText(batch?.selection?.salesPeriodFrom);
  const to = cleanText(batch?.selection?.salesPeriodTo);

  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || "NAv";
}

export function getSalesCategory(sales = {}) {
  return firstText(sales?.leakageCategory) || UNCATEGORISED;
}

export function getWard(sales = {}, row = {}, batch = {}) {
  return firstText(
    row?.location?.wardNumberLabel,
    row?.scope?.wardName,
    row?.scope?.wardNumber,
    sales?.wardNumberLabel,
    batch?.scope?.wardName,
    batch?.scope?.wardNumber,
  ) || UNASSIGNED_WARD;
}

export function getGeofenceRefs(sales = {}, geofenceNameById = {}) {
  const refs = Array.isArray(sales?.geofenceRefs) ? sales.geofenceRefs : [];
  const seen = new Set();

  const normalized = refs
    .map((reference) => {
      const id = cleanText(reference?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);

      return {
        id,
        name:
          firstText(reference?.name, geofenceNameById[id], id) || id,
      };
    })
    .filter(Boolean);

  return normalized.length
    ? normalized
    : [
        {
          id: UNASSIGNED_GEOFENCE_ID,
          name: UNASSIGNED_GEOFENCE_NAME,
        },
      ];
}

export function getBatchReference(sales = {}, tbId, rowId) {
  const refs = Array.isArray(sales?.tbRefs) ? sales.tbRefs : [];
  const normalizedTbId = cleanText(tbId);
  const normalizedRowId = cleanText(rowId);

  return (
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId &&
        cleanText(reference?.rowId || reference?.tbRowId) === normalizedRowId,
    ) ||
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId,
    ) ||
    null
  );
}

export function getFieldWork(sales = {}, tbId, rowId) {
  const reference = getBatchReference(sales, tbId, rowId);
  const fieldWork = reference?.fieldWork;

  return fieldWork && typeof fieldWork === "object" && !Array.isArray(fieldWork)
    ? fieldWork
    : {};
}

export function getPremiseId(row = {}, fieldWork = {}) {
  return firstText(
    fieldWork?.premiseId,
    row?.refs?.premiseId,
    row?.execution?.premiseId,
    row?.execution?.result?.premiseId,
  );
}

export function getExecutionStatus(row = {}, fieldWork = {}) {
  return (
    normalizeUpper(firstText(fieldWork?.status, row?.execution?.status)) ||
    "NOT_STARTED"
  );
}

export function getNoAccessCount(fieldWork = {}) {
  return Array.isArray(fieldWork?.noAccess) ? fieldWork.noAccess.length : 0;
}

export function getOriginalMeter(row = {}, sales = {}) {
  return firstText(
    row?.meter?.numberRaw,
    row?.meter?.numberNormalized,
    sales?.meterNo,
    sales?.meterNoNormalized,
    row?.salesAllMeterId,
  ) || "NAv";
}

export function getFieldMeter(fieldWork = {}, row = {}) {
  return firstText(
    fieldWork?.discoveredMeterNo,
    fieldWork?.discoveredMeterNumber,
    fieldWork?.foundMeterNo,
    fieldWork?.foundMeterNumber,
    fieldWork?.meterNo,
    fieldWork?.meterNumber,
    row?.execution?.foundMeterNoNormalized,
    row?.execution?.foundMeterNumberNormalized,
    row?.execution?.foundMeterNo,
    row?.execution?.foundMeterNumber,
    row?.execution?.meterNoFound,
    row?.execution?.meterNumberFound,
    row?.execution?.foundMeter?.numberNormalized,
    row?.execution?.foundMeter?.number,
    row?.execution?.result?.meterNoNormalized,
    row?.execution?.result?.meterNumberNormalized,
    row?.execution?.result?.meterNo,
    row?.execution?.result?.meterNumber,
  );
}

export function normalizeMeter(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeBooleanMatch(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  const normalized = normalizeUpper(value);

  if (["TRUE", "YES", "MATCH", "MATCHED"].includes(normalized)) {
    return "TRUE";
  }

  if (["FALSE", "NO", "MISMATCH", "NOT_MATCHED"].includes(normalized)) {
    return "FALSE";
  }

  return null;
}

export function getMeterMatch({ originalMeter, fieldMeter, fieldWork }) {
  const explicit = normalizeBooleanMatch(fieldWork?.meterMatch);
  if (explicit) return explicit;

  const original = normalizeMeter(originalMeter);
  const field = normalizeMeter(fieldMeter);

  if (!field || !original) return "PENDING";
  return original === field ? "TRUE" : "FALSE";
}

function parseStreetNumberAndName(value) {
  const firstAddressSegment = cleanText(value).split(",")[0].trim();
  const parts = firstAddressSegment.split(/\s+/).filter(Boolean);

  return {
    strNo: parts[0] || "",
    strName: parts.slice(1).join(" "),
  };
}

export function getOriginalAddressParts(row = {}, sales = {}) {
  const explicitStrNo = firstText(
    row?.location?.strNo,
    row?.location?.address?.strNo,
    sales?.strNo,
    sales?.address?.strNo,
  );
  const explicitStrName = firstText(
    row?.location?.strName,
    row?.location?.address?.strName,
    sales?.strName,
    sales?.address?.strName,
  );

  if (explicitStrNo || explicitStrName) {
    return {
      strNo: explicitStrNo,
      strName: explicitStrName,
    };
  }

  return parseStreetNumberAndName(
    firstText(row?.location?.addressLine1, sales?.addressLine1),
  );
}

export function getFieldAddressParts(premise = {}) {
  return {
    strNo: cleanText(premise?.address?.strNo),
    strName: cleanText(premise?.address?.strName),
  };
}

function normalizeAddressPart(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

export function getAddressMatch({ originalAddressParts, fieldAddressParts }) {
  const originalStrNo = normalizeAddressPart(originalAddressParts?.strNo);
  const originalStrName = normalizeAddressPart(originalAddressParts?.strName);
  const fieldStrNo = normalizeAddressPart(fieldAddressParts?.strNo);
  const fieldStrName = normalizeAddressPart(fieldAddressParts?.strName);

  if (!originalStrNo || !originalStrName || !fieldStrNo || !fieldStrName) {
    return "PENDING";
  }

  return originalStrNo === fieldStrNo && originalStrName === fieldStrName
    ? "TRUE"
    : "FALSE";
}

export function getAllocation(row = {}, batch = {}) {
  const targetType = firstText(
    row?.allocation?.targetType,
    batch?.allocation?.targetType,
  );
  const targetId = firstText(
    row?.allocation?.targetId,
    batch?.allocation?.targetId,
  );
  const targetName = firstText(
    row?.allocation?.targetName,
    batch?.allocation?.targetName,
  );

  const key = targetType || targetName || targetId
    ? `${targetType || "TARGET"}::${targetId || targetName}`
    : "UNALLOCATED";

  return {
    key,
    targetType: targetType || "UNALLOCATED",
    targetId: targetId || null,
    targetName: targetName || "Unallocated",
    label:
      targetType || targetName
        ? `${targetType || "TARGET"} • ${targetName || targetId}`
        : "Unallocated",
  };
}

export function buildTargetedDashboardRows({
  normalizedRows = [],
  geofenceNameById = {},
}) {
  return normalizedRows.map((row) => {
    const analytics = row?.analytics || {};
    const geofenceRefs = (
      Array.isArray(analytics?.geofenceRefs)
        ? analytics.geofenceRefs
        : []
    ).map((reference) => {
      const id = cleanText(reference?.id);

      return {
        id,
        name: firstText(reference?.name, geofenceNameById[id], id) || id,
      };
    });
    const allocation = analytics?.allocation || {
      key: "UNALLOCATED",
      targetType: "UNALLOCATED",
      targetId: null,
      targetName: "Unallocated",
      label: "Unallocated",
    };

    return {
      id: cleanText(row?.id),
      tbId: cleanText(row?.tbId),
      salesId: cleanText(row?.source?.salesId),
      ward: firstText(analytics?.ward, row?.scope?.wardLabel) || UNASSIGNED_WARD,
      category: firstText(analytics?.category) || UNCATEGORISED,
      geofenceRefs: geofenceRefs.length
        ? geofenceRefs
        : [
            {
              id: UNASSIGNED_GEOFENCE_ID,
              name: UNASSIGNED_GEOFENCE_NAME,
            },
          ],
      salesPeriod: firstText(analytics?.salesPeriod) || "NAv",
      executionStatus:
        normalizeUpper(row?.execution?.status) || "NOT_STARTED",
      meterDiscovered:
        row?.fieldMeter?.linkSource ===
        "sales.tbRefs.fieldWork.meterId",
      meterMatch:
        normalizeUpper(row?.comparison?.meterMatch) || "PENDING",
      addressMatch:
        normalizeUpper(row?.comparison?.addressMatch) || "PENDING",
      noAccessCount: Number(row?.noAccess?.count || 0),
      allocation,
      batch: row?.batchContext || {
        id: cleanText(row?.tbId),
        updatedAtMs: null,
        lastActivityAtMs: null,
      },
      premiseId: cleanText(row?.premise?.id),
    };
  });
}

export function buildSalesPopulationRows({
  salesRows = [],
  geofenceNameById = {},
}) {
  return salesRows.map((sales) => ({
    id: cleanText(sales?.id),
    sales,
    category: getSalesCategory(sales),
    ward: getWard(sales),
    geofenceRefs: getGeofenceRefs(sales, geofenceNameById),
    salesPeriod: getSalesPeriod(sales),
  }));
}

export function sortCategories(values = []) {
  const order = new Map(
    SALES_CATEGORY_ORDER.map((category, index) => [category, index]),
  );

  return Array.from(new Set(values)).sort((left, right) => {
    const leftIndex = order.has(left) ? order.get(left) : 999;
    const rightIndex = order.has(right) ? order.get(right) : 999;

    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left).localeCompare(String(right));
  });
}

export function countBy(values = []) {
  return values.reduce((accumulator, value) => {
    const key = cleanText(value) || "NAv";
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

export function buildCategoryDistribution(rows = []) {
  const counts = countBy(rows.map((row) => row.category));
  const total = rows.length;

  return sortCategories(Object.keys(counts)).map((category) => ({
    category,
    count: counts[category],
    percentage: total > 0 ? (counts[category] / total) * 100 : 0,
  }));
}

export function buildCategoryMatrix(rows = [], groupAccessor) {
  const groupMap = new Map();
  const categories = sortCategories(rows.map((row) => row.category));

  rows.forEach((row) => {
    const groups = groupAccessor(row);

    groups.forEach((group) => {
      if (!groupMap.has(group.id)) {
        groupMap.set(group.id, {
          id: group.id,
          name: group.name,
          total: 0,
          categories: {},
        });
      }

      const target = groupMap.get(group.id);
      target.total += 1;
      target.categories[row.category] =
        Number(target.categories[row.category] || 0) + 1;
    });
  });

  return {
    categories,
    rows: Array.from(groupMap.values()).sort((left, right) =>
      String(left.name).localeCompare(String(right.name), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  };
}

export function summarizeTargetedRows(rows = []) {
  const summary = {
    targetedBatches: new Set(),
    totalRows: rows.length,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    metersDiscovered: 0,
    meterTrue: 0,
    meterFalse: 0,
    meterPending: 0,
    addressTrue: 0,
    addressFalse: 0,
    addressPending: 0,
    noAccessAttempts: 0,
  };

  rows.forEach((row) => {
    if (row.tbId) summary.targetedBatches.add(row.tbId);

    if (row.executionStatus === "COMPLETED") summary.completed += 1;
    else if (row.executionStatus === "IN_PROGRESS") summary.inProgress += 1;
    else summary.notStarted += 1;

    if (row.meterDiscovered) summary.metersDiscovered += 1;

    if (row.meterMatch === "TRUE") summary.meterTrue += 1;
    else if (row.meterMatch === "FALSE") summary.meterFalse += 1;
    else summary.meterPending += 1;

    if (row.addressMatch === "TRUE") summary.addressTrue += 1;
    else if (row.addressMatch === "FALSE") summary.addressFalse += 1;
    else summary.addressPending += 1;

    summary.noAccessAttempts += Number(row.noAccessCount || 0);
  });

  return {
    ...summary,
    targetedBatches: summary.targetedBatches.size,
    completionRate: getCompletionRate(summary.completed, summary.totalRows),
    meterMatchRate: getRate(summary.meterTrue, summary.meterFalse),
    addressMatchRate: getRate(summary.addressTrue, summary.addressFalse),
  };
}

export function buildBatchPerformance(rows = []) {
  const byBatch = new Map();

  rows.forEach((row) => {
    if (!byBatch.has(row.tbId)) {
      byBatch.set(row.tbId, {
        id: row.tbId,
        batch: row.batch,
        ward: row.ward,
        allocatedTo: row.allocation.label,
        rows: [],
      });
    }

    byBatch.get(row.tbId).rows.push(row);
  });

  return Array.from(byBatch.values())
    .map((group) => {
      const summary = summarizeTargetedRows(group.rows);

      return {
        ...group,
        total: summary.totalRows,
        completed: summary.completed,
        completionRate: summary.completionRate,
        meterMatchRate: summary.meterMatchRate,
        addressMatchRate: summary.addressMatchRate,
        noAccessAttempts: summary.noAccessAttempts,
        updatedAtMs: Number(
          group.batch?.updatedAtMs || group.batch?.lastActivityAtMs || 0,
        ),
      };
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function buildGeofenceOperationalStats({
  salesRows = [],
  targetedRows = [],
}) {
  const groups = new Map();

  const ensureGroup = (reference) => {
    if (!groups.has(reference.id)) {
      groups.set(reference.id, {
        id: reference.id,
        name: reference.name,
        wards: new Set(),
        salesIds: new Set(),
        targetedRows: [],
      });
    }

    return groups.get(reference.id);
  };

  salesRows.forEach((row) => {
    row.geofenceRefs.forEach((reference) => {
      const group = ensureGroup(reference);
      group.salesIds.add(row.id);
      group.wards.add(row.ward);
    });
  });

  targetedRows.forEach((row) => {
    row.geofenceRefs.forEach((reference) => {
      const group = ensureGroup(reference);
      group.targetedRows.push(row);
      group.wards.add(row.ward);
    });
  });

  return Array.from(groups.values())
    .map((group) => {
      const summary = summarizeTargetedRows(group.targetedRows);

      return {
        id: group.id,
        name: group.name,
        wards: Array.from(group.wards).sort().join(", "),
        salesMeters: group.salesIds.size,
        targetedRows: summary.totalRows,
        notStarted: summary.notStarted,
        inProgress: summary.inProgress,
        completed: summary.completed,
        completionRate: summary.completionRate,
        meterMatchRate: summary.meterMatchRate,
        addressMatchRate: summary.addressMatchRate,
        noAccessAttempts: summary.noAccessAttempts,
      };
    })
    .sort((left, right) =>
      String(left.name).localeCompare(String(right.name), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}
