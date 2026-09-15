import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sortGeofencesNewestFirst, geofenceDescriptionLabel, geofenceCreatedLabel, NO_DESCRIPTION_GIVEN } from "./geofence-list.js";

// Geofences rules GF-R003: the Existing Geofences list.
test("newest first by creation date; a geofence without a date goes last", () => {
  const fences = [
    { name: "Gf W6 Acacia", metadata: { createdAt: "2026-09-13T23:30:35.545Z" } },
    { name: "Gf W6 Old Timer" },
    { name: "Gf W6 Old Acre2", metadata: { createdAt: "2026-09-15T07:39:00.000Z" } },
    { name: "Gf W6 Town", metadata: { createdAt: { seconds: 1785628800, nanoseconds: 0 } } },
    { name: "Gf W6 Old Acre1", metadata: { createdAt: "2026-09-15T05:05:18.233Z" } },
  ];
  assert.deepEqual(sortGeofencesNewestFirst(fences).map(fence => fence.name), ["Gf W6 Old Acre2", "Gf W6 Old Acre1", "Gf W6 Acacia", "Gf W6 Town", "Gf W6 Old Timer"]);
  assert.deepEqual(fences[0].name, "Gf W6 Acacia", "the page's own list is not reordered in place");
  assert.deepEqual(sortGeofencesNewestFirst(), []);
});

test("created line and description label", () => {
  assert.match(geofenceCreatedLabel({ metadata: { createdAt: "2026-09-15T05:52:20.108Z", createdByUser: "Zamo Ngubs" } }), /^Created .*2026.* · Zamo Ngubs$/);
  assert.equal(geofenceCreatedLabel({ metadata: { createdByUser: "NAv" } }), "Created date unknown");
  for (const description of [undefined, "", "   ", "NAv"]) assert.equal(geofenceDescriptionLabel({ description }), NO_DESCRIPTION_GIVEN);
  assert.equal(NO_DESCRIPTION_GIVEN, "No Description Given");
  assert.equal(geofenceDescriptionLabel({ description: " Old Acre, both sides " }), "Old Acre, both sides");
});

test("the window keeps its title and × fixed and scrolls only the list", async () => {
  const shared = await readFile(new URL("./geofence-shared-ui.jsx", import.meta.url), "utf8");
  assert.match(shared, /<div style=\{\{ \.\.\.modalCardStyle, \.\.\.fixedHeaderCardStyle, maxWidth: width \}\}>\s*<div style=\{\{ \.\.\.modalHeaderStyle, flexShrink: 0 \}\}>/);
  assert.match(shared, /<div style=\{scrollingBodyStyle\}>\{children\}<\/div>/);
  assert.match(shared, /const scrollingBodyStyle = \{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" \};/);
  assert.match(shared, /\{sortGeofencesNewestFirst\(visibleGeofences\)\.map\(\(geoFence\) => \(/);
  assert.match(shared, /\{geofenceCreatedLabel\(geoFence\)\}/); assert.match(shared, /\{geofenceDescriptionLabel\(geoFence\)\}/);
  assert.doesNotMatch(shared, /geoFence\.description \|\| "NAv"/);
});
