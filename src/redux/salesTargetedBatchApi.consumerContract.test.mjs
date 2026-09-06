import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import * as category from "../pages/sales/models/salesCategoryModel.js";
import * as month from "../pages/sales/models/salesMonthModel.js";
import * as readModel from "../pages/sales/models/salesTargetedBatchReadModel.js";

test("joined category missing, joined document missing, and failed read remain distinct in both models", () => {
  const failed = { code: "permission-denied", message: "Sales read denied" };
  const cases = [
    [{ monthlyCategories: {} }, null, "category-unavailable", true],
    [undefined, null, "missing-document", false],
    [{ monthlyCategories: {} }, failed, "read-error", null],
  ];
  for (const [sales, error, status, exists] of cases) {
    const direct = readModel.getOperationalSalesCategory(sales, "2026-08", error);
    const stats = readModel.buildSalesOperationalStatsReadModel({
      rows: [{ id: "ROW", tbId: "TB", salesAllMeterId: "METER" }],
      salesById: sales ? { METER: sales } : {},
      salesReadErrors: error ? { METER: error } : {}, selectedMonth: "2026-08",
    }).rows[0].analytics;
    for (const result of [direct, stats.categoryState]) {
      assert.equal(result.status, status);
      assert.equal(result.documentExists, exists);
      assert.equal(result.categoryAvailable, false);
      assert.deepEqual([result.leakageCategory, result.riskTier, result.riskScore], [null, null, null]);
    }
    assert.equal(stats.category, null);
  }
  const valid = { monthlyCategories: { "2026-08": { leakageCategory: "Normal", riskTier: "Normal", riskScore: 0 } } };
  assert.equal(readModel.getOperationalSalesCategory(valid, "2026-08").riskScore, 0);
  assert.equal(readModel.getOperationalSalesCategory(valid, "2026-07").categoryAvailable, false);
  assert.equal(readModel.getOperationalSalesCategory(valid, "2026-08", failed).status, "read-error");
});

test("all three operational Sales join endpoints run synchronously with zero governance calls and dispose with session", async () => {
  const listeners = [];
  let governanceCalls = 0;
  let current = true;
  const cleanups = new Set();
  const context = createContext({ console: { error() {}, warn() {} }, Date });
  const mocks = {
    "@reduxjs/toolkit/query/react": { fakeBaseQuery: () => () => {}, createApi: config => ({ definitions: config.endpoints({ query: value => value }) }) },
    "firebase/firestore": { collection: (_db, name) => name, doc: (_db, name, id) => [name, id], documentId: () => "documentId", where: (...parts) => parts, query: (...parts) => parts,
      onSnapshot: (query, next, error) => { const listener = { query, next, error, stopped: false }; listeners.push(listener); return () => { listener.stopped = true; }; } },
    "../firebase": { db: {}, functions: {} },
    "firebase/functions": { httpsCallable: () => async () => { governanceCalls++; throw Error("governance rejected"); } },
    react: { useMemo: fn => fn() }, "@reduxjs/toolkit/query": { skipToken: Symbol() },
    "./salesApi": { useSalesReadScope: () => ({}), isSalesReadScopeCurrent: () => current, registerSalesSessionCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); } },
    "../pages/sales/models/salesCategoryModel": category,
    "../pages/sales/models/salesMonthModel.js": month,
    "../pages/sales/models/salesTargetedBatchReadModel": readModel,
  };
  const module = new SourceTextModule(await readFile(new URL("./salesTargetedBatchApi.js", import.meta.url), "utf8"), { context });
  await module.link(name => { assert.ok(mocks[name], name); const values = mocks[name]; return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
  await module.evaluate();
  const { projectSalesMapForMonth, salesTargetedBatchApi } = module.namespace;
  const projected = projectSalesMapForMonth({ ONE: { monthlyCategories: { "2026-08": { leakageCategory: "CAT1", riskTier: "High", riskScore: 1 } } }, TWO: { leakageCategory: "legacy" } }, "2026-08");
  assert.equal(projected.then, undefined);
  assert.equal(projected.ONE.categoryAvailable, true);
  assert.equal(projected.TWO.leakageCategory, null);
  const lifetimes = [];
  const results = [];
  for (const [endpointName, query] of [["getTargetedBatchDashboard", { lmPcode: "ZA5241" }], ["getTargetedBatchReportById", "TB"], ["getSalesOperationalStatsByLm", "ZA5241"]]) {
    const endpoint = salesTargetedBatchApi.definitions[endpointName];
    const scope = { uid: "A", session: 1, month: "2026-08", query };
    const state = endpoint.queryFn(scope).data;
    results.push(state);
    lifetimes.push(endpoint.onCacheEntryAdded(scope, { cacheDataLoaded: Promise.resolve(), cacheEntryRemoved: new Promise(() => {}), updateCachedData: update => update(state) }));
  }
  await new Promise(resolve => setImmediate(resolve));
  for (const listener of [...listeners]) {
    const text = JSON.stringify(listener.query);
    if (text.includes('tb_rows')) listener.next({ docs: [{ id: "ROW", data: () => ({ tbId: "TB", salesAllMeterId: "METER" }) }] });
  }
  const salesListeners = listeners.filter(listener => JSON.stringify(listener.query).includes('sales-all-meters'));
  assert.equal(salesListeners.length, 3);
  for (const listener of salesListeners) {
    listener.next({ docs: [{ id: "METER", data: () => ({ lmPcode: "ZA5241", monthlyCategories: {} }) }] });
    listener.error({ code: "permission-denied", message: "denied" });
  }
  assert.equal(results[2].rows[0].analytics.categoryState.status, "read-error");
  assert.equal(governanceCalls, 0);
  current = false;
  for (const cleanup of cleanups) cleanup();
  await Promise.all(lifetimes);
  assert.ok(listeners.every(listener => listener.stopped));
});
