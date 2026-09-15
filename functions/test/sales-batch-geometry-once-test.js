import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBatchGeometry, strictlyInside } from "../geofences/sales-batch-geometry.js";

// Targeted Batch rules 18.7 (1.3.30): a boundary is validated once; checking many points against it
// is fast and gives exactly the same answers.
const square = { type: "Polygon", coordinates: [[[30, -28], [30.01, -28], [30.01, -28.01], [30, -28.01], [30, -28]]] };

test("a validated shape, the same stored text and the same object are not validated again", () => {
  const normalized = normalizeBatchGeometry(square);
  assert.equal(normalizeBatchGeometry(normalized), normalized, "a validated shape is recognised");
  assert.equal(normalizeBatchGeometry(square), normalized, "the same object is remembered");
  const text = JSON.stringify(square);
  assert.equal(normalizeBatchGeometry(text), normalizeBatchGeometry(text), "the same stored text is validated once");
  assert.deepEqual(normalizeBatchGeometry(text), normalized, "and gives the same shape");
});

test("invalid shapes are still refused every time", () => {
  const bowtie = { type: "Polygon", coordinates: [[[30, -28], [30.01, -28.01], [30.01, -28], [30, -28.01], [30, -28]]] };
  assert.throws(() => normalizeBatchGeometry(bowtie), /not simple and valid/);
  assert.throws(() => normalizeBatchGeometry(bowtie), /not simple and valid/);
  assert.throws(() => normalizeBatchGeometry(JSON.stringify(bowtie)), /not simple and valid/);
});

test("the same answers: inside, outside and on the boundary", () => {
  const normalized = normalizeBatchGeometry(square);
  for (const [point, expected] of [[{ lat: -28.005, lng: 30.005 }, true], [{ lat: -28.02, lng: 30.005 }, false], [{ lat: -28, lng: 30.005 }, false], [{ lat: -28.005, lng: 30 }, false]]) {
    assert.equal(strictlyInside(point, normalized), expected, JSON.stringify(point));
    assert.equal(strictlyInside(point, JSON.stringify(square)), expected, `${JSON.stringify(point)} from text`);
  }
});

test("a 3 000-point Ward is validated once; a thousand point checks then take milliseconds", () => {
  const ring = Array.from({ length: 3000 }, (_, i) => [30.23 + 0.05 * Math.cos((2 * Math.PI * i) / 3000), -28.16 + 0.05 * Math.sin((2 * Math.PI * i) / 3000)]);
  const ward = JSON.stringify({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
  const started = Date.now();
  let inside = 0;
  for (let i = 0; i < 1000; i += 1) if (strictlyInside({ lat: -28.16 + (i % 50) * 0.0001, lng: 30.23 }, ward)) inside += 1;
  const ms = Date.now() - started;
  assert.equal(inside, 1000);
  assert.ok(ms < 5000, `took ${ms} ms; validating the Ward for every point took about 5 minutes`);
});
