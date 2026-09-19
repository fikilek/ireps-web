// Targeted Batch rules TB-R055.7 (1.3.49): TB Draft's Map Layers on the GPS Sales map, for the area
// on screen. A read holds at most 500 records, so ERFs, Sales, Premises and Assets load only when
// zoomed in to street level; the area is widened to a fixed grid so small moves reuse the same read.
import { NEARBY_LAYERS } from "../../../features/maps/sales-batch-nearby.js";
import { buildGeofencePlanningDraftStats } from "../../operations/geofencePlanningModel.js";

export const SALES_MAP_LAYER_MIN_ZOOM = 17;
export const SALES_MAP_LAYER_GRID = 0.0025; // degrees, about 275 m
export const SALES_MAP_LAYER_ZOOMED_OUT = "Zoom in to street level to load";

const snap = (value, round) => Number((round(value / SALES_MAP_LAYER_GRID) * SALES_MAP_LAYER_GRID).toFixed(4));

// The area on screen widened to the grid, or null when zoomed out too far (or not known yet).
export function salesMapLayerArea({ south, west, north, east, zoom } = {}) {
  if (![south, west, north, east, zoom].every(Number.isFinite) || zoom < SALES_MAP_LAYER_MIN_ZOOM) return null;
  return { minLat: snap(south, Math.floor), maxLat: snap(north, Math.ceil), minLng: snap(west, Math.floor), maxLng: snap(east, Math.ceil) };
}

// Inside the shape, for the ticked layers that are loaded; "—" for any other (as TB Draft, 18.7).
export function salesMapLayerDrawStats({ draftPoints = [], model = {}, visibility = {}, zoomedOut = false } = {}) {
  const stats = buildGeofencePlanningDraftStats({ draftPoints, ...model });
  const counted = zoomedOut ? [] : NEARBY_LAYERS.filter(layer => visibility[layer]), none = "—";
  return { ...stats,
    erfs: counted.includes("erfs") ? stats.erfs : none,
    premises: counted.includes("premises") ? stats.premises : none,
    assets: counted.includes("assets") ? stats.assets : none,
    sales: counted.includes("sales") ? stats.sales : { ...stats.sales, total: none, notStarted: none, inProgress: none, completed: none, integrityExceptions: 0 } };
}
