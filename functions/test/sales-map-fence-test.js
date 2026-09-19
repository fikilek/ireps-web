import test from "node:test";
import assert from "node:assert/strict";
import { polygonFromPoints } from "../geofences/sales-batch-geometry.js";
import { SALES_MAP_FENCE_LIMIT, findSalesMapFenceMeters, salesMapFenceErfId, salesMapFenceMeters, salesMapFenceProblem } from "../targetedBatches/sales-map-fence.js";
import { createSalesBatchGeofence } from "../targetedBatches/sales-batch-geofence.js";

// Targeted Batch rules TB-R055 (1.3.47): at most 30 meters that can be batched in a geofence drawn
// on the GPS Sales map; CAT, Not Started, not in a batch, ERF centroid strictly inside.
const LM = "ZA5241", WARD = "ZA5241006", OTHER_WARD = "ZA5241004";
const now = new Date(), MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const cat = { [MONTH]: { leakageCategory: "CAT4 - Long Gap (4+ months)" } };
const normal = { [MONTH]: { leakageCategory: "Normal - No Leakage Flag" } };
// A GPS meter at [lng, lat] on ERF `erfId` (pipeline candidate), batchable unless changed.
const gps = (id, erfId, [lng, lat] = [5, 5], extra = {}) => ({ id, master: { id, visibility: "INVISIBLE" }, meterNo: id, meterNoNormalized: id, lmPcode: LM, town: "Dundee",
  adr: { strNo: "1", strName: "Ayob" }, tbRefs: [], hasUsableGps: true, erfCandidates: [{ ErfId: erfId, Latitude: lat, Longitude: lng }], erfNumbers: [erfId.replace(/^E/, "")], monthlyCategories: cat, ...extra });
const erf = (id, [lng, lat], ward = WARD, erfNo = id.replace(/^E/, "")) => ({ admin: { ward: { pcode: ward }, localMunicipality: { pcode: LM } }, centroid: { latitude: lat, longitude: lng }, sg: { erfNo }, bbox: { minLat: lat - 0.5, maxLat: lat + 0.5, minLng: lng - 0.5, maxLng: lng + 0.5 } });
const fence = polygonFromPoints([[0, 0], [10, 0], [10, 10], [0, 10]]);

test("only meters that can be batched, with their ERF centroid strictly inside, count", () => {
  const erfs = new Map([["E1", erf("E1", [5, 5])], ["E2", erf("E2", [5, 5])], ["E3", erf("E3", [5, 5])], ["E4", erf("E4", [5, 5])], ["E5", erf("E5", [0, 5])],
    ["E6", erf("E6", [5, 5], OTHER_WARD)], ["E7", erf("E7", [20, 20])], ["E8", erf("E8", [5, 5])]]);
  // Sales IDs are capital letters and digits only; each other meter fails for the reason in its ID.
  const rows = [
    gps("A", "E1"),
    gps("COMPLETED", "E2", [5, 5], { master: { id: "COMPLETED", visibility: "VISIBLE" } }),
    gps("NORMAL", "E3", [5, 5], { monthlyCategories: normal }),
    gps("BATCHED", "E4", [5, 5], { targetedBatchId: "TGB_20260919_010000_AB12" }),
    gps("ONEDGE", "E5"),
    gps("OTHERWARD", "E6"),
    gps("PININSIDEERFOUTSIDE", "E7", [5, 5]),
    gps("NONGPS", "E8", [5, 5], { hasUsableGps: false, erfCandidates: [] }),
  ];
  assert.deepEqual(salesMapFenceMeters({ salesRows: rows, erfsById: erfs, geometry: fence, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH }), ["A"]);
  // Each excluded meter is batchable in itself when moved onto an ERF that is inside.
  for (const item of rows.slice(4, 7)) assert.deepEqual(salesMapFenceMeters({ salesRows: [{ ...item, erfCandidates: [{ ErfId: "E1", Latitude: 5, Longitude: 5 }] }], erfsById: erfs, geometry: fence, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH }), [item.id], item.id);
  assert.equal(salesMapFenceErfId(gps("A", "E1")), "E1");
  assert.equal(salesMapFenceErfId({ ...gps("A", "E1"), erfCandidates: [] }), null);
});

test("the three refusals: more than 30, none, and changed since counted", () => {
  const ids = count => Array.from({ length: count }, (_, index) => `M${String(index).padStart(3, "0")}`);
  assert.equal(SALES_MAP_FENCE_LIMIT, 30);
  assert.equal(salesMapFenceProblem({ insideIds: ids(31), sentIds: ids(30) }).code, "SALES_MAP_FENCE_TOO_MANY");
  assert.match(salesMapFenceProblem({ insideIds: ids(31), sentIds: ids(30) }).message, /holds 31 meters that can be batched\. The limit is 30/);
  assert.equal(salesMapFenceProblem({ insideIds: [], sentIds: [] }).code, "NO_READY_METERS");
  assert.equal(salesMapFenceProblem({ insideIds: ids(3), sentIds: ids(2) }).code, "SALES_MAP_FENCE_CHANGED");
  assert.equal(salesMapFenceProblem({ insideIds: ids(30), sentIds: [...ids(30)].reverse() }), null);
});

// A fake Firestore answering the three queries the server search makes.
function fakeDb({ erfs = {}, sales = [], categoryFound = true } = {}) {
  const queries = [];
  const docsOf = entries => entries.map(([id, data]) => ({ id, data: () => data }));
  const query = (collection, conditions = []) => ({
    where: (field, op, value) => query(collection, [...conditions, [String(field), op, value]]),
    limit: () => query(collection, conditions),
    get: async () => {
      queries.push({ collection, conditions });
      if (collection === "ireps_erfs") return { docs: docsOf(Object.entries(erfs)) };
      if (conditions.some(([field]) => field.includes("monthlyCategories"))) return { empty: !categoryFound, docs: [] };
      const byNumber = conditions.find(([field]) => field === "erfNumbers");
      if (byNumber) return { docs: docsOf(sales.filter(row => row.erfNumbers?.some(number => byNumber[2].includes(number))).map(row => [row.id, row])) };
      return { docs: [] };
    },
  });
  return { projectId: `fake-${Math.random()}`, queries, collection: name => query(name) };
}

test("the server search finds the Ward's ERFs inside, then their Sales; a repeated ERF number in another town is left out", async () => {
  const db = fakeDb({
    erfs: { E1: erf("E1", [5, 5]), E2: erf("E2", [5, 5]), E9: erf("E9", [20, 20]) },
    sales: [gps("A", "E1"), gps("B", "E2"), { ...gps("OTHERTOWN", "E77"), erfNumbers: ["1"] }],
  });
  const ids = await findSalesMapFenceMeters({ db, geometry: fence, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH });
  assert.deepEqual(ids, ["A", "B"]);
  const erfQuery = db.queries.find(query => query.collection === "ireps_erfs");
  assert.deepEqual(erfQuery.conditions.map(([field, op]) => `${field} ${op}`), ["admin.ward.pcode ==", "bbox.maxLat >=", "bbox.maxLng >=", "bbox.minLat <=", "bbox.minLng <="], "the nearby-ERF query and its index");
});

test("createGeoFence refuses a Sales-map geofence with 31 meters that can be batched, before anything is written", async () => {
  const erfs = {}, sales = [];
  for (let index = 0; index < 31; index += 1) { const id = `M${String(index).padStart(3, "0")}`, erfId = `E${100 + index}`; erfs[erfId] = erf(erfId, [5, 5]); sales.push(gps(id, erfId)); }
  const db = fakeDb({ erfs, sales });
  const intent = { tbId: "TGB_20260919_010000_AB12", lmPcode: LM, source: "PREPAID_SALES", geofenceId: null, salesIds: sales.slice(0, 30).map(row => row.id), resolutionProofs: {} };
  const request = { auth: { uid: "U1" }, data: { targetedBatch: intent, salesMapFence: true } };
  await assert.rejects(createSalesBatchGeofence({ db: { ...db, runTransaction: () => assert.fail("nothing may be written") }, request, codec: null, name: "Gf W6 Ayob", description: "NAv",
    parents: { lmPcode: LM, wardPcode: WARD }, rawPoints: [[0, 0], [10, 0], [10, 10], [0, 10]] }), { code: "SALES_MAP_FENCE_TOO_MANY" });
  await assert.rejects(createSalesBatchGeofence({ db: { ...db, runTransaction: () => assert.fail("nothing may be written") }, request: { ...request, data: { ...request.data, targetedBatch: { ...intent, source: "PREPAID_SALES_NON_GPS" } } }, codec: null,
    name: "Gf W6 Ayob", description: "NAv", parents: { lmPcode: LM, wardPcode: WARD }, rawPoints: [[0, 0], [10, 0], [10, 10], [0, 10]] }), { code: "SALES_MAP_FENCE_GPS_ONLY" });
});
