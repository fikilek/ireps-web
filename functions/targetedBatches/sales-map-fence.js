// Targeted Batch rules TB-R055 (1.3.47): a batch geofence drawn on the GPS Sales map holds at most
// 30 meters that can be batched. The web map and createGeoFence count them with the same code:
// a GPS meter that can be batched (CAT, Not Started, not in a batch) whose ERF centroid is strictly
// inside the geofence (TB-R039). Plain module: no Firebase imports, shared with the web.
import { evaluateSalesBatchability, hasUsableSalesGps, inspectSavedErfDecision, singlePipelineErf } from "../salesAllMeters/sales-batch-policy.js";
import { batchGeometryBounds, strictlyInside } from "../geofences/sales-batch-geometry.js";

export const SALES_MAP_FENCE_LIMIT = 30;
const QUERY_CHUNK = 30;

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
    if (!salesId || !hasUsableSalesGps(row)) continue;
    if (!evaluateSalesBatchability(row, { salesId, lmPcode, source: "PREPAID_SALES", categoryMonth }).batchable) continue;
    const erf = erfsById.get(salesMapFenceErfId(row));
    if (!erf || erf.admin?.ward?.pcode !== wardPcode || erf.admin?.localMunicipality?.pcode !== lmPcode) continue;
    if (erfCentroidInside(erf, geometry)) ids.add(salesId);
  }
  return [...ids].sort();
}

const chunks = values => {
  const list = [...new Set(values)];
  return Array.from({ length: Math.ceil(list.length / QUERY_CHUNK) }, (_, index) => list.slice(index * QUERY_CHUNK, (index + 1) * QUERY_CHUNK));
};

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
  const collect = snapshot => { for (const doc of snapshot.docs) salesById.set(doc.id, { ...doc.data(), id: doc.id }); };
  const erfNumbers = [...erfsById.values()].map(erf => String(erf.sg?.erfNo ?? "").trim()).filter(Boolean);
  for (const chunk of chunks(erfNumbers)) collect(await db.collection("sales-all-meters").where("lmPcode", "==", lmPcode).where("erfNumbers", "array-contains-any", chunk).get());
  for (const chunk of chunks([...erfsById.keys()])) collect(await db.collection("sales-all-meters").where("erfId", "in", chunk).get());
  return salesMapFenceMeters({ salesRows: [...salesById.values()], erfsById, geometry, lmPcode, wardPcode, categoryMonth });
}

// createGeoFence refuses a Sales-map geofence with more than 30 meters that can be batched, with
// none, or whose meters differ from those counted on the map (something changed meanwhile).
export function salesMapFenceProblem({ insideIds = [], sentIds = [] }) {
  const inside = [...insideIds].sort(), sent = [...sentIds].sort();
  if (inside.length > SALES_MAP_FENCE_LIMIT) return { code: "SALES_MAP_FENCE_TOO_MANY", message: `This geofence holds ${inside.length} meters that can be batched. The limit is ${SALES_MAP_FENCE_LIMIT}. Draw a smaller geofence.` };
  if (!inside.length) return { code: "NO_READY_METERS", message: "This geofence holds no meter that can be batched." };
  if (inside.length !== sent.length || inside.some((id, index) => id !== sent[index])) return { code: "SALES_MAP_FENCE_CHANGED", message: `The meters that can be batched inside this geofence changed while it was drawn (now ${inside.length}). Check the count on the map and save again.` };
  return null;
}
