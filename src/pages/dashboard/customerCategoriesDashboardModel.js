import { hasUsableSalesGps } from "../sales/models/salesGpsModel.js";
import { getOperationalSalesCategory } from "../sales/models/salesTargetedBatchReadModel.js";

export const CUSTOMER_CATEGORIES_BASELINE_MONTH_KEYS = Object.freeze([
  "2026-04",
  "2026-05",
  "2026-06",
]);

export const CUSTOMER_CATEGORIES_BASELINE_PRIMARY_MONTH_KEY = "2026-06";

export const CUSTOMER_CATEGORIES_RECOVERY_MONTHS = Object.freeze([
  Object.freeze({ key: "2026-06", label: "June" }),
  Object.freeze({ key: "2026-07", label: "July" }),
  Object.freeze({ key: "2026-08", label: "August" }),
  Object.freeze({ key: "2026-09", label: "September" }),
]);

// The current authoritative Sales category values describe the June snapshot.
// Future months must remain unavailable until an authoritative category snapshot
// exists for that month; purchase values alone are not enough to infer migration.
export const CUSTOMER_CATEGORIES_CURRENT_SNAPSHOT_MONTH_KEY = "2026-06";

function cleanText(value) {
  return String(value ?? "").trim();
}

function asNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeCategory(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[_]+/g, " ");
}

export function isNormalCustomerCategory(value) {
  const normalized = normalizeCategory(value);

  return (
    normalized === "NORMAL" ||
    normalized.startsWith("NORMAL ") ||
    normalized.startsWith("NORMAL-") ||
    normalized.includes("NO LEAKAGE FLAG")
  );
}

export function toCustomerCategoryKey(value) {
  return encodeURIComponent(normalizeCategory(value));
}

function getSalesMonthC(row, monthKey) {
  return asNumber(row?.monthlySalesC?.[monthKey]);
}

function getDistinctGeofenceRefs(row = {}) {
  const seen = new Set();

  return (Array.isArray(row?.geofenceRefs) ? row.geofenceRefs : [])
    .map((reference) => {
      const id = cleanText(reference?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);

      return {
        id,
        name: cleanText(reference?.name) || id,
      };
    })
    .filter(Boolean);
}

function getDistinctWardLabels(row = {}) {
  const labels = Array.isArray(row?.wardNumbers) ? row.wardNumbers : [];

  return Array.from(
    new Set(labels.map((value) => cleanText(value)).filter(Boolean)),
  );
}

function getCustomerCategoryNumber(value) {
  const match = cleanText(value).match(/\bCAT\s*([0-9]+)\b/i);
  if (!match) return null;

  const categoryNumber = Number(match[1]);
  return Number.isInteger(categoryNumber) ? categoryNumber : null;
}

export function getCustomerCategoryShortCode(value) {
  const categoryNumber = getCustomerCategoryNumber(value);
  if (categoryNumber !== null) return `C${categoryNumber}`;

  const normalized = normalizeCategory(value);
  if (!normalized || normalized === "UNCATEGORISED") return "UC";

  return "OTHER";
}

function sortCategorySequence(left, right) {
  const leftNumber = getCustomerCategoryNumber(left?.label);
  const rightNumber = getCustomerCategoryNumber(right?.label);

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;

  return cleanText(left?.label).localeCompare(cleanText(right?.label), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortCountRows(left, right) {
  return (
    Number(right?.count || 0) - Number(left?.count || 0) ||
    cleanText(left?.label).localeCompare(cleanText(right?.label), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function buildRankedRows(counts) {
  return Array.from(counts.values()).sort(sortCountRows);
}

export function countInvisibleOperationalMeters(
  registryRows = [],
  astRows = [],
) {
  const registryMeters = Array.isArray(registryRows) ? registryRows : [];
  const assets = Array.isArray(astRows) ? astRows : [];

  const astIds = new Set(
    assets
      .map((row) => cleanText(row?.id))
      .filter(Boolean),
  );

  return registryMeters.reduce((count, row) => {
    const id = cleanText(row?.id);
    const visibility = cleanText(row?.visibility).toUpperCase();

    return id && astIds.has(id) && visibility === "INVISIBLE"
      ? count + 1
      : count;
  }, 0);
}

export function buildCustomerCategoriesDashboardModel(
  rows = [],
  baselineMonthKeys = CUSTOMER_CATEGORIES_BASELINE_MONTH_KEYS,
) {
  const fieldTargetRows = [];
  const categoryMap = new Map();
  const geofenceCounts = new Map();
  const wardCounts = new Map();
  let gpsReady = 0;
  let baselinePrimarySalesC = 0;
  let normalPopulation = 0;
  let recoveryMonthRevenueC = 0;

  const salesRows = Array.isArray(rows) ? rows : [];

  for (const row of salesRows) {
    const category = getOperationalSalesCategory(row);

    recoveryMonthRevenueC += getSalesMonthC(
      row,
      CUSTOMER_CATEGORIES_CURRENT_SNAPSHOT_MONTH_KEY,
    );

    if (isNormalCustomerCategory(category)) {
      normalPopulation += 1;
      continue;
    }

    fieldTargetRows.push(row);

    if (hasUsableSalesGps(row)) {
      gpsReady += 1;
    }

    baselinePrimarySalesC += getSalesMonthC(
      row,
      CUSTOMER_CATEGORIES_BASELINE_PRIMARY_MONTH_KEY,
    );

    const categoryKey = toCustomerCategoryKey(category);
    const current = categoryMap.get(categoryKey) || {
      key: categoryKey,
      label: cleanText(category) || "Uncategorised",
      count: 0,
      withGps: 0,
      monthSalesC: Object.fromEntries(
        baselineMonthKeys.map((monthKey) => [monthKey, 0]),
      ),
    };

    current.count += 1;
    if (hasUsableSalesGps(row)) current.withGps += 1;

    for (const monthKey of baselineMonthKeys) {
      current.monthSalesC[monthKey] =
        asNumber(current.monthSalesC[monthKey]) + getSalesMonthC(row, monthKey);
    }

    categoryMap.set(categoryKey, current);

    for (const reference of getDistinctGeofenceRefs(row)) {
      const geofence = geofenceCounts.get(reference.id) || {
        key: reference.id,
        label: reference.name,
        count: 0,
      };
      geofence.count += 1;
      geofenceCounts.set(reference.id, geofence);
    }

    for (const wardLabel of getDistinctWardLabels(row)) {
      const ward = wardCounts.get(wardLabel) || {
        key: wardLabel,
        label: `Ward ${wardLabel}`,
        count: 0,
      };
      ward.count += 1;
      wardCounts.set(wardLabel, ward);
    }
  }

  const fieldTarget = fieldTargetRows.length;
  const gpsWithout = Math.max(0, fieldTarget - gpsReady);

  // Customer-category displays must always use the canonical CAT number order
  // (CAT1, CAT2, CAT3 ... CAT8) rather than ranking by population. This keeps
  // Category Composition, Purchase Baseline and Recovery Journey aligned.
  const categories = Array.from(categoryMap.values())
    .map((category) => ({
      ...category,
      share: fieldTarget > 0 ? (category.count / fieldTarget) * 100 : 0,
      gpsShare:
        category.count > 0 ? (category.withGps / category.count) * 100 : 0,
    }))
    .sort(sortCategorySequence);

  const recoveryCategories = [...categories]
    .sort(sortCategorySequence)
    .map((category) => ({
      ...category,
      shortCode: getCustomerCategoryShortCode(category.label),
      categoryNumber: getCustomerCategoryNumber(category.label),
    }));

  const recoveryMaxCategoryCount = Math.max(
    1,
    ...recoveryCategories.map((category) => Number(category.count || 0)),
  );

  const recoveryMonths = CUSTOMER_CATEGORIES_RECOVERY_MONTHS.map((month) => {
    const isAvailable = month.key === CUSTOMER_CATEGORIES_CURRENT_SNAPSHOT_MONTH_KEY;

    return {
      ...month,
      isAvailable,
      revenueC: isAvailable ? recoveryMonthRevenueC : null,
      normalCount: isAvailable ? normalPopulation : null,
      fieldTarget: isAvailable ? fieldTarget : null,
      categories: recoveryCategories.map((category) => ({
        key: category.key,
        shortCode: category.shortCode,
        label: category.label,
        count: isAvailable ? category.count : null,
      })),
    };
  });

  const categoryTotal = categories.reduce(
    (total, category) => total + category.count,
    0,
  );

  const topGeofences = buildRankedRows(geofenceCounts);
  const topWards = buildRankedRows(wardCounts);

  return {
    fieldTarget,
    categoryCount: categories.length,
    categories,
    categoryTotal,
    reconcilesToFieldTarget: categoryTotal === fieldTarget,
    gpsReady,
    gpsWithout,
    gpsReadyShare: fieldTarget > 0 ? (gpsReady / fieldTarget) * 100 : 0,
    baselinePrimarySalesC,
    baselineMonthKeys: [...baselineMonthKeys],
    normalPopulation,
    totalSalesPopulation: salesRows.length,
    recoveryCategories,
    recoveryMaxCategoryCount,
    recoveryMonths,
    topGeofences,
    topWards,
  };
}
