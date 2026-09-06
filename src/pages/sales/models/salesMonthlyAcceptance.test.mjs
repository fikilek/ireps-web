import test from "node:test";
import assert from "node:assert/strict";
import { projectSalesCategoryMonth } from "./salesCategoryModel.js";
import { buildMonthlyPopulation } from "./salesPopulationModel.js";
test("all rows resolve exact view month, with no scalar or other month fallback", () => {
  const entry = { leakageCategory: "CAT1", riskTier: "High", riskScore: 3 };
  const rows = [{ id: "1", leakageCategory: "legacy", monthlyCategories: { "2026-06": entry } }, { id: "2", monthlyCategories: { "2026-07": entry } }];
  const projected = rows.map(row => projectSalesCategoryMonth(row, "2026-07"));
  assert.deepEqual(projected.map(row => row.leakageCategory), [null, "CAT1"]);
  assert.deepEqual(projected.map(row => row.categoryMonth), ["2026-07", "2026-07"]);
  assert.equal(projectSalesCategoryMonth(rows[0], "").leakageCategory, null);
  assert.equal(rows[0].leakageCategory, "legacy");
  assert.equal(projectSalesCategoryMonth({ monthlyCategories: { "2026-07": { ...entry, leakageCategory: {} } } }, "2026-07").leakageCategory, null);
});
test("active membership partitions; retired and unresolved evidence remain separate", () => {
  const snapshots = [
    { month: "2026-06", members: ["A", "B", "C"], replacements: [], exceptions: [] },
    { month: "2026-07", members: ["A", "D", "E", "F"], replacements: [{ predecessor: "B", successor: "D" }], exceptions: [{ meterId: "E", reason: "unknown predecessor" }, { meterId: "E", reason: "duplicate evidence" }] },
    { month: "2026-08", members: ["A", "C", "D"], replacements: [{ predecessor: "F", successor: "C" }], exceptions: [] },
  ];
  assert.equal(buildMonthlyPopulation(snapshots, "2026-06").counts.baseline, 3);
  const july = buildMonthlyPopulation(snapshots, "2026-07").counts;
  assert.deepEqual([july.active, july.unchanged, july.new, july.replacement, july.retired, july.activeExceptions], [4, 1, 1, 1, 2, 1]);
  const august = buildMonthlyPopulation(snapshots, "2026-08").counts;
  assert.equal(august.reentry, 1); assert.equal(august.activeExceptions, 1); assert.equal(august.replacement, 0);
  assert.equal(buildMonthlyPopulation(snapshots, "2026-09"), null);
});
test("invalid replacement evidence fails rather than double counting", () => {
  assert.equal(buildMonthlyPopulation([{ month: "2026-06", members: ["A"], replacements: [], exceptions: [] }, { month: "2026-07", members: ["A", "B"], replacements: [{ predecessor: "A", successor: "B" }], exceptions: [] }], "2026-07").status, "invalid");
});
