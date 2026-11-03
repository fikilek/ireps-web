import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCurrencyRands,
  formatMonthLabel,
  formatNumber,
  formatPercent,
  formatUnitsKwh,
  normalizeElectricityPopulationDoc,
  pickActiveMonth,
} from "./electricityMeterPopulationModel.js";

test("formatNumber, formatCurrencyRands, formatUnitsKwh, and formatPercent format executive vending values", () => {
  assert.equal(formatNumber(10201), "10,201");
  assert.equal(formatCurrencyRands(719526263), "R 7,195,263");
  assert.equal(formatCurrencyRands(105657), "R 1,057");
  assert.equal(formatUnitsKwh(1823793.9), "1,823,794 kWh");
  assert.equal(formatUnitsKwh(267.8), "268 kWh");
  assert.equal(formatPercent(6810, 10201), "66.8%");
  assert.equal(formatPercent(3391, 10201), "33.2%");
  assert.equal(formatMonthLabel("2026-08"), "August 2026");
});

test("normalizeElectricityPopulationDoc normalizes EMP-R001 v1.4.0 original vending rollup doc", () => {
  const doc = normalizeElectricityPopulationDoc({
    id: "ZA5241_2026-07",
    lmPcode: "ZA5241",
    month: "2026-07",
    totalMeters: 10201,
    movements: {
      unchanged: 10146,
      new: 24,
      replacements: 31,
      removed: 39,
    },
    purchases: {
      buying: 6684,
      notBuying: 3517,
      buyingShare: 65.5,
      notBuyingShare: 34.5,
      salesTotalC: 727111461,
      unitsTotal: 1868999.3,
      avgSalesPerBuyingMeterC: 108784,
      avgUnitsPerBuyingMeter: 279.6,
    },
    categories: {
      classifiedTotal: 10241,
      normal: 4645,
      targeted: 5596,
      normalShare: 45.4,
      targetedShare: 54.6,
    },
    metadata: {
      generatedAt: "2026-11-03T12:00:00.000Z",
      updatedAt: "2026-11-03T12:00:00.000Z",
    },
  });

  assert.equal(doc.id, "ZA5241_2026-07");
  assert.equal(doc.lmPcode, "ZA5241");
  assert.equal(doc.month, "2026-07");
  assert.equal(doc.monthLabel, "July 2026");
  assert.equal(doc.totalMeters, 10201);
  assert.deepEqual(doc.movements, {
    unchanged: 10146,
    newMeters: 24,
    replacements: 31,
    removed: 39,
  });
  assert.equal(doc.buying, 6684);
  assert.equal(doc.notBuying, 3517);
  assert.equal(doc.buyingShare, 65.5);
  assert.equal(doc.notBuyingShare, 34.5);
  assert.equal(doc.salesTotalC, 727111461);
  assert.equal(doc.unitsTotal, 1868999.3);
  assert.equal(doc.avgSalesPerBuyingMeterC, 108784);
  assert.equal(doc.avgUnitsPerBuyingMeter, 279.6);
  assert.equal(doc.classifiedTotal, 10241);
  assert.equal(doc.normal, 4645);
  assert.equal(doc.targeted, 5596);
  assert.equal(doc.normalShare, 45.4);
  assert.equal(doc.targetedShare, 54.6);
});

test("pickActiveMonth defaults to latest month and respects valid requested month", () => {
  const months = [{ month: "2026-06" }, { month: "2026-07" }, { month: "2026-08" }];
  assert.equal(pickActiveMonth(months, ""), "2026-08");
  assert.equal(pickActiveMonth(months, "2026-06"), "2026-06");
  assert.equal(pickActiveMonth(months, "2026-05"), "2026-08");
});

