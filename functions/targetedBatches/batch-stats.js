// Targeted Batch rules TB-R057 (1.3.55): Batch Stats. Every number is counted live from the batches
// (tb_uploads), their rows (tb_rows), the Sales meters, the geofences and the ERFs; nothing is stored
// and the running totals kept on each batch (tb_uploads.counts) are not used.
// Plain module: no Firebase imports; batchStatsCallable.js does the reads.
import { classifySalesWorkStatus, evaluateSalesBatchability, hasUsableSalesGps, newestSalesCategoryMonth, resolveSalesTargetedBatchMembership, salesCategoryKind } from "../salesAllMeters/sales-batch-policy.js";
import { erfCentroidInside, salesMapFenceAddressReady, salesMapFenceErfId } from "./sales-map-fence.js";
import { batchGeometryBounds, normalizeBatchGeometry, pointCoordinates } from "../geofences/sales-batch-geometry.js";

export const BATCH_STATS_STATUSES = Object.freeze(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
export const BATCH_STATS_TYPES = Object.freeze(["GPS", "NON_GPS", "OTHER"]);
export const STILL_TO_BATCH_REASONS = Object.freeze(["GPS_INSIDE_FENCE", "GPS_NO_FENCE", "NON_GPS_READY", "NON_GPS_MANUAL_ERFING", "ADDRESS_MISSING", "OTHER"]);
export const NOT_ALLOCATED_KEY = "NOT_ALLOCATED";

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const typeCounts = () => ({ total: 0, GPS: 0, NON_GPS: 0, OTHER: 0 });
const statusCounts = () => ({ total: 0, NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 });
const meterCounts = () => ({ ALL: statusCounts(), GPS: statusCounts(), NON_GPS: statusCounts(), OTHER: statusCounts() });
const reasonCounts = () => ({ ...Object.fromEntries(STILL_TO_BATCH_REASONS.map(reason => [reason, 0])), total: 0 });
const addBatch = (counts, type) => { counts.total += 1; counts[type] += 1; };
const addMeter = (counts, type, status) => { for (const line of [counts.ALL, counts[type]]) { line.total += 1; line[status] += 1; } };
const byName = (left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key);

// The batch type TB Register shows in its Batch Type column (getBatchType); a batch of neither type is Other.
export function batchStatsType(batch = {}) {
  if (upper(batch?.selection?.planningMode) === "NON_GPS_STREET" || batch?.source?.type === "PREPAID_SALES_NON_GPS") return "NON_GPS";
  return batch?.source?.type === "PREPAID_SALES" ? "GPS" : "OTHER";
}

// Who a batch is allocated to, as TB Register's Allocated To column shows it (getAllocationState).
export function batchStatsTarget(batch = {}) {
  const allocation = batch?.allocation || {};
  const targetId = allocation.targetId || allocation.target?.id || null;
  const allocated = upper(batch?.status) === "ALLOCATED" || upper(allocation.status) === "ALLOCATED" || Boolean(targetId);
  if (!allocated) return { key: NOT_ALLOCATED_KEY, kind: null, name: "Not allocated", allocated: false };
  const kind = upper(allocation.targetType || allocation.target?.type) === "TEAM" ? "TEAM" : "SP";
  const name = text(allocation.targetName || allocation.target?.name) || "Name missing";
  return { key: `${kind}:${targetId ? text(targetId) : name}`, kind, name, allocated: true };
}

// TB-R054: one status per batch row. A VISIBLE Sales meter is Completed; otherwise the row's own
// status counts, and anything else is Not Started. A missing Sales record counts by the row only.
export function batchStatsRowStatus({ row = {}, sales = null } = {}) {
  if (sales && classifySalesWorkStatus(sales) === "COMPLETED") return "COMPLETED";
  const status = upper(row?.execution?.status);
  return status === "COMPLETED" || status === "IN_PROGRESS" ? status : "NOT_STARTED";
}

// TB-R046: CAT by the newest category on the meter's own Sales record; no month is chosen.
export const isCatNow = (sales = {}) => salesCategoryKind(sales || {}, newestSalesCategoryMonth(sales || {})).kind === "CAT";

// The town on the Sales file, in title case ("DUNDEE" is "Dundee"); a blank town is null (No town).
const NO_TOWN = new Set(["", "-", "NAV", "N/A", "NA", "NULL", "UNDEFINED"]);
export function batchStatsTown(sales = {}) {
  const town = text(sales?.town ?? sales?.source?.town ?? sales?.sales?.town ?? sales?.address?.town).replace(/\s+/g, " ");
  if (NO_TOWN.has(town.toUpperCase())) return null;
  return town.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}

// Why a CAT meter that is Not Started and in no batch is still to batch: the checks of TB Draft and the
// GPS Sales map, in their order, and the first one it fails. First the batch checks (TB-R046); then, for a
// GPS meter, the street address and town the field needs (TB-R055); then the geofence test, which needs
// the meter's ERF (read afterwards, see gpsFenceReason).
export function stillToBatchReason(sales = {}, lmPcode) {
  const row = sales || {};
  if (hasUsableSalesGps(row)) {
    const check = evaluateSalesBatchability(row, { salesId: row.id, lmPcode, source: "PREPAID_SALES" });
    if (!check.batchable) return { reason: "OTHER", code: check.code };
    if (!salesMapFenceAddressReady(row)) return { reason: "ADDRESS_MISSING" };
    return { reason: "GPS_NEEDS_FENCE_TEST", erfId: salesMapFenceErfId(row) };
  }
  const check = evaluateSalesBatchability(row, { salesId: row.id, lmPcode });
  if (check.batchable) return { reason: "NON_GPS_READY" };
  if (check.code === "NEEDS_MANUAL_ERFING") return { reason: "NON_GPS_MANUAL_ERFING" };
  if (check.code === "PLANNING_ADDRESS_INVALID") return { reason: "ADDRESS_MISSING" };
  return { reason: "OTHER", code: check.code };
}

// The geofence test: the ERF's centroid strictly inside an ACTIVE geofence of the LM that is already
// drawn (TB-R039), of the ERF's own Ward when the geofence names one, whether or not it was drawn for a batch.
const fenceWard = fence => { const ward = text(fence?.parents?.wardPcode); return ward === "NAv" ? "" : ward; };
const usableFence = (fence, lmPcode) => fence?.status === "ACTIVE" && (!lmPcode || text(fence?.parents?.lmPcode) === lmPcode);
const BOUNDS = new WeakMap();
function centroidInsideFence(erf, fence) {
  try {
    const geometry = normalizeBatchGeometry(fence.geometry);
    if (!BOUNDS.has(geometry)) BOUNDS.set(geometry, batchGeometryBounds(geometry));
    const box = BOUNDS.get(geometry), [lng, lat] = pointCoordinates(erf.centroid);
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) return false;
    return erfCentroidInside(erf, geometry);
  } catch { return false; } // A geofence or ERF centroid that cannot be read holds no meter.
}
// An ordinary geofence is drawn by clicking on the map, so it may repeat a point or hold more than 300 of them.
// Its ring is built here before the strict batch-geofence check, so a geofence that exists is not missed.
export function fenceGeometry(fence) {
  const points = fence?.geometry?.points;
  if (!Array.isArray(points) || points.length < 3) return normalizeBatchGeometry(fence?.geometry);
  const ring = [];
  for (const point of points) {
    const [lng, lat] = pointCoordinates(point);
    const last = ring.at(-1);
    if (!last || last[0] !== lng || last[1] !== lat) ring.push([lng, lat]);
  }
  while (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  if (ring.length < 3) throw new Error("A geofence needs three different points");
  return normalizeBatchGeometry({ type: "Polygon", coordinates: [[...ring, [...ring[0]]]] });
}

export function gpsFenceReason(erf, fences = [], lmPcode = null) {
  if (!erf) return { reason: "OTHER", code: "GPS_ERF_NOT_FOUND" };
  // The ERF must be able to hold a batch, as the resolver and the GPS Sales map require (TB-R055, 18.4).
  const erfWard = text(erf.admin?.ward?.pcode);
  if ((lmPcode && text(erf.admin?.localMunicipality?.pcode) !== lmPcode) || !/^ZA[0-9]+$/.test(erfWard)) return { reason: "OTHER", code: "ERF_SCOPE_INVALID" };
  try { pointCoordinates(erf.centroid); } catch { return { reason: "OTHER", code: "ERF_CENTROID_INVALID" }; }
  const inside = (Array.isArray(fences) ? fences : []).some(fence => usableFence(fence, lmPcode) && (!fenceWard(fence) || fenceWard(fence) === erfWard) && centroidInsideFence(erf, fence));
  return { reason: inside ? "GPS_INSIDE_FENCE" : "GPS_NO_FENCE" };
}

// Other reasons are named in plain words under the table; codes never reach the page.
const OTHER_REASON_LABELS = Object.freeze({
  PIPELINE_ERF_INVALID: "GPS meter without exactly one ERF",
  GPS_ERF_NOT_FOUND: "its ERF cannot be found",
  ERF_SCOPE_INVALID: "its ERF is not in this municipality, or names no Ward",
  ERF_CENTROID_INVALID: "its ERF has no centre point",
  ERF_RESOLUTION_INVALID: "its saved ERF is incomplete",
  ERF_LOOKUP_INVALID: "its ERF lookup record cannot be read",
  SALES_IDENTITY_INVALID: "its meter number does not match its Sales record",
  SALES_VISIBILITY_INVALID: "whether it was found cannot be read",
  SALES_METER_TYPE_UNSUPPORTED: "its meter type is not prepaid or conventional",
  TB_REFERENCE_INTEGRITY_INVALID: "its batch history cannot be read",
});
const otherReason = code => Object.hasOwn(OTHER_REASON_LABELS, code) ? { code, label: OTHER_REASON_LABELS[code] } : { code: "OTHER", label: "other data problem" };

// Part 4, before the ERFs are read: every CAT meter of the LM by batch link and status.
function catMetersStillToBatch({ lmPcode, batchIds, salesDocs = [] }) {
  const still = [];
  let foundWithoutBatch = 0, unclearLink = 0;
  for (const sales of Array.isArray(salesDocs) ? salesDocs : []) {
    if (!sales || !isCatNow(sales)) continue;
    const membership = resolveSalesTargetedBatchMembership(sales);
    // In more than one batch, or naming a batch that does not exist: not counted, the office checks it.
    if (membership.state === "UNRESOLVED" || (membership.state === "MEMBER" && !batchIds.has(membership.tbId))) { unclearLink += 1; continue; }
    if (membership.state !== "NONE") continue;
    const status = classifySalesWorkStatus(sales);
    if (status === "COMPLETED") foundWithoutBatch += 1; // Already found: needs no batch.
    else if (status === "NOT_STARTED") still.push({ town: batchStatsTown(sales), result: stillToBatchReason(sales, lmPcode) });
  }
  return { still, foundWithoutBatch, unclearLink };
}
const idsOf = batches => new Set((Array.isArray(batches) ? batches : []).map(batch => batch?.id).filter(Boolean));

// The ERFs the callable must read: those of the GPS meters that reached the geofence test.
export function batchStatsErfIds({ lmPcode, batches = [], salesDocs = [] } = {}) {
  const { still } = catMetersStillToBatch({ lmPcode, batchIds: idsOf(batches), salesDocs });
  return [...new Set(still.filter(item => item.result.reason === "GPS_NEEDS_FENCE_TEST" && item.result.erfId).map(item => item.result.erfId))].sort();
}

export function summarizeBatchStats({ lmPcode, batches = [], rows = [], salesDocs = [], fences = [], erfsById = new Map(), generatedAt = new Date().toISOString() } = {}) {
  // Parts 1 and 3: batches by type, and by the TEAM or SP they are allocated to.
  const batchCounts = typeCounts(), meters = meterCounts(), teams = new Map(), batchInfo = new Map();
  for (const batch of Array.isArray(batches) ? batches : []) {
    if (!batch?.id || batchInfo.has(batch.id)) continue;
    const type = batchStatsType(batch), target = batchStatsTarget(batch);
    if (!teams.has(target.key)) teams.set(target.key, { ...target, batches: typeCounts(), meters: meterCounts() });
    const team = teams.get(target.key);
    batchInfo.set(batch.id, { type, team });
    addBatch(batchCounts, type);
    addBatch(team.batches, type);
  }
  // Parts 2 and 3: every batch row, one status each (TB-R054).
  const salesById = new Map((Array.isArray(salesDocs) ? salesDocs : []).filter(sales => sales?.id).map(sales => [sales.id, sales]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const info = batchInfo.get(text(row?.tbId));
    if (!info) continue;
    const status = batchStatsRowStatus({ row, sales: salesById.get(text(row?.salesAllMeterId)) || null });
    addMeter(meters, info.type, status);
    addMeter(info.team.meters, info.type, status);
  }
  // Part 4: CAT meters still to batch, by town and the first check they fail.
  let fencesSkipped = 0;
  const readyFences = [];
  for (const fence of Array.isArray(fences) ? fences : []) {
    if (!usableFence(fence, lmPcode)) continue;
    try { readyFences.push({ ...fence, geometry: fenceGeometry(fence) }); }
    catch { fencesSkipped += 1; } // Its shape cannot be read, so it is not used.
  }
  const erfOf = id => (id ? (erfsById instanceof Map ? erfsById.get(id) : erfsById?.[id]) || null : null);
  const { still, foundWithoutBatch, unclearLink } = catMetersStillToBatch({ lmPcode, batchIds: new Set(batchInfo.keys()), salesDocs });
  const towns = new Map(), totals = reasonCounts(), others = new Map();
  for (const { town, result } of still) {
    const { reason, code } = result.reason === "GPS_NEEDS_FENCE_TEST" ? gpsFenceReason(erfOf(result.erfId), readyFences, lmPcode) : result;
    if (!towns.has(town)) towns.set(town, { town, counts: Object.fromEntries(STILL_TO_BATCH_REASONS.map(key => [key, 0])), total: 0 });
    const line = towns.get(town);
    line.counts[reason] += 1;
    line.total += 1;
    totals[reason] += 1;
    totals.total += 1;
    if (reason === "OTHER") {
      const named = otherReason(code);
      if (!others.has(named.label)) others.set(named.label, { ...named, count: 0 });
      others.get(named.label).count += 1;
    }
  }
  const teamList = [...teams.values()];
  return {
    success: true, lmPcode, generatedAt,
    batches: batchCounts,
    meters,
    teams: [...teamList.filter(team => team.allocated).sort(byName), ...teamList.filter(team => !team.allocated)],
    stillToBatch: {
      reasons: [...STILL_TO_BATCH_REASONS],
      towns: [...towns.values()].sort((left, right) => (left.town === null) - (right.town === null) || String(left.town ?? "").localeCompare(String(right.town ?? ""), undefined, { sensitivity: "base" })),
      totals,
      otherReasons: [...others.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
      foundWithoutBatch,
      unclearLink,
    },
    fencesSkipped,
  };
}
