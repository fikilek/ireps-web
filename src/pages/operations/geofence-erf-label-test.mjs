import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ERF labels: number only on the centroid, no centroid symbol, light text on an off-white label (rules 18.7)", async () => {
  const layers = await readFile(new URL("./GeofencePlanningLayers.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(layers, /M -1,0 L 1,0 M 0,-1 L 0,1/, "no centroid cross symbol");
  assert.doesNotMatch(layers, /showCentroids/);
  // TB-R061 (1.3.64): the one ERF look lives in geofence-map-helpers, so the GPS Sales map and the
  // Meter Location window cannot drift apart.
  assert.match(layers, /\.\.\.ERF_LABEL_STYLE/);
  const helpers = await readFile(new URL("./geofence-map-helpers.js", import.meta.url), "utf8");
  assert.match(helpers, /className: "ireps-erf-label"/);
  assert.match(helpers, /fontWeight: "400"/);
  assert.match(helpers, /color: "#334155"/);
  const css = await readFile(new URL("../../index.css", import.meta.url), "utf8");
  assert.match(css, /\.ireps-erf-label\s*\{[^}]*background:\s*#fbfbf9/);
});
