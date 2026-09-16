import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createProofCodec, resolveSalesBatch } from "../targetedBatches/sales-batch-resolution.js";
import { assessSalesBatch } from "../targetedBatches/sales-batch-geofence.js";
import { createGeoFenceRequest } from "../geofences/callables.js";
import { createSalesBatch } from "../targetedBatches/sales-batch-creation.js";
import { allocateNonGpsBatchAtomically, allocateSalesBatchesTogether, onAllocateTargetedBatchCallable, onAllocateTargetedBatchesTogetherCallable } from "../targetedBatches/allocationCallable.js";
import { onAcceptRejectTargetedBatchCallable } from "../targetedBatches/acceptanceCallable.js";
import { recordTargetedBatchNoAccess } from "../targetedBatches/recordTargetedBatchNoAccessCallable.js";
import { onGeoFenceCreated } from "../geofences/triggers.js";
import { deleteSalesBatch } from "../targetedBatches/deleteCallable.js";
import { onUnallocateTargetedBatchCallable, unallocateSalesBatch } from "../targetedBatches/unallocateCallable.js";
import { forgetSalesCategoryMonths } from "../salesAllMeters/sales-category-month.js";

const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host||""))throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId="demo-ireps-sales-batch";
const app=initializeApp({projectId});
const db=getFirestore(app);
const f=JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
// Production geometry is JSON text: Firestore cannot store nested arrays.
f.erf.geometry=JSON.stringify(f.erf.geometry);
f.ward.geometry=JSON.stringify(f.ward.geometry);
// Rules TB-R046: only CAT meters are batched, by the LM's newest category month. The fixture meter is a
// CAT meter of last month, so the server's month-by-month search always finds it.
const CATEGORY_MONTH=(()=>{const [y,m]=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit"}).format(new Date()).split("-").map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`;})();
f.sales.monthlyCategories={[CATEGORY_MONTH]:{leakageCategory:"CAT4 - Long Gap (4+ months)",riskTier:"High",riskScore:9}};
const codec=createProofCodec("test-only-proof-key-not-a-real-secret");
const request=data=>({auth:{uid:f.actor.uid,token:{}},data});
const geocode=async()=>({ok:true,point:{latitude:-28.5,longitude:30.5},provider:"Google Geocoding API"});
beforeEach(async()=>{
  forgetSalesCategoryMonths();
  const response=await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:"DELETE"});assert.equal(response.ok,true);
  await Promise.all([db.doc(`users/${f.actor.uid}`).set(f.profile),db.doc("ireps_erfs/ERF1").set(f.erf),db.doc("wards/ZA5241001").set(f.ward)]);
});
after(async()=>{await db.terminate();await deleteApp(app);});
async function seed(n=1,{source="PREPAID_SALES_NON_GPS"}={}){
 const ids=Array.from({length:n},(_,i)=>`00${123+i}`),batch=db.batch();
 for(const id of ids){const row=structuredClone(f.sales);row.master.id=id;row.meterNo=id;row.meterNoNormalized=id;
  row.metadata={createdAt:Timestamp.fromMillis(1000000),createdByUid:"ORIGINAL",createdByUser:"Original",updatedAt:Timestamp.fromMillis(1000000),updatedByUid:"ORIGINAL",updatedByUser:"Original"};
  if(source==="PREPAID_SALES"){row.hasUsableGps=true;row.erfCandidates=[{ErfId:"ERF1",Latitude:-28.5,Longitude:30.5}];}
  batch.set(db.doc(`sales-all-meters/${id}`),row);
 }await batch.commit();return ids;
}
async function saveFence({db,request: req,codec}) {
 const {points,saveSalesIds: _ignored,...intent}=req.data;
 return createGeoFenceRequest({db,codec,request:{...req,data:{name:`Gf W1 Test ${intent.tbId}`,description:"Owner description",parents:{countryPcode:"ZA",provincePcode:"ZA5",dmPcode:"ZA524",lmPcode:"ZA5241",wardPcode:"ZA5241001"},points:points.map(p=>Array.isArray(p)?{latitude:p[1],longitude:p[0]}:p),targetedBatch:intent}}});
}
async function fenceFor(tbId=f.tbId) {return (await db.collection("geo_fences").where("targetedBatch.tbId","==",tbId).get()).docs[0];}
async function prepare(ids,{source="PREPAID_SALES_NON_GPS",tbId=f.tbId}={}){
 const intent={tbId,lmPcode:"ZA5241",source,salesIds:ids,reason:"Fixture selection",salesPeriodFrom:"2026-07",salesPeriodTo:"2026-08"};
 const resolved=await resolveSalesBatch({db,request:request(intent),codec,geocode});
 assert.equal(resolved.rows.every(row=>row.ready),true,JSON.stringify(resolved));
 intent.resolutionProofs=Object.fromEntries(resolved.rows.map(row=>[row.salesId,row.proof]));
 intent.geofenceId=(await saveFence({db,request:request({...intent,points:f.fencePoints,saveSalesIds:ids}),codec})).geofenceId;
 const assessment=await assessSalesBatch({db,request:request(intent),codec});
 return {...intent,confirmationProof:assessment.confirmationProof,fingerprint:assessment.fingerprint,includedIds:assessment.includedIds};
}
for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"])for(const n of [1,30])test(`emulator ${source} ${n} meters commit together with exact history and preserved roots`,async()=>{
 const ids=await seed(n,{source}),intent=await prepare(ids,{source});
 const result=await createSalesBatch({db,request:request(intent),codec});assert.equal(result.rowCount,n);
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data();assert.equal(parent.schemaVersion,"0.3.0");assert.equal(parent.creation.createdRows,n);
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.equal(rows.size,n);
 for(const id of ids){const sales=(await db.doc(`sales-all-meters/${id}`).get()).data();assert.equal(sales.targetedBatchId,f.tbId);assert.equal(sales.tbRefs.length,1);assert.equal(sales.tbRefs[0].date.toMillis(),parent.metadata.createdAt.toMillis());assert.equal(sales.metadata.createdAt.toMillis(),1000000);assert.deepEqual(sales.monthlyCategories,f.sales.monthlyCategories);assert.equal(sales.salesStatus,"NOT_STARTED");
  assert.equal(Boolean(sales.erfResolution),source==="PREPAID_SALES_NON_GPS");assert.equal(sales.erfLocated,undefined);
  assert.equal((await db.doc(`sales-all-meters/${id}/batchHistory/${f.tbId}__BATCHED`).get()).exists,true);
 }
 const again=await createSalesBatch({db,request:request(intent),codec});assert.equal(again.reused,true);
 assert.equal((await createSalesBatch({db,request:request(intent),codec})).reused,true);
});
test("competing creators reread the same Sales: exactly one complete batch wins",async()=>{
 const ids=await seed();const first=await prepare(ids),second=await prepare(ids,{tbId:"TGB_20260913_120001_AB12"});
 const results=await Promise.allSettled([createSalesBatch({db,request:request(first),codec}),createSalesBatch({db,request:request(second),codec})]);
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
 assert.equal((await db.collection("tb_uploads").get()).size,1);assert.equal((await db.collection("tb_rows").get()).size,1);
});
test("a Normal meter is refused by the server when located, and a meter turning Normal before creation creates nothing",async()=>{
 const [normal]=await seed(1);
 await db.doc(`sales-all-meters/${normal}`).update({[`monthlyCategories.${CATEGORY_MONTH}.leakageCategory`]:"Normal - No Leakage Flag"});
 const resolved=await resolveSalesBatch({db,request:request({tbId:f.tbId,lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS",salesIds:[normal],reason:"Fixture selection",salesPeriodFrom:"2026-07",salesPeriodTo:"2026-08"}),codec,geocode:()=>assert.fail("A Normal meter is never located")});
 assert.deepEqual([resolved.rows[0].ready,resolved.rows[0].code],[false,"SALES_CATEGORY_NORMAL"]);
 await db.doc(`sales-all-meters/${normal}`).update({[`monthlyCategories.${CATEGORY_MONTH}.leakageCategory`]:"CAT4 - Long Gap (4+ months)"});
 const intent=await prepare([normal]);
 await db.doc(`sales-all-meters/${normal}`).update({[`monthlyCategories.${CATEGORY_MONTH}.leakageCategory`]:"Normal - No Leakage Flag"});
 await assert.rejects(createSalesBatch({db,request:request(intent),codec}));
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("tb_rows").get()).size,0);
 assert.equal((await db.doc(`sales-all-meters/${normal}`).get()).data().targetedBatchId,undefined);
});
test("30 confirmed with one newly occupied meter creates zero",async()=>{
 const ids=await seed(30),intent=await prepare(ids);
 await db.doc(`sales-all-meters/${ids[10]}`).update({targetedBatchId:"TGB_20260913_120001_AB12"});
 await assert.rejects(createSalesBatch({db,request:request(intent),codec}));
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("tb_rows").get()).size,0);
 assert.equal((await fenceFor()).data().targetedBatch.linkState,"UNLINKED");
 for(const id of ids)assert.equal((await db.doc(`sales-all-meters/${id}/batchHistory/${f.tbId}__BATCHED`).get()).exists,false);
});
test("failed overlapping lookup records only TB9, never coordinates or ERF",async()=>{
 const ids=await seed();await db.doc("ireps_erfs/ERF2").set({...f.erf,erfId:"ERF2"});
 const result=await resolveSalesBatch({db,request:request({tbId:f.tbId,lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS",salesIds:ids}),codec,geocode});
 assert.equal(result.rows[0].code,"MULTIPLE_ERFS");
 const sales=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();assert.equal(sales.erfLookup.outcome,"MULTIPLE_ERFS");assert.equal(sales.erfId,undefined);assert.equal(sales.erfResolution,undefined);assert.deepEqual(sales.tbRefs,[]);
 assert.equal(sales.metadata.createdAt.toMillis(),1000000);assert.equal(sales.erfLookup.attemptedAt instanceof Timestamp,true);
});
test("guarded unexecuted removal retains history and final ERF, consumes fence and permits a new batch ID",async()=>{
 const ids=await seed(),intent=await prepare(ids);await createSalesBatch({db,request:request(intent),codec});
 const before=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();
 await deleteSalesBatch({db,request:request({tbId:f.tbId,reason:"Owner fixture removal"})});
 const after=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();assert.equal(after.targetedBatchId,null);assert.deepEqual(after.tbRefs,[]);assert.deepEqual(after.erfResolution,before.erfResolution);
 assert.equal((await db.doc(`sales-all-meters/${ids[0]}/batchHistory/${f.tbId}__REMOVED_FROM_BATCH`).get()).exists,true);
 assert.equal((await fenceFor()).data().targetedBatch.linkState,"LINKED");
 await assert.rejects(createSalesBatch({db,request:request(intent),codec}));
 const next=await prepare(ids,{tbId:"TGB_20260913_120001_AB12"});assert.equal((await createSalesBatch({db,request:request(next),codec})).success,true);
});
test("positive execution and another batch scalar block removal",async()=>{
 const ids=await seed(),intent=await prepare(ids);await createSalesBatch({db,request:request(intent),codec});
 await db.doc(`sales-all-meters/${ids[0]}`).update({targetedBatchId:"TGB_20260913_120001_AB12"});
 await assert.rejects(deleteSalesBatch({db,request:request({tbId:f.tbId})}));
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).exists,true);
 await db.doc(`sales-all-meters/${ids[0]}`).update({targetedBatchId:f.tbId,"master.visibility":"VISIBLE"});
 await assert.rejects(deleteSalesBatch({db,request:request({tbId:f.tbId})}));
});

async function resolveIntent(ids,{source="PREPAID_SALES_NON_GPS",tbId=f.tbId}={}){
 const intent={tbId,lmPcode:"ZA5241",source,salesIds:ids,reason:"Review fixture",salesPeriodFrom:"2026-07",salesPeriodTo:"2026-08"};
 const resolution=await resolveSalesBatch({db,request:request(intent),codec,geocode});
 return {...intent,resolutionProofs:Object.fromEntries(resolution.rows.filter(row=>row.proof).map(row=>[row.salesId,row.proof]))};
}
// Targeted Batch rules 1.3.15 and Sales schema TB10: successful locations are recorded.
test("successful Non-GPS locate records TB10 once, keeps its evidence valid, and creation removes it",async()=>{
 const ids=await seed(),ref=db.doc(`sales-all-meters/${ids[0]}`);
 await ref.update({erfLookup:{version:1,outcome:"NO_EXACT_POSITION",address:"1 Old Spelling, DUNDEE, KwaZulu-Natal, South Africa",provider:"Google Geocoding API",attemptedAt:Timestamp.fromMillis(2000000),attemptedByUid:"ORIGINAL",attemptedByUser:"Original"}});
 const intent=await resolveIntent(ids),first=await ref.get(),sales=first.data();
 assert.deepEqual(Object.keys(sales.erfLocated).sort(),["address","erfId","locatedAt","locatedByUid","locatedByUser","provider","version","wardPcode"]);
 assert.equal(sales.erfLocated.erfId,"ERF1");assert.equal(sales.erfLocated.wardPcode,"ZA5241001");assert.equal(sales.erfLocated.locatedByUid,f.actor.uid);assert.equal(sales.erfLocated.locatedAt instanceof Timestamp,true);
 assert.equal(sales.erfLookup,undefined);assert.equal(sales.erfId,undefined);assert.equal(sales.erfResolution,undefined);assert.equal(sales.metadata.createdAt.toMillis(),1000000);assert.equal(sales.metadata.updatedByUid,f.actor.uid);
 await resolveIntent(ids);assert.equal((await ref.get()).updateTime.isEqual(first.updateTime),true,"locating again writes nothing");
 intent.geofenceId=(await saveFence({db,request:request({...intent,points:f.fencePoints,saveSalesIds:ids}),codec})).geofenceId;
 const assessed=await assessSalesBatch({db,request:request(intent),codec});assert.deepEqual(assessed.includedIds,ids,"evidence from before the record is still valid");
 assert.equal((await createSalesBatch({db,request:request({...intent,...assessed}),codec})).success,true);
 const batched=(await ref.get()).data();assert.equal(batched.erfLocated,undefined);assert.equal(batched.erfId,"ERF1");assert.equal(batched.erfResolution.geocode.geocodedAddress,sales.erfLocated.address);
});
test("a later failed lookup replaces the successful location with the flag",async()=>{
 const ids=await seed(),ref=db.doc(`sales-all-meters/${ids[0]}`);await resolveIntent(ids);assert.equal((await ref.get()).data().erfLocated.erfId,"ERF1");
 await db.doc("ireps_erfs/ERF2").set({...f.erf,erfId:"ERF2"});
 const result=await resolveSalesBatch({db,request:request({tbId:f.tbId,lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS",salesIds:ids}),codec,geocode});
 assert.equal(result.rows[0].code,"MULTIPLE_ERFS");const sales=(await ref.get()).data();assert.equal(sales.erfLocated,undefined);assert.equal(sales.erfLookup.outcome,"MULTIPLE_ERFS");
});
test("a failure to record the location never fails the locate",async()=>{
 const ids=await seed(),ref=db.doc(`sales-all-meters/${ids[0]}`),before=await ref.get();
 const wrapped=new Proxy(db,{get(target,key){if(key==="runTransaction")return async()=>{throw new Error("Injected record failure");};const value=target[key];return typeof value==="function"?value.bind(target):value;}});
 const result=await resolveSalesBatch({db:wrapped,request:request({tbId:f.tbId,lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS",salesIds:ids}),codec,geocode});
 assert.equal(result.rows[0].ready,true,JSON.stringify(result));assert.ok(result.rows[0].proof);
 assert.equal((await ref.get()).updateTime.isEqual(before.updateTime),true);
});
test("GPS Sales are never geocoded and get no location record",async()=>{
 const ids=await seed(1,{source:"PREPAID_SALES"}),ref=db.doc(`sales-all-meters/${ids[0]}`),before=await ref.get();
 await resolveIntent(ids,{source:"PREPAID_SALES"});assert.equal((await ref.get()).updateTime.isEqual(before.updateTime),true);
});
test("Save is immutable, repeatable across winding, Sales-read-only, and population can only shrink",async()=>{
 const ids=await seed(3),intent=await resolveIntent(ids),before=await Promise.all(ids.map(id=>db.doc(`sales-all-meters/${id}`).get()));
 const saved=await saveFence({db,request:request({...intent,saveSalesIds:ids,points:f.fencePoints}),codec});assert.equal(saved.reused,false);
 assert.equal((await saveFence({db,request:request({...intent,saveSalesIds:ids,points:[...f.fencePoints].reverse()}),codec})).reused,true);
 await assert.rejects(saveFence({db,request:request({...intent,salesIds:ids.slice(1),points:f.fencePoints}),codec}),/different saved/);
 for(let i=0;i<ids.length;i++)assert.deepEqual((await db.doc(`sales-all-meters/${ids[i]}`).get()).data(),before[i].data());
 const smaller={...intent,geofenceId:saved.geofenceId,salesIds:[ids[0],ids[2]]},assessed=await assessSalesBatch({db,request:request(smaller),codec});
 await createSalesBatch({db,request:request({...smaller,...assessed}),codec});
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.deepEqual(rows.docs.map(row=>row.data().rowNo).sort(),[1,3]);
 assert.equal((await db.doc(`sales-all-meters/${ids[1]}`).get()).data().targetedBatchId,undefined);
});
test("unresolved at Save cannot join after resolving later; every retained row is accounted for",async()=>{
 const source="PREPAID_SALES",ids=await seed(2,{source});await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[]});
 let intent=await resolveIntent(ids,{source});await saveFence({db,request:request({...intent,saveSalesIds:[ids[0]],points:f.fencePoints}),codec});
 await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[{ErfId:"ERF1",Latitude:-28.5,Longitude:30.5}]});
 intent={...await resolveIntent(ids,{source}),geofenceId:(await fenceFor()).id};const assessed=await assessSalesBatch({db,request:request(intent),codec});
 assert.deepEqual(assessed.includedIds,[ids[0]]);assert.equal(assessed.leftOut[0].salesId,ids[1]);assert.equal(assessed.leftOut[0].code,"OUTSIDE_SAVED_POPULATION");assert.equal(assessed.rows.length,2);
});
test("a retained ineligible GPS meter in another Ward prevents Save even if excluded from save IDs",async()=>{
 const source="PREPAID_SALES",ids=await seed(2,{source});
 await db.doc("wards/ZA5241002").set({...f.ward,pcode:"ZA5241002",code:"2",name:"Ward 2",geometry:JSON.stringify({type:"Polygon",coordinates:[[[31,-29],[32,-29],[32,-28],[31,-28],[31,-29]]]})});
 await db.doc("ireps_erfs/ERF2").set({...f.erf,erfId:"ERF2",admin:{...f.erf.admin,ward:{pcode:"ZA5241002",name:"Ward 2"}},centroid:{lat:-28.5,lng:31.5},bbox:{minLat:-28.6,maxLat:-28.4,minLng:31.4,maxLng:31.6},geometry:JSON.stringify({type:"Polygon",coordinates:[[[31.4,-28.6],[31.6,-28.6],[31.6,-28.4],[31.4,-28.4],[31.4,-28.6]]]})});
 await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[{ErfId:"ERF2",Latitude:-28.5,Longitude:31.5}],targetedBatchId:"TGB_20260913_120001_AB12"});
 const intent=await resolveIntent(ids,{source});await assert.rejects(saveFence({db,request:request({...intent,saveSalesIds:[ids[0]],points:f.fencePoints}),codec}),/one Ward/);
 assert.equal((await db.collection("geo_fences").get()).size,0);
});
for(const [name,path,patch]of [
 ["address","sales-all-meters/00123",{"adr.strNo":"02"}],
 ["visibility","sales-all-meters/00123",{"master.visibility":"VISIBLE"}],
 ["actor role","users/SUPERVISOR1",{"employment.role":"FWR"}],
 ["Ward geometry","wards/ZA5241001",{geometry:"invalid"}],
 ["ERF geometry","ireps_erfs/ERF1",{geometry:"invalid"}],
 ["fence population","FENCE",{"targetedBatch.salesIds":["WRONG"]}],
 ["fence consumed","FENCE",{"targetedBatch.linkState":"LINKED"}],
])test(`fresh transaction rejects changed ${name} with no creation writes`,async()=>{
 const ids=await seed(),intent=await prepare(ids);await db.doc(path==="FENCE"?`geo_fences/${intent.geofenceId}`:path).update(patch);
 await assert.rejects(createSalesBatch({db,request:request(intent),codec}));
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("tb_rows").get()).size,0);assert.equal((await db.doc(`sales-all-meters/${ids[0]}/batchHistory/${f.tbId}__BATCHED`).get()).exists,false);
});
test("failed commit after queued writes leaves zero partial artifacts",async()=>{
 const ids=await seed(2),intent=await prepare(ids);
 const wrapped=new Proxy(db,{get(target,key){if(key==="runTransaction")return fn=>target.runTransaction(tx=>fn(new Proxy(tx,{get(transaction,method){if(method==="update")return()=>{throw new Error("Injected transaction failure");};const value=transaction[method];return typeof value==="function"?value.bind(transaction):value;}})));const value=target[key];return typeof value==="function"?value.bind(target):value;}});
 await assert.rejects(createSalesBatch({db:wrapped,request:request(intent),codec}),/Injected/);
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("tb_rows").get()).size,0);for(const id of ids)assert.equal((await db.doc(`sales-all-meters/${id}`).get()).data().targetedBatchId,undefined);
});
for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"])test(`competing ${source} creators preserve one winner and one history event`,async()=>{
 const ids=await seed(1,{source}),a=await prepare(ids,{source}),b=await prepare(ids,{source,tbId:"TGB_20260913_120001_AB12"});
 const results=await Promise.allSettled([createSalesBatch({db,request:request(a),codec}),createSalesBatch({db,request:request(b),codec})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await db.collection(`sales-all-meters/${ids[0]}/batchHistory`).get()).size,1);
});
test("source classification change between two origins cannot produce two batches",async()=>{
 const ids=await seed(),a=await prepare(ids);await db.doc(`sales-all-meters/${ids[0]}`).update({hasUsableGps:true,erfCandidates:[{ErfId:"ERF1",Latitude:-28.5,Longitude:30.5}]});
 const b=await prepare(ids,{source:"PREPAID_SALES",tbId:"TGB_20260913_120001_AB12"});
 const results=await Promise.allSettled([createSalesBatch({db,request:request(a),codec}),createSalesBatch({db,request:request(b),codec})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
});
async function allocateFixture(n=1,{source="PREPAID_SALES_NON_GPS",targetType="TEAM"}={}){
 const ids=await seed(n,{source}),intent=await prepare(ids,{source});await createSalesBatch({db,request:request(intent),codec});
 await db.doc(`users/${f.actor.uid}`).update({"employment.serviceProvider.id":"MNC1"});
 await db.doc("users/FWR1").set({profile:{displayName:"Worker",employment:{role:"FWR",serviceProvider:{id:"SP1"}}}});
 await db.doc("teams/TEAM1").set({team:{status:"ACTIVE",name:"Test team"},ownership:{mncServiceProviderId:"MNC1"},scope:{memberUserIds:["FWR1"]},memberUids:["FWR1"]});
 await db.doc("serviceProviders/SP1").set({status:"ACTIVE",name:"Test SP",clients:[{id:"MNC1",clientType:"SP",relationshipType:"SUBC"}]});
 const args={db,request:request({}),parentRef:db.doc(`tb_uploads/${f.tbId}`),tbId:f.tbId,targetType,targetId:targetType==="TEAM"?"TEAM1":"SP1",actorMncId:"MNC1",actorUid:f.actor.uid,actorName:f.actor.user,startedAtMs:Date.now()};
 const result=await allocateNonGpsBatchAtomically(args);return{ids,intent,args,result};
}
for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"])for(const n of [1,30])for(const targetType of ["TEAM","SP"])test(`atomic ${source} N=${n} allocation to ${targetType} preserves Sales and repeats safely`,async()=>{
 const {ids,args,result}=await allocateFixture(n,{source,targetType});assert.equal(result.success,true);assert.equal(result.totalRows,n);
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.ok(rows.docs.every(row=>row.data().allocation.targetId===args.targetId&&row.data().allocation.status==="ALLOCATED"));
 assert.equal((await allocateNonGpsBatchAtomically(args)).alreadyAllocated,true);
 for(const id of ids){const sales=(await db.doc(`sales-all-meters/${id}`).get()).data();assert.equal(sales.targetedBatchId,f.tbId);assert.equal(sales.tbRefs[0].fieldWork,undefined);assert.equal((await db.collection(`sales-all-meters/${id}/batchHistory`).get()).size,1);}
});
for(const targetType of ["TEAM","SP"])for(const action of ["ACCEPT","REJECT"])test(`unchanged callable ${targetType} ${action} operates on canonical parent and leaves Sales intact`,async()=>{
 const {ids}=await allocateFixture(1,{targetType}),before=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();
 const req={auth:{uid:"FWR1",token:{}},data:{tbId:f.tbId,action,rejectReason:action==="REJECT"?"Test rejection":null}};
 const result=await onAcceptRejectTargetedBatchCallable.run(req);assert.equal(result.success,true,JSON.stringify(result));
 assert.equal((await onAcceptRejectTargetedBatchCallable.run(req)).idempotent,true);
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).data().acceptance.status,action==="ACCEPT"?"ACCEPTED":"REJECTED");assert.deepEqual((await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),before);
 const denied=await onAcceptRejectTargetedBatchCallable.run({...req,auth:{uid:"OTHER",token:{role:"FWR",serviceProviderId:"OTHER"}}});assert.equal(denied.success,false);
});
test("No Access races removal: one complete outcome, never orphan execution or released active meter",async()=>{
 const {ids}=await allocateFixture();assert.equal((await onAcceptRejectTargetedBatchCallable.run({auth:{uid:"FWR1",token:{}},data:{tbId:f.tbId,action:"ACCEPT"}})).success,true);
 const row=(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs[0];
 const noAccess={auth:{uid:"FWR1",token:{}},data:{trnId:"TRN_MDIS_EMULATOR_1",sourceModule:"SALES_TARGETED_BATCH",tbId:f.tbId,rowId:row.id,salesDocId:ids[0],erfId:"ERF1",premiseId:null,capturedAt:"2026-09-13T12:00:00Z",reason:"Locked gate",media:[{tag:"noAccessPhoto",url:"gs://mock/photo.jpg"}],location:{gps:{lat:-28.5,lng:30.5}}}};
 const results=await Promise.allSettled([recordTargetedBatchNoAccess({db,request:noAccess}),deleteSalesBatch({db,request:request({tbId:f.tbId})})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 const parent=await db.doc(`tb_uploads/${f.tbId}`).get(),sales=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),trn=await db.doc("trns/TRN_MDIS_EMULATOR_1").get();
 if(parent.exists){assert.equal(sales.targetedBatchId,f.tbId);assert.equal(trn.exists,true);assert.equal(sales.tbRefs[0].fieldWork.status,"IN_PROGRESS");}else{assert.equal(sales.targetedBatchId,null);assert.equal(trn.exists,false);assert.deepEqual(sales.tbRefs,[]);}
});
test("ordinary batch fence uses normal ERF and GPS Sales membership without batch membership",async()=>{
 const ids=await seed(1,{source:"PREPAID_SALES"}),intent=await prepare(ids,{source:"PREPAID_SALES"}),fence=await fenceFor();
 await onGeoFenceCreated.run({data:fence,params:{geoFenceId:fence.id}});
 assert.ok((await db.doc("ireps_erfs/ERF1").get()).data().geofenceRefs.some(ref=>ref.id===fence.id));
 const sales=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();
 assert.equal(sales.targetedBatchId,undefined);assert.deepEqual(sales.tbRefs,[]);
 assert.equal((await fence.ref.get()).data().status,"ACTIVE");assert.ok(intent.confirmationProof);
});

test("saved Non-GPS final pair resolves after removal without another Google request or any Sales write",async()=>{
 const ids=await seed(),intent=await prepare(ids);await createSalesBatch({db,request:request(intent),codec});await deleteSalesBatch({db,request:request({tbId:f.tbId})});
 const before=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();let calls=0;
 const result=await resolveSalesBatch({db,request:request({...intent,tbId:"TGB_20260913_120001_AB12"}),codec,geocode:async()=>{calls++;throw Error("must reuse saved evidence");}});
 assert.equal(result.rows[0].ready,true,JSON.stringify(result));assert.equal(result.rows[0].erfId,before.erfId);assert.equal(calls,0);assert.deepEqual((await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),before);
});
test("historical GPS batch above 30 retains the existing whole-batch allocation path",async()=>{
 const {ids}=await allocateFixture(1,{source:"PREPAID_SALES"});
 const parentRef=db.doc(`tb_uploads/${f.tbId}`),row=(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs[0],template=row.data(),before=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();
 const batch=db.batch();
 batch.update(parentRef,{schemaVersion:"0.2.0",status:"READY","creation.expectedRows":31,"creation.createdRows":31,"counts.totalRows":31,"counts.acceptedRows":31,"counts.rejectedRows":0,"counts.allocatedRows":0,"counts.unallocatedRows":31,"allocation.status":"NOT_STARTED","allocation.targetType":null,"allocation.targetId":null});
 for(let n=1;n<=31;n++){const id=n===1?row.id:`${f.tbId}_HIST_${n}`;batch.set(db.doc(`tb_rows/${id}`),{...template,id,rowNo:n,schemaVersion:"0.2.0",allocation:{...template.allocation,status:"UNALLOCATED",targetType:null,targetId:null}});}
 await batch.commit();const result=await onAllocateTargetedBatchCallable.run(request({tbId:f.tbId,targetType:"TEAM",targetId:"TEAM1"}));
 assert.equal(result.success,true,JSON.stringify(result));assert.equal(result.allocatedRows,31);
 assert.ok((await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs.every(doc=>doc.data().allocation.status==="ALLOCATED"));assert.deepEqual((await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),before);
});

test("unknown geocoding province reports configuration failure and leaves persisted Sales untouched",async()=>{
 const ids=await seed();await db.doc(`sales-all-meters/${ids[0]}`).update({lmPcode:"ZA0241"});
 await db.doc(`users/${f.actor.uid}`).update({"access.activeWorkbase":{id:"ZA0241"},"access.workbases":[{id:"ZA0241"}]});
 const ref=db.doc(`sales-all-meters/${ids[0]}`),before=await ref.get();
 const result=await resolveSalesBatch({db,request:request({tbId:f.tbId,lmPcode:"ZA0241",source:"PREPAID_SALES_NON_GPS",salesIds:ids}),codec,geocode:()=>assert.fail("Unknown province cannot call Google")});
 assert.equal(result.rows[0].code,"GEOCODING_CONFIGURATION_ERROR");assert.equal(result.rows[0].ready,false);
 const after=await ref.get();assert.deepEqual(after.data(),before.data());assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("geo_fences").get()).size,0);
});

test("concurrent identical fence requests produce exactly one ordinary auto ID",async()=>{
 const ids=await seed(),intent=await resolveIntent(ids);
 const results=await Promise.all(Array.from({length:4},()=>saveFence({db,request:request({...intent,points:f.fencePoints}),codec})));
 assert.equal(new Set(results.map(r=>r.geofenceId)).size,1);
 const docs=await db.collection("geo_fences").get();assert.equal(docs.size,1);
 const fence=docs.docs[0].data();assert.match(fence.id,/^[A-Za-z0-9]{20}$/);assert.equal(fence.name,`Gf W1 Test ${f.tbId}`);assert.equal(fence.description,"Owner description");assert.equal(fence.status,"ACTIVE");
 assert.deepEqual(Object.keys(fence.targetedBatch).sort(),["fingerprint","geometryHash","linkState","salesIds","tbId"]);
 assert.equal(fence.purpose,undefined);assert.equal(fence.proposedTbId,undefined);
 assert.equal((await saveFence({db,request:request({...intent,points:f.fencePoints}),codec})).reused,true);
});
test("different simultaneous fence intents cannot reserve two geofences for one tbId",async()=>{
 const ids=await seed(2),intent=await resolveIntent(ids);
 const results=await Promise.allSettled([intent,{...intent,salesIds:[ids[0]]}].map(value=>saveFence({db,request:request({...value,points:f.fencePoints}),codec})));
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await db.collection("geo_fences").get()).size,1);
});
test("batch fence rejects invalid points, edges and bowties with zero writes",async()=>{
 const ids=await seed(),intent=await resolveIntent(ids);
 for(const points of [[...f.fencePoints,{latitude:"bad",longitude:30}],[[30,-29],[31,-29],[31,-28]],[[30.3,-28.7],[30.7,-28.3],[30.7,-28.7],[30.3,-28.3]],[[30.3,-28.7],[30.7,-28.7],[30.7,-28.7],[30.3,-28.3]],[[181,-28],[30,-28],[31,-27]]]){
  await assert.rejects(saveFence({db,request:request({...intent,points}),codec}));
 }
 assert.equal((await db.collection("geo_fences").get()).size,0);
});
test("normal area permission cannot widen batch planning permission",async()=>{
 const ids=await seed(),intent=await resolveIntent(ids);
 await db.doc(`users/${f.actor.uid}`).update({"employment.role":"ADM"});
 await assert.rejects(saveFence({db,request:request({...intent,points:f.fencePoints}),codec}),/Only MNG/);
 const result=await createGeoFenceRequest({db,request:request({name:"Gf W1 Area",parents:{lmPcode:"ZA5241",wardPcode:"ZA5241001"},points:f.fencePoints.map(([longitude,latitude])=>({longitude,latitude}))})});
 const area=(await db.doc(`geo_fences/${result.geofenceId}`).get()).data();assert.equal(area.status,"ACTIVE");assert.equal(area.targetedBatch,undefined);
});
// Geofences rules GF-R002: no two active geofences in a Ward share a name (capital letters ignored).
test("a name taken by an active geofence in the Ward is refused for area and batch geofences; a removed one's name is free",async()=>{
 const area=name=>request({name,parents:{lmPcode:"ZA5241",wardPcode:"ZA5241001"},points:f.fencePoints.map(([longitude,latitude])=>({longitude,latitude}))});
 const ids=await seed(),intent=await resolveIntent(ids);
 await db.doc(`users/${f.actor.uid}`).update({"employment.role":"ADM"});
 const first=await createGeoFenceRequest({db,request:area("Gf W1 Albert Street")});assert.equal(first.success,true);
 await assert.rejects(createGeoFenceRequest({db,request:area("Gf W1 ALBERT STREET")}),{code:"already-exists",message:/"Gf W1 Albert Street" already exists\. Choose another name\./});
 await db.doc(`users/${f.actor.uid}`).update({"employment.role":"MNG"});
 await assert.rejects(createGeoFenceRequest({db,codec,request:request({name:"Gf W1 albert street",parents:{countryPcode:"ZA",provincePcode:"ZA5",dmPcode:"ZA524",lmPcode:"ZA5241",wardPcode:"ZA5241001"},points:f.fencePoints.map(([longitude,latitude])=>({longitude,latitude})),targetedBatch:intent})}),{code:"GEOFENCE_NAME_TAKEN"});
 assert.equal((await db.collection("geo_fences").get()).size,1,"nothing was created");
 const saved=await saveFence({db,request:request({...intent,points:f.fencePoints}),codec});assert.equal(saved.reused,false);
 assert.equal((await saveFence({db,request:request({...intent,points:f.fencePoints}),codec})).reused,true,"saving again for the same batch is not a duplicate");
 await db.doc(`geo_fences/${first.geofenceId}`).update({status:"INACTIVE"});
 await db.doc(`users/${f.actor.uid}`).update({"employment.role":"ADM"});
 assert.equal((await createGeoFenceRequest({db,request:area("Gf W1 Albert Street")})).success,true,"a removed geofence's name can be used again");
});
test("batch supervisor also needs normal MNC geofence permission",async()=>{
 const ids=await seed(),intent=await resolveIntent(ids);
 await db.doc(`users/${f.actor.uid}`).update({"employment.role":"SPV","employment.serviceProvider.id":"SP1"});
 await db.doc("serviceProviders/SP1").set({clients:[]});
 await assert.rejects(saveFence({db,request:request({...intent,points:f.fencePoints}),codec}),/Only MNC/);
 await db.doc("serviceProviders/SP1").update({clients:[{id:"ZA5241",clientType:"LM",relationshipType:"MNC"}]});
 assert.equal((await saveFence({db,request:request({...intent,points:f.fencePoints}),codec})).success,true);
});
test("ordinary membership counts changing does not invalidate batch confirmation",async()=>{
 const ids=await seed(),intent=await prepare(ids);
 await (await fenceFor()).ref.update({"counts.erfs":100,"metadata.updatedAt":new Date().toISOString()});
 assert.equal((await createSalesBatch({db,request:request(intent),codec})).success,true);
 const fence=(await fenceFor()).data();assert.equal(fence.targetedBatch.linkState,"LINKED");
 await deleteSalesBatch({db,request:request({tbId:f.tbId})});assert.deepEqual((await fenceFor()).data(),fence);
});
test("old batch-only fence remains untouched and cannot be used for new creation",async()=>{
 const ids=await seed(),intent=await resolveIntent(ids),old={id:`SALES_${f.tbId}`,status:"BATCH_ONLY",proposedTbId:f.tbId,linkState:"UNLINKED"};
 await db.doc(`geo_fences/${old.id}`).set(old);
 await assert.rejects(assessSalesBatch({db,request:request({...intent,geofenceId:old.id}),codec}),/Create a new geofence/);
 assert.deepEqual((await db.doc(`geo_fences/${old.id}`).get()).data(),old);
});
// Rules TB-R047: the Allocation Map allocates several batches to one TEAM or SP together, all or nothing.
const TB_B="TGB_20260913_120002_AB12";
async function twoBatches(){
 const [a,b]=await seed(2);
 await createSalesBatch({db,request:request(await prepare([a])),codec});
 await createSalesBatch({db,request:request(await prepare([b],{tbId:TB_B})),codec});
 await db.doc(`users/${f.actor.uid}`).update({"employment.serviceProvider.id":"MNC1"});
 await db.doc("users/FWR1").set({profile:{displayName:"Worker",employment:{role:"FWR",serviceProvider:{id:"SP1"}}}});
 await db.doc("teams/TEAM1").set({team:{status:"ACTIVE",name:"Test team"},ownership:{mncServiceProviderId:"MNC1"},scope:{memberUserIds:["FWR1"]},memberUids:["FWR1"]});
 await db.doc("serviceProviders/SP1").set({status:"ACTIVE",name:"Test SP",clients:[{id:"MNC1",clientType:"SP",relationshipType:"SUBC"}]});
 return {db,request:request({}),tbIds:[f.tbId,TB_B],targetType:"TEAM",targetId:"TEAM1",actorMncId:"MNC1",actorUid:f.actor.uid,actorName:f.actor.user};
}
test("the Allocation Map allocates the selected batches to one TEAM in one step, and a repeat changes nothing",async()=>{
 const args=await twoBatches();
 const result=await allocateSalesBatchesTogether(args);
 assert.deepEqual([result.allocatedTbIds,result.totalRows,result.target.id],[[f.tbId,TB_B],2,"TEAM1"]);
 for(const tbId of [f.tbId,TB_B]){
  const parent=(await db.doc(`tb_uploads/${tbId}`).get()).data();
  assert.deepEqual([parent.allocation.status,parent.allocation.targetId,parent.acceptance.status],["ALLOCATED","TEAM1","WAITING"]);
  const rows=await db.collection("tb_rows").where("tbId","==",tbId).get();assert.ok(rows.docs.every(row=>row.data().allocation.targetId==="TEAM1"&&row.data().allocation.status==="ALLOCATED"));
 }
 const again=await allocateSalesBatchesTogether(args);assert.deepEqual([again.alreadyAllocatedTbIds,again.updatedRows],[[f.tbId,TB_B],0]);
});
test("the Allocation Map allocates nothing when one selected batch is allocated elsewhere, and names it",async()=>{
 const args=await twoBatches();
 await allocateNonGpsBatchAtomically({db,request:request({}),parentRef:db.doc(`tb_uploads/${TB_B}`),tbId:TB_B,targetType:"SP",targetId:"SP1",actorMncId:"MNC1",actorUid:f.actor.uid,actorName:f.actor.user,startedAtMs:Date.now()});
 await assert.rejects(allocateSalesBatchesTogether(args),error=>error.details.tbId===TB_B&&/another TEAM\/SP/.test(error.message));
 const first=(await db.doc(`tb_uploads/${f.tbId}`).get()).data();assert.notEqual(first.allocation?.status,"ALLOCATED","the other batch was not allocated");
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.ok(rows.docs.every(row=>row.data().allocation.status!=="ALLOCATED"));
});
test("the Allocation Map Function allows 1 to 15 distinct batches and reports the batch that failed",async()=>{
 await twoBatches();
 const call=data=>onAllocateTargetedBatchesTogetherCallable.run(request({targetType:"TEAM",targetId:"TEAM1",...data}));
 assert.equal((await call({tbIds:[]})).code,"INVALID_GROUP_ALLOCATION_SIZE");
 assert.equal((await call({tbIds:Array.from({length:16},(_,i)=>`TGB_20260913_1200${String(i).padStart(2,"0")}_AB12`)})).code,"INVALID_GROUP_ALLOCATION_SIZE");
 assert.equal((await call({tbIds:[f.tbId,f.tbId]})).code,"DUPLICATE_TARGETED_BATCH_ID");
 const missing=await call({tbIds:[f.tbId,"TGB_20260913_120009_AB12"]});assert.deepEqual([missing.success,missing.code,missing.tbId],[false,"TARGETED_BATCH_NOT_FOUND","TGB_20260913_120009_AB12"]);
 assert.notEqual((await db.doc(`tb_uploads/${f.tbId}`).get()).data().allocation?.status,"ALLOCATED","nothing is allocated when one batch fails");
 const ok=await call({tbIds:[f.tbId,TB_B]});assert.deepEqual([ok.success,ok.code,ok.allocatedTbIds],[true,"TARGETED_BATCHES_ALLOCATED",[f.tbId,TB_B]]);
});


// Targeted Batch rules TB-R048 (1.3.33): Unallocate.
const withoutMetadata=doc=>{const copy=structuredClone(doc);delete copy.metadata;return copy;};
async function unallocationFixture(){
 const ids=await seed(1),intent=await prepare(ids);await createSalesBatch({db,request:request(intent),codec});
 await db.doc(`users/${f.actor.uid}`).update({"employment.serviceProvider.id":"MNC1"});
 await db.doc("users/FWR1").set({profile:{displayName:"Worker",employment:{role:"FWR",serviceProvider:{id:"SP1"}}}});
 await db.doc("users/MANAGER2").set({...structuredClone(f.profile),displayName:"Second Manager",employment:{role:"MNG",serviceProvider:{id:"MNC1"}}});
 await db.doc("users/SUPERVISOR2").set({...structuredClone(f.profile),displayName:"Main Supervisor",employment:{role:"SPV",serviceProvider:{id:"MNC1"}}});
 await db.doc("serviceProviders/MNC1").set({status:"ACTIVE",name:"Main SP",clients:[]});
 await db.doc("teams/TEAM1").set({team:{status:"ACTIVE",name:"Test team"},ownership:{mncServiceProviderId:"MNC1"},scope:{memberUserIds:["FWR1"]},memberUids:["FWR1"]});
 await db.doc("serviceProviders/SP1").set({status:"ACTIVE",name:"Test SP",clients:[{id:"MNC1",clientType:"SP",relationshipType:"SUBC"}]});
 const parentRef=db.doc(`tb_uploads/${f.tbId}`);
 const created={parent:(await parentRef.get()).data(),rows:(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs.map(d=>d.data())};
 const allocate=(targetType="TEAM")=>allocateNonGpsBatchAtomically({db,request:request({}),parentRef,tbId:f.tbId,targetType,targetId:targetType==="TEAM"?"TEAM1":"SP1",actorMncId:"MNC1",actorUid:f.actor.uid,actorName:f.actor.user,startedAtMs:Date.now()});
 return {ids,parentRef,created,allocate};
}
// TB Register sends the allocation it showed: the TEAM or SP and the moment it was allocated.
const shownAllocationMillis=async()=>(await db.doc(`tb_uploads/${f.tbId}`).get()).data().allocation?.completedAt?.toMillis?.()??null;
const unallocate=async(data={},uid=f.actor.uid)=>unallocateSalesBatch({db,request:{auth:{uid,token:{}},data:{tbId:f.tbId,expectedTargetType:"TEAM",expectedTargetId:"TEAM1",expectedAllocatedAtMillis:await shownAllocationMillis(),reason:"Allocated to the wrong team",...data}}});
async function unallocationHistory(){return (await db.collection(`tb_uploads/${f.tbId}/history`).get()).docs.map(d=>d.data()).filter(h=>h.event==="TARGETED_BATCH_UNALLOCATED");}
const acceptAs=(action="ACCEPT",extra={})=>onAcceptRejectTargetedBatchCallable.run({auth:{uid:"FWR1",token:{}},data:{tbId:f.tbId,action,...extra}});
const noAccessRequest=(rowId,salesDocId,trnId)=>({auth:{uid:"FWR1",token:{}},data:{trnId,sourceModule:"SALES_TARGETED_BATCH",tbId:f.tbId,rowId,salesDocId,erfId:"ERF1",premiseId:null,capturedAt:"2026-09-16T08:00:00Z",reason:"Locked gate",media:[{tag:"noAccessPhoto",url:"gs://mock/photo.jpg"}],location:{gps:{lat:-28.5,lng:30.5}}}});

test("unallocate returns an accepted batch exactly to its created state and it can be allocated to someone else",async()=>{
 const {ids,created,allocate}=await unallocationFixture();
 assert.equal((await allocate()).success,true);
 assert.equal((await acceptAs()).success,true);
 const salesBefore=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),fence=(await fenceFor()).data(),team=(await db.doc("teams/TEAM1").get()).data();
 const result=await unallocate();
 assert.deepEqual([result.success,result.code,result.rows,result.previousTarget.id,result.previousAcceptance,result.authority],[true,"TARGETED_BATCH_UNALLOCATED",1,"TEAM1","ACCEPTED","ALLOCATOR"]);
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data(),rows=(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs.map(d=>d.data());
 assert.deepEqual(withoutMetadata(parent),withoutMetadata(created.parent),"the parent is exactly as it was created");
 assert.deepEqual(rows.map(withoutMetadata),created.rows.map(withoutMetadata),"every row is exactly as it was created");
 assert.deepEqual((await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),salesBefore,"Sales is untouched");
 assert.equal((await db.collection(`sales-all-meters/${ids[0]}/batchHistory`).get()).size,1,"no batch history is added");
 assert.deepEqual((await fenceFor()).data(),fence,"the geofence is untouched");
 assert.deepEqual((await db.doc("teams/TEAM1").get()).data(),team,"the team is untouched");
 const [entry]=await unallocationHistory();
 assert.deepEqual([entry.reason,entry.previousAllocation.targetId,entry.previousAcceptance.status,entry.rowCount,entry.authority,entry.override,entry.actor.uid],["Allocated to the wrong team","TEAM1","ACCEPTED",1,"ALLOCATOR",false,f.actor.uid]);
 const again=await allocate("SP");assert.equal(again.success,true,JSON.stringify(again));
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).data().allocation.targetId,"SP1");
});

test("a rejected batch can be unallocated, which is its only way back",async()=>{
 const {allocate}=await unallocationFixture();await allocate();
 assert.equal((await acceptAs("REJECT",{rejectReason:"Too far"})).success,true);
 const result=await unallocate();assert.deepEqual([result.success,result.previousAcceptance],[true,"REJECTED"]);
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).data().acceptance.status,"NOT_READY");
});

test("only the allocator unallocates; another supervisor is refused and a manager overrides on the record",async()=>{
 const {allocate}=await unallocationFixture();await allocate();
 await assert.rejects(unallocate({},"SUPERVISOR2"),{code:"UNALLOCATE_NOT_ALLOCATOR"});
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).data().allocation.status,"ALLOCATED","nothing changed");
 const result=await unallocate({reason:"Allocator on leave"},"MANAGER2");
 assert.deepEqual([result.success,result.authority],[true,"MANAGER_OVERRIDE"]);
 const [entry]=await unallocationHistory();assert.deepEqual([entry.authority,entry.override,entry.actor.uid],["MANAGER_OVERRIDE",true,"MANAGER2"]);
 assert.match(entry.note,/manager override of Test Supervisor/);
});

test("field work blocks unallocation, and the batch keeps its TEAM",async()=>{
 const {ids,allocate}=await unallocationFixture();await allocate();
 assert.equal((await acceptAs()).success,true);
 const row=(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs[0];
 await recordTargetedBatchNoAccess({db,request:noAccessRequest(row.id,ids[0],"TRN_MDIS_EMULATOR_2")});
 await assert.rejects(unallocate(),error=>["EXECUTION_STATE_INVALID","EXECUTION_STARTED"].includes(error.code));
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data();
 assert.deepEqual([parent.allocation.status,parent.allocation.targetId],["ALLOCATED","TEAM1"]);
 assert.equal((await unallocationHistory()).length,0);
});

test("No Access racing Unallocate: exactly one wins, never work on an unallocated batch",async()=>{
 const {ids,allocate}=await unallocationFixture();await allocate();
 assert.equal((await acceptAs()).success,true);
 const row=(await db.collection("tb_rows").where("tbId","==",f.tbId).get()).docs[0];
 const results=await Promise.allSettled([recordTargetedBatchNoAccess({db,request:noAccessRequest(row.id,ids[0],"TRN_MDIS_EMULATOR_3")}),unallocate()]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1,JSON.stringify(results.map(r=>r.status==="fulfilled"?"ok":r.reason?.code)));
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data(),live=(await row.ref.get()).data(),trn=await db.doc("trns/TRN_MDIS_EMULATOR_3").get();
 if(parent.allocation.status==="ALLOCATED"){assert.equal(live.execution.status,"IN_PROGRESS");assert.equal(trn.exists,true);assert.equal((await unallocationHistory()).length,0);}
 else{assert.equal(live.execution.status,"NOT_STARTED");assert.equal(live.allocation.status,"UNALLOCATED");assert.equal(trn.exists,false);assert.equal((await unallocationHistory()).length,1);}
});

test("a repeat changes nothing, and a batch now held by someone else is not unallocated",async()=>{
 const {allocate}=await unallocationFixture();await allocate();
 const shown=await shownAllocationMillis();
 assert.equal((await unallocate({expectedAllocatedAtMillis:shown})).code,"TARGETED_BATCH_UNALLOCATED");
 const repeat=await unallocate({expectedAllocatedAtMillis:shown});assert.deepEqual([repeat.success,repeat.code],[true,"TARGETED_BATCH_ALREADY_UNALLOCATED"]);
 assert.equal((await unallocationHistory()).length,1,"a repeat writes no second record");
 await allocate("SP");
 await assert.rejects(unallocate(),{code:"UNALLOCATE_TARGET_CHANGED"});
 assert.equal((await db.doc(`tb_uploads/${f.tbId}`).get()).data().allocation.targetId,"SP1");
});

test("the Unallocate Function refuses a missing reason, a missing allocation, a stray acceptance and an older batch, reporting codes without throwing",async()=>{
 const {parentRef,allocate}=await unallocationFixture();await allocate();
 const shown=await shownAllocationMillis();
 const call=data=>onUnallocateTargetedBatchCallable.run(request({tbId:f.tbId,expectedTargetType:"TEAM",expectedTargetId:"TEAM1",expectedAllocatedAtMillis:shown,reason:"Wrong team",...data}));
 assert.equal((await call({reason:"  "})).code,"UNALLOCATE_REASON_REQUIRED");
 assert.equal((await call({expectedTargetType:"PERSON"})).code,"INVALID_UNALLOCATE_INTENT");
 assert.equal((await call({expectedAllocatedAtMillis:undefined})).code,"INVALID_UNALLOCATE_INTENT","the allocation TB Register showed is required");
 await parentRef.update({"acceptance.status":"NOT_READY"});
 assert.equal((await call({})).code,"UNALLOCATE_ACCEPTANCE_INVALID","only Waiting, Accepted or Rejected");
 await parentRef.update({"acceptance.status":"WAITING"});
 await parentRef.update({schemaVersion:"0.2.0"});
 const legacy=await call({});assert.deepEqual([legacy.success,legacy.code],[false,"UNALLOCATE_LEGACY_BATCH"]);
 assert.equal((await parentRef.get()).data().allocation.status,"ALLOCATED");
});

test("a batch allocated again to the same TEAM since TB Register showed it is not taken back",async()=>{
 const {allocate}=await unallocationFixture();await allocate();
 const shown=await shownAllocationMillis();
 assert.equal((await unallocate({expectedAllocatedAtMillis:shown})).success,true);
 await allocate();
 await assert.rejects(unallocate({expectedAllocatedAtMillis:shown},"MANAGER2"),{code:"UNALLOCATE_TARGET_CHANGED"});
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data();
 assert.deepEqual([parent.allocation.status,parent.allocation.targetId],["ALLOCATED","TEAM1"],"the new allocation stands");
 assert.equal((await unallocationHistory()).length,1,"only the first unallocation is recorded");
});
