import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Targeted Batch rules 18.7, amendment 1.3.17: each map layer loads on its own and is not loaded
// again while the Ward and area stay the same; the panel labels the counts as near the draft.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("each layer is its own read, keyed only on the Ward, the area and the layer", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /const layerRead = layer => \[\{ lmPcode, wardPcode, bounds, layer \}, \{ skip: !layersReady \|\| !layers\.includes\(layer\) \}\];/);
  for (const layer of ["erfs", "sales", "premises", "assets"]) assert.match(workspace, new RegExp(`const \\{ data: ${layer}Layer \\} = useGetSalesBatchNearbyLayerQuery\\(\\.\\.\\.layerRead\\("${layer}"\\)\\);`));
  assert.doesNotMatch(workspace, /useGetSalesBatchNearbyQuery|wardGeometry: ward\?\.geometry, layers/, "no single read of every layer");
});

test("loaded layers do not restart while TB Draft briefly waits for draft data", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /const layersReady = Boolean\(wardPcode && bounds\);/, "not tied to live.ready");
  assert.match(workspace, /useGetGeoFencesByWardQuery\(\{ lmPcode, wardPcode \}, \{ skip: !lmPcode \|\| !wardPcode \}\)/);
  assert.match(workspace, /disabled=\{!layersReady\}/);
  const api = await read("../../../../redux/salesTargetedBatchApi.js");
  assert.match(api, /getSalesBatchNearbyLayer: builder\.query\(\{/);
  assert.match(api, /const wardSnapshot = await getDoc\(doc\(db, "wards", args\.wardPcode\)\);/, "the layer reads its Ward itself");
  assert.doesNotMatch(api, /getSalesBatchNearby: builder\.query/);
});

test("the panel says the counts are for the area near the draft; the legend covers batched Non-GPS Sales", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /countsNote="Counts are for the area near the draft"/);
  assert.match(workspace, /Non-GPS Sales in a batch at the position saved with their batch/);
  const panel = await read("../../GeofencePlanningLayers.jsx");
  assert.match(panel, /\{countsNote \? <div style=\{countsNoteStyle\}>\{countsNote\}<\/div> : null\}/);
  assert.match(panel, /item\.positionNote \? ` • \$\{item\.positionNote\}` : ""/);
});
