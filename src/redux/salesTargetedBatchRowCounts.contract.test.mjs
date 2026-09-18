// Targeted Batch rules TB-R054 (1.3.45): the Sales Reporting row counts stream.
import * as nearbyModel from "../features/maps/sales-batch-nearby.js";
import * as planningModel from "../pages/operations/geofencePlanningModel.js";
import * as policy from "../../functions/salesAllMeters/sales-batch-policy.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import * as category from "../pages/sales/models/salesCategoryModel.js";
import * as month from "../pages/sales/models/salesMonthModel.js";
import * as readModel from "../pages/sales/models/salesTargetedBatchReadModel.js";

async function loadRowCountsEndpoint() {
  const listeners = [];
  const cleanups = new Set();
  let removeEntry;
  const context = createContext({ console: { error() {}, warn() {} }, Date });
  const mocks = {
    "../features/maps/sales-batch-nearby.js": nearbyModel,
    "../pages/operations/geofencePlanningModel.js": planningModel,
    "../../functions/salesAllMeters/sales-batch-policy.js": policy,
    "@reduxjs/toolkit/query/react": { fakeBaseQuery: () => () => {}, createApi: config => ({ definitions: config.endpoints({ query: value => value, mutation: value => value }) }) },
    "firebase/firestore": { collection: (_db, name) => name, doc: (_db, name, id) => [name, id], documentId: () => "documentId", limit: n => ["limit", n], where: (...parts) => parts, query: (...parts) => parts,
      getDocs: async () => ({ size: 0, docs: [] }), getDoc: async () => ({ exists: () => false, data: () => null }),
      onSnapshot: (query, optionsOrNext, nextOrError, failure) => {
        const next = typeof optionsOrNext === "function" ? optionsOrNext : nextOrError;
        const error = typeof optionsOrNext === "function" ? nextOrError : failure;
        const listener = { query, options: typeof optionsOrNext === "function" ? null : optionsOrNext, next, error, stopped: false };
        listeners.push(listener);
        return () => { listener.stopped = true; };
      } },
    "../firebase": { db: {}, functions: {} },
    "firebase/functions": { httpsCallable: () => async () => { throw Error("Read-only counts must never call a function"); } },
    react: { useMemo: fn => fn() }, "@reduxjs/toolkit/query": { skipToken: Symbol() },
    "./salesApi": { useSalesReadScope: () => ({}), isSalesReadScopeCurrent: () => true, registerSalesSessionCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); } },
    "../pages/sales/models/salesCategoryModel": category,
    "../pages/sales/models/salesMonthModel.js": month,
    "../pages/sales/models/salesTargetedBatchReadModel": readModel,
  };
  const module = new SourceTextModule(await readFile(new URL("./salesTargetedBatchApi.js", import.meta.url), "utf8"), { context });
  await module.link(name => { assert.ok(mocks[name], name); const values = mocks[name]; return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
  await module.evaluate();
  const endpoint = module.namespace.salesTargetedBatchApi.definitions.getTargetedBatchRowCountsByLm;
  const scope = { uid: "A", session: 1, month: "2026-09", query: "ZA5241" };
  let state = endpoint.queryFn(scope).data;
  const lifetime = endpoint.onCacheEntryAdded(scope, {
    cacheDataLoaded: Promise.resolve(), cacheEntryRemoved: new Promise(resolve => { removeEntry = resolve; }),
    updateCachedData: update => { const draft = structuredClone(state); update(draft); state = draft; },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { listeners, cleanups, lifetime, removeEntry, state: () => state };
}

const row = (id, tbId, salesAllMeterId, status = "NOT_STARTED") => ({ id, data: () => ({ id, tbId, salesAllMeterId, schemaVersion: "0.3.0", scope: { lmPcode: "ZA5241" }, execution: { status } }) });
const sales = (id, visibility) => ({ id, data: () => ({ master: { visibility } }) });
const snap = (docs, fromCache = false) => ({ docs, metadata: { fromCache } });
const isSales = listener => JSON.stringify(listener.query).includes("sales-all-meters");
const salesListeners = listeners => listeners.filter(isSales);
const openSales = listeners => salesListeners(listeners).filter(listener => !listener.stopped);
const groupFor = (listeners, meter) => openSales(listeners).find(listener => JSON.stringify(listener.query).includes(`"${meter}"`));

const many = (tbId, prefix, count) => Array.from({ length: count }, (_, index) => {
  const meter = `${prefix}${String(index).padStart(2, "0")}`;
  return row(`R_${meter}`, tbId, meter);
});
const answer = (listener, visible = []) => listener.next(snap(JSON.parse(JSON.stringify(listener.query))
  .flat(Infinity).filter(value => typeof value === "string" && !["sales-all-meters", "documentId", "in"].includes(value))
  .map(id => sales(id, visible.includes(id) ? "VISIBLE" : "INVISIBLE"))));

test("counts wait for every Sales meter, then balance with VISIBLE as Completed", async () => {
  const { listeners, removeEntry, lifetime, state } = await loadRowCountsEndpoint();
  const rowsListener = listeners.find(listener => JSON.stringify(listener.query).includes("tb_rows"));
  assert.match(JSON.stringify(rowsListener.query), /scope\.lmPcode.*ZA5241/);
  assert.equal(rowsListener.options?.includeMetadataChanges, true);

  rowsListener.next(snap([...many("TB1", "A", 30), row("R3", "TB2", "M3", "IN_PROGRESS")]));
  assert.equal(state().sync.sources.rows, "ready");
  assert.equal(state().sync.sources.sales, "syncing");
  assert.equal(openSales(listeners).length, 2, "30 meters fill a group; the next batch starts another");

  answer(groupFor(listeners, "A00"), ["A00"]);
  assert.equal(state().sync.sources.sales, "syncing");
  assert.equal(Object.keys(state().countsByBatch).length, 0, "nothing is counted until every group has answered");

  answer(groupFor(listeners, "M3"));
  assert.equal(state().sync.status, "ready");
  assert.deepEqual(state().countsByBatch, {
    TB1: { total: 30, notStarted: 29, inProgress: 0, completed: 1 },
    TB2: { total: 1, notStarted: 0, inProgress: 1, completed: 0 },
  });

  removeEntry();
  await lifetime;
  assert.ok(listeners.every(listener => listener.stopped), "removing the cache entry stops every listener");
});

test("small batches share a group; creating or deleting a batch touches only its own group", async () => {
  const { listeners, cleanups, lifetime, state } = await loadRowCountsEndpoint();
  const rowsListener = listeners[0];
  const batchA = many("TB_A", "A", 30);
  const batchB = [row("RB1", "TB_B", "B1"), row("RB2", "TB_B", "B2")];
  const batchC = [row("RC1", "TB_C", "C1"), row("RC2", "TB_C", "C2"), row("RC3", "TB_C", "C3")];
  rowsListener.next(snap([...batchA, ...batchB, ...batchC]));
  assert.equal(openSales(listeners).length, 2);
  const groupA = groupFor(listeners, "A00");
  const groupBC = groupFor(listeners, "B1");
  assert.equal(groupFor(listeners, "C3"), groupBC, "TB_B and TB_C are packed together");
  answer(groupA);
  answer(groupBC, ["B1"]);
  assert.equal(state().sync.status, "ready");

  // Creating a batch opens one group for its own meters; the open groups stay open.
  rowsListener.next(snap([...batchA, ...batchB, ...batchC, row("RD1", "TB_D", "D1")]));
  assert.equal(groupA.stopped, false);
  assert.equal(groupBC.stopped, false);
  assert.equal(salesListeners(listeners).length, 3);
  assert.doesNotMatch(JSON.stringify(groupFor(listeners, "D1").query), /"A00"|"B1"/);
  assert.equal(state().sync.sources.sales, "syncing");
  answer(groupFor(listeners, "D1"));
  assert.equal(state().sync.status, "ready");

  // Deleting TB_B closes only the group it was in; TB_C's meters are read again on their own.
  rowsListener.next(snap([...batchA, ...batchC, row("RD1", "TB_D", "D1")]));
  assert.equal(groupA.stopped, false);
  assert.equal(groupBC.stopped, true);
  assert.equal(groupFor(listeners, "D1").stopped, false);
  const groupC = groupFor(listeners, "C1");
  assert.doesNotMatch(JSON.stringify(groupC.query), /"B1"|"A00"|"D1"/);
  assert.equal(state().sync.sources.sales, "syncing");
  answer(groupC);
  assert.equal(state().sync.status, "ready");
  assert.deepEqual(Object.keys(state().countsByBatch).sort(), ["TB_A", "TB_C", "TB_D"]);

  // A late answer from a closed group is ignored.
  answer(groupBC, ["B1", "C1"]);
  assert.equal(state().countsByBatch.TB_C.completed, 0);

  for (const cleanup of cleanups) cleanup();
  await lifetime;
});

test("snapshots from the browser's cache are not final", async () => {
  const { listeners, cleanups, lifetime, state } = await loadRowCountsEndpoint();
  const rowsListener = listeners[0];
  rowsListener.next(snap([row("R1", "TB1", "M1")], true));
  assert.equal(state().sync.sources.rows, "syncing");
  assert.equal(Object.keys(state().countsByBatch).length, 0);

  rowsListener.next(snap([row("R1", "TB1", "M1"), row("R2", "TB2", "M2")]));
  assert.equal(state().sync.sources.rows, "ready");
  // The group opened for the cached row stays; the new meter gets its own group.
  const groupM1 = groupFor(listeners, "M1");
  answer(groupFor(listeners, "M2"));
  groupM1.next(snap([sales("M1", "VISIBLE")], true));
  assert.equal(state().sync.sources.sales, "syncing");
  assert.equal(Object.keys(state().countsByBatch).length, 0);

  groupM1.next(snap([sales("M1", "VISIBLE")]));
  assert.equal(state().sync.status, "ready");
  assert.equal(state().countsByBatch.TB1.completed, 1);

  for (const cleanup of cleanups) cleanup();
  await lifetime;
});

test("Sales meters that cannot be read: their rows count by row status and are reported", async () => {
  const { listeners, cleanups, lifetime, state } = await loadRowCountsEndpoint();
  listeners[0].next(snap([row("R1", "TB1", "M1", "IN_PROGRESS"), row("R2", "TB2", "M2")]));
  groupFor(listeners, "M1").error({ code: "permission-denied", message: "denied" });
  assert.equal(state().sync.sources.sales, "error");
  assert.equal(state().salesUnreadRows, 2);
  assert.deepEqual(state().countsByBatch.TB1, { total: 1, notStarted: 0, inProgress: 1, completed: 0 });
  assert.deepEqual(state().countsByBatch.TB2, { total: 1, notStarted: 1, inProgress: 0, completed: 0 });
  for (const cleanup of cleanups) cleanup();
  await lifetime;
  assert.ok(listeners.every(listener => listener.stopped));
});

test("unreadable batch rows show no counts, also after they were read", async () => {
  const { listeners, cleanups, lifetime, state } = await loadRowCountsEndpoint();
  listeners[0].error({ code: "permission-denied", message: "denied" });
  assert.equal(state().sync.sources.rows, "error");
  assert.equal(state().sync.status, "error");
  assert.equal(state().sync.error.source, "rows");
  for (const cleanup of cleanups) cleanup();
  await lifetime;

  const second = await loadRowCountsEndpoint();
  second.listeners[0].next(snap([row("R1", "TB1", "M1")]));
  groupFor(second.listeners, "M1").next(snap([sales("M1", "INVISIBLE")]));
  assert.equal(second.state().sync.status, "ready");
  second.listeners[0].error({ code: "unavailable", message: "lost" });
  assert.equal(second.state().sync.sources.rows, "error");
  assert.equal(second.state().sync.status, "error");
  for (const cleanup of second.cleanups) cleanup();
  await second.lifetime;
});
