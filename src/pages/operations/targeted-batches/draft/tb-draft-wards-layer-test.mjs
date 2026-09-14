import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WARD_BOUNDARY_STYLE, geoJsonPolygonToGooglePaths, nearestPointOnPaths, parseGeometry, pointInPaths, pointsCentre, wardNameLabelPoint } from "../../geofence-map-helpers.js";

// Targeted Batch rules 18.7 (1.3.8): TB Draft Wards layer; TB-R017 Allocate / Allocated.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const square = (west, east, north, south) => [[{ lat: north, lng: west }, { lat: north, lng: east }, { lat: south, lng: east }, { lat: south, lng: west }, { lat: north, lng: west }]];

test("one Ward boundary look, shared with the Geo-Fences page", async () => {
  assert.deepEqual({ ...WARD_BOUNDARY_STYLE }, { strokeColor: "#f59e0b", strokeOpacity: 1, strokeWeight: 3, fillColor: "#f59e0b", fillOpacity: 0.08 });
  const geoFencesPage = await read("../../GeoFencesPage.jsx");
  assert.match(geoFencesPage, /return <WardBoundaryPolygons wards=\{boundary\} \/>;/);
  assert.doesNotMatch(geoFencesPage, /#f59e0b/, "the page no longer draws its own Ward polygon");
  assert.doesNotMatch(geoFencesPage, /^function parseGeometry|^function geoJsonPolygonToGooglePaths/m);
  const layers = await read("../../geofence-map-layers.jsx");
  assert.match(layers, /export function WardBoundaryPolygons\(\{ wards = \[\] \}\)/);
  assert.match(layers, /\{ paths, \.\.\.WARD_BOUNDARY_STYLE, clickable: false, zIndex: 20 \}/);
  assert.match(layers, /labelOrigin: new window\.google\.maps\.Point\(0, ward\.labelAbove \? -30 : 0\)/);
});

test("Ward geometry helpers read JSON text, multipolygons and holes", () => {
  const ring = [[30, -28], [30.1, -28], [30.1, -28.1], [30, -28.1], [30, -28]];
  assert.equal(geoJsonPolygonToGooglePaths(parseGeometry(JSON.stringify({ type: "Polygon", coordinates: [ring] }))).length, 1);
  assert.equal(geoJsonPolygonToGooglePaths({ type: "MultiPolygon", coordinates: [[ring], [ring]] }).length, 2);
  assert.equal(parseGeometry("not json"), null);
  assert.deepEqual(pointsCentre([{ lat: -28, lng: 30 }, { lat: -28.2, lng: 30.2 }]), { lat: -28.1, lng: 30.1 });
  assert.equal(pointsCentre([]), null);
  const withHole = [...square(30, 30.1, -28, -28.1), ...square(30.04, 30.06, -28.04, -28.06)];
  assert.equal(pointInPaths({ lat: -28.02, lng: 30.02 }, withHole), true);
  assert.equal(pointInPaths({ lat: -28.05, lng: 30.05 }, withHole), false, "inside the hole is outside the Ward");
  const nearest = nearestPointOnPaths({ lat: -28.05, lng: 30.2 }, square(30, 30.1, -28, -28.1));
  assert.ok(Math.abs(nearest.point.lng - 30.1) < 1e-9 && Math.abs(nearest.point.lat + 28.05) < 1e-9);
});

test("a neighbouring Ward is named just across the line from the meters, inside itself", () => {
  // Ward 6 west of lng 30.01, Ward 4 east of it; the meters sit in Ward 6, 50 m from the line.
  const ward6 = square(30.0, 30.01, -28.0, -28.01), ward4 = square(30.01, 30.02, -28.0, -28.01);
  const meters = { lat: -28.005, lng: 30.01 - 50 / (Math.cos(28.005 * Math.PI / 180) * 111320) };
  assert.equal(wardNameLabelPoint(ward6, meters), meters, "the meters' own Ward is named at the meters");
  const label = wardNameLabelPoint(ward4, meters);
  assert.equal(pointInPaths(label, ward4), true);
  const metresPastLine = (label.lng - 30.01) * Math.cos(28.005 * Math.PI / 180) * 111320;
  assert.ok(metresPastLine > 30 && metresPastLine < 50, `label ${metresPastLine.toFixed(1)} m inside Ward 4`);
  assert.deepEqual(wardNameLabelPoint(ward4, null, { centroid: { lat: -28.005, lng: 30.015 } }), { lat: -28.005, lng: 30.015 }, "no meters: the stored centroid");
});

test("TB Draft Wards layer: listed from the start, unticked, every LM Ward, loaded on demand, no camera move", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /geofences: false, wards: false \}\);/);
  assert.match(workspace, /useGetWardBoundariesByLmQuery\(lmPcode, \{ skip: !visibility\.wards \|\| !lmPcode \}\)/);
  assert.match(workspace, /\{visibility\.wards && <WardBoundaryPolygons wards=\{wardLayer\}\/>\}/);
  assert.match(workspace, /labelPoint: own \? pointsCentre\(own\) : wardNameLabelPoint\(paths, batchCentre, \{ centroid: ward\.centroid \}\)/);
  assert.match(workspace, /label: number \? `Ward \$\{number\}` : ward\.name/);
  assert.match(workspace, /showWards wardsCount=\{visibility\.wards \? wardLayer\.length : null\} wardsLoading=\{wardsLoading\}/);
  assert.doesNotMatch(workspace, /WardsLayerCamera|fitMapToWard/);
  const panel = await read("../../GeofencePlanningLayers.jsx");
  assert.match(panel, /\{showWards \? \(/);
  assert.match(panel, /<ToggleRow\s+checked=\{Boolean\(visibility\.wards\)\}\s+label="Wards"/, "never disabled, even for a multi-Ward draft");
});

test("TB Register action reads Allocate, then Allocated (TB-R017)", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /<span style=\{styles\.allocationStatusLabel\}>\s*Allocated\s*<\/span>/);
  assert.match(register, /style=\{styles\.rowLinkButton\}\s+title="Open TB Allocation to allocate this batch to a team or service provider\."\s*>\s*Allocate\s*<\/Link>/);
  assert.doesNotMatch(register, /\{allocationState\.label\}/, "the column shows the action words, not the filter label");
});
