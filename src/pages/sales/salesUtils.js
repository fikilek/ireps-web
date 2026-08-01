export const EXPECTED_MONTH_KEYS = [
  "2026-02",
  "2026-01",
  "2025-12",
  "2025-11",
  "2025-10",
  "2025-09",
  "2025-08",
  "2025-07",
  "2025-06",
  "2025-05",
  "2025-04",
  "2025-03",
  "2025-02",
  "2025-01",
  "2024-12",
  "2024-11",
  "2024-10",
  "2024-09",
  "2024-08",
  "2024-07",
  "2024-06",
  "2024-05",
  "2024-04",
  "2024-03",
  "2024-02",
  "2024-01",
  "2023-12",
];

export const TARGET_FILTERS = {
  ALL: "ALL",
  NO_SALES_3M: "NO_SALES_3M",
  NO_SALES_6M: "NO_SALES_6M",
  NO_SALES_12M: "NO_SALES_12M",
  BELOW_R400_X_12: "BELOW_R400_X_12",
  BELOW_R200_X_12: "BELOW_R200_X_12",
  NEVER_VENDED: "NEVER_VENDED",
  LATEST_MONTH_ZERO: "LATEST_MONTH_ZERO",
};

export const SALES_TARGET_THRESHOLDS_C = {
  BELOW_R400_X_12: 4_800 * 100,
  BELOW_R200_X_12: 2_400 * 100,
};

export function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

export function getActiveWorkbaseName(activeWorkbase) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv"
  );
}

export function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? numberValue.toLocaleString("en-ZA")
    : "0";
}

export function formatCurrencyFromCents(value) {
  const cents = Number(value);
  const rands = Number.isFinite(cents) ? cents / 100 : 0;

  return rands.toLocaleString("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCompactCurrencyFromCents(value) {
  const cents = Number(value);
  const rands = Number.isFinite(cents) ? cents / 100 : 0;

  if (Math.abs(rands) >= 1_000_000_000) {
    return `R${(rands / 1_000_000_000).toFixed(2)}bn`;
  }

  if (Math.abs(rands) >= 1_000_000) {
    return `R${(rands / 1_000_000).toFixed(2)}m`;
  }

  if (Math.abs(rands) >= 1_000) {
    return `R${(rands / 1_000).toFixed(1)}k`;
  }

  return formatCurrencyFromCents(cents);
}

export function getMonthLabel(monthKey, format = "short") {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey || "NAv";

  const date = new Date(year, month - 1, 1);

  return date.toLocaleDateString("en-ZA", {
    month: format === "long" ? "long" : "short",
    year: "numeric",
  });
}

export function buildMonthKeys(rows = []) {
  const monthKeys = new Set(EXPECTED_MONTH_KEYS);

  rows.forEach((row) => {
    Object.keys(row?.monthlySalesC || {}).forEach((key) => monthKeys.add(key));
  });

  return Array.from(monthKeys).sort((left, right) =>
    String(right).localeCompare(String(left)),
  );
}

export function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function includesText(value, filterValue) {
  const normalizedFilter = normalizeFilterText(filterValue);
  if (!normalizedFilter) return true;

  return normalizeFilterText(value).includes(normalizedFilter);
}

export function compareNatural(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function matchesExactRandValue(centsValue, filterValue) {
  if (filterValue === "" || filterValue === null || filterValue === undefined) {
    return true;
  }

  const filterRands = Number(filterValue);
  if (!Number.isFinite(filterRands)) return false;

  return Number(centsValue || 0) === Math.round(filterRands * 100);
}

export function getTargetFilterLabel(targetFilter) {
  switch (targetFilter) {
    case TARGET_FILTERS.NO_SALES_3M:
      return "No sales for 3 months";
    case TARGET_FILTERS.NO_SALES_6M:
      return "No sales for 6 months";
    case TARGET_FILTERS.NO_SALES_12M:
      return "No sales for 12 months";
    case TARGET_FILTERS.BELOW_R400_X_12:
      return "Below R400 × 12 months";
    case TARGET_FILTERS.BELOW_R200_X_12:
      return "Below R200 × 12 months";
    case TARGET_FILTERS.NEVER_VENDED:
      return "Never purchased";
    case TARGET_FILTERS.LATEST_MONTH_ZERO:
      return "Latest month sales = R0";
    default:
      return "All sales meters";
  }
}

export function matchesTargetFilter(row, targetFilter, latestMonthKey) {
  switch (targetFilter) {
    case TARGET_FILTERS.NO_SALES_3M:
      return Number(row?.sales3MonthsC || 0) === 0;
    case TARGET_FILTERS.NO_SALES_6M:
      return Number(row?.sales6MonthsC || 0) === 0;
    case TARGET_FILTERS.NO_SALES_12M:
      return Number(row?.sales12MonthsC || 0) === 0;
    case TARGET_FILTERS.BELOW_R400_X_12:
      return (
        Number(row?.sales12MonthsC || 0) <
        SALES_TARGET_THRESHOLDS_C.BELOW_R400_X_12
      );
    case TARGET_FILTERS.BELOW_R200_X_12:
      return (
        Number(row?.sales12MonthsC || 0) <
        SALES_TARGET_THRESHOLDS_C.BELOW_R200_X_12
      );
    case TARGET_FILTERS.NEVER_VENDED:
      return Number(row?.totalSalesC || 0) === 0;
    case TARGET_FILTERS.LATEST_MONTH_ZERO:
      return Number(row?.monthlySalesC?.[latestMonthKey] || 0) === 0;
    default:
      return true;
  }
}

export const SALES_RANGE_IDS = {
  ZERO: "ZERO",
  R1_TO_99: "R1_TO_99",
  R100_TO_299: "R100_TO_299",
  R300_TO_499: "R300_TO_499",
  R500_TO_999: "R500_TO_999",
  GTE_1000: "GTE_1000",
  CUSTOM: "CUSTOM",
};

export const SALES_RANGE_OPTIONS = [
  { id: SALES_RANGE_IDS.ZERO, label: "Zero" },
  { id: SALES_RANGE_IDS.R1_TO_99, label: "R1 to R99" },
  { id: SALES_RANGE_IDS.R100_TO_299, label: "R100 to R299" },
  { id: SALES_RANGE_IDS.R300_TO_499, label: "R300 to R499" },
  { id: SALES_RANGE_IDS.R500_TO_999, label: "R500 to R999" },
  { id: SALES_RANGE_IDS.GTE_1000, label: "R1,000 and above" },
  { id: SALES_RANGE_IDS.CUSTOM, label: "Custom range" },
];

export const EMPTY_SALES_RANGE_FILTER = {
  selectedRangeIds: [],
  customMinR: "",
  customMaxR: "",
};

export function normalizeSalesRangeFilter(filter) {
  const selectedRangeIds = Array.isArray(filter?.selectedRangeIds)
    ? filter.selectedRangeIds.filter((rangeId) =>
        SALES_RANGE_OPTIONS.some((option) => option.id === rangeId),
      )
    : [];

  return {
    selectedRangeIds,
    customMinR:
      filter?.customMinR === null || filter?.customMinR === undefined
        ? ""
        : String(filter.customMinR),
    customMaxR:
      filter?.customMaxR === null || filter?.customMaxR === undefined
        ? ""
        : String(filter.customMaxR),
  };
}

export function isSalesRangeFilterActive(filter) {
  return normalizeSalesRangeFilter(filter).selectedRangeIds.length > 0;
}

function randsToCents(value) {
  if (value === "" || value === null || value === undefined) return null;

  const rands = Number(value);
  return Number.isFinite(rands) ? Math.round(rands * 100) : null;
}

function matchesCustomRange(centsValue, filter) {
  const minimumCents = randsToCents(filter.customMinR);
  const maximumCents = randsToCents(filter.customMaxR);

  if (minimumCents === null && maximumCents === null) return false;
  if (minimumCents !== null && centsValue < minimumCents) return false;
  if (maximumCents !== null && centsValue > maximumCents) return false;

  return true;
}

export function matchesSalesRangeFilter(centsValue, filter) {
  const normalizedFilter = normalizeSalesRangeFilter(filter);
  if (normalizedFilter.selectedRangeIds.length === 0) return true;

  const normalizedCents = Number(centsValue || 0);
  const cents = Number.isFinite(normalizedCents) ? normalizedCents : 0;

  return normalizedFilter.selectedRangeIds.some((rangeId) => {
    switch (rangeId) {
      case SALES_RANGE_IDS.ZERO:
        return cents === 0;
      case SALES_RANGE_IDS.R1_TO_99:
        return cents >= 100 && cents <= 9_999;
      case SALES_RANGE_IDS.R100_TO_299:
        return cents >= 10_000 && cents <= 29_999;
      case SALES_RANGE_IDS.R300_TO_499:
        return cents >= 30_000 && cents <= 49_999;
      case SALES_RANGE_IDS.R500_TO_999:
        return cents >= 50_000 && cents <= 99_999;
      case SALES_RANGE_IDS.GTE_1000:
        return cents >= 100_000;
      case SALES_RANGE_IDS.CUSTOM:
        return matchesCustomRange(cents, normalizedFilter);
      default:
        return false;
    }
  });
}

function formatRandRangeValue(value) {
  if (value === "" || value === null || value === undefined) return "";

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "";

  return numberValue.toLocaleString("en-ZA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function getSalesRangeFilterButtonLabel(filter) {
  const normalizedFilter = normalizeSalesRangeFilter(filter);
  const selectedRangeIds = normalizedFilter.selectedRangeIds;

  if (selectedRangeIds.length === 0) return "Filter";

  if (selectedRangeIds.length > 1) {
    return `${selectedRangeIds.length} ranges`;
  }

  const [rangeId] = selectedRangeIds;
  const option = SALES_RANGE_OPTIONS.find((item) => item.id === rangeId);

  if (rangeId !== SALES_RANGE_IDS.CUSTOM) {
    return option?.label || "1 range";
  }

  const minimumLabel = formatRandRangeValue(normalizedFilter.customMinR);
  const maximumLabel = formatRandRangeValue(normalizedFilter.customMaxR);

  if (minimumLabel && maximumLabel) {
    return `R${minimumLabel}–R${maximumLabel}`;
  }

  if (minimumLabel) return `≥ R${minimumLabel}`;
  if (maximumLabel) return `≤ R${maximumLabel}`;

  return "Custom range";
}
