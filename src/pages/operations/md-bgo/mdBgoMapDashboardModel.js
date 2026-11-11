import { buildMdBgoDashboard } from "./mdBgoDashboardModel.js";
import { getMdBgoBatchStatus, getMdBgoRowStatusCounts, isBmdBatch } from "./mdBgoRegisterModel.js";
import { getGeoFencePath, parseGeometry, pointInPaths, toUsableLatLng } from "../geofence-map-helpers.js";

const text = value => String(value ?? "").trim();
const validId = value => text(value) && text(value).toUpperCase() !== "NAV" ? text(value) : "";
const rowErf = row => validId(row.erf?.id || row.refs?.erfId || row.erfId);
const batchId = row => row.bgoBatchId || row.batchId;
const distinct = values => new Set(values.map(validId).filter(Boolean));
export function normalizeMapDashboardErf(id, data) {
  return { id, wardPcode: data.admin?.ward?.pcode || "", centroid: toUsableLatLng(data.centroid) };
}

export function mapDashboardGeometry(value) {
  const parsed = parseGeometry(value);
  const geometry = parsed?.type === "Feature" ? parsed.geometry : parsed;
  return ["Polygon", "MultiPolygon"].includes(geometry?.type) ? geometry : null;
}

function geometryPaths(geometry) {
  if (!geometry) return [];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap(polygon => polygon.map(ring => ring.map(([lng, lat]) => ({ lat, lng }))));
}

// Same centroid membership as planning, with deterministic inclusion of edge points.
export function mapDashboardContains(point, paths) {
  if (!point || !paths.length) return false;
  for (const ring of paths) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng);
    if (Math.abs(cross) < 1e-10 && point.lat >= Math.min(a.lat, b.lat) - 1e-10 && point.lat <= Math.max(a.lat, b.lat) + 1e-10 && point.lng >= Math.min(a.lng, b.lng) - 1e-10 && point.lng <= Math.max(a.lng, b.lng) + 1e-10) return true;
  }
  return pointInPaths(point, paths);
}

function allocation(batch) {
  const target = batch.target || batch.assignment?.target || batch.assignment?.targets?.[0] || {};
  return { id: validId(target.id || batch.targetId || batch.bgo?.targetId), type: text(target.type || batch.targetType || batch.bgo?.targetType).toUpperCase(), name: validId(target.name || batch.targetName || batch.bgo?.targetName) || "NAv" };
}

function areaSummary({ rows, batches, erfs, total, coverageError = "", globalErfs }) {
  const byBatch = getMdBgoRowStatusCounts(rows);
  const counts = [...byBatch.values()].reduce((sum, current) => ({ total: sum.total + current.total, inProgress: sum.inProgress + current.inProgress, completed: sum.completed + current.completed }), { total: 0, inProgress: 0, completed: 0 });
  const batched = [...erfs].filter(id => globalErfs.has(id)).length;
  if (total != null && batched > total) coverageError = "Batched ERFs exceed the authoritative ERF total. Coverage needs reconciliation.";
  const targets = [...new Map(batches.map(allocation).filter(target => target.id).map(target => [`${target.type}:${target.id}`, target])).values()];
  const statuses = {};
  const related = batches.map(batch => {
    const status = getMdBgoBatchStatus({ ...batch, workflowState: batch.workflow?.state || batch.workflowState });
    statuses[status] = (statuses[status] || 0) + 1;
    return { id: batch.id, name: batch.geofenceRef?.name || batch.bgo?.geofenceName || batch.id, status, wardPcode: batch.scope?.wardPcode || "" };
  });
  return { ...counts, notStarted: counts.total - counts.inProgress - counts.completed, completion: counts.total ? 100 * counts.completed / counts.total : 0,
    erfs: total, batched, unbatched: coverageError || total == null ? null : total - batched, coverage: coverageError || total == null ? null : total ? 100 * batched / total : 0, coverageError,
    premises: distinct(rows.map(row => row.refs?.premiseId || row.premise?.id)).size, meters: distinct(rows.map(row => row.refs?.meterId || row.meter?.id)).size,
    statuses, related, batchCount: batches.length, targets, teams: targets.filter(target => target.type === "TEAM").length, sps: targets.filter(target => target.type === "SP").length };
}

export function buildMdBgoMapDashboard(source) {
  const batches = [...new Map(source.batches.filter(batch => isBmdBatch(batch) && (batch.workflow?.state || batch.workflowState) !== "CANCELLED").map(batch => [batch.id, batch])).values()];
  const batchById = new Map(batches.map(batch => [batch.id, batch]));
  const rows = [...new Map(source.rows.filter(row => batchById.has(batchId(row)) && row.workflow?.state !== "CANCELLED").map(row => [row.id, row])).values()];
  const erfById = new Map(source.erfs.map(erf => [erf.id, erf]));
  const membersByBatch = new Map(batches.map(batch => [batch.id, distinct((batch.worklist?.erfRefs || []).map(ref => typeof ref === "string" ? ref : ref.id || ref.erfId))]));
  rows.forEach(row => { const id = rowErf(row); if (id) membersByBatch.get(batchId(row)).add(id); });
  const globalErfs = new Set([...membersByBatch.values()].flatMap(ids => [...ids]));
  const global = buildMdBgoDashboard(source);
  const makeSummary = (areaErfs, areaRows, linked, total, coverageError) => areaSummary({ erfs: areaErfs, rows: areaRows, batches: linked, total, coverageError, globalErfs });
  const lm = { key: `lm:${source.lm.id}`, id: source.lm.id, kind: "lm", name: source.lm.name || source.lm.id, geometry: mapDashboardGeometry(source.lm.geometry), summary: makeSummary(globalErfs, rows, batches, global.coverage.total, global.coverage.error) };
  const wards = source.wards.map(ward => {
    const code = ward.pcode || ward.id;
    const areaErfs = new Set(source.erfs.filter(erf => erf.wardPcode === code).map(erf => erf.id));
    // Preserve canonical ward scope for batch references absent from cadastral data.
    batches.filter(batch => batch.scope?.wardPcode === code).forEach(batch => membersByBatch.get(batch.id).forEach(id => { if (!erfById.has(id)) areaErfs.add(id); }));
    const areaRows = rows.filter(row => areaErfs.has(rowErf(row)) || (!erfById.has(rowErf(row)) && (row.scope?.wardPcode || batchById.get(batchId(row))?.scope?.wardPcode) === code));
    const relatedIds = new Set(areaRows.map(batchId));
    const linked = batches.filter(batch => batch.scope?.wardPcode === code || relatedIds.has(batch.id) || [...membersByBatch.get(batch.id)].some(id => areaErfs.has(id)));
    const summary = source.summaries.find(summary => summary.ward?.pcode === code);
    const total = summary?.calculation?.state === "READY" && Number.isInteger(summary?.counts?.totalErfs) && summary.counts.totalErfs >= 0 ? summary.counts.totalErfs : null;
    return { key: `ward:${code}`, id: code, kind: "wards", name: `Ward ${ward.code || Number(code.slice(-3))}`, geometry: mapDashboardGeometry(ward.geometry), summary: makeSummary(areaErfs, areaRows, linked, total, total == null ? "This ward's authoritative ERF total is not ready." : "") };
  });
  const missingLocations = source.erfs.filter(erf => !erf.centroid).length;
  const fences = source.geofences.filter(fence => fence.status === "ACTIVE").map(fence => {
    const path = getGeoFencePath(fence);
    const geometry = path.length >= 3 ? { type: "Polygon", coordinates: [[...path.map(point => [point.lng, point.lat]), [path[0].lng, path[0].lat]]] } : null;
    const paths = geometryPaths(geometry);
    const areaErfs = new Set(source.erfs.filter(erf => mapDashboardContains(erf.centroid, paths)).map(erf => erf.id));
    const explicit = batches.filter(batch => (batch.geofenceRef?.id || batch.bgo?.geofenceId) === fence.id);
    const explicitIds = new Set(explicit.map(batch => batch.id));
    const areaRows = rows.filter(row => areaErfs.has(rowErf(row)) || (!erfById.get(rowErf(row))?.centroid && explicitIds.has(batchId(row))));
    const relatedIds = new Set(areaRows.map(batchId));
    const linked = batches.filter(batch => explicitIds.has(batch.id) || relatedIds.has(batch.id) || [...membersByBatch.get(batch.id)].some(id => areaErfs.has(id)));
    const coverageError = !geometry ? "This geofence has no valid boundary." : missingLocations ? `${missingLocations} municipal ERFs lack usable locations; geofence coverage is incomplete.` : "";
    return { key: `geofence:${fence.id}`, id: fence.id, kind: "geofences", name: fence.name || fence.id, wardPcode: fence.parents?.wardPcode || "", geometry, summary: makeSummary(areaErfs, areaRows, linked, coverageError ? null : areaErfs.size, coverageError) };
  });
  const missingBoundaries = [lm, ...wards, ...fences].filter(area => !area.geometry).length;
  return { lm, wards, fences, areas: [lm, ...wards, ...fences], diagnostics: { missingLocations, missingBoundaries, erfCount: source.erfs.length } };
}

export function mdMapAreaColour(area, metric) {
  const value = metric === "completion" ? area.summary.completion : area.summary.coverage;
  return value == null ? "#94a3b8" : value === 0 ? "#e3e8ed" : value <= 25 ? "#b8d4fb" : value <= 75 ? "#72a5f1" : "#3877db";
}
