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

async function detailsFixture(query = { tbId: "TB", lmPcode: "ZA5241" }) {
  const listeners = [];
  const cleanups = new Set();
  let current = true;
  const context = createContext({ Date, console: { error() {}, warn() {} } });
  const mocks = {
    "@reduxjs/toolkit/query/react": {
      fakeBaseQuery: () => () => {},
      createApi: config => ({ definitions: config.endpoints({ query: value => value }) }),
    },
    "firebase/firestore": {
      collection: (_db, name) => name, doc: (_db, name, id) => [name, id],
      documentId: () => "documentId", where: (...parts) => parts, query: (...parts) => parts,
      onSnapshot: (path, next, error) => {
        const listener = { path, next, error, stopped: false };
        listeners.push(listener);
        return () => { listener.stopped = true; };
      },
    },
    "../firebase": { db: {} },
    react: { useMemo: fn => fn() },
    "@reduxjs/toolkit/query": { skipToken: Symbol() },
    "./salesApi": {
      useSalesReadScope: () => ({}), isSalesReadScopeCurrent: () => current,
      registerSalesSessionCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); },
    },
    "../pages/sales/models/salesCategoryModel": category,
    "../pages/sales/models/salesMonthModel.js": month,
    "../pages/sales/models/salesTargetedBatchReadModel": readModel,
  };
  const module = new SourceTextModule(await readFile(new URL("./salesTargetedBatchApi.js", import.meta.url), "utf8"), { context });
  await module.link(name => {
    assert.ok(mocks[name], name);
    const values = mocks[name];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const endpoint = module.namespace.salesTargetedBatchApi.definitions.getTargetedBatchDetailsById;
  const scope = { uid: "A", session: 1, query };
  const state = endpoint.queryFn(scope).data;
  let endCache;
  const lifetime = endpoint.onCacheEntryAdded(scope, {
    cacheDataLoaded: Promise.resolve(),
    cacheEntryRemoved: new Promise(resolve => { endCache = resolve; }),
    updateCachedData: update => update(state),
  });
  await new Promise(resolve => setImmediate(resolve));
  const emit = (listener, data, id = listener.path[1]) =>
    listener.next({ id, exists: () => data !== null, data: () => data });
  const parent = (extra = {}) => ({ id: "TB", scope: { lmPcode: "ZA5241" },
    metadata: { createdAt: { seconds: 1700000000 }, createdByUid: "U", createdByUser: "Creator" }, ...extra });
  return {
    listeners, state, emit, parent,
    async close() { endCache(); await lifetime; },
    async logout() { current = false; for (const cleanup of cleanups) cleanup(); await lifetime; },
  };
}

test("details stream reads only the parent and follows a nullable geofence live", async () => {
  const f = await detailsFixture();
  assert.equal(f.state.sync.status, "syncing");
  assert.equal(f.state.details, null);
  assert.equal(f.listeners.length, 1);
  f.emit(f.listeners[0], f.parent());
  assert.equal(f.state.sync.status, "ready");
  assert.equal(f.state.details.geofenceId, null);
  assert.equal(f.state.details.createdByUser, "Creator");
  assert.equal(f.state.details.createdAtMs, 1700000000000);
  f.emit(f.listeners[0], f.parent({ geofenceId: "G1" }));
  assert.equal(f.state.sync.sources.geofence, "syncing");
  assert.equal(f.listeners.length, 2);
  const old = f.listeners[1];
  f.emit(old, { parents: { lmPcode: "ZA5241" }, name: "First" });
  assert.equal(f.state.details.geofenceName, "First");
  f.emit(old, { parents: { lmPcode: "ZA5241" }, name: "Renamed" });
  assert.equal(f.state.details.geofenceName, "Renamed");
  f.emit(f.listeners[0], f.parent({ geofenceId: "G2" }));
  assert.equal(old.stopped, true);
  assert.equal(f.state.details.geofenceName, null);
  f.emit(old, { parents: { lmPcode: "ZA5241" }, name: "Stale" });
  assert.equal(f.state.details.geofenceName, null);
  f.emit(f.listeners[2], { parents: { lmPcode: "ZA5241" }, name: "Second" });
  assert.equal(f.state.details.geofenceName, "Second");
  f.emit(f.listeners[0], f.parent());
  assert.equal(f.listeners[2].stopped, true);
  assert.equal(f.state.details.geofenceId, null);
  assert.equal(f.state.sync.status, "ready");
  assert.ok(f.listeners.every(l => ["tb_uploads", "geo_fences"].includes(l.path[0])));
  await f.close();
  assert.ok(f.listeners.every(l => l.stopped));
});

test("details distinguish missing parent, parent error, and missing or denied geofence", async () => {
  const f = await detailsFixture();
  f.emit(f.listeners[0], null);
  assert.equal(f.state.details, null);
  assert.equal(f.state.sync.status, "ready");
  f.listeners[0].error({ code: "permission-denied" });
  assert.equal(f.state.sync.sources.batch, "error");
  f.emit(f.listeners[0], f.parent({ geofenceId: "G" }));
  const g = f.listeners[1];
  f.emit(g, null);
  assert.equal(f.state.sync.status, "ready");
  assert.equal(f.state.details.geofenceId, "G");
  assert.equal(f.state.details.geofenceName, null);
  g.error({ code: "permission-denied" });
  assert.equal(f.state.sync.sources.geofence, "error");
  assert.equal(f.state.details.id, "TB");
  f.emit(g, { parents: { lmPcode: "ZA5241" }, name: "Recovered" });
  assert.equal(f.state.sync.status, "ready");
  f.emit(f.listeners[0], null);
  assert.equal(g.stopped, true);
  assert.equal(f.state.details, null);
  await f.close();
});

test("details reject mismatched scope and malformed geofence relationships", async () => {
  const f = await detailsFixture();
  f.emit(f.listeners[0], f.parent({ scope: { lmPcode: "OTHER" } }));
  assert.equal(f.state.sync.sources.batch, "error");
  assert.equal(f.state.details, null);
  f.emit(f.listeners[0], f.parent({ id: "OTHER" }));
  assert.equal(f.state.details, null);
  f.emit(f.listeners[0], f.parent({ geofenceId: 42 }));
  assert.equal(f.state.sync.sources.geofence, "error");
  assert.equal(f.listeners.length, 1);
  f.emit(f.listeners[0], f.parent({ geofenceId: "G" }));
  f.emit(f.listeners[1], { parents: { lmPcode: "OTHER" }, name: "Must not leak" });
  assert.equal(f.state.details.geofenceName, null);
  assert.equal(f.state.sync.sources.geofence, "error");
  await f.close();
});

test("details reject path-invalid IDs and suppress callbacks after session disposal", async () => {
  const invalid = await detailsFixture({ tbId: "bad/id", lmPcode: "ZA5241" });
  assert.equal(invalid.listeners.length, 0);
  assert.equal(invalid.state.sync.sources.batch, "error");
  await invalid.close();
  const f = await detailsFixture();
  f.emit(f.listeners[0], f.parent({ geofenceId: "G" }));
  await f.logout();
  const before = JSON.stringify(f.state);
  f.emit(f.listeners[0], f.parent({ geofenceId: "NEW" }));
  f.listeners[1].error({ code: "late-error" });
  assert.equal(JSON.stringify(f.state), before);
  assert.equal(f.listeners.length, 2);
  assert.ok(f.listeners.every(l => l.stopped));
});
