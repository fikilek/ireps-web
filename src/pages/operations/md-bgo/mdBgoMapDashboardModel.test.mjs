import test from "node:test";
import assert from "node:assert/strict";
import { buildMdBgoMapDashboard, mapDashboardContains, mdMapAreaColour, normalizeMapDashboardErf } from "./mdBgoMapDashboardModel.js";

const square = { type: "Polygon", coordinates: [[[30,-29],[31,-29],[31,-28],[30,-28],[30,-29]]] };
const fence = (id, points = [{latitude:-29,longitude:30},{latitude:-29,longitude:31},{latitude:-28,longitude:31},{latitude:-28,longitude:30}]) => ({ id, name:id, status:"ACTIVE", parents:{wardPcode:"W001"}, geometry:{points:points.map((p,order)=>({...p,order}))} });
const batch = (id, erfIds, target = {id:"TEAM1",type:"TEAM",name:"Peter Team"}) => ({id,operationType:"METER_DISCOVERY",scope:{lmPcode:"LM",wardPcode:"W001"},workflow:{state:"IN_PROGRESS"},geofenceRef:{id:"f1",name:"Fence 1"},assignment:{targets:[target]},worklist:{erfRefs:erfIds.map(id=>({id}))}});
function fixture(){return {lm:{id:"LM",name:"Municipality",geometry:JSON.stringify(square)},wards:[{id:"W001",pcode:"W001",code:1,geometry:square},{id:"W002",pcode:"W002",code:2,geometry:square}],summaries:[{ward:{pcode:"W001"},calculation:{state:"READY"},counts:{totalErfs:3}},{ward:{pcode:"W002"},calculation:{state:"READY"},counts:{totalErfs:1}}],geofences:[fence("f1"),fence("overlap")],batches:[batch("b1",["e1","e2"])],rows:[{id:"r1",bgoBatchId:"b1",erf:{id:"e1"},refs:{premiseId:"A",meterId:"M1"},workflow:{state:"COMPLETED"}},{id:"r2",bgoBatchId:"b1",erf:{id:"e2"},refs:{premiseId:"B"},workflow:{state:"IN_PROGRESS"}},{id:"r3",bgoBatchId:"b1",erf:{id:"e2"},refs:{premiseId:"C"},workflow:{state:"IN_PROGRESS"}}],erfs:[{id:"e1",wardPcode:"W001",centroid:{lat:-28.5,lng:30.5}},{id:"e2",wardPcode:"W001",centroid:{lat:-28.7,lng:30.7}},{id:"e3",wardPcode:"W001",centroid:{lat:-28,lng:30.5}},{id:"e4",wardPcode:"W002",centroid:{lat:-27,lng:32}}]};}

test("municipal and ward coverage deduplicate flats and match aggregate dashboard totals",()=>{
 const m=buildMdBgoMapDashboard(fixture());assert.equal(m.lm.summary.erfs,4);assert.equal(m.lm.summary.batched,2);assert.equal(m.lm.summary.total,3);assert.equal(m.lm.summary.premises,3);assert.equal(m.lm.summary.meters,1);
 assert.equal(m.wards[0].summary.erfs,3);assert.equal(m.wards[0].summary.unbatched,1);assert.equal(m.wards[1].summary.batched,0);assert.equal(m.wards[1].summary.total,0);
 assert.equal(m.lm.summary.teams,1);assert.equal(m.lm.summary.targets[0].name,"Peter Team");assert.equal(m.lm.summary.statuses["IN PROGRESS"],1);
});
test("overlapping geofences include actual centroid and edge membership without inflating LM totals",()=>{
 const m=buildMdBgoMapDashboard(fixture());for(const f of m.fences){assert.equal(f.summary.erfs,3);assert.equal(f.summary.batched,2);assert.equal(f.summary.total,3);assert.equal(f.summary.batchCount,1)}assert.equal(m.lm.summary.batched,2);
});
test("unbatched geofence has truthful ERFs with no invented batch or progress",()=>{
 const s=fixture();s.geofences.push(fence("empty",[{latitude:-27.5,longitude:31.5},{latitude:-27.5,longitude:32.5},{latitude:-26.5,longitude:32.5},{latitude:-26.5,longitude:31.5}]));const f=buildMdBgoMapDashboard(s).fences.at(-1);assert.equal(f.summary.erfs,1);assert.equal(f.summary.batched,0);assert.equal(f.summary.total,0);assert.equal(f.summary.batchCount,0);assert.equal(f.summary.teams,0);
});
test("TEAM/SP identities deduplicate by target ID and cancelled work is excluded",()=>{
 const s=fixture();s.batches.push(batch("b2",["e2"]),batch("sp",["e1"],{id:"SP1",type:"SP",name:"Provider"}),{...batch("cancelled",["e3"]),workflow:{state:"CANCELLED"}});s.rows.push({...s.rows[0],id:"cancelledRow",workflow:{state:"CANCELLED"}});const m=buildMdBgoMapDashboard(s);assert.equal(m.lm.summary.teams,1);assert.equal(m.lm.summary.sps,1);assert.equal(m.lm.summary.batched,2);assert.equal(m.lm.summary.total,3);
});
test("missing locations/boundaries and pending summaries do not fabricate coverage",()=>{
 const s=fixture();s.erfs[0].centroid=null;s.geofences.push(fence("invalid",[]));s.summaries[0].calculation.state="PENDING";const m=buildMdBgoMapDashboard(s);assert.equal(m.lm.summary.coverage,null);assert.equal(m.wards[0].summary.erfs,null);assert.equal(m.fences[0].summary.coverage,null);assert.equal(m.fences.at(-1).geometry,null);assert.deepEqual(m.diagnostics,{missingLocations:1,missingBoundaries:1,erfCount:4});
});
test("centroid normalization retains only needed fields and rejects invalid/missing operational GPS",()=>{
 assert.deepEqual(normalizeMapDashboardErf("E",{centroid:{latitude:-28,longitude:30},geometry:"large",admin:{ward:{pcode:"W"}}}),{id:"E",wardPcode:"W",centroid:{lat:-28,lng:30}});assert.equal(normalizeMapDashboardErf("E",{centroid:{lat:0,lng:0}}).centroid,null);
});
test("point membership handles polygon holes and boundaries and shading does not mutate counts",()=>{
 const outer=[{lat:0,lng:0},{lat:0,lng:4},{lat:4,lng:4},{lat:4,lng:0}],hole=[{lat:1,lng:1},{lat:1,lng:3},{lat:3,lng:3},{lat:3,lng:1}];assert.equal(mapDashboardContains({lat:2,lng:2},[outer,hole]),false);assert.equal(mapDashboardContains({lat:0,lng:2},[outer,hole]),true);
 const m=buildMdBgoMapDashboard(fixture()),before=JSON.stringify(m);assert.notEqual(mdMapAreaColour(m.lm,"coverage"),"#94a3b8");mdMapAreaColour(m.lm,"completion");assert.equal(JSON.stringify(m),before);
});
