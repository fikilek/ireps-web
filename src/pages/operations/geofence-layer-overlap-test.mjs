import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GEOFENCE_KIND_COLORS, geofenceKind, geofenceLabelPoint, pathsOverlap } from "./geofence-map-helpers.js";

// Targeted Batch rules 1.3.3 (18.5, 18.7).
const square = (lat, lng, size) => [{ lat, lng }, { lat, lng: lng + size }, { lat: lat + size, lng: lng + size }, { lat: lat + size, lng }];

test("pathsOverlap: shared ground counts; separate or edge-touching areas do not", () => {
  assert.equal(pathsOverlap(square(0, 0, 2), square(1, 1, 2)), true, "partly overlapping");
  assert.equal(pathsOverlap(square(0, 0, 4), square(1, 1, 1)), true, "one inside the other");
  assert.equal(pathsOverlap(square(1, 1, 1), square(0, 0, 4)), true, "other way round");
  assert.equal(pathsOverlap([{ lat: 0, lng: 1 }, { lat: 3, lng: 1 }, { lat: 3, lng: 2 }, { lat: 0, lng: 2 }], [{ lat: 1, lng: 0 }, { lat: 2, lng: 0 }, { lat: 2, lng: 3 }, { lat: 1, lng: 3 }]), true, "crossing strips, no corner inside");
  assert.equal(pathsOverlap(square(0, 0, 1), square(5, 5, 1)), false, "far apart");
  assert.equal(pathsOverlap(square(0, 0, 1), square(0, 1, 1)), false, "touching along an edge only");
  assert.equal(pathsOverlap(square(0, 0, 1), square(1, 1, 1)), false, "touching at one corner only");
  assert.equal(pathsOverlap(square(0, 0, 1), square(0, 0, 1)), true, "the same shape drawn twice");
  assert.equal(pathsOverlap(square(0, 0, 1).slice(0, 2), square(0, 0, 1)), false, "fewer than 3 points");
});

test("geofence kind, colours and label point", () => {
  assert.equal(geofenceKind({ targetedBatch: { tbId: "TGB_20260913_160443_MOQW" } }), "batch");
  assert.equal(geofenceKind({ name: "Gf W6 Busuku" }), "area");
  assert.deepEqual(GEOFENCE_KIND_COLORS, { area: "#10b981", batch: "#7c3aed" });
  assert.deepEqual(geofenceLabelPoint({ geometry: { centroid: { latitude: -28.1, longitude: 30.2 } } }), { lat: -28.1, lng: 30.2 });
  assert.deepEqual(geofenceLabelPoint({ geometry: { points: [{ latitude: 0, longitude: 1, order: 0 }, { latitude: 2, longitude: 1, order: 1 }, { latitude: 2, longitude: 3, order: 2 }, { latitude: 0, longitude: 3, order: 3 }] } }), { lat: 1, lng: 2 });
  assert.equal(geofenceLabelPoint({}), null);
});

test("layer, labels, row and Overlaps line are wired on the shared components and TB Draft", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const layer = await read("./geofence-map-layers.jsx");
  assert.match(layer, /strokeColor: selected \? "#dc2626" : kindColor/);
  assert.match(layer, /className: "ireps-geofence-label"/);
  assert.match(layer, /Batch geofence · \$\{escapeHtml\(geoFence\.targetedBatch\?\.tbId/);
  assert.match(await read("../../index.css"), /\.ireps-geofence-label\s*\{[^}]*background:\s*#ffffff/);
  assert.match(await read("./GeofencePlanningLayers.jsx"), /label="Geofences \(whole Ward\)"/);
  assert.match(await read("./geofence-shared-ui.jsx"), /\{draftInside\}\s*\{overlaps\}/);
  const workspace = await read("./targeted-batches/draft/sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /geofences: false[, ]/);
  assert.match(workspace, /geofencesCount=\{geofences\.length\}/);
  assert.match(workspace, /overlaps=\{overlapsNote\}/);
  assert.match(workspace, /visibility\.geofences \? geofences : \[\]/);
});
