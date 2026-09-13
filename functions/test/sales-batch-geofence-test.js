import test from "node:test";
import assert from "node:assert/strict";
import { polygonFromPoints, strictlyInside, strictlyWithinWard, normalizeBatchGeometry } from "../geofences/sales-batch-geometry.js";

const polygon = coordinates => ({ type: "Polygon", coordinates });
const box = (a, b, c, d) => polygon([[[a,b],[c,b],[c,d],[a,d],[a,b]]]);
test("strict point containment excludes edges, vertices and hole boundaries", () => {
  const outer = box(0,0,10,10);
  const withHole = polygon([...outer.coordinates, box(3,3,7,7).coordinates[0]]);
  assert.equal(strictlyInside([1,1], withHole), true);
  for (const p of [[0,0],[0,5],[3,4],[4,4],[11,1]]) assert.equal(strictlyInside(p, withHole), false);
});
test("Ward containment rejects touching, crossing, enclosing holes and concave escapes", () => {
  const ward = box(0,0,10,10);
  assert.equal(strictlyWithinWard(box(1,1,2,2),ward),true);
  for (const fence of [box(0,1,2,2),box(0,0,2,2),box(1,1,11,2),box(-1,0,11,1)]) assert.equal(strictlyWithinWard(fence,ward),false);
  const holeWard=polygon([...ward.coordinates,box(4,4,6,6).coordinates[0]]);
  assert.equal(strictlyWithinWard(box(3,3,7,7),holeWard),false);
  const concave=polygon([[[0,0],[10,0],[10,10],[6,10],[6,4],[4,4],[4,10],[0,10],[0,0]]]);
  assert.equal(strictlyWithinWard(box(2,2,8,8),concave),false);
});
test("MultiPolygon islands never admit a fence across the gap", () => {
  const islands={type:"MultiPolygon",coordinates:[box(0,0,4,4).coordinates,box(6,0,10,4).coordinates]};
  assert.equal(strictlyWithinWard(box(1,1,3,3),islands),true);
  assert.equal(strictlyWithinWard(box(1,1,9,3),islands),false);
  assert.equal(strictlyInside([5,2],islands),false);
});
test("invalid drawing vertices, duplicate points and self-crossings reject rather than disappear", () => {
  for (const points of [[{latitude:null,longitude:1},{latitude:1,longitude:2},{latitude:2,longitude:1}],[[0,0],[1,1],[2,2]],[[0,0],[2,2],[0,2],[2,0]],[[0,0],[0,0],[1,1]]]) assert.throws(()=>polygonFromPoints(points));
  assert.throws(()=>normalizeBatchGeometry(polygon([[[0,0],[2,0],[2,2],[0,2]]])));
  const fence=polygonFromPoints([[1,1],[2,1],[2,2],[1,2]]);
  assert.equal(strictlyWithinWard(fence,box(0,0,3,3)),true);
});

test("canonical geometry gives identical hashes across winding and starting vertex",()=>{
 const first=polygonFromPoints([[1,1],[2,1],[2,2],[1,2]]);
 for(const points of [[[2,1],[2,2],[1,2],[1,1]],[[1,2],[2,2],[2,1],[1,1]]])assert.deepEqual(polygonFromPoints(points),first);
});
