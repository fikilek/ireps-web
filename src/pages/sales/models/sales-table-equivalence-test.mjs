import * as policy from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import * as categories from "./salesCategoryModel.js";
import * as months from "./salesMonthModel.js";
import * as refs from "./salesTbRefsIntegrityModel.js";

import { buildSalesTableWorkStatusRows } from "./salesTableWorkStatusModel.js";
const corpus=JSON.parse(await readFile(new URL("../../../../scripts/tools/sales-work-status-audit/fixtures/classifier_parity.json",import.meta.url),"utf8"));
async function fixture() {
  const state = { uid: "A", governanceCalls: 0, listeners: [], raw: {}, args: [] };
  const context = createContext({ console: { info() {}, error() {} }, setTimeout, clearTimeout, Date, AbortController });
  const mocks = {
    "../../functions/salesAllMeters/sales-batch-policy.js": policy,
    "@reduxjs/toolkit/query/react": {
      fakeBaseQuery: () => () => {},
      createApi: config => ({ definitions: config.endpoints({ query: value => value, mutation: value => value }),
        useGetSalesByLmPcodeQuery: arg => { state.args.push(arg); return state.raw; },
        useGetSalesGovernanceQuery: () => { state.governanceCalls++; return { error: "governance rejected" }; },
      }),
    },
    "firebase/firestore": {
      collection: (_db, name) => name, query: (...parts) => parts, where: (...parts) => parts,
      onSnapshot: (query, ...handlers) => {
        const options = typeof handlers[0] === "function" ? null : handlers.shift();
        const [rows, error] = handlers;
        const listener = { query, options, rows, error, stopped: false };
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
  const module = new SourceTextModule(await readFile(new URL("../../../redux/salesApi.js", import.meta.url), "utf8"), { context });
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

for(const item of corpus.canonicalCases)test(`A14 raw/API/table canonical parity: ${item.name}`,async()=>{
  const {api}=await fixture();const before=JSON.stringify(item.data);
  const row=api.normalizeSalesRow("00123",item.data);
  assert.equal(policy.classifySalesWorkStatus(item.data),item.status);
  assert.equal(row.salesWorkStatus,item.status);
  assert.equal(buildSalesTableWorkStatusRows({salesRows:[row]})[0].salesWorkStatus,item.status);
  assert.equal(policy.resolveSalesTargetedBatchMembership(row).state,item.membership);
  assert.equal(JSON.stringify(item.data),before);api.setSalesReadSession(null);
});
