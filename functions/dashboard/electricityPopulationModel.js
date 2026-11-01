// Electricity Meter Population rules EMP-R001 1.2.0 (ireps-rules/ui-rules/electricity-meter-population.md).
// Pure counting rules, run on the server so the page never downloads the Sales records.

export const POPULATION_START_MONTH = "2026-06";
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const CATEGORY_KEYS = ["leakageCategory", "riskScore", "riskTier"];

// The same checks as the web's normalizeSalesMonthlyCategories: exactly the three governed
// fields, non-blank text and a whole, non-negative risk score.
export function categoryForMonth(monthlyCategories, month) {
  const entry = monthlyCategories?.[month];
  if (!MONTH_KEY.test(String(month)) || !entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const keys = Object.keys(entry).sort();
  if (keys.length !== CATEGORY_KEYS.length || keys.some((key, i) => key !== CATEGORY_KEYS[i])) return null;
  if (typeof entry.leakageCategory !== "string" || typeof entry.riskTier !== "string") return null;
  if (!entry.leakageCategory.trim() || !entry.riskTier.trim()) return null;
  if (!Number.isInteger(entry.riskScore) || entry.riskScore < 0) return null;
  return { leakageCategory: entry.leakageCategory.trim() };
}

export function isNormalCategory(label) {
  const text = String(label ?? "").toUpperCase().replace(/_/g, " ").trim();
  return text === "NORMAL" || text.startsWith("NORMAL ") || text.startsWith("NORMAL-") ||
    text.includes("NO LEAKAGE FLAG");
}

// Targeted is CAT 1 to 8 only; any other label is counted as another category.
export function isTargetedCategory(label) {
  return /^CAT\s*[1-8](?![0-9])/i.test(String(label ?? "").trim());
}

function listedMonths(row) {
  return Object.keys(row?.monthlyCategories || {})
    .filter((month) => MONTH_KEY.test(month) && categoryForMonth(row.monthlyCategories, month))
    .sort();
}

// Section 2: every month from June 2026 that has category data, oldest first.
export function listPopulationMonths(salesRows = []) {
  const months = new Set();
  for (const row of salesRows) {
    for (const month of listedMonths(row)) if (month >= POPULATION_START_MONTH) months.add(month);
  }
  return [...months].sort();
}

const share = (value, total) => (total > 0 ? (value / total) * 100 : 0);

// Section 1. salesRows: { id, monthlyCategories, hasUsableGps, gpsAvailable }.
// fieldMeters: { meterNo, foundMonth } for the LM's field-found electricity meters.
export function buildElectricityPopulation({ salesRows = [], fieldMeters = [], month }) {
  const listed = new Set();
  const firstListed = new Map();
  let normal = 0, targeted = 0, otherCategory = 0;
  let withGps = 0, withoutGps = 0, gpsUnknown = 0;

  for (const row of salesRows) {
    if (!row?.id) continue;
    const first = listedMonths(row)[0];
    if (first && (!firstListed.has(row.id) || first < firstListed.get(row.id))) firstListed.set(row.id, first);

    const category = categoryForMonth(row.monthlyCategories, month);
    if (!category || listed.has(row.id)) continue;
    listed.add(row.id);
    if (isNormalCategory(category.leakageCategory)) normal += 1;
    else if (isTargetedCategory(category.leakageCategory)) targeted += 1;
    else otherCategory += 1;
    if (row.gpsAvailable !== false && row.hasUsableGps === true) withGps += 1;
    else if (row.gpsAvailable !== false && row.hasUsableGps === false) withoutGps += 1;
    else gpsUnknown += 1;
  }

  // MV-R001 section 5: counted from the month found until the first month the list includes
  // it. A found meter that was on an earlier list but not this month's is counted separately.
  let foundInField = 0;
  let foundNotOnListNow = 0;
  const seen = new Set();
  for (const meter of fieldMeters) {
    const meterNo = meter?.meterNo;
    if (!meterNo || seen.has(meterNo) || !meter?.foundMonth || meter.foundMonth > month) continue;
    seen.add(meterNo);
    if (listed.has(meterNo)) continue;
    const first = firstListed.get(meterNo);
    if (!first || first > month) foundInField += 1;
    else foundNotOnListNow += 1;
  }

  const onList = listed.size;
  const total = onList + foundInField;
  return {
    month,
    onList,
    foundInField,
    foundNotOnListNow,
    total,
    onListShare: share(onList, total),
    foundInFieldShare: share(foundInField, total),
    normal,
    targeted,
    otherCategory,
    normalShare: share(normal, onList),
    targetedShare: share(targeted, onList),
    otherCategoryShare: share(otherCategory, onList),
    withGps,
    withoutGps,
    gpsUnknown,
    withGpsShare: share(withGps, onList),
    withoutGpsShare: share(withoutGps, onList),
    gpsUnknownShare: share(gpsUnknown, onList),
  };
}
