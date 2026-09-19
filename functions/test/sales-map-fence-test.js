import test from "node:test";
import assert from "node:assert/strict";
import { polygonFromPoints } from "../geofences/sales-batch-geometry.js";
import { SALES_MAP_FENCE_LIMIT, findSalesMapFenceMeters, salesMapFenceAddressReady, salesMapFenceErfId, salesMapFenceMeters, salesMapFenceProblem } from "../targetedBatches/sales-map-fence.js";
import { createSalesBatchGeofence } from "../targetedBatches/sales-batch-geofence.js";

// Targeted Batch rules TB-R055 (1.3.47): at most 30 meters that can be batched in a geofence drawn
// on the GPS Sales map; CAT, Not Started, not in a batch, with street address and town, ERF centroid
// strictly inside. Sales IDs are capital letters and digits only.
const LM = "ZA5241", WARD = "ZA5241006", OTHER_WARD = "ZA5241004";
const now = new Date(), MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const cat = { [MONTH]: { leakageCategory: "CAT4 - Long Gap (4+ months)" } };
const normal = { [MONTH]: { leakageCategory: "Normal - No Leakage Flag" } };
const stamp = { seconds: 1789257600, nanoseconds: 0 };
// A GPS meter at [lng, lat] on ERF `erfId` (pipeline candidate), batchable unless changed.
const gps = (id, erfId, [lng, lat] = [5, 5], extra = {}) => ({ id, master: { id, visibility: "INVISIBLE" }, meterNo: id, meterNoNormalized: id, lmPcode: LM, town: "Dundee",
  adr: { strNo: "1", strName: "Ayob" }, tbRefs: [], hasUsableGps: true, erfCandidates: [{ ErfId: erfId, Latitude: lat, Longitude: lng }], erfNumbers: [erfId.replace(/^E/, "")], monthlyCategories: cat, ...extra });
const erf = (id, [lng, lat], ward = WARD, erfNo = id.replace(/^E/, "")) => ({ admin: { ward: { pcode: ward }, localMunicipality: { pcode: LM } }, centroid: { latitude: lat, longitude: lng }, sg: { erfNo }, bbox: { minLat: lat - 0.5, maxLat: lat + 0.5, minLng: lng - 0.5, maxLng: lng + 0.5 } });
// A meter whose ERF was confirmed by an earlier batch (a saved ERF decision), found by `erfId`.
const decided = (id, erfId) => ({ ...gps(id, erfId), erfNumbers: [], erfId, erfResolution: { version: 1, revision: 1, method: "GEOCODED", evidenceRefs: [`ireps_erfs/${erfId}`],
  geocode: { latitude: 5, longitude: 5, matchLevel: "EXACT_STREET_NUMBER", geocodedAddress: "1 Ayob, Dundee", provider: "Google Geocoding API", geocodedAt: stamp },
  confirmedByUid: "U1", confirmedByUser: "Manager", confirmedAt: stamp, tbId: "TGB_20260901_010000_AB12" } });
const fence = polygonFromPoints([[0, 0], [10, 0], [10, 10], [0, 10]]);
const count = (rows, erfs) => salesMapFenceMeters({ salesRows: rows, erfsById: erfs, geometry: fence, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH });

test("only meters that can be batched, with their ERF centroid strictly inside, count", () => {
  const erfs = new Map([["E1", erf("E1", [5, 5])], ["E2", erf("E2", [5, 5])], ["E3", erf("E3", [5, 5])], ["E4", erf("E4", [5, 5])], ["E5", erf("E5", [0, 5])],
    ["E6", erf("E6", [5, 5], OTHER_WARD)], ["E7", erf("E7", [20, 20])], ["E8", erf("E8", [5, 5])], ["E9", erf("E9", [5, 5])]]);
  const rows = [
    gps("A", "E1"),
    gps("COMPLETED", "E2", [5, 5], { master: { id: "COMPLETED", visibility: "VISIBLE" } }),
    gps("NORMAL", "E3", [5, 5], { monthlyCategories: normal }),
    gps("BATCHED", "E4", [5, 5], { targetedBatchId: "TGB_20260919_010000_AB12" }),
    gps("ONEDGE", "E5"),
    gps("OTHERWARD", "E6"),
    gps("PININSIDEERFOUTSIDE", "E7", [5, 5]),
    gps("NONGPS", "E8", [5, 5], { hasUsableGps: false, erfCandidates: [] }),
    gps("NOADDRESS", "E9", [5, 5], { adr: { strNo: "-", strName: "" } }),
  ];
  assert.deepEqual(count(rows, erfs), ["A"]);
  // The ones left out for their ERF are batchable in themselves when moved onto an ERF inside.
  for (const item of rows.slice(4, 7)) assert.deepEqual(count([{ ...item, erfCandidates: [{ ErfId: "E1", Latitude: 5, Longitude: 5 }] }], erfs), [item.id], item.id);
  assert.equal(salesMapFenceAddressReady(rows[8]), false, "no street address: the resolver refuses it, so it is not counted");
  assert.equal(salesMapFenceAddressReady({ ...rows[0], town: " " }), false, "no town either");
  assert.equal(salesMapFenceErfId(gps("A", "E1")), "E1");
  assert.equal(salesMapFenceErfId({ ...gps("A", "E1"), erfCandidates: [] }), null);
  assert.equal(salesMapFenceErfId(decided("D", "E2")), "E2", "a saved ERF decision wins over the pipeline ERF");
});

test("the two refusals: more than 30, and none", () => {
  const ids = count => Array.from({ length: count }, (_, index) => `M${String(index).padStart(3, "0")}`);
  assert.equal(SALES_MAP_FENCE_LIMIT, 30);
  assert.equal(salesMapFenceProblem({ insideIds: ids(31) }).code, "SALES_MAP_FENCE_TOO_MANY");
  assert.match(salesMapFenceProblem({ insideIds: ids(31) }).message, /holds 31 meters that can be batched\. The limit is 30/);
  assert.equal(salesMapFenceProblem({ insideIds: [] }).code, "NO_READY_METERS");
  assert.equal(salesMapFenceProblem({ insideIds: ids(30) }), null);
});

// A fake Firestore that applies the Ward, box, ERF-number and ERF-ID conditions of the queries.
function fakeDb({ erfs = {}, sales = [], users = {} } = {}) {
  const queries = [];
  const docsOf = entries => entries.map(([id, data]) => ({ id, data: () => data }));
  const valueAt = (data, path) => path.split(".").reduce((value, key) => value?.[key], data);
  const matches = (data, [field, op, value]) => {
    const actual = valueAt(data, field);
    if (op === "==") return actual === value;
    if (op === ">=") return actual >= value;
    if (op === "<=") return actual <= value;
    if (op === "array-contains-any") return Array.isArray(actual) && actual.some(item => value.includes(item));
    if (op === "in") return value.includes(actual);
    return false;
  };
  const query = (collection, conditions = []) => ({
    where: (field, op, value) => query(collection, [...conditions, [String(field), op, value]]),
    limit: () => query(collection, conditions),
    get: async () => {
      queries.push({ collection, conditions });
      if (conditions.some(([field]) => field.includes("monthlyCategories"))) return { empty: false, docs: [] };
      const source = collection === "ireps_erfs" ? Object.entries(erfs) : sales.map(row => [row.id, row]);
      return { docs: docsOf(source.filter(([, data]) => conditions.every(condition => matches(data, condition)))) };
    },
  });
  const doc = path => ({ get: async () => { const [, id] = path.split("/"); return { exists: Boolean(users[id]), data: () => users[id] }; } });
  return { projectId: `fake-${Math.random()}`, queries, collection: name => query(name), doc };
}

test("the server search: the Ward's ERFs around the geofence, their Sales by ERF number and by saved ERF, a repeated number in another town left out", async () => {
  const db = fakeDb({
    erfs: { E1: erf("E1", [5, 5]), E2: erf("E2", [5, 5]), E3: erf("E3", [5, 5]), E9: erf("E9", [20, 20]), E10: erf("E10", [5, 5], OTHER_WARD) },
    sales: [gps("A", "E1"), gps("B", "E2"), decided("D", "E3"), { ...gps("OTHERTOWN", "E77"), erfNumbers: ["1"] }, gps("FAR", "E9"), gps("OTHERWARD", "E10")],
  });
  const ids = await findSalesMapFenceMeters({ db, geometry: fence, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH });
  assert.deepEqual(ids, ["A", "B", "D"]);
  const erfQuery = db.queries.find(query => query.collection === "ireps_erfs");
  assert.deepEqual(erfQuery.conditions.map(([field, op]) => `${field} ${op}`), ["admin.ward.pcode ==", "bbox.maxLat >=", "bbox.maxLng >=", "bbox.minLat <=", "bbox.minLng <="], "the nearby-ERF query and its index");
  assert.ok(db.queries.some(query => query.conditions.some(([field, op]) => field === "erfId" && op === "in")), "saved ERF decisions are looked up by ERF ID");
});

const planner = { employment: { role: "MNG" }, access: { activeWorkbase: LM, workbases: [LM] }, displayName: "Manager" };
const fieldWorker = { employment: { role: "FWR" }, access: { activeWorkbase: LM, workbases: [LM] }, displayName: "Worker" };
const save = (db, intent, uid = "U1") => createSalesBatchGeofence({ db: { ...db, runTransaction: () => assert.fail("nothing may be written") }, request: { auth: { uid }, data: { targetedBatch: intent, salesMapFence: true } },
  codec: null, name: "Gf W6 Ayob", description: "NAv", parents: { lmPcode: LM, wardPcode: WARD }, rawPoints: [[0, 0], [10, 0], [10, 10], [0, 10]] });

test("createGeoFence refuses a Sales-map geofence with 31 meters that can be batched, before anything is written", async () => {
  const erfs = {}, sales = [];
  for (let index = 0; index < 31; index += 1) { const id = `M${String(index).padStart(3, "0")}`, erfId = `E${100 + index}`; erfs[erfId] = erf(erfId, [5, 5]); sales.push(gps(id, erfId)); }
  const db = fakeDb({ erfs, sales, users: { U1: planner } });
  const intent = { tbId: "TGB_20260919_010000_AB12", lmPcode: LM, source: "PREPAID_SALES", geofenceId: null, salesIds: sales.slice(0, 30).map(row => row.id), resolutionProofs: {} };
  await assert.rejects(save(db, intent), { code: "SALES_MAP_FENCE_TOO_MANY" });
  await assert.rejects(save(db, { ...intent, source: "PREPAID_SALES_NON_GPS" }), { code: "SALES_MAP_FENCE_GPS_ONLY" });
});

test("someone who may not plan batches gets no count: refused before any ERF or Sales is read", async () => {
  const db = fakeDb({ erfs: { E1: erf("E1", [5, 5]) }, sales: [gps("A", "E1")], users: { U2: fieldWorker } });
  const intent = { tbId: "TGB_20260919_010000_AB12", lmPcode: LM, source: "PREPAID_SALES", geofenceId: null, salesIds: ["A"], resolutionProofs: {} };
  await assert.rejects(save(db, intent, "U2"), { code: "PERMISSION_DENIED" });
  assert.equal(db.queries.length, 0, "nothing was read for the count");
});
