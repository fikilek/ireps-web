import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveSalesMonthSelection, salesCategorySearch } from "./salesMonthModel.js";
import { projectSalesCategoryMonth } from "./salesCategoryModel.js";

test("absent month defaults; explicit malformed/empty/duplicate month fails closed", () => {
  const now = new Date("2026-09-06T00:00:00Z");
  assert.equal(resolveSalesMonthSelection("", now).month, "2026-08");
  for (const search of ["?month=", "?month=2026-13", "?month=2026-07&month=2026-08"]) {
    assert.equal(resolveSalesMonthSelection(search, now).valid, false);
  }
  assert.equal(resolveSalesMonthSelection(salesCategorySearch("2026-06"), now).month, "2026-06");
});

test("exact category distinguishes valid zero from unavailable and rejects extra keys", () => {
  const entry = { leakageCategory: "Normal", riskTier: "Normal", riskScore: 0 };
  const row = { leakageCategory: "legacy", riskScore: 99, monthlyCategories: { "2026-06": entry } };
  assert.equal(projectSalesCategoryMonth(row, "2026-06").riskScore, 0);
  for (const source of [row, { monthlyCategories: { "2026-07": { ...entry, extra: true } } }]) {
    const result = projectSalesCategoryMonth(source, "2026-07");
    assert.equal(result.categoryAvailable, false);
    assert.deepEqual([result.leakageCategory, result.riskTier, result.riskScore], [null, null, null]);
  }
  assert.equal(row.leakageCategory, "legacy");
});

test("overview and detail both bind URL month to model/read and preserve it in navigation", async () => {
  for (const name of ["CustomerCategoriesDashboardPage.jsx", "CustomerCategoryDashboardPage.jsx"]) {
    const source = await readFile(new URL(`../../dashboard/${name}`, import.meta.url), "utf8");
    assert.match(source, /resolveSalesMonthSelection\(location.search\)/);
    assert.match(source, /month: categoryMonth/);
    assert.match(source, /salesCategorySearch\(categoryMonth\)/);
    assert.match(source, /!monthSelection.valid/);
  }
});
