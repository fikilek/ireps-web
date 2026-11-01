import test from "node:test";
import assert from "node:assert/strict";

import {
  buildElectricityPopulation,
  isNormalCategory,
  isTargetedCategory,
  listPopulationMonths,
} from "../dashboard/electricityPopulationModel.js";

const cat = (leakageCategory) => ({ leakageCategory, riskTier: "Normal", riskScore: 0 });
const row = (id, categories, extra = {}) => ({
  id, lmPcode: "ZA5241", monthlyCategories: categories, hasUsableGps: true, gpsAvailable: true, ...extra,
});

const rows = [
  row("A", { "2026-06": cat("Normal - No Leakage Flag"), "2026-07": cat("Normal - No Leakage Flag") }),
  row("B", { "2026-06": cat("CAT4 - Long Gap (4+ months)"), "2026-07": cat("CAT5 - Stopped Purchasing") }, { hasUsableGps: false }),
  row("C", { "2026-07": cat("CAT8 - Energy Without Purchase") }),
  row("OLD", { "2026-05": cat("Normal - No Leakage Flag") }),
  row("OTHER_LM", { "2026-08": cat("Normal - No Leakage Flag") }, { lmPcode: "ZA9999" }),
];

test("months: only from June 2026, only with data, oldest first", () => {
  // The server reads one LM's Sales records, so every row given here belongs to that LM.
  assert.deepEqual(listPopulationMonths(rows.filter((r) => r.lmPcode === "ZA5241")), ["2026-06", "2026-07"]);
});

test("normal is only the Normal category", () => {
  assert.equal(isNormalCategory("Normal - No Leakage Flag"), true);
  assert.equal(isNormalCategory("NORMAL"), true);
  assert.equal(isNormalCategory("CAT2 - Ghost Purchaser (1-3 mo)"), false);
});

test("targeted is CAT 1 to 8 only", () => {
  assert.equal(isTargetedCategory("CAT1 - Zero Purchaser"), true);
  assert.equal(isTargetedCategory("CAT8 - Energy Without Purchase"), true);
  assert.equal(isTargetedCategory("CAT9 - Something"), false);
  assert.equal(isTargetedCategory("CAT10"), false);
  assert.equal(isTargetedCategory("Uncategorised"), false);
  const p = buildElectricityPopulation({
    salesRows: [row("U", { "2026-07": cat("Uncategorised") })], fieldMeters: [], month: "2026-07", lmPcode: "ZA5241",
  });
  assert.deepEqual([p.normal, p.targeted, p.otherCategory], [0, 0, 1]);
});

test("list, Normal vs targeted and GPS for a month", () => {
  const p = buildElectricityPopulation({ salesRows: rows, fieldMeters: [], month: "2026-07", lmPcode: "ZA5241" });
  assert.equal(p.onList, 3);
  assert.equal(p.normal, 1);
  assert.equal(p.targeted, 2);
  assert.equal(p.withGps, 2);
  assert.equal(p.withoutGps, 1);
  assert.equal(p.gpsUnknown, 0);
  assert.equal(p.total, 3);
  assert.equal(p.foundInField, 0);
});

test("MV-R001 month rule: found in the field counts until the month it is on the list", () => {
  const fieldMeters = [
    { meterNo: "C", foundMonth: "2026-06" },  // found June, on the list from July
    { meterNo: "F1", foundMonth: "2026-06" }, // never on the list
    { meterNo: "F2", foundMonth: "2026-07" }, // found July
    { meterNo: "A", foundMonth: "2026-06" },  // on the list already
  ];
  const june = buildElectricityPopulation({ salesRows: rows, fieldMeters, month: "2026-06", lmPcode: "ZA5241" });
  assert.equal(june.onList, 2);
  assert.equal(june.foundInField, 2); // C and F1; F2 not found yet; A on the list
  assert.equal(june.total, 4);
  const july = buildElectricityPopulation({ salesRows: rows, fieldMeters, month: "2026-07", lmPcode: "ZA5241" });
  assert.equal(july.onList, 3);
  assert.equal(july.foundInField, 2); // F1 and F2; C is on the list now
  assert.equal(july.total, 5);
  assert.equal(Math.round(july.onListShare), 60);
});

test("MV-R001 section 5: a found meter that was on an earlier list is not counted as found in the field", () => {
  const salesRows = [
    row("E", { "2026-06": cat("Normal") }),                              // on June's list, found in July, off the list after
    row("D", { "2026-06": cat("Normal"), "2026-07": cat("Normal") }),   // found June, dropped in August
    row("K", { "2026-08": cat("Normal") }),                             // first listed August
  ];
  const fieldMeters = [
    { meterNo: "E", foundMonth: "2026-07" },
    { meterNo: "D", foundMonth: "2026-06" },
    { meterNo: "K", foundMonth: "2026-07" },
  ];
  const july = buildElectricityPopulation({ salesRows, fieldMeters, month: "2026-07", lmPcode: "ZA5241" });
  assert.equal(july.onList, 1);            // D
  assert.equal(july.foundInField, 1);      // K (first listed in August)
  assert.equal(july.foundNotOnListNow, 1); // E
  const august = buildElectricityPopulation({ salesRows, fieldMeters, month: "2026-08", lmPcode: "ZA5241" });
  assert.equal(august.onList, 1);            // K
  assert.equal(august.foundInField, 0);
  assert.equal(august.foundNotOnListNow, 2); // E and D
});

test("a category entry must have exactly the three governed fields", () => {
  const bad = { leakageCategory: "Normal", riskTier: "Normal" };
  const p = buildElectricityPopulation({
    salesRows: [row("B1", { "2026-07": bad }), row("B2", { "2026-07": { ...cat("Normal"), riskScore: 1.5 } })],
    fieldMeters: [], month: "2026-07",
  });
  assert.equal(p.onList, 0);
});

test("GPS without an answer is counted separately", () => {
  const p = buildElectricityPopulation({
    salesRows: [row("X", { "2026-07": cat("Normal") }, { gpsAvailable: false, hasUsableGps: false })],
    fieldMeters: [], month: "2026-07", lmPcode: "ZA5241",
  });
  assert.equal(p.gpsUnknown, 1);
  assert.equal(p.withGps + p.withoutGps, 0);
});
