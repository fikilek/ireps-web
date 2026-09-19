// Targeted Batch rules TB-R055 (1.3.47): a GPS batch geofence drawn on the GPS Sales map.
// The count of meters that can be batched uses the server's own code (sales-map-fence.js).
import { evaluateSalesBatchability, hasUsableSalesGps } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { polygonFromPoints, strictlyInside } from "../../../../functions/geofences/sales-batch-geometry.js";
import { SALES_MAP_FENCE_LIMIT, salesMapFenceErfId, salesMapFenceMeters } from "../../../../functions/targetedBatches/sales-map-fence.js";

export { SALES_MAP_FENCE_LIMIT };

// The ERFs whose centroids the map reads before counting: those of the Ward's GPS meters that can
// be batched. No other meter can count toward the limit, so no other ERF is needed.
export function salesMapFenceErfIds(rows = [], { lmPcode, categoryMonth } = {}) {
  return [...new Set(rows.filter(row => hasUsableSalesGps(row) && evaluateSalesBatchability(row, { salesId: row?.id, lmPcode, source: "PREPAID_SALES", categoryMonth }).batchable)
    .map(salesMapFenceErfId).filter(Boolean))].sort();
}

const gpsPointInside = (candidate, geometry) => {
  try { return strictlyInside({ latitude: candidate.latitude, longitude: candidate.longitude }, geometry); } catch { return false; }
};

// The live count while drawing: `inside` = the Ward's GPS Sales meters whose GPS point is inside
// (as geofence membership tags them), `batchableIds` = the meters that can be batched whose ERF
// centroid is inside (the batch and the limit).
export function salesMapFenceCount({ points = [], rows = [], erfsById = new Map(), lmPcode, wardPcode, categoryMonth }) {
  let geometry = null;
  try { geometry = polygonFromPoints(points); } catch { geometry = null; }
  if (!geometry) return { shape: false, inside: 0, batchableIds: [], over: false, canSave: false };
  const inside = rows.filter(row => hasUsableSalesGps(row) && (row.erfCandidates || []).some(candidate => candidate?.hasValidGps && candidate.wardPcode === wardPcode && gpsPointInside(candidate, geometry))).length;
  const batchableIds = salesMapFenceMeters({ salesRows: rows, erfsById, geometry, lmPcode, wardPcode, categoryMonth });
  const over = batchableIds.length > SALES_MAP_FENCE_LIMIT;
  return { shape: true, inside, batchableIds, over, canSave: !over && batchableIds.length > 0 };
}

// The words under the drawing (TB-R055.2 and .3).
export function salesMapFenceCountText({ pointsCount = 0, count, loading = false, error = "" }) {
  if (error) return { tone: "error", text: error };
  if (loading) return { tone: "busy", text: "Counting the meters that can be batched…" };
  if (pointsCount < 3) return { tone: "info", text: "Click at least 3 points on the map. The count starts with the third point." };
  if (!count?.shape) return { tone: "error", text: "The shape crosses itself. Undo the last point or restart." };
  const counted = `Inside: ${count.inside} Sales meter${count.inside === 1 ? "" : "s"} · ${count.batchableIds.length} can be batched`;
  if (count.over) return { tone: "error", text: `${counted}. Too many: ${count.batchableIds.length} — the limit is ${SALES_MAP_FENCE_LIMIT}.` };
  if (!count.batchableIds.length) return { tone: "info", text: `${counted}. Save needs at least one meter that can be batched.` };
  return { tone: "ok", text: counted };
}

// Save -> linked, as TB Draft's progress window, without TB Draft's third step (TB-R055.5).
export const SALES_MAP_FENCE_PROGRESS_STEPS = Object.freeze([
  { key: "save", label: "Saving the geofence" },
  { key: "link", label: "Linking the ERFs, premises and meters inside it" },
]);
export function salesMapFenceProgress({ phase, fenceId, fence, timedOut = false } = {}) {
  const saved = phase === "saved" && Boolean(fenceId);
  const linked = saved && fence?.id === fenceId && fence?.metadata?.updatedByUid === "SYSTEM" && fence?.metadata?.updatedByUser === "onGeoFenceCreated";
  const doneByStep = { save: saved, link: linked };
  const current = SALES_MAP_FENCE_PROGRESS_STEPS.find(step => !doneByStep[step.key])?.key || null;
  return {
    steps: SALES_MAP_FENCE_PROGRESS_STEPS.map(step => ({ ...step, done: doneByStep[step.key], active: step.key === current })),
    done: linked || (saved && timedOut),
    stillLinking: saved && timedOut && !linked,
  };
}

// Create Target Batch after a Sales-map geofence (TB-R055.6): the ticked meters of that geofence go
// to its TB Draft; a ticked meter outside it is named and must be unticked first; a selection with
// none of its meters is an ordinary selection.
export function salesMapFenceDraftChoice({ fence = null, selectedIds = new Set(), rows = [] } = {}) {
  const selected = [...selectedIds];
  const fenceIds = new Set(fence?.salesIds || []);
  if (!fence || !selected.some(id => fenceIds.has(id))) return { kind: "normal" };
  const outside = selected.filter(id => !fenceIds.has(id));
  if (outside.length) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const names = outside.slice(0, 5).map(id => byId.get(id)?.meterNo || id).join(", ");
    return { kind: "outside", message: `${outside.length} ticked meter${outside.length === 1 ? " is" : "s are"} not in ${fence.name}: ${names}${outside.length > 5 ? ", …" : ""}. Untick ${outside.length === 1 ? "it" : "them"} to create this geofence's batch.` };
  }
  return { kind: "fence", keepIds: selected.sort(), removeIds: [...fenceIds].filter(id => !selectedIds.has(id)).sort() };
}
