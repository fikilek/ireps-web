import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ERF labels: number only on the centroid, no centroid symbol, light text on an off-white label (rules 18.7)", async () => {
  const layers = await readFile(new URL("./GeofencePlanningLayers.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(layers, /M -1,0 L 1,0 M 0,-1 L 0,1/, "no centroid cross symbol");
  assert.doesNotMatch(layers, /showCentroids/);
  assert.match(layers, /className: "ireps-erf-label"/);
  assert.match(layers, /fontWeight: "400"/);
  assert.match(layers, /color: "#334155"/);
  const css = await readFile(new URL("../../index.css", import.meta.url), "utf8");
  assert.match(css, /\.ireps-erf-label\s*\{[^}]*background:\s*#fbfbf9/);
});
