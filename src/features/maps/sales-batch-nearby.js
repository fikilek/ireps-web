import { pointCoordinates, normalizeBatchGeometry, strictlyInside } from "../../../functions/geofences/sales-batch-geometry.js";
import { classifySalesWorkStatus, pipelineCandidates, inspectSavedErfDecision } from "../../../functions/salesAllMeters/sales-batch-policy.js";
import { geoJsonGeometryToPlanningPaths, summarizeSalesPlanningRecords } from "../../pages/operations/geofencePlanningModel.js";

export const NEARBY_LIMIT = 500;
export const NEARBY_LAYERS = ["erfs", "sales", "premises", "assets"];
export const emptyNearbyModel = () => ({ erfs: [], premises: [], assets: [], salesRecords: [], salesSummary: summarizeSalesPlanningRecords([]) });
export function mapPoint(value) { try { const [lng, lat] = pointCoordinates(value); return { lat, lng }; } catch { return null; } }
export function locatedMeterBounds(rows) {
  const points = rows.map(row => mapPoint(row.point)).filter(Boolean);
  if (!points.length) return null;
  const minLat = Math.min(...points.map(p => p.lat)), maxLat = Math.max(...points.map(p => p.lat));
  const latMargin = 50 / 111320, lngMargin = latMargin / Math.max(0.01, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
  return { minLat: Math.max(-90, minLat - latMargin), maxLat: Math.min(90, maxLat + latMargin), minLng: Math.max(-180, Math.min(...points.map(p => p.lng)) - lngMargin), maxLng: Math.min(180, Math.max(...points.map(p => p.lng)) + lngMargin) };
}
export function nearbyQuerySpec(layer, { wardPcode, bounds }) {
  const overlap = [["bbox.maxLat", ">=", bounds.minLat], ["bbox.maxLng", ">=", bounds.minLng], ["bbox.minLat", "<=", bounds.maxLat], ["bbox.minLng", "<=", bounds.maxLng]];
  if (layer === "erfs") return { collection: "ireps_erfs", conditions: [["admin.ward.pcode", "==", wardPcode], ...overlap] };
  if (layer === "premises") return { collection: "premises", conditions: [["parents.wardPcode", "==", wardPcode], ["geometry.centroid.lat", ">=", bounds.minLat], ["geometry.centroid.lat", "<=", bounds.maxLat], ["geometry.centroid.lng", ">=", bounds.minLng], ["geometry.centroid.lng", "<=", bounds.maxLng]] };
  if (layer === "sales" || layer === "assets") throw new Error("Nearby Sales and Assets are read through the nearby ERFs (nearbyErfLinkedPlan)");
  throw new Error("Unknown nearby layer");
}
// Sales carry no Ward or searchable position, but GPS Sales list their pipeline ERF numbers in
// `erfNumbers` (same format as sg.erfNo). Ask only for Sales on the nearby ERFs, at most 30 values
// per query (Firestore array-contains-any limit); the area check in nearbyLayerRecords then keeps
// only points inside the nearby area and the Ward. ERF numbers repeat across towns; that check
// removes those.
export const SALES_ERF_CHUNK = 30;
export const MAX_SALES_ERF_CHUNKS = 10;
export function nearbySalesQueryPlan({ lmPcode, erfNumbers = [], erfCapped = false }) {
  const numbers = [...new Set(erfNumbers.map(value => String(value ?? "").trim()).filter(value => value && value !== "Unavailable"))].sort();
  const chunks = [];
  for (let index = 0; index < numbers.length; index += SALES_ERF_CHUNK) chunks.push(numbers.slice(index, index + SALES_ERF_CHUNK));
  return {
    specs: chunks.slice(0, MAX_SALES_ERF_CHUNKS).map(chunk => ({ collection: "sales-all-meters", conditions: [["lmPcode", "==", lmPcode], ["erfNumbers", "array-contains-any", chunk]] })),
    truncated: erfCapped || chunks.length > MAX_SALES_ERF_CHUNKS,
  };
}
// Rules 18.7 (1.3.17): Assets, and Non-GPS Sales with a saved ERF decision, are read through the
// nearby ERFs by ERF ID, 30 IDs per query (Firestore "in" limit), enough queries to cover every
// nearby ERF. The whole Ward is never read.
export const ERF_ID_CHUNK = 30;
export const MAX_ERF_ID_CHUNKS = Math.ceil(NEARBY_LIMIT / ERF_ID_CHUNK);
function erfIdChunks(erfIds) {
  const ids = [...new Set(erfIds.map(value => String(value ?? "").trim()).filter(Boolean))].sort(), chunks = [];
  for (let index = 0; index < ids.length; index += ERF_ID_CHUNK) chunks.push(ids.slice(index, index + ERF_ID_CHUNK));
  return chunks;
}
export function nearbyErfLinkedPlan(layer, { lmPcode, erfs = [], erfCapped = false }) {
  const chunks = erfIdChunks(erfs.map(erf => erf.id)), byId = chunks.slice(0, MAX_ERF_ID_CHUNKS), idsTruncated = chunks.length > MAX_ERF_ID_CHUNKS;
  if (layer === "assets") return { specs: byId.map(chunk => ({ collection: "asts", conditions: [["accessData.erfId", "in", chunk]] })), truncated: erfCapped || idsTruncated };
  if (layer === "sales") {
    const gps = nearbySalesQueryPlan({ lmPcode, erfNumbers: erfs.map(erf => erf.erfNo), erfCapped });
    return { specs: [...gps.specs, ...byId.map(chunk => ({ collection: "sales-all-meters", conditions: [["erfId", "in", chunk]] }))], truncated: gps.truncated || idsTruncated };
  }
  throw new Error("Only Sales and Assets are read through the nearby ERFs");
}
// One entry per layer (18.7, 1.3.17); the map and panel use them together.
export function combineNearbyLayers({ erfs, sales, premises, assets } = {}) {
  const salesRecords = sales?.records || [], assetRecords = assets?.records || [];
  return { ...emptyNearbyModel(), erfs: erfs?.records || [], premises: premises?.records || [], assets: assetRecords, generalAssets: assetRecords,
    salesRecords, salesSummary: summarizeSalesPlanningRecords(salesRecords) };
}
export const BATCH_POSITION_NOTE = "Position from address, saved with its batch";
export function nearbyLayerRecords(layer, documents, { lmPcode, wardPcode, bounds, wardGeometry }) {
  const result = []; let invalid = 0;
  const ward = normalizeBatchGeometry(wardGeometry);
  const insideArea = p => p && p.lat >= bounds.minLat && p.lat <= bounds.maxLat && p.lng >= bounds.minLng && p.lng <= bounds.maxLng && strictlyInside(p, ward);
  for (const row of documents) {
    const actualLm = layer === "erfs" ? row.admin?.localMunicipality?.pcode : layer === "sales" ? row.lmPcode : layer === "premises" ? row.parents?.lmPcode : row.accessData?.parents?.lmPcode;
    if (actualLm !== lmPcode) { invalid++; continue; }
    if (layer === "erfs") {
      const point = mapPoint(row.centroid);
      try {
        const geometry = normalizeBatchGeometry(row.geometry);
        if (!point || row.admin?.ward?.pcode !== wardPcode) { invalid++; continue; }
        // An ERF is kept on its centroid, in the area and the Ward, exactly as Sales, Premises and
        // Assets are (18.7, 1.3.49): a read asks for ERFs whose bbox overlaps the area, and a long
        // farm portion (or a bad imported bbox) overlaps an area it is nowhere near.
        if (insideArea(point)) result.push({ id: row.id, erfNo: String(row.sg?.erfNo || "Unavailable"), point, paths: geoJsonGeometryToPlanningPaths(geometry), raw: row });
      } catch { invalid++; }
    } else if (layer === "sales") {
      // Sales GPS points first; a Non-GPS meter with a saved ERF decision uses the position saved
      // with it (18.7, 1.3.17). Anything else has no position and is not shown.
      const observed = (pipelineCandidates(row) || []).map(candidate => mapPoint({ latitude: candidate.Latitude ?? candidate.latitude, longitude: candidate.Longitude ?? candidate.longitude })).filter(Boolean);
      const saved = observed.length ? null : inspectSavedErfDecision(row);
      const points = observed.length ? observed : saved?.established ? [mapPoint(saved.point)].filter(Boolean) : [];
      const candidates = points.flatMap((point, index) => insideArea(point) ? [{ key: `${row.id}:${index}`, point, ...(saved?.established ? { positionNote: BATCH_POSITION_NOTE } : {}) }] : []);
      if (candidates.length) result.push({ id: row.id, meterNo: row.meterNo || row.id, status: classifySalesWorkStatus(row), integrityIssues: [], candidates, raw: row });
    } else {
      const point = mapPoint(layer === "premises" ? row.geometry?.centroid : row.ast?.location?.gps || row.location?.gps || row.gps);
      if (!point) { invalid++; continue; }
      if (insideArea(point)) result.push({ id: row.id, point, meterNo: row.ast?.astData?.astNo || row.meterNo || row.id, address: [row.address?.strNo,row.address?.strName,row.address?.strType].filter(Boolean).join(" "), raw: row });
    }
  }
  return { records: result, invalid };
}
