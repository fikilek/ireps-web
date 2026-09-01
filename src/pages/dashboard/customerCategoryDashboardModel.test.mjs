import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerCategoryDashboardModel,
  normalizeCustomerCategoryRouteKey,
} from "./customerCategoryDashboardModel.js";
import { toCustomerCategoryKey } from "./customerCategoriesDashboardModel.js";

function salesRow({
  meterNo,
  leakageCategory,
  hasUsableGps = false,
  monthlySalesC = {},
  geofenceRefs = [],
  wardNumbers = [],
  salesPeriodTo = "",
}) {
  return {
    id: meterNo,
    meterNo,
    meterNoNormalized: meterNo,
    leakageCategory,
    hasUsableGps,
    monthlySalesC,
    geofenceRefs,
    wardNumbers,
    salesPeriodTo: salesPeriodTo || Object.keys(monthlySalesC).sort().at(-1) || "",
  };
}

test("route category key resolves encoded and decoded forms consistently", () => {
  const category = "CAT2 - Ghost Purchaser (1-3 mo)";
  assert.equal(
    normalizeCustomerCategoryRouteKey(toCustomerCategoryKey(category)),
    toCustomerCategoryKey(category),
  );
  assert.equal(
    normalizeCustomerCategoryRouteKey(category),
    toCustomerCategoryKey(category),
  );
});

test("individual category metrics use only the selected authoritative category", () => {
  const rows = [
    salesRow({
      meterNo: "1001",
      leakageCategory: "CAT2 - Ghost Purchaser (1-3 mo)",
      hasUsableGps: true,
      monthlySalesC: { "2026-04": 10_00, "2026-05": 20_00, "2026-06": 30_00 },
      geofenceRefs: [{ id: "GF1", name: "Matande North" }],
      wardNumbers: ["4"],
    }),
    salesRow({
      meterNo: "1002",
      leakageCategory: "CAT2 - Ghost Purchaser (1-3 mo)",
      monthlySalesC: { "2026-04": 5_00, "2026-05": 7_00, "2026-06": 9_00 },
      geofenceRefs: [{ id: "GF1", name: "Matande North" }],
      wardNumbers: ["4"],
    }),
    salesRow({
      meterNo: "2001",
      leakageCategory: "CAT4 - Another Category",
      monthlySalesC: { "2026-06": 99_00 },
    }),
    salesRow({
      meterNo: "3001",
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC: { "2026-06": 120_00 },
    }),
  ];

  const model = buildCustomerCategoryDashboardModel(
    rows,
    [],
    toCustomerCategoryKey("CAT2 - Ghost Purchaser (1-3 mo)"),
  );

  assert.equal(model.categoryTotal, 2);
  assert.equal(model.fieldTarget, 3);
  assert.equal(model.gpsReady, 1);
  assert.deepEqual(model.purchaseMonths.map((month) => month.key), [
    "2026-04",
    "2026-05",
    "2026-06",
  ]);
  assert.equal(model.latestMonthKey, "2026-06");
  assert.equal(model.previousMonthKey, "2026-05");
  assert.equal(model.latestMonthSalesC, 39_00);
  assert.equal(model.previousMonthSalesC, 27_00);
  assert.equal(model.latestMunicipalSalesC, 258_00);
  assert.equal(model.latestCategoryMeterCount, 2);
  assert.equal(model.currentCategorySnapshotMonthKey, "2026-06");
  assert.deepEqual(
    model.purchaseMonths.map((month) => month.categoryMeterCount),
    [null, null, 2],
  );
  assert.equal(model.rollingAverageC, 27_00);
  assert.equal(Math.round(model.latestVsPreviousPercent), 44);
  assert.equal(model.topGeofences[0].count, 2);
  assert.equal(model.topWards[0].label, "Ward 4");
});

test("field coverage links only TRNs whose meter number belongs to the category", () => {
  const rows = [
    salesRow({ meterNo: "1001", leakageCategory: "CAT2 - Ghost Purchaser" }),
    salesRow({ meterNo: "1002", leakageCategory: "CAT2 - Ghost Purchaser" }),
  ];

  const trns = [
    {
      meterNo: "1001",
      trnType: "METER_DISCOVERY",
      hasAccess: "YES",
      anomaly: "METER OK",
    },
    {
      meterNo: "1001",
      trnType: "METER_INSPECTION",
      hasAccess: "YES",
    },
    { meterNo: "1001", trnType: "METER_DISCONNECTION" },
    { meterNo: "1001", trnType: "METER_RECONNECTION" },
    {
      meterNo: "9999",
      trnType: "METER_DISCOVERY",
      hasAccess: "NO",
      anomaly: "OTHER",
    },
  ];

  const model = buildCustomerCategoryDashboardModel(
    rows,
    trns,
    toCustomerCategoryKey("CAT2 - Ghost Purchaser"),
  );

  assert.equal(model.fieldCoverage.visited, 1);
  assert.equal(model.fieldCoverage.notVisited, 1);
  assert.equal(model.fieldCoverage.discoveries, 1);
  assert.equal(model.fieldCoverage.meterOk, 1);
  assert.equal(model.fieldCoverage.meterFaulty, 0);
  assert.equal(model.fieldCoverage.meterDamaged, 0);
  assert.equal(model.fieldCoverage.illegallyConnected, 0);
  assert.equal(model.fieldCoverage.noAccess, 0);
  assert.equal(model.fieldCoverage.disconnections, 1);
  assert.equal(model.fieldCoverage.reconnections, 1);
  assert.equal(model.fieldCoverage.linkedTrnCount, 4);
});

test("purchase trend keeps only the latest three loaded authoritative months", () => {
  const rows = [
    salesRow({
      meterNo: "1001",
      leakageCategory: "CAT4 - Long Gap",
      monthlySalesC: {
        "2026-04": 10_00,
        "2026-05": 20_00,
        "2026-06": 30_00,
        "2026-07": 40_00,
        "2026-08": 50_00,
      },
    }),
  ];

  const model = buildCustomerCategoryDashboardModel(
    rows,
    [],
    toCustomerCategoryKey("CAT4 - Long Gap"),
  );

  assert.deepEqual(model.purchaseMonths.map((month) => month.key), [
    "2026-06",
    "2026-07",
    "2026-08",
  ]);
  assert.equal(model.rollingAverageC, 40_00);
  assert.equal(model.previousMonthKey, "2026-07");
  assert.equal(model.latestMonthKey, "2026-08");
  assert.equal(model.latestVsPreviousPercent, 25);
});

test("field findings use only the four canonical Meter Discovery main anomaly values", () => {
  const rows = [
    salesRow({ meterNo: "1001", leakageCategory: "CAT2 - Ghost Purchaser" }),
    salesRow({ meterNo: "1002", leakageCategory: "CAT2 - Ghost Purchaser" }),
    salesRow({ meterNo: "1003", leakageCategory: "CAT2 - Ghost Purchaser" }),
    salesRow({ meterNo: "1004", leakageCategory: "CAT2 - Ghost Purchaser" }),
  ];
  const trns = [
    { meterNo: "1001", trnType: "METER_DISCOVERY", anomaly: "METER OK" },
    { meterNo: "1002", trnType: "METER_DISCOVERY", anomaly: "METER FAULTY" },
    { meterNo: "1003", trnType: "METER_DISCOVERY", anomaly: "METER DAMAGED" },
    { meterNo: "1004", trnType: "METER_DISCOVERY", anomaly: "ILLEGALLY CONNECTED" },
    { meterNo: "1004", trnType: "METER_INSPECTION", anomaly: "METER FAULTY" },
  ];

  const model = buildCustomerCategoryDashboardModel(
    rows,
    trns,
    toCustomerCategoryKey("CAT2 - Ghost Purchaser"),
  );

  assert.equal(model.fieldCoverage.discoveries, 4);
  assert.equal(model.fieldCoverage.meterOk, 1);
  assert.equal(model.fieldCoverage.meterFaulty, 1);
  assert.equal(model.fieldCoverage.meterDamaged, 1);
  assert.equal(model.fieldCoverage.illegallyConnected, 1);
  assert.deepEqual(
    model.fieldCoverage.rows.slice(6, 10).map((row) => row.label),
    ["Meter OK", "Meter Faulty", "Meter Damaged", "Illegally Connected"],
  );
  assert.deepEqual(
    model.fieldCoverage.rows.slice(0, 6).map((row) => row.label),
    [
      "Visited",
      "Not Visited",
      "No Access",
      "Disconnections",
      "Reconnections",
      "Discoveries / Verifications",
    ],
  );
  assert.equal(model.fieldCoverage.rows[10].label, "Meters Returned to Normal");
  assert.equal(model.fieldCoverage.rows[10].count, null);
});

test("purchase recovery compares CAT purchases with the full prepaid Sales population without fabricating historical CAT counts", () => {
  const rows = [
    salesRow({
      meterNo: "1001",
      leakageCategory: "CAT2 - Ghost Purchaser",
      monthlySalesC: { "2026-06": 10_00, "2026-07": 20_00, "2026-08": 30_00 },
      salesPeriodTo: "2026-08",
    }),
    salesRow({
      meterNo: "1002",
      leakageCategory: "CAT2 - Ghost Purchaser",
      monthlySalesC: { "2026-06": 5_00, "2026-07": 6_00, "2026-08": 7_00 },
      salesPeriodTo: "2026-08",
    }),
    salesRow({
      meterNo: "2001",
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC: { "2026-06": 100_00, "2026-07": 110_00, "2026-08": 120_00 },
      salesPeriodTo: "2026-08",
    }),
  ];

  const model = buildCustomerCategoryDashboardModel(
    rows,
    [],
    toCustomerCategoryKey("CAT2 - Ghost Purchaser"),
  );

  assert.deepEqual(
    model.purchaseMonths.map((month) => ({
      key: month.key,
      categorySalesC: month.categorySalesC,
      municipalSalesC: month.municipalSalesC,
      categoryMeterCount: month.categoryMeterCount,
    })),
    [
      { key: "2026-06", categorySalesC: 15_00, municipalSalesC: 115_00, categoryMeterCount: null },
      { key: "2026-07", categorySalesC: 26_00, municipalSalesC: 136_00, categoryMeterCount: null },
      { key: "2026-08", categorySalesC: 37_00, municipalSalesC: 157_00, categoryMeterCount: 2 },
    ],
  );
  assert.equal(model.latestMunicipalSalesC, 157_00);
  assert.equal(model.latestCategoryMeterCount, 2);
});

test("outcome rows remain unavailable until a historical category/outcome contract exists", () => {
  const model = buildCustomerCategoryDashboardModel(
    [salesRow({ meterNo: "1001", leakageCategory: "CAT1 - Zero Purchaser" })],
    [],
    toCustomerCategoryKey("CAT1 - Zero Purchaser"),
  );

  assert.equal(model.outcomesAvailable, false);
  assert.equal(model.outcomes.length, 4);
  assert.deepEqual(model.outcomes.map((row) => row.label), [
    "Started Purchasing",
    "Still Not Purchasing",
    "Returned to Normal",
    "Pending / Unresolved",
  ]);
});
