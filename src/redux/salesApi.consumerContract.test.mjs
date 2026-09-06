import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import * as categories from "../pages/sales/models/salesCategoryModel.js";
import * as months from "../pages/sales/models/salesMonthModel.js";
import * as refs from "../pages/sales/models/salesTbRefsIntegrityModel.js";

async function fixture() {
  const state = { uid: "A", governanceCalls: 0, listeners: [], raw: {}, args: [] };
  const context = createContext({ console: { info() {}, error() {} }, setTimeout, clearTimeout, Date, AbortController });
  const mocks = {
    "@reduxjs/toolkit/query/react": {
      fakeBaseQuery: () => () => {},
      createApi: config => ({ definitions: config.endpoints({ query: value => value }),
        useGetSalesByLmPcodeQuery: arg => { state.args.push(arg); return state.raw; },
        useGetSalesGovernanceQuery: () => { state.governanceCalls++; return { error: "governance rejected" }; },
      }),
    },
    "firebase/firestore": {
      collection: (_db, name) => name, query: (...parts) => parts, where: (...parts) => parts,
      onSnapshot: (query, rows, error) => {
        const listener = { query, rows, error, stopped: false };
        state.listeners.push(listener);
        return () => { listener.stopped = true; };
      },
    },
    "../firebase": { db: {}, functions: {} },
    "firebase/functions": { httpsCallable: () => async () => { state.governanceCalls++; throw Error("governance rejected"); } },
    react: { useMemo: fn => fn(), useSyncExternalStore: (_subscribe, get) => get() },
    "@reduxjs/toolkit/query": { skipToken: Symbol.for("skipToken") },
    "../auth/useAuth": { useAuth: () => ({ uid: state.uid }) },
    "../pages/sales/models/salesTbRefsIntegrityModel": refs,
    "../pages/sales/models/salesCategoryModel": categories,
    "../pages/sales/models/salesMonthModel.js": months,
  };
  const module = new SourceTextModule(await readFile(new URL("./salesApi.js", import.meta.url), "utf8"), { context });
  await module.link(name => {
    assert.ok(mocks[name], `Unexpected dependency ${name}`);
    const exports = mocks[name];
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const api = module.namespace;
  api.setSalesReadSession("A");
  const scope = lmPcode => ({ uid: state.uid, session: api.getSalesReadSession().generation, lmPcode });
  const snapshot = (id, lmPcode) => ({ metadata: { fromCache: false }, docs: [{ id, data: () => ({ lmPcode, monthlySalesC: {}, monthlyUnits: {}, monthlyCategories: {} }) }], docChanges: () => [] });
  return { api, state, scope, snapshot };
}

test("raw hook stays successful/loading/error solely according to raw reads while governance rejects", async () => {
  const { api, state } = await fixture();
  await api.salesApi.definitions.getSalesGovernance.queryFn({ lmPcode: "ZA5241" });
  state.governanceCalls = 0;
  for (const flags of [
    { isLoading: false, isFetching: false, isSuccess: true, status: "fulfilled" },
    { isLoading: true, isFetching: true, isSuccess: false, status: "pending" },
    { isLoading: false, isFetching: false, isSuccess: false, status: "rejected", error: { error: "raw denied" } },
  ]) {
    state.raw = { ...flags, currentData: { rows: [{ id: "1" }] } };
    const result = api.useGetSalesByLmPcodeQuery({ lmPcode: "ZA5241" });
    for (const key of ["isLoading", "isFetching", "isSuccess", "status", "error"]) assert.equal(result[key], flags[key]);
  }
  assert.equal(state.governanceCalls, 0);
  api.setSalesReadSession(null);
});

test("LM, UID and logout/login generation isolate listeners and suppress stale snapshots", async () => {
  const { api, state, scope, snapshot } = await fixture();
  const endpoint = api.salesApi.definitions.getSalesByLmPcode;
  const firstScope = scope("ZA5241");
  const first = endpoint.queryFn(firstScope, {});
  const other = endpoint.queryFn(scope("ZA9999"), {});
  state.listeners[0].rows(snapshot("A1", "ZA5241"));
  state.listeners[1].rows(snapshot("A2", "ZA9999"));
  assert.equal((await first).data.rows[0].id, "A1");
  assert.equal((await other).data.rows[0].id, "A2");
  api.setSalesReadSession(null);
  assert.ok(state.listeners.every(listener => listener.stopped));
  api.setSalesReadSession("A");
  assert.equal(api.isSalesReadScopeCurrent(firstScope), false);
  const renewed = endpoint.queryFn(scope("ZA5241"), {});
  state.listeners[0].rows(snapshot("STALE", "ZA5241"));
  state.listeners[2].rows(snapshot("FRESH", "ZA5241"));
  assert.equal((await renewed).data.rows[0].id, "FRESH");
  state.uid = "B";
  api.setSalesReadSession("B");
  assert.equal(api.isSalesReadScopeCurrent(firstScope), false);
  assert.equal(state.listeners[2].stopped, true);
  api.setSalesReadSession(null);
});

test("raw normalization preserves empty/sparse commercial maps and nested metadata; projection/refetch retains month", async () => {
  const { api, state } = await fixture();
  const row = api.normalizeSalesRow("0001", { monthlySalesC: {}, Sales: { "2026-06": 999 }, monthlyUnits: { "2026-07": 0 }, leakageCategory: "legacy", metadata: { createdAt: { seconds: 5, nanoseconds: 0 }, createdByUid: "A" } });
  assert.equal(JSON.stringify(row.monthlySalesC), "{}");
  assert.equal(JSON.stringify(row.monthlyUnits), '{"2026-07":0}');
  assert.equal(row.createdAtMs, 5000);
  assert.equal(row.leakageCategory, undefined);
  let refetchCount = 0;
  state.raw = { currentData: { rows: [row] }, refetch: () => ++refetchCount };
  const view = api.useGetSalesCategoryViewQuery({ lmPcode: "ZA5241", month: "2026-06" });
  view.refetch();
  assert.equal(refetchCount, 1);
  assert.equal(api.useGetSalesCategoryViewQuery({ lmPcode: "ZA5241", month: "2026-06" }).categoryMonth, "2026-06");
  assert.equal(state.governanceCalls, 0);
  api.setSalesReadSession(null);
});

test("a failed listener can be refetched and its stale callbacks cannot overwrite recovery", async () => {
  const { api, state, scope, snapshot } = await fixture();
  const endpoint = api.salesApi.definitions.getSalesByLmPcode;
  const first = endpoint.queryFn(scope("ZA5241"), {});
  state.listeners[0].error({ message: "temporarily unavailable" });
  assert.equal((await first).error.error, "temporarily unavailable");
  const second = endpoint.queryFn(scope("ZA5241"), {});
  assert.equal(state.listeners[0].stopped, true);
  state.listeners[0].rows(snapshot("STALE", "ZA5241"));
  state.listeners[1].rows(snapshot("RECOVERED", "ZA5241"));
  assert.equal((await second).data.rows[0].id, "RECOVERED");
  state.raw = { currentData: { rows: [{ id: "OLD_ACCOUNT" }] } };
  state.uid = "B";
  assert.equal(api.useGetSalesByLmPcodeQuery({ lmPcode: "ZA5241" }).data, undefined);
  api.setSalesReadSession(null);
});
