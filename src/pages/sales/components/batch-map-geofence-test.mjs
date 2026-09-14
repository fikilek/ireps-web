import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { geofenceKind, getGeoFencePath } from "../../operations/geofence-map-helpers.js";

// Targeted Batch rules TB-R043 (1.3.10): the batch's geofence on the Batch Map and the Batch
// Report map; the incomplete-assets warning only for genuine gaps.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the LM geofence list keeps the batch link, so the map colours it as a batch geofence", async () => {
  const api = await read("../../../redux/mapGeofencesApi.js");
  assert.match(api, /targetedBatch: data\?\.targetedBatch \|\| null,/);
  const row = { geometry: { points: [{ latitude: -28.1, longitude: 30.1, order: 0 }, { latitude: -28.1, longitude: 30.2, order: 1 }, { latitude: -28.2, longitude: 30.2, order: 2 }] }, targetedBatch: { tbId: "TGB_20260914_012600_YHXQ" } };
  assert.equal(geofenceKind(row), "batch");
  assert.equal(getGeoFencePath(row).length, 3);
  assert.deepEqual(getGeoFencePath(null), []);
});

test("the shared batch map draws the geofence, fits to it and lists it in the legend", async () => {
  const map = await read("./SalesTargetedBatchMap.jsx");
  assert.match(map, /<ExistingGeoFenceLayer geofences=\{geofenceList\} selectedGeoFenceId="" interactive=\{false\} fitSelected=\{false\} \/>/);
  assert.match(map, /geofence && geofenceBoundary\.length >= 3 \? \[geofence\] : \[\]/);
  assert.match(map, /function fitMapToBatch\(map, \{ erfs, premises, meters, boundary = \[\] \}\)/);
  assert.match(map, /fitMapToBatch\(map, \{ erfs, premises, meters, boundary \}\)/);
  assert.match(map, /boundary=\{geofenceBoundary\}/);
  assert.match(map, /JSON\.stringify\(boundary\),/, "the geofence arriving refits once, like other data");
  assert.match(map, /<span style=\{styles\.geofenceLegend\} \/> Geofence/);
});

test("Batch Map page: geofence named at the top and passed to the map; warning only for genuine gaps", async () => {
  const page = await read("../SalesBatchMapPage.jsx");
  assert.match(page, /const geofence = useBatchGeofence\(activeLmPcode, batch\?\.geofenceId\);/);
  assert.match(page, /<span style=\{styles\.identityLabel\}>Geofence<\/span>/);
  assert.match(page, /geofence=\{geofence\}/);
  const warning = page.slice(page.indexOf("const missingReferenceCount"), page.indexOf("return (", page.indexOf("const missingReferenceCount")));
  assert.match(warning, /missingErfCount[\s\S]*missingPremiseCount[\s\S]*missingMeterCount[\s\S]*rowsMissingErfRef/);
  assert.doesNotMatch(warning, /rowsMissingPremiseRef|rowsMissingMeterRef/, "a new batch without premises or meters yet is not a warning");
});

test("Batch Report: geofence next to Ward, and drawn in its map pop-up", async () => {
  const report = await read("../SalesBatchReportPage.jsx");
  assert.match(report, /<InfoItem label="Ward" value=\{batch\.scope\.wardLabel\} \/>\s*<InfoItem label="Geofence" value=\{geofenceLabel\} \/>/);
  const modal = await read("./SalesBatchMapModal.jsx");
  assert.match(modal, /const geofence = useBatchGeofence\(normalizedLmPcode, mapStream\?\.batch\?\.geofenceId\);/);
  assert.match(modal, /geofence=\{geofence\}/);
});
