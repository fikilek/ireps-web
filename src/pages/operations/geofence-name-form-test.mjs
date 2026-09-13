import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Geofences rules GF-R001: the shared Create New Geofence form fixes the "Gf W<n>" start,
// and both pages send the composed standard name.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the form shows the fixed start and lets the user type only the name", async () => {
  const ui = await read("./geofence-shared-ui.jsx");
  assert.match(ui, /\{geofenceNamePrefix\(wardNumber\)\.trim\(\)\}<\/span>/);
  assert.match(ui, /value=\{geofenceNamePart\(draftName\)\}/);
  assert.match(ui, /onChange=\{\(event\) => setDraftName\(`\$\{geofenceNamePrefix\(wardNumber\)\}\$\{event\.target\.value\}`\)\}/);
  assert.match(ui, /Full name: <strong>\{composeGeofenceName\(wardNumber, geofenceNamePart\(draftName\)\)/);
});

test("the Geo-Fences page and TB Draft send the standard name", async () => {
  for (const [file, wardSource] of [["./GeoFencesPage.jsx", "wardPcode"], ["./targeted-batches/draft/sales-batch-geofence-workspace.jsx", "wardPcode"]]) {
    const source = await read(file);
    assert.match(source, new RegExp(`const draftWardNumber = wardNumberFromPcode\\(${wardSource}\\);`), file);
    assert.match(source, /const standardDraftName = composeGeofenceName\(draftWardNumber, geofenceNamePart\(draftName\)\);/, file);
    assert.match(source, /name: standardDraftName/, file);
    assert.match(source, /wardNumber=\{draftWardNumber\}/, file);
    assert.doesNotMatch(source, /name: draftName\.trim\(\)/, file);
  }
});
