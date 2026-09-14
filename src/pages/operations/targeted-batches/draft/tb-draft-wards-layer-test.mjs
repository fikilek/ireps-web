import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WARD_BOUNDARY_STYLE, geoJsonPolygonToGooglePaths, parseGeometry, pointsCentre } from "../../geofence-map-helpers.js";

// Targeted Batch rules 18.7 (1.3.7): TB Draft Wards layer; TB-R017 Allocate / Allocated.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("one Ward boundary look, shared with the Geo-Fences page", async () => {
  assert.deepEqual({ ...WARD_BOUNDARY_STYLE }, { strokeColor: "#f59e0b", strokeOpacity: 1, strokeWeight: 3, fillColor: "#f59e0b", fillOpacity: 0.08 });
  const geoFencesPage = await read("../../GeoFencesPage.jsx");
  assert.match(geoFencesPage, /return <WardBoundaryPolygons wards=\{boundary\} \/>;/);
  assert.doesNotMatch(geoFencesPage, /#f59e0b/, "the page no longer draws its own Ward polygon");
  assert.doesNotMatch(geoFencesPage, /^function parseGeometry|^function geoJsonPolygonToGooglePaths/m);
  const layers = await read("../../geofence-map-layers.jsx");
  assert.match(layers, /export function WardBoundaryPolygons\(\{ wards = \[\] \}\)/);
  assert.match(layers, /\{ paths, \.\.\.WARD_BOUNDARY_STYLE, clickable: false, zIndex: 20 \}/);
});

test("Ward geometry helpers read JSON text and multipolygons; labels sit at the meters' centre", () => {
  const square = [[[30, -28], [30.1, -28], [30.1, -28.1], [30, -28.1], [30, -28]]];
  assert.equal(geoJsonPolygonToGooglePaths(parseGeometry(JSON.stringify({ type: "Polygon", coordinates: square }))).length, 1);
  assert.equal(geoJsonPolygonToGooglePaths({ type: "MultiPolygon", coordinates: [square, square] }).length, 2);
  assert.equal(parseGeometry("not json"), null);
  assert.deepEqual(pointsCentre([{ lat: -28, lng: 30 }, { lat: -28.2, lng: 30.2 }]), { lat: -28.1, lng: 30.1 });
  assert.equal(pointsCentre([]), null);
});

test("TB Draft Wards layer: off at the start, every Ward of the draft's meters, usable with several Wards, no camera move", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /geofences: false, wards: false \}\);/);
  assert.match(workspace, /\{visibility\.wards && <WardBoundaryPolygons wards=\{wardLayer\}\/>\}/);
  assert.match(workspace, /label: salesDraftWardLabel\(pcode, wardDoc\), labelPoint: pointsCentre\(points\)/);
  assert.match(workspace, /wardsCount=\{wardLayer\.length\}/);
  assert.doesNotMatch(workspace, /WardsLayerCamera|fitMapToWard/);
  const panel = await read("../../GeofencePlanningLayers.jsx");
  assert.match(panel, /<ToggleRow disabled=\{!wardsCount\}\s+checked=\{Boolean\(visibility\.wards\)\}\s+label="Wards"/);
});

test("TB Register action reads Allocate, then Allocated (TB-R017)", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /<span style=\{styles\.allocationStatusLabel\}>\s*Allocated\s*<\/span>/);
  assert.match(register, /style=\{styles\.rowLinkButton\}\s+title="Open TB Allocation to allocate this batch to a team or service provider\."\s*>\s*Allocate\s*<\/Link>/);
  assert.doesNotMatch(register, /\{allocationState\.label\}/, "the column shows the action words, not the filter label");
});
