import { pointCoordinates, normalizeBatchGeometry, strictlyInside } from "../../../functions/geofences/sales-batch-geometry.js";
import { classifySalesWorkStatus, pipelineCandidates } from "../../../functions/salesAllMeters/sales-batch-policy.js";
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
  if (layer === "assets") return { collection: "asts", conditions: [["accessData.parents.wardPcode", "==", wardPcode]] };
  if (layer === "sales") throw new Error("Nearby Sales use nearbySalesQueryPlan (ERF numbers of the nearby ERFs)");
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
        if (strictlyInside(point, ward)) result.push({ id: row.id, erfNo: String(row.sg?.erfNo || "Unavailable"), point, paths: geoJsonGeometryToPlanningPaths(geometry), raw: row });
      } catch { invalid++; }
    } else if (layer === "sales") {
      const candidates = (pipelineCandidates(row) || []).flatMap((candidate, index) => {
        const point = mapPoint({ latitude: candidate.Latitude ?? candidate.latitude, longitude: candidate.Longitude ?? candidate.longitude });
        return insideArea(point) ? [{ key: `${row.id}:${index}`, point }] : [];
      });
      if (candidates.length) result.push({ id: row.id, meterNo: row.meterNo || row.id, status: classifySalesWorkStatus(row), integrityIssues: [], candidates, raw: row });
    } else {
      const point = mapPoint(layer === "premises" ? row.geometry?.centroid : row.ast?.location?.gps || row.location?.gps || row.gps);
      if (!point) { invalid++; continue; }
      if (insideArea(point)) result.push({ id: row.id, point, meterNo: row.ast?.astData?.astNo || row.meterNo || row.id, address: [row.address?.strNo,row.address?.strName,row.address?.strType].filter(Boolean).join(" "), raw: row });
    }
  }
  return { records: result, invalid };
}
