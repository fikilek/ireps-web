// Targeted Batch rules TB-R055.7 (1.3.63): TB Draft's Map Layers on the GPS Sales map, loading only
// near the work, exactly as TB Draft does (18.7): within 50 m of the geofence being drawn, or, when
// nothing is being drawn, within 50 m of the area covering the ticked meters, and inside the Ward.
// Nothing loads until meters are ticked or a geofence is being drawn. Until 1.3.63 these layers
// loaded for the area on screen, which pulled hundreds of ERFs far from the meters being batched.
import { NEARBY_LAYERS, locatedMeterBounds } from "../../../features/maps/sales-batch-nearby.js";
import { buildGeofencePlanningDraftStats } from "../../operations/geofencePlanningModel.js";

// What the panel says about the layers and their counts (18.7, 1.3.63).
export const SALES_MAP_LAYER_COUNTS_NOTE = "Layers show the area near the work · counts are for that area";
// What a layer line says while there is no work to be near.
export const SALES_MAP_LAYER_NO_WORK = "Tick meters or draw a geofence";

// The area near the work, TB Draft's own 50 m box (locatedMeterBounds, 18.7): the shape being drawn
// when one is, else the ticked meters. Null when there is neither, so nothing loads.
export function salesMapLayerArea({ drawingPoints = [], tickedPoints = [] } = {}) {
  const points = drawingPoints.length ? drawingPoints : tickedPoints;
  return locatedMeterBounds(points.map(point => ({ point })));
}

// The ticked layers whose count inside the shape is final: fully loaded ("Complete") for the area
// near the work, which always holds the whole shape while one is drawn. Any other shows "—" (as TB
// Draft, 18.7): a count still loading, or cut off at 500 records, would look final but be too low.
export function salesMapLayerCountedLayers({ visibility = {}, ready = false, layerStates = {} } = {}) {
  if (!ready) return [];
  return NEARBY_LAYERS.filter(layer => visibility[layer] && layerStates[layer] === "Complete");
}

// What the drawing bar says about those counts.
export function salesMapLayerDrawNotes({ draftPoints = [], visibility = {}, ready = false, layerStates = {} } = {}) {
  const ticked = NEARBY_LAYERS.filter(layer => visibility[layer]);
  if (!ticked.length || draftPoints.length < 3) return [];
  if (!ready) return ["Layer counts: the layers near this shape are not loaded yet."];
  return ticked.filter(layer => layerStates[layer] !== "Complete").map(layer => `${layer}: ${layerStates[layer] || "Loading nearby records…"}`);
}

// Inside the shape, for the ticked layers whose count is final; "—" for any other (as TB Draft, 18.7).
export function salesMapLayerDrawStats({ draftPoints = [], model = {}, ...state } = {}) {
  const stats = buildGeofencePlanningDraftStats({ draftPoints, ...model });
  const counted = salesMapLayerCountedLayers(state), none = "—";
  return { ...stats,
    erfs: counted.includes("erfs") ? stats.erfs : none,
    premises: counted.includes("premises") ? stats.premises : none,
    assets: counted.includes("assets") ? stats.assets : none,
    sales: counted.includes("sales") ? stats.sales : { ...stats.sales, total: none, notStarted: none, inProgress: none, completed: none, integrityExceptions: 0 } };
}
