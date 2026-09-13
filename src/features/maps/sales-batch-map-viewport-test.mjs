import test from "node:test";
import assert from "node:assert/strict";
import { salesBatchMapViewport } from "./sales-batch-map-viewport.js";
const lm = { bbox: { minLat: -29, maxLat: -27, minLng: 29, maxLng: 32 } };
const ward = { geometry: { type: "Polygon", coordinates: [[[30,-28],[31,-28],[31,-29],[30,-29],[30,-28]]] } };
test("camera uses the Ward first, and the LM while no Ward is known", () => {
 const before=structuredClone({ward,lm});
 assert.deepEqual(salesBatchMapViewport({ward,lm}),{scope:"WARD",center:{lat:-28.5,lng:30.5},bounds:{south:-29,north:-28,west:30,east:31},zoom:13});
 assert.deepEqual(salesBatchMapViewport({lm}),{scope:"LM",center:{lat:-28,lng:30.5},bounds:{south:-29,north:-27,west:29,east:32},zoom:10});
 assert.deepEqual({ward,lm},before);
});
test("bbox and centroid camera fallbacks tolerate missing geometry but never invent meter coordinates", () => {
 for(const centroid of [[30.5,-28.5],{lat:-28.5,lng:30.5},{latitude:-28.5,longitude:30.5}]) {
  const result=salesBatchMapViewport({ward:{centroid},lm});assert.equal(result.scope,"WARD");assert.deepEqual(result.center,{lat:-28.5,lng:30.5});assert.equal(result.bounds,null);
  assert.equal(Object.hasOwn(result,"point"),false);assert.equal(Object.hasOwn(result,"ready"),false);
 }
 assert.equal(salesBatchMapViewport({ward:{geometry:"bad",centroid:{lat:999,lng:0}},lm}).scope,"LM");
 assert.equal(salesBatchMapViewport({lm:{bbox:{minLat:5,maxLat:1,minLng:0,maxLng:1}}}),null);
 assert.equal(salesBatchMapViewport(),null);
});
test("MultiPolygon and serialized boundary geometry retain their complete camera extent", () => {
 const geometry={type:"MultiPolygon",coordinates:[ward.geometry.coordinates,[[[32,-28],[33,-28],[33,-29],[32,-29],[32,-28]]]]};
 assert.deepEqual(salesBatchMapViewport({lm:{geometry:JSON.stringify(geometry)}}).bounds,{south:-29,north:-28,west:30,east:33});
});
