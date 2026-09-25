import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { locatedMeterBounds, nearbyQuerySpec, nearbySalesQueryPlan, nearbyLayerRecords, nearbyErfLinkedPlan, combineNearbyLayers, NEARBY_LIMIT, SALES_ERF_CHUNK, MAX_SALES_ERF_CHUNKS, ERF_ID_CHUNK, MAX_ERF_ID_CHUNKS, BATCH_POSITION_NOTE } from "./sales-batch-nearby.js";
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
// 18.7 / TB-R055.7 (1.3.49): a layer draws the area on screen. The read asks for ERFs whose bbox
// overlaps that area, and the fixture ERF's own bbox is 20km across, so bbox overlap alone would
// draw ERFs nowhere near the screen — the same area test Sales, Premises and Assets use.
test("the ERF layer draws only ERFs whose centroid is in the area and the Ward, not every ERF the bbox read returns",()=>{
 const far={...f.erf,id:"FAR",centroid:{lat:-28.2,lng:30.23}};
 const result=nearbyLayerRecords("erfs",[{...f.erf,id:"IN"},far],args);
 assert.deepEqual(result.records.map(row=>row.id),["IN"],"an ERF outside the area on screen is not drawn");
 assert.ok(far.bbox.minLat<=args.bounds.maxLat&&far.bbox.maxLat>=args.bounds.minLat,"and it is one the bbox read really does return");
 assert.equal(nearbyLayerRecords("erfs",[{...f.erf,id:"OUT-OF-WARD"}],{...args,wardGeometry:{type:"Polygon",coordinates:[[[31,-29],[32,-29],[32,-28],[31,-28],[31,-29]]]}}).records.length,0,"the Ward test still applies");
});
test("Sales use their Sales GPS point; a Non-GPS meter with a saved ERF decision uses its saved position (18.7, 1.3.17)",()=>{
 const sales={...f.sales,id:"S1",erfResolution:{geocode:{latitude:-28.5,longitude:30.5}}};
 assert.equal(nearbyLayerRecords("sales",[sales],args).records.length,0,"a partial saved position is not a saved decision");
 const stamp={seconds:1789257600,nanoseconds:0};
 const saved={...f.sales,id:"S2",erfId:"ERF1",erfResolution:{version:1,revision:1,method:"GEOCODED",evidenceRefs:["ireps_erfs/ERF1"],confirmedByUid:"U1",confirmedByUser:"Planner",confirmedAt:stamp,tbId:f.tbId,
  geocode:{latitude:-28.5,longitude:30.5,matchLevel:"EXACT_STREET_NUMBER",geocodedAddress:"1 Test, DUNDEE, KwaZulu-Natal, South Africa",provider:"Google Geocoding API",geocodedAt:stamp}}};
 const [batched]=nearbyLayerRecords("sales",[saved],args).records;
 assert.equal(batched.id,"S2");assert.equal(batched.candidates[0].positionNote,BATCH_POSITION_NOTE);
 assert.equal(nearbyLayerRecords("sales",[{...saved,erfResolution:{...saved.erfResolution,geocode:{...saved.erfResolution.geocode,latitude:-28.6}}}],args).records.length,0,"outside the area");
 sales.erfCandidates=[{Latitude:-28.5,Longitude:30.5}];const [gps]=nearbyLayerRecords("sales",[sales],args).records;
 assert.equal(gps.candidates.length,1);assert.equal(gps.candidates[0].positionNote,undefined,"a Sales GPS point is not labelled as a batch position");
 const both=nearbyLayerRecords("sales",[{...saved,erfCandidates:[{Latitude:-28.5001,Longitude:30.5}]}],args).records[0];
 assert.equal(both.candidates[0].point.lat,-28.5001);assert.equal(both.candidates[0].positionNote,undefined,"the Sales GPS point wins");
});
test("Assets and batched Non-GPS Sales are read through the nearby ERF IDs, enough queries for every nearby ERF",()=>{
 const erfs=Array.from({length:65},(_,index)=>({id:`E${String(index).padStart(3,"0")}`,erfNo:String(index+1)}));
 const assets=nearbyErfLinkedPlan("assets",{lmPcode:"ZA5241",erfs:[...erfs,erfs[0],{id:""}]});
 assert.equal(ERF_ID_CHUNK,30);assert.equal(assets.truncated,false);assert.equal(assets.specs.length,3);
 for(const spec of assets.specs){assert.equal(spec.collection,"asts");assert.equal(spec.conditions.length,1);assert.equal(spec.conditions[0][0],"accessData.erfId");assert.equal(spec.conditions[0][1],"in");assert.ok(spec.conditions[0][2].length<=30);}
 assert.equal(assets.specs.flatMap(spec=>spec.conditions[0][2]).length,65);
 const sales=nearbyErfLinkedPlan("sales",{lmPcode:"ZA5241",erfs});
 assert.equal(sales.specs.filter(spec=>spec.conditions[0][0]==="lmPcode").length,3,"GPS Sales by ERF number");
 assert.deepEqual(sales.specs.filter(spec=>spec.conditions[0][0]==="erfId").map(spec=>spec.conditions[0][2].length),[30,30,5],"batched Non-GPS by ERF ID");
 assert.equal(MAX_ERF_ID_CHUNKS*ERF_ID_CHUNK>=NEARBY_LIMIT,true,"every nearby ERF can be covered");
 assert.equal(nearbyErfLinkedPlan("assets",{erfs,erfCapped:true}).truncated,true);
 assert.deepEqual(nearbyErfLinkedPlan("assets",{erfs:[]}),{specs:[],truncated:false});
 assert.throws(()=>nearbyErfLinkedPlan("premises",{erfs}),/Only Sales and Assets/);
});
test("the layers are combined for the map and panel, each empty until it has loaded",()=>{
 const model=combineNearbyLayers({erfs:{records:[{id:"E1"}]},sales:{records:[{id:"S1",status:"IN_PROGRESS",candidates:[]}]},assets:{records:[{id:"A1"}]}});
 assert.deepEqual([model.erfs.length,model.premises.length,model.assets.length,model.generalAssets.length,model.salesRecords.length],[1,0,1,1,1]);
 assert.equal(model.salesSummary.inProgress,1);
 assert.deepEqual(combineNearbyLayers().erfs,[]);
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
 for(const layer of ["sales","assets"])assert.throws(()=>nearbyQuerySpec(layer,args),/nearbyErfLinkedPlan/,`${layer} are never a Ward-wide read`);
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
