const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CATEGORY_ENTRY_KEYS = ["leakageCategory", "riskTier", "riskScore"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCategoryEntry(value) {
  if (!isPlainObject(value)) return null;

  const keys = Object.keys(value).sort();
  const expectedKeys = [...CATEGORY_ENTRY_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return null;
  }

  const leakageCategory = String(value.leakageCategory ?? "").trim();
  const riskTier = String(value.riskTier ?? "").trim();
  const riskScore = value.riskScore;

  if (!leakageCategory || !riskTier) return null;
  if (typeof riskScore !== "number" || !Number.isInteger(riskScore) || riskScore < 0) {
    return null;
  }

  return { leakageCategory, riskTier, riskScore };
}

export function normalizeSalesMonthlyCategories(value) {
  if (!isPlainObject(value)) return {};

  return Object.entries(value).reduce((result, [monthKey, entry]) => {
    if (!MONTH_KEY_PATTERN.test(monthKey)) return result;

    const normalized = normalizeCategoryEntry(entry);
    if (normalized) result[monthKey] = normalized;
    return result;
  }, {});
}

export function getGovernedCategoryMonths(row = {}) {
  const monthlyCategories = normalizeSalesMonthlyCategories(row?.monthlyCategories);
  return Object.keys(monthlyCategories).sort((left, right) =>
    String(right).localeCompare(String(left)),
  );
}

export function resolveSalesCategoryForMonth(row = {}, monthKey = "") {
  const normalizedMonthKey = String(monthKey ?? "").trim();
  if (!MONTH_KEY_PATTERN.test(normalizedMonthKey)) return null;

  const monthlyCategories = normalizeSalesMonthlyCategories(row?.monthlyCategories);
  const entry = monthlyCategories[normalizedMonthKey];
  if (!entry) return null;

  return {
    monthKey: normalizedMonthKey,
    ...entry,
  };
}

export function resolveLatestSalesCategory(row = {}) {
  const [latestMonthKey] = getGovernedCategoryMonths(row);
  return latestMonthKey
    ? resolveSalesCategoryForMonth(row, latestMonthKey)
    : null;
}
