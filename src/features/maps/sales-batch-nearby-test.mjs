import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { locatedMeterBounds, nearbyQuerySpec, nearbySalesQueryPlan, nearbyLayerRecords, NEARBY_LIMIT, SALES_ERF_CHUNK, MAX_SALES_ERF_CHUNKS } from "./sales-batch-nearby.js";
import { salesDraftWardGroups, projectSalesDraft, buildRetainedSalesDraft, salesDraftIntent } from "../../pages/operations/targeted-batches/draft/sales-batch-draft-model.js";
const f=JSON.parse(fs.readFileSync(new URL("../../../functions/test/fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
const args={lmPcode:"ZA5241",wardPcode:"ZA5241001",bounds:locatedMeterBounds([{point:{latitude:-28.5,longitude:30.5}}]),wardGeometry:f.ward.geometry};
test("nearby bounds fit every located meter with a 50m margin and ignore absent coordinates",()=>{
 assert.equal(locatedMeterBounds([{point:null}]),null);
 const bounds=locatedMeterBounds([{point:{latitude:-28.5,longitude:30.5}},{point:{latitude:-28.499,longitude:30.501}},{point:{latitude:999,longitude:999}}]);
 assert.ok(Math.abs((bounds.maxLat+28.499)*111320-50)<0.00001);assert.ok(bounds.minLng<30.5&&bounds.maxLng>30.501);
 assert.ok(bounds.maxLat-bounds.minLat<0.002);assert.equal(NEARBY_LIMIT,500);
});
test("nearby point layers exclude other LMs, Ward exterior and points beyond the margin",()=>{
 const row={id:"P1",parents:{lmPcode:"ZA5241"},geometry:{centroid:{lat:-28.5,lng:30.5}}};
 const result=nearbyLayerRecords("premises",[row,{...row,id:"FAR",geometry:{centroid:{lat:-28.6,lng:30.5}}},{...row,id:"WRONG",parents:{lmPcode:"ZA1"}}],args);
 assert.deepEqual(result.records.map(row=>row.id),["P1"]);assert.equal(result.invalid,1);
 assert.equal(nearbyLayerRecords("premises",[row],{...args,wardGeometry:{type:"Polygon",coordinates:[[[31,-29],[32,-29],[32,-28],[31,-28],[31,-29]]]}}).records.length,0);
});
test("ERF labels use sg.erfNo verbatim; invalid geometry explicitly contributes to incomplete state",()=>{
 for(const number of ["4230","3/826","RE/799"]){const result=nearbyLayerRecords("erfs",[{...f.erf,id:"SG-CODE",sg:{erfNo:number,parcelNo:"WRONG"}}],args);assert.equal(result.records[0].erfNo,number);}
 assert.equal(nearbyLayerRecords("erfs",[{...f.erf,id:"BAD",geometry:"bad"}],args).invalid,1);
});
test("Sales coordinates come only from observed pipeline candidates, not saved address positions",()=>{
 const sales={...f.sales,id:"S1",erfResolution:{geocode:{latitude:-28.5,longitude:30.5}}};
 assert.equal(nearbyLayerRecords("sales",[sales],args).records.length,0);
 sales.erfCandidates=[{Latitude:-28.5,Longitude:30.5}];assert.equal(nearbyLayerRecords("sales",[sales],args).records.length,1);
});
test("every spatial composite used by draft layers or ERF lookup has equality first and alphabetic ranges",()=>{
 const indexes=JSON.parse(fs.readFileSync(new URL("../../../firestore.indexes.json",import.meta.url))).indexes;
 const specs=[nearbyQuerySpec("erfs",args),nearbyQuerySpec("premises",args)];
 const source=fs.readFileSync(new URL("../../../functions/targetedBatches/sales-batch-resolution.js",import.meta.url),"utf8");
 const querySource=source.slice(source.indexOf('const query = db.collection("ireps_erfs")'),source.indexOf('let snapshot;',source.indexOf('const query = db.collection("ireps_erfs")')));
 specs.push({collection:"ireps_erfs",conditions:[...querySource.matchAll(/\.where\("([^"]+)", "([^"]+)"/g)].map(match=>[match[1],match[2]])});
 for(const spec of specs){
  const equal=[...new Set(spec.conditions.filter(c=>c[1]==="==").map(c=>c[0]))],ranges=[...new Set(spec.conditions.filter(c=>c[1]!=="==").map(c=>c[0]))].sort();
  const expected=[...equal,...ranges];assert.ok(expected.length>1);
  assert.ok(indexes.some(index=>index.collectionGroup===spec.collection&&JSON.stringify(index.fields.filter(field=>field.fieldPath!=="__name__").map(field=>field.fieldPath))===JSON.stringify(expected)&&index.fields.every(field=>field.order==="ASCENDING")),`Missing or incorrectly ordered ${spec.collection} index: ${expected}`);
 }
 assert.deepEqual(nearbyQuerySpec("assets",args).conditions,[["accessData.parents.wardPcode","==",args.wardPcode]]);
 assert.throws(()=>nearbyQuerySpec("sales",args),/nearbySalesQueryPlan/);
 assert.ok(indexes.some(index=>index.collectionGroup==="sales-all-meters"&&JSON.stringify(index.fields.map(field=>[field.fieldPath,field.order||field.arrayConfig]))===JSON.stringify([["lmPcode","ASCENDING"],["erfNumbers","CONTAINS"]])),"Missing sales-all-meters lmPcode + erfNumbers CONTAINS index");
});
test("nearby Sales ask only for the nearby ERF numbers, 30 per query, never the whole LM",()=>{
 const numbers=Array.from({length:65},(_,index)=>String(index+1));
 const plan=nearbySalesQueryPlan({lmPcode:"ZA5241",erfNumbers:[...numbers,"12","Unavailable",""," 3/826 ","RE/799"]});
 assert.equal(SALES_ERF_CHUNK,30);assert.equal(plan.truncated,false);assert.equal(plan.specs.length,3);
 for(const spec of plan.specs){assert.equal(spec.collection,"sales-all-meters");assert.deepEqual(spec.conditions[0],["lmPcode","==","ZA5241"]);assert.equal(spec.conditions[1][0],"erfNumbers");assert.equal(spec.conditions[1][1],"array-contains-any");assert.ok(spec.conditions[1][2].length<=30);}
 const asked=plan.specs.flatMap(spec=>spec.conditions[1][2]);
 assert.equal(asked.length,67);assert.ok(asked.includes("3/826")&&asked.includes("RE/799"));assert.ok(!asked.includes("Unavailable")&&!asked.includes(""));
 assert.deepEqual(nearbySalesQueryPlan({lmPcode:"ZA5241",erfNumbers:[]}),{specs:[],truncated:false});
 const many=nearbySalesQueryPlan({lmPcode:"ZA5241",erfNumbers:Array.from({length:SALES_ERF_CHUNK*MAX_SALES_ERF_CHUNKS+1},(_,index)=>`E${index}`)});
 assert.equal(many.specs.length,MAX_SALES_ERF_CHUNKS);assert.equal(many.truncated,true);
 assert.equal(nearbySalesQueryPlan({lmPcode:"ZA5241",erfNumbers:["1"],erfCapped:true}).truncated,true);
});
test("Ward groups preserve all rows until the owner explicitly removes them; old fences ask for replacement",()=>{
 const rows=[{salesId:"A",scope:{wardPcode:"ZA5241006"}},{salesId:"B",scope:{wardPcode:"ZA5241004"}},{salesId:"C",scope:{wardPcode:"ZA5241006"}},{salesId:"D"}];
 const before=JSON.stringify(rows),groups=salesDraftWardGroups(rows);
 assert.deepEqual(groups.map(g=>[g.label,g.salesIds]),[["Ward 6",["A","C"]],["Ward 4",["B"]]]);assert.equal(JSON.stringify(rows),before);
 const draft=buildRetainedSalesDraft({source:{type:"PREPAID_SALES_NON_GPS"},scope:f.scope,selection:{reason:"Test"},rows:[{...f.sales,id:"00123"}]},f.tbId);
 draft.savedFence={id:"oldFence",status:"BATCH_ONLY"};
 const model=projectSalesDraft(draft,{ready:true,sales:{"00123":f.sales}});assert.match(model.gate,/Create a new geofence/);assert.equal(Boolean(model.canCreate),false);
 assert.equal(salesDraftIntent(draft).geofenceId,"oldFence");assert.deepEqual(draft.retainedIds,["00123"]);
});
