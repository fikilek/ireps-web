import test from "node:test";
import assert from "node:assert/strict";
import { trnMeterConnections, attachTrnMeterConnections } from "../src/pages/operations/md-bgo/trnMeterConnections.js";
test("one premise links its meters only; hiding meters removes links and restoring rebuilds them", () => {
 const premises=[{id:"p1",point:{lat:-28,lng:30}}];
 const meters=[{id:"m1",linkedPremiseId:"p1",point:{lat:-28.1,lng:30}},{id:"m2",linkedPremiseId:"p1",point:{lat:-28.2,lng:30}},{id:"missing",linkedPremiseId:"other",point:{lat:-28,lng:30}},{id:"noGps",linkedPremiseId:"p1"}];
 const links=trnMeterConnections(premises,meters);assert.deepEqual(links.map(link=>link.meterId),["m1","m2"]);
 const objects=[];class Polyline {constructor(options){this.options=options;objects.push(this)}setMap(map){this.map=map}}
 const clear=attachTrnMeterConnections({Polyline},"map",links);assert.equal(objects.length,2);assert.deepEqual(objects[0].options.path,[premises[0].point,meters[0].point]);
 clear();assert.ok(objects.every(line=>line.map===null));assert.deepEqual(trnMeterConnections(premises,meters,false),[]);assert.equal(trnMeterConnections(premises,meters,true).length,2);
 assert.deepEqual(trnMeterConnections([],meters),[]);
});
