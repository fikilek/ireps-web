import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Targeted Batch rules 18.7, amendment 1.3.4.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("TB Draft shows a spinner with a short message wherever it is busy", async () => {
  const spinner = await read("../../../../components/busy-spinner.jsx");
  assert.match(spinner, /className=\{`ireps-spinner/);
  assert.match(await read("../../../../index.css"), /@keyframes ireps-spin[\s\S]*\.ireps-spinner\s*\{/);
  const review = await read("../TargetedBatchDraftReview.jsx");
  assert.match(review, /<BusySpinner label="Loading draft…"\/>/);
  assert.match(review, /locating \? <BusySpinner label="Locating meters…"/);
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /<BusySpinner label="Locating meters…" size=\{20\}\/>/);
  assert.match(workspace, /layersLoading && <div style=\{layersLoadingStripStyle\}><BusySpinner label="Loading map layers…"/);
  assert.match(await read("../../GeofencePlanningLayers.jsx"), /\{loading \? <BusySpinner size=\{11\} asStatus=\{false\} \/> : null\}/);
  assert.match(await read("../../geofence-shared-ui.jsx"), /createState\.isLoading \? <BusySpinner label="Creating…"/);
  assert.match(await read("../TargetedBatchConfirmModal.jsx"), /isCreating \? <BusySpinner label="Creating…"/);
});

test("switching Geofences on fits every Ward geofence with the draft's meters; off returns to the meters", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /<GeofencesLayerCamera active=\{Boolean\(visibility\.geofences\)\} geofences=\{geofences\} meterPoints=\{meterPoints\}\/>/);
  assert.match(workspace, /const points = active \? \[\.\.\.geofences\.flatMap\(fence => getGeoFencePath\(fence\)\), \.\.\.meterPoints\] : meterPoints;/);
  assert.match(workspace, /if \(!switched && !listArrived\) return undefined;/, "only reacts to the switch, never overriding panning");
});

test("the map is not redrawn on every draft rebuild", async () => {
  const markers = await read("./sales-batch-map-layers.jsx");
  assert.match(markers, /\}, \[map, markerKey, onHighlight\]\);/);
  assert.doesNotMatch(markers, /\}, \[map, rows, onHighlight\]\);/);
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /const meterPoints = useMemo\(\(\) => JSON\.parse\(meterKey\), \[meterKey\]\);/);
  assert.match(workspace, /const emptyModel = useMemo\(\(\) => emptyNearbyModel\(\), \[\]\);/);
  assert.match(workspace, /const geofences = useMemo\(\(\) => geofenceData \|\| \[\], \[geofenceData\]\);/);
});
