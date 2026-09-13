import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createProofCodec, resolveSalesBatch } from "../targetedBatches/sales-batch-resolution.js";
import { saveSalesBatchGeofence, assessSalesBatch } from "../targetedBatches/sales-batch-geofence.js";
import { createSalesBatch } from "../targetedBatches/sales-batch-creation.js";
import { allocateNonGpsBatchAtomically, onAllocateTargetedBatchCallable } from "../targetedBatches/allocationCallable.js";
import { onAcceptRejectTargetedBatchCallable } from "../targetedBatches/acceptanceCallable.js";
import { recordTargetedBatchNoAccess } from "../targetedBatches/recordTargetedBatchNoAccessCallable.js";
import { onGeoFenceCreated } from "../geofences/triggers.js";
import { deleteSalesBatch } from "../targetedBatches/deleteCallable.js";

const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host||""))throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId="demo-ireps-sales-batch";
const app=initializeApp({projectId});
const db=getFirestore(app);
const f=JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
// Production geometry is JSON text: Firestore cannot store nested arrays.
f.erf.geometry=JSON.stringify(f.erf.geometry);
f.ward.geometry=JSON.stringify(f.ward.geometry);
let clock=Date.now();const codec=createProofCodec("test-only-proof-key-not-a-real-secret",()=>clock);
const request=data=>({auth:{uid:f.actor.uid,token:{}},data});
const geocode=async()=>({ok:true,point:{latitude:-28.5,longitude:30.5},provider:"Google Geocoding API"});
beforeEach(async()=>{
  clock=Date.now();
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
async function prepare(ids,{source="PREPAID_SALES_NON_GPS",tbId=f.tbId}={}){
 const intent={tbId,lmPcode:"ZA5241",source,salesIds:ids,reason:"Fixture selection",salesPeriodFrom:"2026-07",salesPeriodTo:"2026-08"};
 const resolved=await resolveSalesBatch({db,request:request(intent),codec,geocode});
 assert.equal(resolved.rows.every(row=>row.ready),true,JSON.stringify(resolved));
 intent.resolutionProofs=Object.fromEntries(resolved.rows.map(row=>[row.salesId,row.proof]));
 await saveSalesBatchGeofence({db,request:request({...intent,points:f.fencePoints,saveSalesIds:ids}),codec});
 const assessment=await assessSalesBatch({db,request:request(intent),codec});
 return {...intent,confirmationProof:assessment.confirmationProof,fingerprint:assessment.fingerprint,includedIds:assessment.includedIds};
}
for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"])for(const n of [1,30])test(`emulator ${source} ${n} meters commit together with exact history and preserved roots`,async()=>{
 const ids=await seed(n,{source}),intent=await prepare(ids,{source});
 const result=await createSalesBatch({db,request:request(intent),codec});assert.equal(result.rowCount,n);
 const parent=(await db.doc(`tb_uploads/${f.tbId}`).get()).data();assert.equal(parent.schemaVersion,"0.3.0");assert.equal(parent.creation.createdRows,n);
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.equal(rows.size,n);
 for(const id of ids){const sales=(await db.doc(`sales-all-meters/${id}`).get()).data();assert.equal(sales.targetedBatchId,f.tbId);assert.equal(sales.tbRefs.length,1);assert.equal(sales.tbRefs[0].date.toMillis(),parent.metadata.createdAt.toMillis());assert.equal(sales.metadata.createdAt.toMillis(),1000000);assert.deepEqual(sales.monthlyCategories,f.sales.monthlyCategories);assert.equal(sales.salesStatus,"NOT_STARTED");
  assert.equal(Boolean(sales.erfResolution),source==="PREPAID_SALES_NON_GPS");
  assert.equal((await db.doc(`sales-all-meters/${id}/batchHistory/${f.tbId}__BATCHED`).get()).exists,true);
 }
 const again=await createSalesBatch({db,request:request(intent),codec});assert.equal(again.reused,true);
 clock+=10000000;assert.equal((await createSalesBatch({db,request:request(intent),codec})).reused,true);
});
test("competing creators reread the same Sales: exactly one complete batch wins",async()=>{
 const ids=await seed();const first=await prepare(ids),second=await prepare(ids,{tbId:"TGB_20260913_120001_AB12"});
 const results=await Promise.allSettled([createSalesBatch({db,request:request(first),codec}),createSalesBatch({db,request:request(second),codec})]);
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
 assert.equal((await db.collection("tb_uploads").get()).size,1);assert.equal((await db.collection("tb_rows").get()).size,1);
});
test("30 confirmed with one newly occupied meter creates zero",async()=>{
 const ids=await seed(30),intent=await prepare(ids);
 await db.doc(`sales-all-meters/${ids[10]}`).update({targetedBatchId:"TGB_20260913_120001_AB12"});
 await assert.rejects(createSalesBatch({db,request:request(intent),codec}));
 assert.equal((await db.collection("tb_uploads").get()).size,0);assert.equal((await db.collection("tb_rows").get()).size,0);
 assert.equal((await db.doc(`geo_fences/SALES_${f.tbId}`).get()).data().linkState,"UNLINKED");
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
 assert.equal((await db.doc(`geo_fences/SALES_${f.tbId}`).get()).data().linkState,"LINKED");
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
test("Save is immutable, repeatable across winding, Sales-read-only, and population can only shrink",async()=>{
 const ids=await seed(3),intent=await resolveIntent(ids),before=await Promise.all(ids.map(id=>db.doc(`sales-all-meters/${id}`).get()));
 const saved=await saveSalesBatchGeofence({db,request:request({...intent,saveSalesIds:ids,points:f.fencePoints}),codec});assert.equal(saved.reused,false);
 assert.equal((await saveSalesBatchGeofence({db,request:request({...intent,saveSalesIds:ids,points:[...f.fencePoints].reverse()}),codec})).reused,true);
 await assert.rejects(saveSalesBatchGeofence({db,request:request({...intent,saveSalesIds:ids.slice(1),points:f.fencePoints}),codec}),/different saved/);
 for(let i=0;i<ids.length;i++)assert.deepEqual((await db.doc(`sales-all-meters/${ids[i]}`).get()).data(),before[i].data());
 const smaller={...intent,salesIds:[ids[0],ids[2]]},assessed=await assessSalesBatch({db,request:request(smaller),codec});
 await createSalesBatch({db,request:request({...smaller,...assessed}),codec});
 const rows=await db.collection("tb_rows").where("tbId","==",f.tbId).get();assert.deepEqual(rows.docs.map(row=>row.data().rowNo).sort(),[1,3]);
 assert.equal((await db.doc(`sales-all-meters/${ids[1]}`).get()).data().targetedBatchId,undefined);
});
test("unresolved at Save cannot join after resolving later; every retained row is accounted for",async()=>{
 const source="PREPAID_SALES",ids=await seed(2,{source});await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[]});
 let intent=await resolveIntent(ids,{source});await saveSalesBatchGeofence({db,request:request({...intent,saveSalesIds:[ids[0]],points:f.fencePoints}),codec});
 await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[{ErfId:"ERF1",Latitude:-28.5,Longitude:30.5}]});
 intent=await resolveIntent(ids,{source});const assessed=await assessSalesBatch({db,request:request(intent),codec});
 assert.deepEqual(assessed.includedIds,[ids[0]]);assert.equal(assessed.leftOut[0].salesId,ids[1]);assert.equal(assessed.leftOut[0].code,"OUTSIDE_SAVED_POPULATION");assert.equal(assessed.rows.length,2);
});
test("a retained ineligible GPS meter in another Ward prevents Save even if excluded from save IDs",async()=>{
 const source="PREPAID_SALES",ids=await seed(2,{source});
 await db.doc("wards/ZA5241002").set({...f.ward,pcode:"ZA5241002",code:"2",name:"Ward 2",geometry:JSON.stringify({type:"Polygon",coordinates:[[[31,-29],[32,-29],[32,-28],[31,-28],[31,-29]]]})});
 await db.doc("ireps_erfs/ERF2").set({...f.erf,erfId:"ERF2",admin:{...f.erf.admin,ward:{pcode:"ZA5241002",name:"Ward 2"}},centroid:{lat:-28.5,lng:31.5},bbox:{minLat:-28.6,maxLat:-28.4,minLng:31.4,maxLng:31.6},geometry:JSON.stringify({type:"Polygon",coordinates:[[[31.4,-28.6],[31.6,-28.6],[31.6,-28.4],[31.4,-28.4],[31.4,-28.6]]]})});
 await db.doc(`sales-all-meters/${ids[1]}`).update({erfCandidates:[{ErfId:"ERF2",Latitude:-28.5,Longitude:31.5}],targetedBatchId:"TGB_20260913_120001_AB12"});
 const intent=await resolveIntent(ids,{source});await assert.rejects(saveSalesBatchGeofence({db,request:request({...intent,saveSalesIds:[ids[0]],points:f.fencePoints}),codec}),/one Ward/);
 assert.equal((await db.collection("geo_fences").get()).size,0);
});
for(const [name,path,patch]of [
 ["address","sales-all-meters/00123",{"adr.strNo":"02"}],
 ["visibility","sales-all-meters/00123",{"master.visibility":"VISIBLE"}],
 ["actor role","users/SUPERVISOR1",{"employment.role":"FWR"}],
 ["Ward geometry","wards/ZA5241001",{geometry:"invalid"}],
 ["ERF geometry","ireps_erfs/ERF1",{geometry:"invalid"}],
 ["fence population",`geo_fences/SALES_${f.tbId}`,{savedSalesIds:["WRONG"]}],
 ["fence consumed",`geo_fences/SALES_${f.tbId}`,{linkState:"LINKED"}],
])test(`fresh transaction rejects changed ${name} with no creation writes`,async()=>{
 const ids=await seed(),intent=await prepare(ids);await db.doc(path).update(patch);
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
test("BATCH_ONLY CREATE trigger returns before any generic membership write",async()=>{
 const ids=await seed(),intent=await prepare(ids),fence=await db.doc(`geo_fences/SALES_${f.tbId}`).get(),before=(await db.doc(`sales-all-meters/${ids[0]}`).get()).data();
 await onGeoFenceCreated.run({data:fence,params:{geoFenceId:fence.id}});
 assert.deepEqual((await db.doc(`sales-all-meters/${ids[0]}`).get()).data(),before);assert.deepEqual((await fence.ref.get()).data(),fence.data());
 assert.equal((await db.collection("premises").get()).size,0);assert.equal((await db.collection("asts").get()).size,0);assert.equal((await db.collection("tb_uploads").get()).size,0);assert.ok(intent.confirmationProof);
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
