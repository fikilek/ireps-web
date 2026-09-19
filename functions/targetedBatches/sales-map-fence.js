// Targeted Batch rules TB-R055 (1.3.47): a batch geofence drawn on the GPS Sales map holds at most
// 30 meters that can be batched. The web map and createGeoFence count them with the same code:
// a GPS meter that can be batched (CAT, Not Started, not in a batch) with the street address and
// town the field needs, whose ERF centroid is strictly inside the geofence (TB-R039).
// Plain module: no Firebase imports, shared with the web.
import { evaluateSalesBatchability, hasUsableSalesGps, inspectSavedErfDecision, nonblank, salesStreetAddress, singlePipelineErf } from "../salesAllMeters/sales-batch-policy.js";
import { batchGeometryBounds, strictlyInside } from "../geofences/sales-batch-geometry.js";

export const SALES_MAP_FENCE_LIMIT = 30;
const QUERY_CHUNK = 30;
const QUERIES_AT_ONCE = 10;

// The resolver refuses a meter without a street address or town (resolveSalesBatch), so such a
// meter never goes into a batch and is not counted as one that can be batched.
export function salesMapFenceAddressReady(row = {}) {
  return nonblank(salesStreetAddress(row)) && nonblank(row.town);
}

// The ERF a GPS meter is batched on: its saved ERF decision, else its one pipeline ERF,
// exactly as the resolver chooses it (resolveSalesBatch).
export function salesMapFenceErfId(sales = {}) {
  const saved = inspectSavedErfDecision(sales);
  if (saved.established) return saved.erfId;
  const pipeline = singlePipelineErf(sales);
  return pipeline.ok ? pipeline.erfId : null;
}

export function erfCentroidInside(erf, geometry) {
  try { return strictlyInside(erf?.centroid, geometry); }
  catch { return false; } // An ERF without a usable centroid cannot hold a batch meter.
}

// The meters that can be batched inside the geofence, sorted by Sales ID.
export function salesMapFenceMeters({ salesRows = [], erfsById = new Map(), geometry, lmPcode, wardPcode, categoryMonth }) {
  const ids = new Set();
  for (const row of salesRows) {
    const salesId = row?.id;
    if (!salesId || !hasUsableSalesGps(row) || !salesMapFenceAddressReady(row)) continue;
    if (!evaluateSalesBatchability(row, { salesId, lmPcode, source: "PREPAID_SALES", categoryMonth }).batchable) continue;
    const erf = erfsById.get(salesMapFenceErfId(row));
    if (!erf || erf.admin?.ward?.pcode !== wardPcode || erf.admin?.localMunicipality?.pcode !== lmPcode) continue;
    if (erfCentroidInside(erf, geometry)) ids.add(salesId);
  }
  return [...ids].sort();
}

export const chunks = (values, size = QUERY_CHUNK) => {
  const list = [...new Set(values)];
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
};
// Runs `run` over the items a few at a time: fast for a large area, without a burst of reads.
export async function inGroups(items, run, atOnce = QUERIES_AT_ONCE) {
  const results = [];
  for (const group of chunks(items.map((_, index) => index), atOnce)) results.push(...await Promise.all(group.map(index => run(items[index]))));
  return results;
}

// Server search: the Ward's ERFs around the geofence (the nearby-ERF query TB Draft uses), those
// whose centroid is inside, then the Sales on them (GPS Sales list their pipeline ERF numbers in
// `erfNumbers`; a saved ERF decision carries `erfId`). ERF numbers repeat across towns; matching
// on the ERF ID afterwards removes those.
export async function findSalesMapFenceMeters({ db, geometry, lmPcode, wardPcode, categoryMonth }) {
  const bounds = batchGeometryBounds(geometry);
  const erfSnapshot = await db.collection("ireps_erfs").where("admin.ward.pcode", "==", wardPcode)
    .where("bbox.maxLat", ">=", bounds.minLat).where("bbox.maxLng", ">=", bounds.minLng)
    .where("bbox.minLat", "<=", bounds.maxLat).where("bbox.minLng", "<=", bounds.maxLng).get();
  const erfsById = new Map();
  for (const doc of erfSnapshot.docs) {
    const erf = doc.data();
    if (erf.admin?.localMunicipality?.pcode === lmPcode && erfCentroidInside(erf, geometry)) erfsById.set(doc.id, erf);
  }
  if (!erfsById.size) return [];
  const salesById = new Map();
  const erfNumbers = [...erfsById.values()].map(erf => String(erf.sg?.erfNo ?? "").trim()).filter(Boolean);
  const queries = [
    ...chunks(erfNumbers).map(chunk => db.collection("sales-all-meters").where("lmPcode", "==", lmPcode).where("erfNumbers", "array-contains-any", chunk)),
    ...chunks([...erfsById.keys()]).map(chunk => db.collection("sales-all-meters").where("erfId", "in", chunk)),
  ];
  for (const snapshot of await inGroups(queries, found => found.get())) for (const doc of snapshot.docs) salesById.set(doc.id, { ...doc.data(), id: doc.id });
  return salesMapFenceMeters({ salesRows: [...salesById.values()], erfsById, geometry, lmPcode, wardPcode, categoryMonth });
}

// createGeoFence refuses a Sales-map geofence with more than 30 meters that can be batched, or with
// none. Which of them are saved is decided as for every batch geofence: the located meters whose ERF
// centroid is inside; the web names any it counted that were left out.
export function salesMapFenceProblem({ insideIds = [] }) {
  if (insideIds.length > SALES_MAP_FENCE_LIMIT) return { code: "SALES_MAP_FENCE_TOO_MANY", message: `This geofence holds ${insideIds.length} meters that can be batched. The limit is ${SALES_MAP_FENCE_LIMIT}. Draw a smaller geofence.` };
  if (!insideIds.length) return { code: "NO_READY_METERS", message: "This geofence holds no meter that can be batched." };
  return null;
}
