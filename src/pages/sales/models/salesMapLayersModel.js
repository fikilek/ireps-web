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

// The whole shape lies inside the loaded area (the area on screen, widened to the grid).
export function shapeInsideArea(draftPoints = [], bounds = null) {
  return Boolean(bounds) && draftPoints.length > 0 && draftPoints.every(point => point.lat >= bounds.minLat && point.lat <= bounds.maxLat && point.lng >= bounds.minLng && point.lng <= bounds.maxLng);
}

// The ticked layers whose count inside the shape is final: fully loaded ("Complete") for an area that
// holds the whole shape. Any other shows "—" (as TB Draft, 18.7): a count still loading, cut off at
// 500 records, or missing the part of the shape off screen would look final but be too low.
export function salesMapLayerCountedLayers({ draftPoints = [], visibility = {}, zoomedOut = false, layerStates = {}, bounds = null } = {}) {
  if (zoomedOut || !shapeInsideArea(draftPoints, bounds)) return [];
  return NEARBY_LAYERS.filter(layer => visibility[layer] && layerStates[layer] === "Complete");
}

// What the drawing bar says about those counts.
export function salesMapLayerDrawNotes({ draftPoints = [], visibility = {}, zoomedOut = false, layerStates = {}, bounds = null } = {}) {
  const ticked = NEARBY_LAYERS.filter(layer => visibility[layer]);
  if (!ticked.length || draftPoints.length < 3) return [];
  if (zoomedOut) return [`Layer counts: ${SALES_MAP_LAYER_ZOOMED_OUT.toLowerCase()}.`];
  if (!shapeInsideArea(draftPoints, bounds)) return ["Layer counts: part of the shape is off screen. Move the map so the whole shape shows."];
  return ticked.filter(layer => layerStates[layer] !== "Complete").map(layer => `${layer}: ${layerStates[layer] || "Loading nearby records…"}`);
}

// Inside the shape, for the ticked layers whose count is final; "—" for any other (as TB Draft, 18.7).
export function salesMapLayerDrawStats({ draftPoints = [], model = {}, ...state } = {}) {
  const stats = buildGeofencePlanningDraftStats({ draftPoints, ...model });
  const counted = salesMapLayerCountedLayers({ draftPoints, ...state }), none = "—";
  return { ...stats,
    erfs: counted.includes("erfs") ? stats.erfs : none,
    premises: counted.includes("premises") ? stats.premises : none,
    assets: counted.includes("assets") ? stats.assets : none,
    sales: counted.includes("sales") ? stats.sales : { ...stats.sales, total: none, notStarted: none, inProgress: none, completed: none, integrityExceptions: 0 } };
}
