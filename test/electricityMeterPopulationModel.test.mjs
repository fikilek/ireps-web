import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeElectricityPopulationDoc,
  formatNumber,
  formatPercent,
  formatMonthLabel,
  pickActiveMonth,
  EMD_HELP_STORIES,
} from "../src/pages/dashboard/models/electricityMeterPopulationModel.js";

describe("electricityMeterPopulationModel (EMP-R001 v1.4.0)", () => {
  it("formats grouped dashboard numbers", () => {
    assert.equal(formatNumber(10216), "10,216"); // dashboard grouping
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(null), "0");
  });

  it("formats percentages accurately", () => {
    assert.equal(formatPercent(1840, 9796), "18.8%");
    assert.equal(formatPercent(7956, 9796), "81.2%");
    assert.equal(formatPercent(0, 0), "0.0%");
  });

  it("formats month labels nicely", () => {
    assert.equal(formatMonthLabel("2026-10"), "October 2026");
    assert.equal(formatMonthLabel("2026-06"), "June 2026");
    assert.equal(formatMonthLabel("invalid"), "invalid");
  });

  it("picks the latest month if no preference requested", () => {
    const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    assert.equal(pickActiveMonth(months), "2026-10");
    assert.equal(pickActiveMonth(months, "2026-08"), "2026-08");
    assert.equal(pickActiveMonth(months, "2026-99"), "2026-10");
  });

  it("normalizes a rollup document correctly", () => {
    const raw = {
      id: "ZA241_2026-10",
      lmPcode: "ZA241",
      month: "2026-10",
      totalMeters: 10216,
      purchases: { buying: 9000, notBuying: 1216, salesTotalC: 90000000, unitsTotal: 45000 },
      categories: { normal: 8376, targeted: 1840 },
      movements: { unchanged: 9642, new: 318, replacements: 184, removed: 72 },
    };

    const norm = normalizeElectricityPopulationDoc(raw);
    assert.equal(norm.totalMeters, 10216);
    assert.equal(norm.buying, 9000);
    assert.equal(norm.notBuying, 1216);
    assert.equal(norm.salesTotalC, 90000000);
    assert.equal(norm.unitsTotal, 45000);
    assert.equal(norm.normal, 8376);
    assert.equal(norm.targeted, 1840);
    assert.equal(norm.classifiedTotal, 10216);
    assert.equal(norm.movements.unchanged, 9642);
    assert.equal(norm.movements.newMeters, 318);
    assert.equal(norm.movements.replacements, 184);
    assert.equal(norm.movements.removed, 72);
  });

  it("contains all required educational help stories", () => {
    assert.ok(EMD_HELP_STORIES["kpi-total"]);
    assert.ok(EMD_HELP_STORIES["kpi-unchanged"]);
    assert.ok(EMD_HELP_STORIES["kpi-new"]);
    assert.ok(EMD_HELP_STORIES["kpi-replacements"]);
    assert.ok(EMD_HELP_STORIES["kpi-removed"]);
    assert.ok(EMD_HELP_STORIES["card-donut"]);
    assert.ok(EMD_HELP_STORIES["card-scope"]);
    assert.ok(EMD_HELP_STORIES["card-notes"]);
  });
});
