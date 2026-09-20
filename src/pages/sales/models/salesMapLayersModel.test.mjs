import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SALES_MAP_LAYER_COUNTS_NOTE, SALES_MAP_LAYER_NO_WORK, salesMapLayerArea, salesMapLayerDrawNotes, salesMapLayerDrawStats } from "./salesMapLayersModel.js";

// Targeted Batch rules TB-R055.7 (1.3.63): TB Draft's Map Layers on the GPS Sales map, loading only
// near the work — 50 m around the geofence being drawn, else 50 m around the ticked meters.
const TICKED = [{ lat: -28.16, lng: 30.23 }, { lat: -28.158, lng: 30.232 }];
const SHAPE = [{ lat: -28.2, lng: 30.3 }, { lat: -28.199, lng: 30.301 }, { lat: -28.1995, lng: 30.3005 }];
const metres = degrees => degrees * 111320;

test("nothing loads until meters are ticked or a geofence is being drawn", () => {
  assert.equal(salesMapLayerArea(), null, "no ticked meters, nothing being drawn");
  assert.equal(salesMapLayerArea({ drawingPoints: [], tickedPoints: [] }), null);
});

test("with nothing being drawn the area is 50 m around the ticked meters", () => {
  const area = salesMapLayerArea({ tickedPoints: TICKED });
  assert.ok(area.minLat < -28.16 && area.maxLat > -28.158 && area.minLng < 30.23 && area.maxLng > 30.232, "the ticked meters are inside");
  assert.ok(Math.abs(metres(area.maxLat - -28.158) - 50) < 1, `50 m north of the ticked meters, not ${metres(area.maxLat - -28.158)} m`);
  assert.ok(Math.abs(metres(-28.16 - area.minLat) - 50) < 1, "50 m south of the ticked meters");
  // The same meters give the same area, so a loaded layer is not read again (18.7).
  assert.deepEqual(salesMapLayerArea({ tickedPoints: TICKED.map(point => ({ ...point })) }), area);
  // One ticked meter is a 50 m box around it.
  const one = salesMapLayerArea({ tickedPoints: [TICKED[0]] });
  assert.ok(Math.abs(metres(one.maxLat - one.minLat) - 100) < 1, "50 m each side of a single ticked meter");
});

test("while a geofence is being drawn the area follows the shape, not the ticked meters", () => {
  const area = salesMapLayerArea({ drawingPoints: SHAPE, tickedPoints: TICKED });
  assert.ok(area.minLat < -28.2 && area.maxLat > -28.199 && area.minLng < 30.3 && area.maxLng > 30.301, "the shape is inside");
  assert.ok(Math.abs(metres(area.maxLat - -28.199) - 50) < 1, "50 m around the shape being drawn");
  const ticked = salesMapLayerArea({ tickedPoints: TICKED });
  assert.ok(area.minLng > ticked.maxLng, "the far-away ticked meters are not loaded while drawing");
  // The first point of a shape already gives an area, so the layers load around it.
  assert.ok(salesMapLayerArea({ drawingPoints: [SHAPE[0]] }), "one point is enough");
});

test("counts inside the shape only for ticked layers fully loaded for the area near the work", () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
  const model = { erfs: [{ id: "E1", point: { lat: 5, lng: 5 } }], premises: [], assets: [], salesRecords: [] };
  const complete = { erfs: "Complete", premises: "Complete" };
  const state = extra => ({ draftPoints: square, model, visibility: { erfs: true }, layerStates: complete, ready: true, ...extra });
  const ticked = salesMapLayerDrawStats(state());
  assert.notEqual(ticked.erfs, "—");
  assert.equal(ticked.premises, "—", "not ticked");
  assert.equal(ticked.sales.total, "—");
  assert.equal(salesMapLayerDrawStats(state({ ready: false })).erfs, "—", "no area near the work yet");
  assert.equal(salesMapLayerDrawStats(state({ layerStates: { erfs: "Incomplete: waiting for the server" } })).erfs, "—", "still loading");
  assert.equal(salesMapLayerDrawStats(state({ layerStates: { erfs: "Incomplete: 500-record read limit reached" } })).erfs, "—", "cut off at 500");
});

test("the drawing bar says why a layer count is not shown, and never mentions zoom", () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
  const notes = extra => salesMapLayerDrawNotes({ draftPoints: square, ready: true, ...extra });
  assert.deepEqual(notes({ visibility: {} }), [], "no layer ticked");
  assert.deepEqual(notes({ visibility: { erfs: true }, layerStates: { erfs: "Complete" } }), []);
  assert.deepEqual(notes({ visibility: { erfs: true }, layerStates: { erfs: "Incomplete: waiting for the server" } }), ["erfs: Incomplete: waiting for the server"]);
  const waiting = notes({ visibility: { erfs: true }, ready: false });
  assert.equal(waiting.length, 1);
  assert.doesNotMatch(waiting[0], /zoom/i, "no zoom requirement is left");
});

test("the GPS Sales map carries TB Draft's panel and layers, near the work only", async () => {
  const section = await readFile(new URL("../components/SalesGpsMapSection.jsx", import.meta.url), "utf8");
  assert.match(section, /const layers = useSalesMapLayers\(/);
  assert.match(section, /\{layers\.renderOnMap\(fence\.isCreateMode, pinPoints\)\}/, "the red pins go with it (1.3.50)");
  assert.match(section, /\{layers\.renderPanel\(fence\.isCreateMode\)\}/);
  assert.match(section, /planning: layers\.planning,/);
  // The drawing is owned here, so the layers and the drawing tool see the same shape (1.3.63).
  assert.match(section, /const drawing = useGeofencePolygonDraft\(\);/);
  assert.match(section, /const drawingPoints = drawing\.drawing \? drawing\.points : NO_POINTS;/);
  assert.match(section, /drawingPoints,\s*tickedPoints,\s*\}\);/, "the layers are given both");
  assert.match(section, /useSalesMapFence\(\{\s*drawing,/, "the drawing tool is given the same one");
  assert.match(section, /selectedMeterIds \|\| \[\]/, "the ticked meters come from the table");

  const layers = await readFile(new URL("../components/sales-map-layers.jsx", import.meta.url), "utf8");
  assert.match(layers, /countsNote=\{SALES_MAP_LAYER_COUNTS_NOTE\}/);
  assert.match(SALES_MAP_LAYER_COUNTS_NOTE, /near the work/, "the panel says the layers show the area near the work");
  assert.match(SALES_MAP_LAYER_NO_WORK, /Tick meters or draw a geofence/);
  assert.match(layers, /const areaKey = JSON\.stringify\(salesMapLayerArea\(\{ drawingPoints, tickedPoints \}\)\);/);
  assert.match(layers, /skip: !ready \|\| !visibility\[layer\]/, "only ticked layers load, and only once there is an area");
  // One implementation: both maps read through TB Draft's endpoint (18.7, 10 minutes).
  assert.match(layers, /useGetSalesBatchNearbyLayerQuery\(\.\.\.layerRead\("(erfs|sales|premises|assets)"\)\)/);
  assert.doesNotMatch(layers, /SalesMapViewport|zoom/i, "the area no longer follows the screen");

  const api = await readFile(new URL("../../../redux/salesTargetedBatchApi.js", import.meta.url), "utf8");
  assert.match(api, /getSalesBatchNearbyLayer: builder\.query\(nearbyLayerEndpoint\(600\)\)/, "an area stays loaded 10 minutes");
  assert.doesNotMatch(api, /getSalesMapNearbyLayer/, "the area-on-screen endpoint is retired");

  const fence = await readFile(new URL("../components/use-sales-map-fence.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(fence, /showStats=\{false\}|showCounts=\{false\}/, "the counts show while drawing and in Confirm Geofence");
  assert.match(fence, /draftPreviewStats=\{draftPreviewStats\}/);
  assert.match(fence, /export function useSalesMapFence\(\{ drawing,/, "the drawing is owned by the map section");
  assert.doesNotMatch(fence, /const drawing = useGeofencePolygonDraft\(\)/, "and not made a second time here");
});
