import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ERF_LABEL_BELOW_ICON_OFFSET, erfIdsUnderMeterIcons } from "../../operations/geofence-map-icons.js";

// Targeted Batch rules TB-R055.7 (1.3.50): on the GPS Sales map the red GPS pins are never hidden
// by the ERF lines and numbers, and an ERF number on a pin moves just below it (as TB Draft, 18.7).
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const zIndexAfter = (source, marker) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `found ${marker}`);
  return Number(source.slice(at).match(/zIndex: (\d+)/)[1]);
};

test("the red pins sit above the ERF numbers and below the points of a shape being drawn", async () => {
  const section = await read("./SalesGpsMapSection.jsx");
  const pins = Number(section.match(/const METER_MARKER_Z_INDEX = (\d+);/)[1]);
  const erfLabels = zIndexAfter(await read("../../operations/GeofencePlanningLayers.jsx"), 'className: "ireps-erf-label"');
  const drawingPoints = zIndexAfter(await read("../../operations/geofence-map-layers.jsx"), "text: String(index + 1),");
  assert.ok(pins > erfLabels, `pins ${pins} above ERF numbers ${erfLabels}`);
  assert.ok(pins < drawingPoints, `pins ${pins} below drawing points ${drawingPoints}`);
  assert.match(section, /icon: buildMeterMarkerIcon\(\),\s*zIndex: METER_MARKER_Z_INDEX,/, "a new pin");
  assert.match(section, /marker\.setZIndex\(isFocused \? 1200 : isHovered \? 1000 : METER_MARKER_Z_INDEX\);/, "a pin after hover or focus");
  assert.doesNotMatch(section, /zIndex: 40\b|: 40\);/, "no pin keeps the old place under the ERF numbers");
});

test("the red pins reach the ERF numbers, so a number on a pin moves below it", async () => {
  const section = await read("./SalesGpsMapSection.jsx");
  assert.match(section, /const pinPoints = useMemo\(\s*\(\) => points\.map\(\(point\) => \(\{ lat: point\.latitude, lng: point\.longitude \}\)\),\s*\[points\],\s*\);/);
  assert.match(section, /\{layers\.renderOnMap\(fence\.isCreateMode, pinPoints\)\}/);
  const layers = await read("./sales-map-layers.jsx");
  assert.match(layers, /const renderOnMap = \(isCreateMode, meterPoints = NO_METER_POINTS\) =>/);
  assert.match(layers, /<GeofencePlanningLayers [^>]*meterPoints=\{meterPoints\}\/>/);
  assert.doesNotMatch(layers, /meterPoints=\{NO_METER_POINTS\}/);

  // A pin on ERF A's centre moves A's number below it; ERF B, 20 m away, keeps its place.
  const erfs = [{ id: "A", point: { lat: -28.16, lng: 30.23 } }, { id: "B", point: { lat: -28.16018, lng: 30.23 } }];
  const pins = [{ lat: -28.16, lng: 30.23 }];
  assert.deepEqual([...erfIdsUnderMeterIcons(erfs, pins)], ["A"]);
  assert.ok(ERF_LABEL_BELOW_ICON_OFFSET > 11 + 3, "the moved number clears the largest (focused) pin");
});
