import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SALES_MAP_LAYER_GRID, SALES_MAP_LAYER_MIN_ZOOM, salesMapLayerArea, salesMapLayerDrawNotes, salesMapLayerDrawStats } from "./salesMapLayersModel.js";

// Targeted Batch rules TB-R055.7 (1.3.49): TB Draft's Map Layers on the GPS Sales map.
test("layers load for the area on screen only when zoomed in to street level", () => {
  const view = { south: -28.16, west: 30.23, north: -28.155, east: 30.24 };
  assert.equal(SALES_MAP_LAYER_MIN_ZOOM, 17);
  assert.equal(salesMapLayerArea({ ...view, zoom: 16 }), null, "zoomed out: nothing loads");
  assert.equal(salesMapLayerArea({ ...view, zoom: undefined }), null, "not known yet");
  const area = salesMapLayerArea({ ...view, zoom: 17 });
  assert.ok(area.minLat <= view.south && area.maxLat >= view.north && area.minLng <= view.west && area.maxLng >= view.east, "the grid area covers the screen");
});

test("small moves inside the same grid cells reuse the same read", () => {
  assert.equal(SALES_MAP_LAYER_GRID, 0.0025);
  const first = salesMapLayerArea({ south: -28.1601, west: 30.2301, north: -28.1551, east: 30.2398, zoom: 18 });
  const nudged = salesMapLayerArea({ south: -28.1604, west: 30.2303, north: -28.1553, east: 30.2396, zoom: 18 });
  assert.deepEqual(nudged, first);
  assert.deepEqual(first, { minLat: -28.1625, maxLat: -28.155, minLng: 30.23, maxLng: 30.24 });
});

test("counts inside the shape only for ticked layers fully loaded for an area holding the whole shape", () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
  const model = { erfs: [{ id: "E1", point: { lat: 5, lng: 5 } }], premises: [], assets: [], salesRecords: [] };
  const bounds = { minLat: -1, maxLat: 11, minLng: -1, maxLng: 11 };
  const complete = { erfs: "Complete", premises: "Complete" };
  const ticked = salesMapLayerDrawStats({ draftPoints: square, model, visibility: { erfs: true }, layerStates: complete, bounds });
  assert.notEqual(ticked.erfs, "—");
  assert.equal(ticked.premises, "—", "not ticked");
  assert.equal(ticked.sales.total, "—");
  const state = extra => ({ draftPoints: square, model, visibility: { erfs: true }, layerStates: complete, bounds, ...extra });
  assert.equal(salesMapLayerDrawStats(state({ zoomedOut: true })).erfs, "—", "zoomed out");
  assert.equal(salesMapLayerDrawStats(state({ layerStates: { erfs: "Incomplete: waiting for the server" } })).erfs, "—", "still loading");
  assert.equal(salesMapLayerDrawStats(state({ layerStates: { erfs: "Incomplete: 500-record read limit reached" } })).erfs, "—", "cut off at 500");
  assert.equal(salesMapLayerDrawStats(state({ bounds: { minLat: 2, maxLat: 11, minLng: -1, maxLng: 11 } })).erfs, "—", "part of the shape off screen");
});

test("the drawing bar says why a layer count is not shown", () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
  const bounds = { minLat: -1, maxLat: 11, minLng: -1, maxLng: 11 };
  assert.deepEqual(salesMapLayerDrawNotes({ draftPoints: square, visibility: {}, bounds }), [], "no layer ticked");
  assert.deepEqual(salesMapLayerDrawNotes({ draftPoints: square, visibility: { erfs: true }, layerStates: { erfs: "Complete" }, bounds }), []);
  assert.deepEqual(salesMapLayerDrawNotes({ draftPoints: square, visibility: { erfs: true }, layerStates: { erfs: "Incomplete: waiting for the server" }, bounds }), ["erfs: Incomplete: waiting for the server"]);
  assert.match(salesMapLayerDrawNotes({ draftPoints: square, visibility: { erfs: true }, zoomedOut: true })[0], /zoom in to street level/);
  assert.match(salesMapLayerDrawNotes({ draftPoints: square, visibility: { erfs: true }, layerStates: { erfs: "Complete" }, bounds: { minLat: 2, maxLat: 11, minLng: -1, maxLng: 11 } })[0], /off screen/);
});

test("the GPS Sales map carries TB Draft's panel and layers, and the drawing shows their counts", async () => {
  const section = await readFile(new URL("../components/SalesGpsMapSection.jsx", import.meta.url), "utf8");
  assert.match(section, /const layers = useSalesMapLayers\(/);
  assert.match(section, /\{layers\.renderOnMap\(fence\.isCreateMode, pinPoints\)\}/, "the red pins go with it (1.3.50)");
  assert.match(section, /\{layers\.renderPanel\(fence\.isCreateMode\)\}/);
  assert.match(section, /planning: layers\.planning,/);
  const layers = await readFile(new URL("../components/sales-map-layers.jsx", import.meta.url), "utf8");
  assert.match(layers, /countsNote="Counts are for the area on screen"/);
  assert.match(layers, /useGetSalesMapNearbyLayerQuery\(\.\.\.layerRead\("(erfs|sales|premises|assets)"\)\)/);
  assert.doesNotMatch(layers, /meterPoints=\{\[\]\}|onSelectGeoFence=\{\(\) => \{\}\}/, "fixed values, so the layers are not rebuilt on every render");
  const api = await readFile(new URL("../../../redux/salesTargetedBatchApi.js", import.meta.url), "utf8");
  assert.match(api, /getSalesBatchNearbyLayer: builder\.query\(nearbyLayerEndpoint\(600\)\)/, "TB Draft keeps its 10 minutes");
  assert.match(api, /getSalesMapNearbyLayer: builder\.query\(nearbyLayerEndpoint\(20\)\)/, "the moving Sales map lets an area go after 20 seconds");
  const fence = await readFile(new URL("../components/use-sales-map-fence.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(fence, /showStats=\{false\}|showCounts=\{false\}/, "the counts show while drawing and in Confirm Geofence");
  assert.match(fence, /draftPreviewStats=\{draftPreviewStats\}/);
});
