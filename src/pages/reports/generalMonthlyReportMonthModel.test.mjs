import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDefaultReportMonth } from "./generalMonthlyReportMonthModel.js";
import { buildCanonicalGmrMeterRow } from "../../../functions/reports/generalMonthlyReport.js";

test("GMR owns its previous-month default, including Johannesburg midnight and January", () => {
  assert.equal(getDefaultReportMonth(new Date("2026-09-06T00:00:00Z")), "2026-08");
  assert.equal(getDefaultReportMonth(new Date("2026-08-31T22:00:00Z")), "2026-08");
  assert.equal(getDefaultReportMonth(new Date("2025-12-31T22:00:00Z")), "2025-12");
});

test("prepared GMR backend rejects missing/invalid exact categories and never uses scalar roots", () => {
  const entry = { leakageCategory: "Normal", riskTier: "Normal", riskScore: 0 };
  for (const value of [null, { ...entry, extra: 1 }, { ...entry, riskScore: "0" }, { ...entry, riskTier: "" }]) {
    const result = buildCanonicalGmrMeterRow({ registry: {}, sourceSalesEntry: { id: "M1", data: { leakageCategory: "LEGACY", monthlyCategories: { "2026-07": entry, "2026-08": value } } }, reportMonth: "2026-08" });
    assert.equal(result.salesCategory, null);
  }
});

test("GMR uses its own helper and passes explicit reportMonth without invoking generation", async () => {
  const page = await readFile(new URL("./GeneralMonthlyReportPage.jsx", import.meta.url), "utf8");
  assert.match(page, /useState\(\(\) => getDefaultReportMonth\(\)\)/);
  assert.match(page, /reportMonth,/);
  assert.doesNotMatch(page, /getDefaultSalesMonth|useGetSalesGovernance/);
});
