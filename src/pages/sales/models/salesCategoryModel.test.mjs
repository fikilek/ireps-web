import assert from "node:assert/strict";
import test from "node:test";

import {
  getGovernedCategoryMonths,
  normalizeSalesMonthlyCategories,
  resolveLatestSalesCategory,
  resolveSalesCategoryForMonth,
} from "./salesCategoryModel.js";

const row = {
  monthlyCategories: {
    "2026-06": {
      leakageCategory: "CAT1 - Zero Purchaser",
      riskTier: "High Risk",
      riskScore: 12,
    },
    "2026-08": {
      leakageCategory: "CAT4 - Low Purchaser",
      riskTier: "Medium Risk",
      riskScore: 6,
    },
  },
  leakageCategory: "OLD SCALAR MUST NEVER BE USED",
  riskTier: "OLD",
  riskScore: 99,
};

test("resolves only the exact requested monthly category", () => {
  assert.deepEqual(resolveSalesCategoryForMonth(row, "2026-06"), {
    monthKey: "2026-06",
    leakageCategory: "CAT1 - Zero Purchaser",
    riskTier: "High Risk",
    riskScore: 12,
  });
});

test("exact-month miss returns null and never borrows another month", () => {
  assert.equal(resolveSalesCategoryForMonth(row, "2026-07"), null);
});

test("documents without monthlyCategories never fall back to scalar category roots", () => {
  assert.equal(
    resolveLatestSalesCategory({
      leakageCategory: "CAT1 - OLD",
      riskTier: "High Risk",
      riskScore: 12,
    }),
    null,
  );
});

test("latest governed category is the greatest valid month key", () => {
  assert.deepEqual(getGovernedCategoryMonths(row), ["2026-08", "2026-06"]);
  assert.deepEqual(resolveLatestSalesCategory(row), {
    monthKey: "2026-08",
    leakageCategory: "CAT4 - Low Purchaser",
    riskTier: "Medium Risk",
    riskScore: 6,
  });
});

test("invalid entries are unavailable rather than coerced", () => {
  const normalized = normalizeSalesMonthlyCategories({
    "2026-08": {
      leakageCategory: "CAT4",
      riskTier: "Medium Risk",
      riskScore: "6",
    },
    "2026-09": {
      leakageCategory: "CAT4",
      riskTier: "Medium Risk",
      riskScore: -1,
    },
    bad: {
      leakageCategory: "CAT4",
      riskTier: "Medium Risk",
      riskScore: 6,
    },
  });

  assert.deepEqual(normalized, {});
});

test("sparse governed history is valid", () => {
  assert.deepEqual(Object.keys(normalizeSalesMonthlyCategories(row.monthlyCategories)), [
    "2026-06",
    "2026-08",
  ]);
});
