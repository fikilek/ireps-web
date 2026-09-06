import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesPopulationRows, buildCategoryDistribution, buildCategoryMatrix, buildTargetedDashboardRows } from "./salesStatsModel.js";
import { buildSalesOperationalStatsReadModel } from "../models/salesTargetedBatchReadModel.js";

test("valid Normal zero is available; exact-month miss and scalar-only rows are unavailable", () => {
  const rows = buildSalesPopulationRows({ selectedMonth: "2026-08", salesRows: [
    { id: "VALID", monthlyCategories: { "2026-08": { leakageCategory: "Normal", riskTier: "Normal", riskScore: 0 } } },
    { id: "SCALAR", leakageCategory: "CAT1", riskScore: 5 },
    { id: "OTHER", monthlyCategories: { "2026-07": { leakageCategory: "CAT1", riskTier: "High", riskScore: 5 } } },
  ] });
  assert.equal(rows[0].categoryState.riskScore, 0);
  assert.equal(rows[0].categoryAvailable, true);
  assert.equal(rows[1].category, null);
  assert.equal(rows[2].category, null);
  assert.deepEqual(buildCategoryDistribution(rows).map(({ category, count }) => ({ category, count })), [{ category: "Normal", count: 1 }]);
  const matrix = buildCategoryMatrix(rows, () => [{ id: "WARD", name: "Ward" }]);
  assert.equal(matrix.rows[0].total, 3);
  assert.equal(matrix.rows[0].categoryUnavailable, 2);
  assert.deepEqual(matrix.categories, ["Normal"]);
});

test("Stats presentation preserves failed-join versus missing-document states", () => {
  const read = buildSalesOperationalStatsReadModel({ rows: [{ id: "A", salesAllMeterId: "A" }, { id: "B", salesAllMeterId: "B" }], salesReadErrors: { B: { message: "denied" } }, selectedMonth: "2026-08" });
  const rows = buildTargetedDashboardRows({ normalizedRows: read.rows });
  assert.deepEqual(rows.map(row => row.categoryState.status), ["missing-document", "read-error"]);
  assert.ok(rows.every(row => row.category === null && !row.categoryAvailable));
});
