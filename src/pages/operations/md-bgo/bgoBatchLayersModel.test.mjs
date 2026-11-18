import test from "node:test";
import assert from "node:assert/strict";
import { batchMapLayers } from "./bgoBatchLayersModel.js";

const squareFence = {
  id: "gf1",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [30.0, -28.0],
        [30.01, -28.0],
        [30.01, -28.01],
        [30.0, -28.01],
        [30.0, -28.0],
      ],
    ],
  },
};

const sampleErfs = [
  { id: "e_in", centroid: { lat: -28.005, lng: 30.005 } },
  { id: "e_out", centroid: { lat: -28.05, lng: 30.05 } },
];
const samplePremises = [
  { id: "p_in", point: { lat: -28.005, lng: 30.005 } },
  { id: "p_out", point: { lat: -28.05, lng: 30.05 } },
];
const sampleMeters = [
  { id: "m_in", point: { lat: -28.005, lng: 30.005 } },
  { id: "m_out", point: { lat: -28.05, lng: 30.05 } },
];

test("batchMapLayers clips/filters assets to geofence boundaries by default (MD BGO)", () => {
  const result = batchMapLayers({
    erfs: sampleErfs,
    premises: samplePremises,
    meters: sampleMeters,
    geofences: [squareFence],
  });
  assert.equal(result.erfs.length, 1);
  assert.equal(result.premises.length, 1);
  assert.equal(result.meters.length, 1);
  assert.equal(result.meters[0].id, "m_in");
});

test("batchMapLayers preserves all assets when clipToGeofences is false (TRN BGO ward-scoped)", () => {
  const result = batchMapLayers({
    erfs: sampleErfs,
    premises: samplePremises,
    meters: sampleMeters,
    geofences: [],
    clipToGeofences: false,
  });
  assert.equal(result.erfs.length, 2);
  assert.equal(result.premises.length, 2);
  assert.equal(result.meters.length, 2);
});
