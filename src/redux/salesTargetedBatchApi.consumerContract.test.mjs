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
    "../features/maps/sales-batch-nearby.js": nearbyModel,
    "../pages/operations/geofencePlanningModel.js": planningModel,
    "../../functions/salesAllMeters/sales-batch-policy.js": policy,
    "@reduxjs/toolkit/query/react": { fakeBaseQuery: () => () => {}, createApi: config => ({ definitions: config.endpoints({ query: value => value, mutation: value => value }) }) },
    "firebase/firestore": { collection: (_db, name) => name, doc: (_db, name, id) => [name, id], documentId: () => "documentId", limit: n => ["limit",n], where: (...parts) => parts, query: (...parts) => parts,
      getDocs: async () => ({ size: 0, docs: [] }), getDoc: async () => ({ exists: () => false, data: () => null }),
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

const FIXTURE_WARD = { parents: { localMunicipalityId: "ZA5241" }, geometry: { type: "Polygon", coordinates: [[[30, -29], [31, -29], [31, -28], [30, -28], [30, -29]]] } };
async function detailsFixture(query = { tbId: "TB", lmPcode: "ZA5241" }, callable = null, endpointName = "getTargetedBatchDetailsById", erfDocs = [], wardDoc = FIXTURE_WARD) {
  const listeners = [];
  const oneTimeReads = [];
  const cleanups = new Set();
  let current = true;
  const context = createContext({ Date, console: { error() {}, warn() {} } });
  const mocks = {
    "../features/maps/sales-batch-nearby.js": nearbyModel,
    "../pages/operations/geofencePlanningModel.js": planningModel,
    "firebase/functions": { httpsCallable: callable || (() => { throw Error("Read-only details must never call a mutation"); }) },
    "../../functions/salesAllMeters/sales-batch-policy.js": policy,
    "@reduxjs/toolkit/query/react": {
      fakeBaseQuery: () => () => {},
      createApi: config => ({ definitions: config.endpoints({ query: value => value, mutation: value => value }) }),
    },
    "firebase/firestore": {
      collection: (_db, name) => name, doc: (_db, name, id) => [name, id],
      documentId: () => "documentId", limit: n => ["limit",n], where: (...parts) => parts, query: (...parts) => parts,
      getDocs: async path => { oneTimeReads.push(path); return { size: erfDocs.length, docs: erfDocs.map((data, index) => ({ id: `E${index}`, data: () => data })) }; },
      getDoc: async path => { oneTimeReads.push(path); return { exists: () => wardDoc !== null, data: () => wardDoc }; },
      onSnapshot: (path, optionsOrNext, nextOrError, failure) => {
        const next = typeof optionsOrNext === "function" ? optionsOrNext : nextOrError;
        const error = typeof optionsOrNext === "function" ? nextOrError : failure;
        const listener = { path, next, error, stopped: false };
        listeners.push(listener);
        return () => { listener.stopped = true; };
      },
    },
    "../firebase": { db: {}, functions: {} },
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
  const endpoint = module.namespace.salesTargetedBatchApi.definitions[endpointName];
  const scope = { uid: "A", session: 1, query };
  const state = endpoint.queryFn(scope).data;
  let endCache;
  const lifetime = endpoint.onCacheEntryAdded(scope, {
    cacheDataLoaded: Promise.resolve(),
    cacheEntryRemoved: new Promise(resolve => { endCache = resolve; }),
    updateCachedData: update => { const replacement = update(state); if (replacement) Object.assign(state, replacement); },
  });
  await new Promise(resolve => setImmediate(resolve));
  const emit = (listener, data, id = listener.path[1]) =>
    listener.next({ id, exists: () => data !== null, data: () => data });
  const parent = (extra = {}) => ({ id: "TB", scope: { lmPcode: "ZA5241" },
    metadata: { createdAt: { seconds: 1700000000 }, createdByUid: "U", createdByUser: "Creator" }, ...extra });
  return {
    listeners, oneTimeReads, state, emit, parent, definitions: module.namespace.salesTargetedBatchApi.definitions,
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

test("a resolver rejected before server entry returns only a request error, never failed-lookup rows or writes", async () => {
  let rejection = { code: "functions/internal", message: "internal" }, calls = 0;
  const f = await detailsFixture(undefined, (_functions, name) => async () => {
    assert.equal(name, "resolveSalesTargetedBatchCallable"); calls++;
    if (rejection) throw rejection;
    return { data: { success: true, rows: [{ salesId: "00123", ready: true, code: "RESOLVED" }] } };
  });
  try {
    const input = { tbId: "TB", lmPcode: "ZA5241", source: "PREPAID_SALES_NON_GPS", salesIds: ["00123"] };
    const before = structuredClone(input), streamBefore = JSON.stringify(f.state);
    for (const code of ["internal", "not-found", "unavailable", "deadline-exceeded"]) {
      rejection = { code: `functions/${code}`, message: code };
      const result = await f.definitions.resolveSalesTargetedBatch.queryFn(input);
      assert.equal(result.error.code, rejection.code); assert.equal(result.error.uncertain, true);
      assert.equal(Object.hasOwn(result, "data"), false);
      assert.doesNotMatch(JSON.stringify(result), /erfLookup|NO_EXACT_POSITION|NO_ERF|MULTIPLE_ERFS/);
      assert.deepEqual(input, before); assert.equal(JSON.stringify(f.state), streamBefore);
    }
    rejection = null;
    const recovered = await f.definitions.resolveSalesTargetedBatch.queryFn(input);
    assert.equal(recovered.data.rows[0].code, "RESOLVED"); assert.equal(calls, 5);
  } finally { await f.close(); }
});

test("draft snapshot reads only retained authorities and the ordinary fence document ID, never whole-Ward layers",async()=>{
 const args={tbId:"TGB_20260913_120000_AB12",lmPcode:"ZA5241",salesIds:["00123"],erfIds:["ERF1"],wardIds:["ZA5241001"]};
 const initial=await detailsFixture(args,null,"getSalesBatchDraftSnapshot");
 assert.deepEqual(initial.listeners.map(l=>l.path),[["sales-all-meters","00123"],["ireps_erfs","ERF1"],["wards","ZA5241001"],["tb_uploads",args.tbId]]);
 await initial.close();assert.ok(initial.listeners.every(l=>l.stopped));
 const saved=await detailsFixture({...args,geofenceId:"ordinaryAutoId"},null,"getSalesBatchDraftSnapshot");
 assert.ok(saved.listeners.some(l=>l.path[0]==="geo_fences"&&l.path[1]==="ordinaryAutoId"));
 assert.ok(saved.listeners.every(l=>l.path.length===2));await saved.logout();assert.ok(saved.listeners.every(l=>l.stopped));
});
// Rules 18.7 (1.3.17): one read per layer; Sales and Assets through the nearby ERFs.
const nearbyArgs=layer=>({lmPcode:"ZA5241",wardPcode:"ZA5241001",bounds:{minLat:-28.5005,maxLat:-28.4995,minLng:30.4995,maxLng:30.5005},layer});
const nearbyErf=erfNo=>({admin:{localMunicipality:{pcode:"ZA5241"},ward:{pcode:"ZA5241001"}},centroid:{lat:-28.5,lng:30.5},sg:{erfNo},geometry:JSON.stringify({type:"Polygon",coordinates:[[[30.4999,-28.5001],[30.5001,-28.5001],[30.5001,-28.4999],[30.4999,-28.4999],[30.4999,-28.5001]]]})});
const hasPart=(path,part)=>path.some(item=>JSON.stringify(item)===JSON.stringify(part));
test("each nearby layer is its own read: opt-in, capped, explicit about completeness and errors, and ends with the account",async()=>{
 for(const bad of [{...nearbyArgs("premises"),bounds:null},nearbyArgs("unknown")]){const off=await detailsFixture(bad,null,"getSalesBatchNearbyLayer");assert.equal(off.listeners.length,0);assert.equal(off.oneTimeReads.length,0);await off.close();}
 const f=await detailsFixture(nearbyArgs("premises"),null,"getSalesBatchNearbyLayer");
 assert.deepEqual(f.oneTimeReads,[["wards","ZA5241001"]],"the layer reads its Ward itself, never waiting on the draft snapshot");
 assert.equal(f.listeners.length,1);const premise=f.listeners[0];assert.equal(premise.path[0],"premises");assert.ok(hasPart(premise.path,["limit",501]));
 const data={parents:{lmPcode:"ZA5241"},geometry:{centroid:{lat:-28.5,lng:30.5}}};
 const snapshot=n=>({size:n,docs:Array.from({length:n},(_,i)=>({id:`P${i}`,data:()=>data})),metadata:{fromCache:false,hasPendingWrites:false}});
 premise.next(snapshot(1));assert.equal(f.state.records.length,1);assert.equal(f.state.state,"Complete");
 premise.next(snapshot(501));assert.equal(f.state.records.length,500);assert.match(f.state.state,/Incomplete.*500/);
 const cached=snapshot(1);cached.metadata.fromCache=true;premise.next(cached);assert.match(f.state.state,/waiting for the server/);
 premise.error({code:"permission-denied"});assert.match(f.state.state,/Error:/);assert.equal(f.state.records.length,0);
 await f.logout();const before=JSON.stringify(f.state);premise.next(snapshot(2));assert.equal(JSON.stringify(f.state),before);assert.ok(f.listeners.every(l=>l.stopped));
 const erfs=await detailsFixture(nearbyArgs("erfs"),null,"getSalesBatchNearbyLayer");assert.equal(erfs.listeners.length,1);assert.equal(erfs.listeners[0].path[0],"ireps_erfs");await erfs.close();
 const foreign=await detailsFixture(nearbyArgs("erfs"),null,"getSalesBatchNearbyLayer",[],{...FIXTURE_WARD,parents:{localMunicipalityId:"ZA9999"}});
 assert.equal(foreign.listeners.length,0);assert.match(foreign.state.state,/Error: the Ward boundary/);await foreign.close();
});
test("nearby Sales: GPS Sales by nearby ERF numbers and batched Non-GPS Sales by nearby ERF IDs, never the whole LM",async()=>{
 const f=await detailsFixture(nearbyArgs("sales"),null,"getSalesBatchNearbyLayer",[nearbyErf("4230"),nearbyErf("4241"),nearbyErf("4230")]);
 assert.equal(f.oneTimeReads.length,2);assert.equal(f.oneTimeReads[1][0],"ireps_erfs");assert.ok(hasPart(f.oneTimeReads[1],["admin.ward.pcode","==","ZA5241001"]));
 assert.equal(f.listeners.length,2);const [gps,batched]=f.listeners;
 assert.equal(gps.path[0],"sales-all-meters");assert.ok(hasPart(gps.path,["lmPcode","==","ZA5241"]));assert.ok(hasPart(gps.path,["erfNumbers","array-contains-any",["4230","4241"]]));
 assert.equal(batched.path[0],"sales-all-meters");assert.ok(hasPart(batched.path,["erfId","in",["E0","E1","E2"]]));
 for(const listener of f.listeners)assert.ok(hasPart(listener.path,["limit",501]));
 const stamp={seconds:1789257600,nanoseconds:0},ok={fromCache:false,hasPendingWrites:false};
 const row=(id,lat)=>({id,data:()=>({lmPcode:"ZA5241",meterNo:id,hasUsableGps:true,erfCandidates:[{Latitude:lat,Longitude:30.5}]})});
 gps.next({size:2,docs:[row("NEAR",-28.5),row("FAR",-28.6)],metadata:ok});
 assert.deepEqual(f.state.records.map(record=>record.id),["NEAR"]);assert.match(f.state.state,/waiting for the server/,"not complete until every read has answered");
 const nonGps={lmPcode:"ZA5241",meterNo:"NONGPS",erfId:"E0",erfResolution:{version:1,revision:1,method:"GEOCODED",evidenceRefs:["ireps_erfs/E0"],confirmedByUid:"U1",confirmedByUser:"Planner",confirmedAt:stamp,tbId:"TGB_20260914_085124_F2MH",
  geocode:{latitude:-28.5,longitude:30.5,matchLevel:"EXACT_STREET_NUMBER",geocodedAddress:"1 Test, DUNDEE, KwaZulu-Natal, South Africa",provider:"Google Geocoding API",geocodedAt:stamp}}};
 batched.next({size:2,docs:[{id:"NONGPS",data:()=>nonGps},{id:"UNSAVED",data:()=>({...nonGps,meterNo:"UNSAVED",erfResolution:{geocode:{latitude:-28.5,longitude:30.5}}})}],metadata:ok});
 assert.deepEqual(f.state.records.map(record=>record.id).sort(),["NEAR","NONGPS"],"a partial saved position is not shown");assert.equal(f.state.state,"Complete");
 assert.match(f.state.records.find(record=>record.id==="NONGPS").candidates[0].positionNote,/saved with its batch/);
 await f.close();
 const none=await detailsFixture(nearbyArgs("sales"),null,"getSalesBatchNearbyLayer",[]);
 assert.equal(none.listeners.length,0);assert.equal(none.state.state,"Complete");assert.equal(none.state.records.length,0);await none.close();
});
test("nearby Assets are read through the nearby ERFs by ERF ID, never the whole Ward",async()=>{
 const f=await detailsFixture(nearbyArgs("assets"),null,"getSalesBatchNearbyLayer",[nearbyErf("4230"),nearbyErf("4241")]);
 assert.equal(f.listeners.length,1);const assets=f.listeners[0];
 assert.equal(assets.path[0],"asts");assert.ok(hasPart(assets.path,["accessData.erfId","in",["E0","E1"]]));
 assert.equal(assets.path.some(part=>JSON.stringify(part).includes("accessData.parents.wardPcode")),false);
 const asset=(id,lat)=>({id,data:()=>({accessData:{parents:{lmPcode:"ZA5241"},erfId:"E0"},ast:{astData:{astNo:id},location:{gps:{lat,lng:30.5}}}})});
 assets.next({size:2,docs:[asset("A1",-28.5),asset("A2",-28.6)],metadata:{fromCache:false,hasPendingWrites:false}});
 assert.deepEqual(f.state.records.map(record=>record.id),["A1"]);assert.equal(f.state.state,"Complete");await f.close();
});
