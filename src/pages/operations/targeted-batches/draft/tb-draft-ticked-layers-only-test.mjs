import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nearbyLayerRecords } from "../../../../features/maps/sales-batch-nearby.js";

// Targeted Batch rules 18.7, amendment 1.3.30: only ticked layers load, also while drawing; layers
// never hold up the user; the inside-the-Ward check never freezes TB Draft.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("only ticked layers load, also while a geofence is being drawn", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /const layers = NEARBY_LAYERS\.filter\(layer => visibility\[layer\]\);/);
  assert.doesNotMatch(workspace, /visibility\[layer\] \|\| isCreateMode/, "drawing never switches layers on by itself");
  assert.match(workspace, /counted = NEARBY_LAYERS\.filter\(layer => visibility\[layer\]\), none = "—"/, "drawing counts cover ticked layers only");
  assert.match(workspace, /sales: counted\.includes\("sales"\) \? stats\.sales : \{ \.\.\.stats\.sales, total: none, notStarted: none, inProgress: none, completed: none, integrityExceptions: 0 \}/);
  assert.match(workspace, /requestedLayers=\{layers\} uncountedLabel="—"/, "an unticked layer shows no count in the panel");
  const panel = await read("../../GeofencePlanningLayers.jsx");
  for (const layer of ["erfs", "sales", "premises", "assets"]) assert.match(panel, new RegExp(`count=\\{countOf\\("${layer}", `), layer);
  assert.match(panel, /uncountedLabel = null,/, "other pages keep their counts");
});

test("a loaded layer stays loaded, Sales and Assets share one ERF read, and no-change updates are not worked through", async () => {
  const api = await read("../../../../redux/salesTargetedBatchApi.js");
  // The endpoint's code is shared with the GPS Sales map (TB-R055.7); TB Draft keeps an area 10 minutes.
  const layerEndpoint = api.slice(api.indexOf("function nearbyLayerEndpoint(keepUnusedDataFor) {"), api.indexOf("export const salesTargetedBatchApi = createApi({"));
  assert.ok(layerEndpoint.length > 1000, "the shared endpoint code is found");
  assert.match(api, /getSalesBatchNearbyLayer: builder\.query\(nearbyLayerEndpoint\(600\)\)/, "10 minutes after it is switched off");
  assert.match(layerEndpoint, /await readNearbyErfsOnce\(scope, \(\) => getDocs\(read\(nearbyQuerySpec\("erfs", scope\)\)\)\)/);
  assert.match(api, /function readNearbyErfsOnce\(scope, readErfs\) \{/);
  assert.match(layerEndpoint, /const rowsChanged = !previous \|\| previous\.error \|\| typeof snapshot\.docChanges !== "function" \|\| snapshot\.docChanges\(\)\.length > 0;/);
  assert.match(layerEndpoint, /if \(computed\.version !== rowsVersion\) \{/, "records are worked out again only when a record changed");
  assert.match(layerEndpoint, /if \(published && published\.records === computed\.records && published\.state === state\) return;/);
});

test("the inside-the-Ward check handles a large Ward and hundreds of records in well under a second", () => {
  // A 3 000-point Ward ring (a circle) and 600 nearby records around its centre.
  const ring = Array.from({ length: 3000 }, (_, i) => [30.23 + 0.05 * Math.cos((2 * Math.PI * i) / 3000), -28.16 + 0.05 * Math.sin((2 * Math.PI * i) / 3000)]);
  const wardGeometry = JSON.stringify({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
  const bounds = { minLat: -28.17, maxLat: -28.15, minLng: 30.22, maxLng: 30.24 };
  const rows = Array.from({ length: 600 }, (_, i) => ({ id: `P${i}`, parents: { lmPcode: "ZA5241" }, geometry: { centroid: { lat: -28.16 + (i % 20) * 0.0004, lng: 30.225 + Math.floor(i / 20) * 0.0004 } } }));
  const started = Date.now();
  const { records } = nearbyLayerRecords("premises", rows, { lmPcode: "ZA5241", wardPcode: "ZA5241006", bounds, wardGeometry });
  const ms = Date.now() - started;
  assert.equal(records.length, rows.filter(row => row.geometry.centroid.lat <= bounds.maxLat && row.geometry.centroid.lng <= bounds.maxLng).length);
  assert.ok(ms < 5000, `took ${ms} ms; re-validating the Ward for every record took minutes`);
});
