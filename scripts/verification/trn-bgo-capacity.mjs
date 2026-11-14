// Explicit hosted DEV capacity probe. All fixtures live under one private
// verification document, so operational collection triggers never receive them.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, applicationDefault, deleteApp } from "../../functions/node_modules/firebase-admin/lib/app/index.js";
import { getFirestore } from "../../functions/node_modules/firebase-admin/lib/firestore/index.js";
import { createBulkGraph, buildBulkTrn, BULK_CONTRACT, digest } from "../../functions/tcUploads/stage2Core.js";
import { allocateTcBatches } from "../../functions/tcUploads/allocation.js";
import { OFFICIAL_HEADERS } from "../../functions/tcUploads/stage1Validation.js";
import { serializeCsv } from "../../functions/tcUploads/sourceCsv.js";
assert.equal(process.env.TRN_BGO_HOSTED_CAPACITY,"ireps2","Explicit DEV capacity opt-in required");
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST,"Hosted probe cannot claim emulator results");
const app=initializeApp({projectId:"ireps2",credential:applicationDefault()});
const raw=getFirestore(app),root=raw.doc(`_verification/TRN_BGO_STAGE2_${randomUUID()}`);
const db={doc:path=>root.collection(path.split('/')[0]).doc(path.split('/').slice(1).join('/')),collection:path=>raw.collection(`${root.path}/${path}`),getAll:(...refs)=>raw.getAll(...refs),runTransaction:callback=>raw.runTransaction(callback)};
const types=["METER_DISCONNECTION","METER_RECONNECTION","METER_INSPECTION","METER_REMOVAL","METER_READING"];
const lmPcode="ZA5241",uid="CAPACITY_MANAGER",now=new Date().toISOString(),stamp=Date.now(),entries=[];
const writeFixtures=async records=>{for(let i=0;i<records.length;i+=400){const batch=raw.batch();for(const [path,data] of records.slice(i,i+400))batch.set(db.doc(path),data);await batch.commit();}};
try {
 console.log(JSON.stringify({namespace:root.path}));
 await root.create({purpose:"TRN BGO Stage 2 isolated capacity verification",createdAt:now});
 await db.doc(`users/${uid}`).set({accountStatus:"ACTIVE",employment:{role:"MNG",serviceProvider:{id:"MNC_CAPACITY"}},access:{workbases:[lmPcode]}});
 const rows=Array.from({length:200},(_,i)=>Object.fromEntries(OFFICIAL_HEADERS.map(h=>[h,h==="rowNo"?String(i+1):h==="meterNo"?`00${stamp}${String(i).padStart(3,"0")}`:""])));
 const fixtures=[];
 for(let i=0;i<200;i++){
  const astId=`TRN_MDIS_${stamp}_${i}`,premiseId=`P_${i}`,wardPcode=`${lmPcode}${String(i).padStart(3,"0")}`,parents={lmPcode,wardPcode};
  const ast={id:astId,meterType:"electricity",status:{state:"CONNECTED"},accessData:{parents,premise:{id:premiseId},erfNo:String(i)},ast:{astData:{astId,astNo:rows[i].meterNo,meter:{type:"conventional"}}},geofenceRefs:[{id:"G1",name:"Capacity"}]};
  const premise={id:premiseId,parents,erfNo:String(i),services:{electricityMeters:[{trnId:astId}]}};
  entries.push({astId,ast,premiseId,premise,wardPcode,row:rows[i]});
  fixtures.push([`wards/${wardPcode}`,{parents:{localMunicipalityId:lmPcode},name:`Ward ${i}`}],[`premises/${premiseId}`,premise],[`asts/${astId}`,ast],[`trns/${astId}`,{id:astId,accessData:{trnType:"METER_DISCOVERY",access:{hasAccess:"yes"}},ast:{astData:{astNo:rows[i].meterNo}}}],[`meter_master/${rows[i].meterNo}`,{refs:{asts:{id:astId}}}]);
 }
 await writeFixtures(fixtures);
 const csv=serializeCsv([OFFICIAL_HEADERS,...rows.map(row=>OFFICIAL_HEADERS.map(h=>row[h]))]);
 for(const trnType of process.env.TRN_BGO_CAPACITY_ALLOCATION_ONLY ? [] : types){
  await writeFixtures(entries.map(e=>[`asts/${e.astId}`,{...e.ast,status:{state:trnType==="METER_RECONNECTION"?"DISCONNECTED":"CONNECTED"}}]));
  const source={id:digest(`${root.id}:${trnType}`),uid,lmPcode,trnType,contractVersion:BULK_CONTRACT,hash:digest(csv),fileName:"capacity.csv",generation:"private-fixture"};
  await db.doc(`tc_source_files/${source.id}`).set(source);
  const data={lmPcode,trnType,selectedRowNos:rows.map(r=>r.rowNo),keep:{}};
  const start=Date.now(),result=await createBulkGraph({db,uid,data,source,csv});
  assert.equal(result.batches.length,200);assert.equal(result.totalMeters,200);
  assert.deepEqual(await createBulkGraph({db,uid,data,source,csv}),result);
  console.log(JSON.stringify({probe:"actual coordinator",trnType,meters:200,wards:200,durationMs:Date.now()-start,idempotency:"PASS"}));
 }
 const records=[],batchIds=[];
 for(let b=0;b<15;b++){
  const batchId=`CAPACITY_15_${b}`,trnIds=[];batchIds.push(batchId);
  for(let i=0;i<Math.floor(200/15)+(b<200%15?1:0);i++){
   const entry=entries[i],id=`CAPACITY_${b}_${i}`,astId=`CAPACITY_AST_${b}_${i}`;
   const trn=buildBulkTrn({entry:{...entry,astId},id,trnType:"METER_DISCONNECTION",lineage:{batchId,rowId:`R_${b}_${i}`,sourceFileId:"CAPACITY",requestId:"CAPACITY"},actor:{uid,name:"Capacity Manager"},now});
   trnIds.push(id);records.push([`trns/${id}`,trn],[`asts/${astId}`,{...entry.ast,id:astId}]);
  }
  records.push([`tc_uploads/${batchId}`,{id:batchId,contractVersion:BULK_CONTRACT,lmPcode,wardPcode:"ZA5241006",trnType:"METER_DISCONNECTION",totalRows:trnIds.length,trnIds,workflow:{state:"READY_FOR_ALLOCATION"},assignment:{targets:[]}}]);
 }
 records.push(["teams/CAPACITY_TEAM",{status:"ACTIVE",name:"Capacity Team",ownership:{mncServiceProviderId:"MNC_CAPACITY"},scope:{memberUserIds:["CAPACITY_FIELD"]}}]);
 console.log(JSON.stringify({probe:"allocation fixtures",parents:15,meters:200,phase:"preparing"}));
 await writeFixtures(records);
 console.log(JSON.stringify({probe:"allocation fixtures",phase:"ready"}));
 const start=Date.now();
 assert.equal((await allocateTcBatches({db,request:{auth:{uid},data:{batchIds,targetType:"TEAM",targetId:"CAPACITY_TEAM"}}})).success,true);
 for(const id of batchIds)assert.equal((await db.doc(`tc_uploads/${id}`).get()).data().workflow.state,"ISSUED");
 assert.equal((await db.doc("trns/CAPACITY_14_12").get()).data().workflow.state,"ISSUED");
 console.log(JSON.stringify({probe:"actual allocation",parents:15,meters:200,durationMs:Date.now()-start,result:"PASS"}));
} finally {
 await raw.recursiveDelete(root);
 assert.equal((await root.get()).exists,false);
 assert.equal((await root.listCollections()).length,0);
 console.log("Private capacity fixtures removed; operational collections untouched.");
 await deleteApp(app);
}
