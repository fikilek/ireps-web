import test from "node:test";
import assert from "node:assert/strict";
import { FieldPath } from "firebase-admin/firestore";
import { evaluateSalesBatchability, newestSalesCategoryMonth, salesCategoryKind, SALES_CATEGORY_LABELS } from "../salesAllMeters/sales-batch-policy.js";
import { forgetSalesCategoryMonths, latestSalesCategoryMonth } from "../salesAllMeters/sales-category-month.js";

// Targeted Batch rules TB-R046 (1.3.28): only CAT meters are batched.
const entry = leakageCategory => ({ leakageCategory, riskTier: "High", riskScore: 9 });
const meter = (monthlyCategories = { "2026-08": entry("CAT4 - Long Gap (4+ months)") }, extra = {}) => ({ id: "00123", master: { id: "00123", visibility: "INVISIBLE" },
  meterNo: "00123", meterNoNormalized: "00123", lmPcode: "ZA5241", town: "Dundee", adr: { strNo: "01A", strName: "Smith", strType: "Street" }, tbRefs: [], hasUsableGps: false,
  monthlyCategories, ...extra });
const check = (row, categoryMonth) => evaluateSalesBatchability(row, { source: "PREPAID_SALES_NON_GPS", categoryMonth });

test("only CAT1–CAT8 meters can be batched; Normal and uncategorised meters never", () => {
  for (const label of SALES_CATEGORY_LABELS.filter(label => label.startsWith("CAT"))) assert.equal(check(meter({ "2026-08": entry(label) }), "2026-08").batchable, true, label);
  assert.deepEqual(check(meter({ "2026-08": entry("Normal - No Leakage Flag") }), "2026-08"), { batchable: false, code: "SALES_CATEGORY_NORMAL", reason: "Normal — only CAT meters are batched" });
  assert.deepEqual(check(meter({}), "2026-08"), { batchable: false, code: "SALES_CATEGORY_NONE", reason: "No category for 2026-08 — only CAT meters are batched" });
  assert.equal(check(meter({ "2026-08": entry("Some new label") }), "2026-08").code, "SALES_CATEGORY_NONE", "an unknown label is not a CAT");
  assert.equal(check(meter({ "2026-06": entry("CAT4 - Long Gap (4+ months)") }), "2026-08").code, "SALES_CATEGORY_NONE", "a meter missing from the LM's newest month has no category for batching");
  assert.equal(check(meter({ "2026-07": entry("CAT4 - Long Gap (4+ months)"), "2026-08": entry("Normal - No Leakage Flag") }), "2026-08").code, "SALES_CATEGORY_NORMAL", "the newest month decides");
  assert.equal(check(meter({ "2026-08": entry("CAT2 - Ghost Purchaser (1-3 mo)") }), null).code, "SALES_CATEGORY_NONE", "no category month for the LM: nothing is batchable");
});

test("data problems are still reported first; the category is the last check", () => {
  const normal = { "2026-08": entry("Normal - No Leakage Flag") };
  assert.equal(check(meter(normal, { lmPcode: "" }), "2026-08").code, "SALES_LM_INVALID");
  assert.equal(check(meter(normal, { targetedBatchId: "TGB_20260913_120000_AB12" }), "2026-08").code, "CURRENT_TARGETED_BATCH");
  assert.equal(check(meter(normal, { town: "" }), "2026-08").code, "PLANNING_ADDRESS_INVALID");
});

test("screens holding only a few meters fall back to each meter's newest month; the LM month comes from all meters", () => {
  assert.equal(check(meter({ "2026-06": entry("CAT4 - Long Gap (4+ months)") })).batchable, true, "no LM month given: the meter's own newest month");
  assert.equal(newestSalesCategoryMonth([meter({ "2026-06": entry("CAT4 - Long Gap (4+ months)") }), meter({ "2026-08": entry("Normal - No Leakage Flag") }), meter({})]), "2026-08");
  assert.equal(newestSalesCategoryMonth([meter({})]), null);
  assert.equal(newestSalesCategoryMonth([meter({ "2026-13": entry("CAT4 - Long Gap (4+ months)"), bad: entry("CAT4") })]), null, "only real months count");
  assert.deepEqual(salesCategoryKind(meter(), "2026-08"), { kind: "CAT", label: "CAT4 - Long Gap (4+ months)", month: "2026-08" });
  assert.deepEqual(salesCategoryKind(meter({ "2026-08": entry("Normal - No Leakage Flag") }), "2026-08").kind, "NORMAL");
  assert.deepEqual(salesCategoryKind(meter(), "2026-09"), { kind: "NONE", label: null, month: "2026-09" });
});

test("the server finds the LM's newest category month month by month, with two equality filters, and remembers it", async () => {
  forgetSalesCategoryMonths();
  const asked = [];
  const db = { projectId: "demo-category-month", collection: name => {
    assert.equal(name, "sales-all-meters");
    const filters = [];
    const query = { where: (field, op, value) => { filters.push([field, op, value]); return query; }, limit: n => { assert.equal(n, 1); return query; },
      get: async () => {
        assert.deepEqual(filters[0], ["lmPcode", "==", "ZA5241"]);
        assert.ok(filters[1][0] instanceof FieldPath); assert.equal(filters[1][1], "in"); assert.deepEqual(filters[1][2], [...SALES_CATEGORY_LABELS]);
        const month = String(filters[1][0]).match(/\d{4}-\d{2}/)[0]; asked.push(month);
        return { empty: month !== "2026-08" };
      } };
    return query;
  } };
  assert.equal(await latestSalesCategoryMonth(db, "ZA5241", { now: new Date("2026-10-05T08:00:00Z") }), "2026-08");
  assert.deepEqual(asked, ["2026-10", "2026-09", "2026-08"], "from this month back, stopping at the first month found");
  assert.equal(await latestSalesCategoryMonth(db, "ZA5241"), "2026-08"); assert.equal(asked.length, 3, "remembered");
  forgetSalesCategoryMonths(); asked.length = 0;
  const empty = { projectId: "demo-category-month", collection: () => ({ where() { return this; }, limit() { return this; }, get: async () => { asked.push(1); return { empty: true }; } }) };
  assert.equal(await latestSalesCategoryMonth(empty, "ZA9999", { now: new Date("2026-10-05T08:00:00Z") }), null);
  assert.equal(asked.length, 13, "a year back, then nothing");
  forgetSalesCategoryMonths();
});
