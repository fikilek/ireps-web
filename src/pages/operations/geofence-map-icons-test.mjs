import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ERF_LABEL_BELOW_ICON_OFFSET, SALES_ICON_SCALE, SALES_STATUS_GLYPHS, erfIdsUnderMeterIcons } from "./geofence-map-icons.js";

// Targeted Batch rules 18.7, amendment 1.3.2.
test("nearby Sales icons: dark grey triangle, amber star, green square at the draft-marker size", async () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SALES_STATUS_GLYPHS).map(([status, glyph]) => [status, [glyph.shape, glyph.color]])), {
    NOT_STARTED: ["triangle", "#475569"],
    IN_PROGRESS: ["star", "#f59e0b"],
    COMPLETED: ["square", "#16a34a"],
  });
  assert.equal(SALES_ICON_SCALE, 13);
  const layers = await readFile(new URL("./GeofencePlanningLayers.jsx", import.meta.url), "utf8");
  assert.match(layers, /path: glyph\.path,\s*scale: SALES_ICON_SCALE,\s*fillColor: glyph\.color,\s*fillOpacity: 1,\s*strokeColor: "#ffffff",\s*strokeWeight: 2,/);
  const draftMarkers = await readFile(new URL("./targeted-batches/draft/sales-batch-map-layers.jsx", import.meta.url), "utf8");
  assert.match(draftMarkers, /const icon = \{ path: window\.google\.maps\.SymbolPath\.CIRCLE,/, "the draft's own meters stay lettered circles");
});

test("Map Layers panel closes with × and reopens from a Layers button; rows show the same icons", async () => {
  const layers = await readFile(new URL("./GeofencePlanningLayers.jsx", import.meta.url), "utf8");
  assert.match(layers, /aria-label="Close map layers"/);
  assert.match(layers, /aria-label="Show map layers"/);
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]) assert.match(layers, new RegExp(`glyphStatus=\\{SALES_STATUSES\\.${status}\\}`));
});

test("an ERF label moves just below a meter icon that sits on its centroid", async () => {
  const erfs = [{ id: "A", point: { lat: -28.1651, lng: 30.2561 } }, { id: "B", point: { lat: -28.1655, lng: 30.2565 } }, { id: "C", point: null }];
  const onA = { lat: -28.16511, lng: 30.25611 }; // about 1.5 m from A's centroid
  const nearB = { lat: -28.16556, lng: 30.2565 }; // about 6.6 m from B's centroid
  assert.deepEqual([...erfIdsUnderMeterIcons(erfs, [onA, nearB, null, { lat: Number.NaN, lng: 1 }])], ["A"]);
  assert.deepEqual([...erfIdsUnderMeterIcons(erfs, [])], []);
  assert.ok(ERF_LABEL_BELOW_ICON_OFFSET > SALES_ICON_SCALE, "the moved label clears the icon");
  const layers = await readFile(new URL("./GeofencePlanningLayers.jsx", import.meta.url), "utf8");
  assert.match(layers, /labelOrigin: new window\.google\.maps\.Point\(0, ERF_LABEL_BELOW_ICON_OFFSET\)/);
  assert.match(layers, /\}, \[map, model\?\.erfs, visibility\.erfs, zoom, salesMarkers, meterPoints\]\);/);
});
