import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_CATEGORIES_BASELINE_MONTH_KEYS,
  CUSTOMER_CATEGORIES_CURRENT_SNAPSHOT_MONTH_KEY,
  CUSTOMER_CATEGORIES_RECOVERY_MONTHS,
  buildCustomerCategoriesDashboardModel,
  countInvisibleOperationalMeters,
  getCustomerCategoryShortCode,
  isNormalCustomerCategory,
  toCustomerCategoryKey,
} from "./customerCategoriesDashboardModel.js";

function salesRow({
  leakageCategory = "CAT1 - Zero Purchaser",
  hasUsableGps = false,
  monthlySalesC = {},
  geofenceRefs = [],
  wardNumbers = [],
} = {}) {
  return {
    leakageCategory,
    hasUsableGps,
    monthlySalesC,
    geofenceRefs,
    wardNumbers,
  };
}

test("Normal variants are excluded using Project Population parity rules", () => {
  assert.equal(isNormalCustomerCategory("Normal"), true);
  assert.equal(isNormalCustomerCategory("Normal - No Leakage Flag"), true);
  assert.equal(isNormalCustomerCategory("NORMAL_CUSTOMER"), true);
  assert.equal(isNormalCustomerCategory("CAT1 - Zero Purchaser"), false);
});

test("authoritative category value produces stable URL and compact recovery keys", () => {
  assert.equal(
    toCustomerCategoryKey(" CAT1 - Zero Purchaser "),
    encodeURIComponent("CAT1 - ZERO PURCHASER"),
  );
  assert.equal(getCustomerCategoryShortCode("CAT1 - Zero Purchaser"), "C1");
  assert.equal(getCustomerCategoryShortCode("CAT8 - Energy Without Purchase"), "C8");
  assert.equal(getCustomerCategoryShortCode("Uncategorised"), "UC");
});

test("Invisible operational meters require matching Registry and AST records", () => {
  const registryRows = [
    { id: "M1", visibility: "INVISIBLE" },
    { id: "M2", visibility: "INVISIBLE" },
    { id: "M3", visibility: "VISIBLE" },
    { id: "REGISTRY_ONLY", visibility: "INVISIBLE" },
  ];

  const astRows = [
    { id: "M1" },
    { id: "M2" },
    { id: "M3" },
    { id: "AST_ONLY" },
  ];

  assert.equal(countInvisibleOperationalMeters(registryRows, astRows), 2);
  assert.equal(countInvisibleOperationalMeters([], astRows), 0);
  assert.equal(countInvisibleOperationalMeters(registryRows, []), 0);
});

test("field target, category totals, GPS and June baseline reconcile", () => {
  const model = buildCustomerCategoriesDashboardModel([
    salesRow({
      leakageCategory: "Normal - No Leakage Flag",
      hasUsableGps: true,
      monthlySalesC: { "2026-06": 999_00 },
    }),
    salesRow({
      leakageCategory: "CAT1 - Zero Purchaser",
      hasUsableGps: true,
      monthlySalesC: {
        "2026-04": 100_00,
        "2026-05": 120_00,
        "2026-06": 150_00,
      },
    }),
    salesRow({
      leakageCategory: "CAT1 - Zero Purchaser",
      hasUsableGps: false,
      monthlySalesC: { "2026-06": 50_00 },
    }),
    salesRow({
      leakageCategory: "CAT2 - Low Purchaser",
      hasUsableGps: true,
      monthlySalesC: { "2026-06": 25_00 },
    }),
  ]);

  assert.equal(model.fieldTarget, 3);
  assert.equal(model.categoryCount, 2);
  assert.equal(model.categoryTotal, 3);
  assert.equal(model.reconcilesToFieldTarget, true);
  assert.equal(model.gpsReady, 2);
  assert.equal(model.gpsWithout, 1);
  assert.equal(model.baselinePrimarySalesC, 225_00);
  assert.deepEqual(model.baselineMonthKeys, CUSTOMER_CATEGORIES_BASELINE_MONTH_KEYS);
  assert.equal(model.categories[0].label, "CAT1 - Zero Purchaser");
  assert.equal(model.categories[0].count, 2);
});

test("baseline purchases aggregate per category and geofence memberships are ranked", () => {
  const model = buildCustomerCategoriesDashboardModel([
    salesRow({
      leakageCategory: "CAT1 - Zero Purchaser",
      monthlySalesC: { "2026-04": 10_00, "2026-05": 20_00, "2026-06": 30_00 },
      geofenceRefs: [{ id: "GF_A", name: "Matande North" }],
      wardNumbers: ["4"],
    }),
    salesRow({
      leakageCategory: "CAT2 - Low Purchaser",
      monthlySalesC: { "2026-04": 5_00, "2026-05": 7_00, "2026-06": 9_00 },
      geofenceRefs: [
        { id: "GF_A", name: "Matande North" },
        { id: "GF_B", name: "CBD Fringe" },
      ],
      wardNumbers: ["4", "5"],
    }),
  ]);

  const cat1 = model.categories.find((category) => category.label.startsWith("CAT1"));
  assert.equal(cat1.monthSalesC["2026-04"], 10_00);
  assert.equal(cat1.monthSalesC["2026-05"], 20_00);
  assert.equal(cat1.monthSalesC["2026-06"], 30_00);

  assert.equal(model.topGeofences[0].label, "Matande North");
  assert.equal(model.topGeofences[0].count, 2);
  assert.equal(model.topWards[0].label, "Ward 4");
  assert.equal(model.topWards[0].count, 2);
});


test("all category displays use ascending CAT sequence rather than population ranking", () => {
  const model = buildCustomerCategoriesDashboardModel([
    salesRow({ leakageCategory: "CAT4 - Long Gap (4+ months)" }),
    salesRow({ leakageCategory: "CAT4 - Long Gap (4+ months)" }),
    salesRow({ leakageCategory: "CAT4 - Long Gap (4+ months)" }),
    salesRow({ leakageCategory: "CAT8 - Energy Without Purchase" }),
    salesRow({ leakageCategory: "CAT2 - Ghost Purchaser (1-3 mo)" }),
    salesRow({ leakageCategory: "CAT1 - Zero Purchaser" }),
    salesRow({ leakageCategory: "CAT6 - Low kWh per Rand" }),
    salesRow({ leakageCategory: "CAT5 - Stopped Purchasing" }),
    salesRow({ leakageCategory: "CAT3 - Micro Purchaser (<R400)" }),
  ]);

  assert.deepEqual(
    model.categories.map((category) => getCustomerCategoryShortCode(category.label)),
    ["C1", "C2", "C3", "C4", "C5", "C6", "C8"],
  );

  assert.deepEqual(
    model.recoveryCategories.map((category) => category.shortCode),
    ["C1", "C2", "C3", "C4", "C5", "C6", "C8"],
  );
});


test("recovery tracker uses fixed category sequence rather than count ranking", () => {
  const model = buildCustomerCategoriesDashboardModel([
    salesRow({ leakageCategory: "CAT5 - Stopped Purchasing" }),
    salesRow({ leakageCategory: "CAT5 - Stopped Purchasing" }),
    salesRow({ leakageCategory: "CAT5 - Stopped Purchasing" }),
    salesRow({ leakageCategory: "CAT3 - Micro Purchaser (<R400)" }),
    salesRow({ leakageCategory: "CAT8 - Energy Without Purchase" }),
    salesRow({ leakageCategory: "CAT1 - Zero Purchaser" }),
  ]);

  assert.deepEqual(
    model.recoveryCategories.map((category) => category.shortCode),
    ["C1", "C3", "C5", "C8"],
  );
  assert.equal(model.recoveryCategories[0].count, 1);
  assert.equal(model.recoveryCategories[2].count, 3);
});

test("recovery tracker exposes only the authoritative June snapshot and no fake future values", () => {
  const model = buildCustomerCategoriesDashboardModel([
    salesRow({
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC: { "2026-06": 500_00 },
    }),
    salesRow({
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC: { "2026-06": 200_00 },
    }),
    salesRow({
      leakageCategory: "CAT1 - Zero Purchaser",
      monthlySalesC: { "2026-06": 100_00 },
    }),
    salesRow({
      leakageCategory: "CAT2 - Ghost Purchaser (1-3 mo)",
      monthlySalesC: { "2026-06": 50_00 },
    }),
  ]);

  assert.deepEqual(
    model.recoveryMonths.map((month) => month.key),
    CUSTOMER_CATEGORIES_RECOVERY_MONTHS.map((month) => month.key),
  );

  const june = model.recoveryMonths.find(
    (month) => month.key === CUSTOMER_CATEGORIES_CURRENT_SNAPSHOT_MONTH_KEY,
  );
  assert.equal(june.isAvailable, true);
  assert.equal(june.revenueC, 850_00);
  assert.equal(june.normalCount, 2);
  assert.equal(june.fieldTarget, 2);
  assert.deepEqual(june.categories.map((category) => category.count), [1, 1]);

  for (const month of model.recoveryMonths.filter((item) => !item.isAvailable)) {
    assert.equal(month.revenueC, null);
    assert.equal(month.normalCount, null);
    assert.equal(month.fieldTarget, null);
    assert.ok(month.categories.every((category) => category.count === null));
  }
});
