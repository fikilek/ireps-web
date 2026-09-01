import { hasUsableSalesGps } from "../sales/models/salesGpsModel.js";
import { getOperationalSalesCategory } from "../sales/models/salesTargetedBatchReadModel.js";
import {
  isNormalCustomerCategory,
  toCustomerCategoryKey,
  getCustomerCategoryShortCode,
} from "./customerCategoriesDashboardModel.js";

export const CUSTOMER_CATEGORY_PURCHASE_START_MONTH_KEY = "2026-04";
export const CUSTOMER_CATEGORY_ROLLING_MONTH_COUNT = 3;

function cleanText(value) {
  return String(value ?? "").trim();
}

function asNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}


function normalizeMeterNumber(value) {
  const text = cleanText(value).toUpperCase();
  if (!text || text === "NAV") return "";
  return text.replace(/\s+/g, "");
}

function normalizeCode(value) {
  return cleanText(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(cleanText(value));
  } catch {
    return cleanText(value);
  }
}

export function normalizeCustomerCategoryRouteKey(value) {
  return toCustomerCategoryKey(safeDecodeURIComponent(value));
}

function getMonthKeys(rows = []) {
  const keys = new Set();

  rows.forEach((row) => {
    const monthMap = row?.monthlySalesC;
    if (!monthMap || typeof monthMap !== "object") return;

    Object.keys(monthMap).forEach((monthKey) => {
      if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
      if (monthKey < CUSTOMER_CATEGORY_PURCHASE_START_MONTH_KEY) return;
      keys.add(monthKey);
    });
  });

  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

function sumMonth(rows, monthKey) {
  return rows.reduce(
    (total, row) => total + asNumber(row?.monthlySalesC?.[monthKey]),
    0,
  );
}

function getCurrentCategorySnapshotMonthKey(selectedRows = [], latestMonthKey = "") {
  if (!latestMonthKey || !selectedRows.length) return "";

  const periodToValues = new Set(
    selectedRows
      .map((row) => cleanText(row?.salesPeriodTo))
      .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey)),
  );

  if (periodToValues.size !== 1) return "";
  const [snapshotMonthKey] = Array.from(periodToValues);
  return snapshotMonthKey === latestMonthKey ? snapshotMonthKey : "";
}

function getDistinctGeofenceRefs(row = {}) {
  const seen = new Set();

  return (Array.isArray(row?.geofenceRefs) ? row.geofenceRefs : [])
    .map((reference) => {
      const id = cleanText(reference?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return { id, name: cleanText(reference?.name) || id };
    })
    .filter(Boolean);
}

function getDistinctWardLabels(row = {}) {
  const wardNumbers = Array.isArray(row?.wardNumbers) ? row.wardNumbers : [];
  return Array.from(new Set(wardNumbers.map(cleanText).filter(Boolean)));
}

function buildRankedRows(counts) {
  return Array.from(counts.values()).sort(
    (left, right) =>
      Number(right?.count || 0) - Number(left?.count || 0) ||
      cleanText(left?.label).localeCompare(cleanText(right?.label), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function buildFieldCoverage(selectedRows, trnRows) {
  const meterNos = new Set(
    selectedRows
      .map((row) => normalizeMeterNumber(row?.meterNoNormalized || row?.meterNo || row?.id))
      .filter(Boolean),
  );

  const visited = new Set();
  const noAccess = new Set();
  const discoveries = new Set();
  const disconnections = new Set();
  const reconnections = new Set();
  const discoveryFindingByMeter = new Map();
  let linkedTrnCount = 0;

  const canonicalFindingCodes = new Set([
    "METER_OK",
    "METER_FAULTY",
    "METER_DAMAGED",
    "ILLEGALLY_CONNECTED",
  ]);

  (Array.isArray(trnRows) ? trnRows : []).forEach((trn) => {
    const meterNo = normalizeMeterNumber(trn?.meterNo || trn?.astNo);
    if (!meterNo || !meterNos.has(meterNo)) return;

    linkedTrnCount += 1;
    visited.add(meterNo);

    const trnType = normalizeCode(trn?.trnType);
    const hasAccess = normalizeCode(trn?.hasAccess);

    if (hasAccess === "NO" || trnType === "NO_ACCESS" || trnType === "NA") {
      noAccess.add(meterNo);
    }

    if (trnType === "METER_DISCONNECTION" || trnType === "DISCONNECTION") {
      disconnections.add(meterNo);
    }

    if (trnType === "METER_RECONNECTION" || trnType === "RECONNECTION") {
      reconnections.add(meterNo);
    }

    if (trnType === "METER_DISCOVERY") {
      discoveries.add(meterNo);

      const findingCode = normalizeCode(trn?.anomaly);
      if (canonicalFindingCodes.has(findingCode)) {
        discoveryFindingByMeter.set(meterNo, findingCode);
      }
    }
  });

  const findingCounts = {
    meterOk: 0,
    meterFaulty: 0,
    meterDamaged: 0,
    illegallyConnected: 0,
  };

  discoveryFindingByMeter.forEach((findingCode) => {
    if (findingCode === "METER_OK") findingCounts.meterOk += 1;
    if (findingCode === "METER_FAULTY") findingCounts.meterFaulty += 1;
    if (findingCode === "METER_DAMAGED") findingCounts.meterDamaged += 1;
    if (findingCode === "ILLEGALLY_CONNECTED") findingCounts.illegallyConnected += 1;
  });

  const total = selectedRows.length;
  const visitedCount = visited.size;

  return {
    linkedTrnCount,
    visited: visitedCount,
    notVisited: Math.max(0, total - visitedCount),
    noAccess: noAccess.size,
    disconnections: disconnections.size,
    reconnections: reconnections.size,
    discoveries: discoveries.size,
    ...findingCounts,
    rows: [
      { key: "visited", label: "Visited", count: visitedCount, tone: "teal" },
      { key: "notVisited", label: "Not Visited", count: Math.max(0, total - visitedCount), tone: "blue" },
      { key: "noAccess", label: "No Access", count: noAccess.size, tone: "slate" },
      { key: "disconnections", label: "Disconnections", count: disconnections.size, tone: "red" },
      { key: "reconnections", label: "Reconnections", count: reconnections.size, tone: "green" },
      { key: "discoveries", label: "Discoveries / Verifications", count: discoveries.size, tone: "purple" },
      { key: "meterOk", label: "Meter OK", count: findingCounts.meterOk, tone: "teal" },
      { key: "meterFaulty", label: "Meter Faulty", count: findingCounts.meterFaulty, tone: "amber" },
      { key: "meterDamaged", label: "Meter Damaged", count: findingCounts.meterDamaged, tone: "red" },
      { key: "illegallyConnected", label: "Illegally Connected", count: findingCounts.illegallyConnected, tone: "orange" },
      { key: "returnedNormal", label: "Meters Returned to Normal", count: null, tone: "teal", unavailable: true },
    ],
  };
}

export function buildCustomerCategoryDashboardModel(
  salesRows = [],
  trnRows = [],
  routeCategoryKey = "",
) {
  const normalizedRouteKey = normalizeCustomerCategoryRouteKey(routeCategoryKey);
  const rows = Array.isArray(salesRows) ? salesRows : [];

  const fieldTargetRows = rows.filter((row) => {
    const category = getOperationalSalesCategory(row);
    return !isNormalCustomerCategory(category);
  });

  const selectedRows = fieldTargetRows.filter((row) => {
    const category = getOperationalSalesCategory(row);
    return toCustomerCategoryKey(category) === normalizedRouteKey;
  });

  const firstCategoryValue = selectedRows.length
    ? getOperationalSalesCategory(selectedRows[0])
    : safeDecodeURIComponent(routeCategoryKey);
  const categoryLabel = cleanText(firstCategoryValue) || "Customer Category";
  const shortCode = getCustomerCategoryShortCode(categoryLabel);

  const categoryTotal = selectedRows.length;
  const fieldTarget = fieldTargetRows.length;
  const fieldTargetShare = fieldTarget > 0 ? (categoryTotal / fieldTarget) * 100 : 0;

  let gpsReady = 0;
  const geofenceCounts = new Map();
  const wardCounts = new Map();

  selectedRows.forEach((row) => {
    if (hasUsableSalesGps(row)) gpsReady += 1;

    getDistinctGeofenceRefs(row).forEach((reference) => {
      const current = geofenceCounts.get(reference.id) || {
        key: reference.id,
        label: reference.name,
        count: 0,
      };
      current.count += 1;
      geofenceCounts.set(reference.id, current);
    });

    getDistinctWardLabels(row).forEach((wardNumber) => {
      const current = wardCounts.get(wardNumber) || {
        key: wardNumber,
        label: `Ward ${wardNumber}`,
        count: 0,
      };
      current.count += 1;
      wardCounts.set(wardNumber, current);
    });
  });

  const monthKeys = getMonthKeys(rows);
  const purchaseMonthKeys = monthKeys.slice(-CUSTOMER_CATEGORY_ROLLING_MONTH_COUNT);
  const latestMonthKey = purchaseMonthKeys[purchaseMonthKeys.length - 1] || "";
  const previousMonthKey = purchaseMonthKeys[purchaseMonthKeys.length - 2] || "";
  const currentCategorySnapshotMonthKey = getCurrentCategorySnapshotMonthKey(
    selectedRows,
    latestMonthKey,
  );
  const purchaseMonths = purchaseMonthKeys.map((monthKey) => {
    const categorySalesC = sumMonth(selectedRows, monthKey);
    return {
      key: monthKey,
      salesC: categorySalesC,
      categorySalesC,
      municipalSalesC: sumMonth(rows, monthKey),
      categoryMeterCount:
        monthKey === currentCategorySnapshotMonthKey ? categoryTotal : null,
      categoryMeterCountAvailable: monthKey === currentCategorySnapshotMonthKey,
    };
  });
  const latestMonthSalesC = latestMonthKey ? sumMonth(selectedRows, latestMonthKey) : 0;
  const previousMonthSalesC = previousMonthKey ? sumMonth(selectedRows, previousMonthKey) : 0;
  const latestMunicipalSalesC = latestMonthKey ? sumMonth(rows, latestMonthKey) : 0;
  const latestCategoryMeterCount =
    latestMonthKey && latestMonthKey === currentCategorySnapshotMonthKey
      ? categoryTotal
      : null;
  const rollingSalesC = purchaseMonths.reduce((total, month) => total + month.categorySalesC, 0);
  const rollingAverageC = purchaseMonths.length
    ? Math.round(rollingSalesC / purchaseMonths.length)
    : 0;
  const latestVsPreviousPercent = previousMonthSalesC > 0
    ? ((latestMonthSalesC - previousMonthSalesC) / previousMonthSalesC) * 100
    : null;

  const fieldCoverage = buildFieldCoverage(selectedRows, trnRows);
  const gpsWithout = Math.max(0, categoryTotal - gpsReady);

  return {
    found: categoryTotal > 0,
    categoryKey: normalizedRouteKey,
    categoryLabel,
    shortCode,
    categoryTotal,
    fieldTarget,
    fieldTargetShare,
    gpsReady,
    gpsWithout,
    gpsReadyShare: categoryTotal > 0 ? (gpsReady / categoryTotal) * 100 : 0,
    purchaseMonths,
    latestMonthKey,
    previousMonthKey,
    latestMonthSalesC,
    previousMonthSalesC,
    latestMunicipalSalesC,
    latestCategoryMeterCount,
    currentCategorySnapshotMonthKey,
    rollingAverageC,
    latestVsPreviousPercent,
    fieldCoverage,
    topGeofences: buildRankedRows(geofenceCounts),
    topWards: buildRankedRows(wardCounts),
    outcomes: [
      { key: "startedPurchasing", label: "Started Purchasing" },
      { key: "stillNotPurchasing", label: "Still Not Purchasing" },
      { key: "returnedNormal", label: "Returned to Normal" },
      { key: "pending", label: "Pending / Unresolved" },
    ],
    outcomesAvailable: false,
  };
}
