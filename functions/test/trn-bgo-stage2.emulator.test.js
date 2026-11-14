import { allocateTcBatches, decideTcBatch, deleteModernTc } from "../tcUploads/allocation.js";
import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp,deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createBulkGraph, BULK_CONTRACT,digest,parseSource } from "../tcUploads/stage2Core.js";
import { validateLifecycleInstructionEligibility } from "../meterLifecycle/helpers.js";
import { OFFICIAL_HEADERS } from "../tcUploads/stage1Validation.js";
import { serializeCsv } from "../tcUploads/sourceCsv.js";
import { verifyBulkInstruction, verifyBulkExecution } from "../tcUploads/bulkPolicy.js";

test("actual bulk coordinator: atomic 200-row creation, source lineage, retry and concurrent work protection",{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
 assert.match(process.env.GCLOUD_PROJECT||"",/^demo-/);
 const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},`bulk-${Date.now()}`);t.after(()=>deleteApp(app));const db=getFirestore(app);
 const uid=`M_${Date.now()}`,lmPcode="ZA5241",trnType="METER_DISCONNECTION",stamp=Date.now();
 await db.doc(`users/${uid}`).set({accountStatus:"ACTIVE",employment:{role:"MNG"},access:{workbases:[lmPcode]}});
 const rows=Array.from({length:200},(_,i)=>Object.fromEntries(OFFICIAL_HEADERS.map(h=>[h,h==="rowNo"?String(i+1):h==="meterNo"?`00${stamp}${String(i).padStart(3,"0")}`:""])));
 const fixture=[];
 for(let i=0;i<200;i++) {
  const id=`TRN_MDIS_${stamp}_${i}`,wardPcode=`${lmPcode}${String(i).padStart(3,"0")}`,premiseId=`P_${stamp}_${i}`,no=rows[i].meterNo,parents={lmPcode,wardPcode};
  fixture.push([`wards/${wardPcode}`,{parents:{localMunicipalityId:lmPcode},name:`Ward${i}`}],[`premises/${premiseId}`,{id:premiseId,parents,erfId:`E${i}`,erfNo:`${i}`,services:{electricityMeters:[{trnId:id}]}}],[`asts/${id}`,{id,meterType:"electricity",accessData:{parents,premise:{id:premiseId},erfNo:`${i}`},ast:{astData:{astId:id,astNo:no,meter:{type:"conventional"}}},status:{state:i===0?"CONNECTED":"DISCONNECTED"},geofenceRefs:[{id:"G1",name:"Geo"}]}],[`trns/${id}`,{id,accessData:{trnType:"METER_DISCOVERY",access:{hasAccess:"yes"}},ast:{astData:{astNo:no}}}],[`meter_master/${no}`,{refs:{asts:{id}}}]);
 }
 for(let i=0;i<fixture.length;i+=400){const b=db.batch();fixture.slice(i,i+400).forEach(([path,data])=>b.set(db.doc(path),data));await b.commit();}
 const csv=serializeCsv([OFFICIAL_HEADERS,...rows.map(r=>OFFICIAL_HEADERS.map(h=>r[h]))]);
 const source={id:digest(`${uid}:upload`),uid,lmPcode,trnType,contractVersion:BULK_CONTRACT,hash:digest(csv),fileName:"Original.csv",generation:"1"};
 await db.doc(`tc_source_files/${source.id}`).set(source);
 const data={lmPcode,trnType,selectedRowNos:rows.map(r=>r.rowNo),keep:{}};
 const [result,concurrentResult]=await Promise.all([createBulkGraph({db,uid,data,source,csv}),createBulkGraph({db,uid,data,source,csv})]);
 assert.deepEqual(concurrentResult,result);
 assert.equal(validateLifecycleInstructionEligibility({trnType,astDoc:{status:{state:"DISCONNECTED"}}}).ok,false,"individual issuance retains its status gate");
 assert.equal((await db.doc(`asts/TRN_MDIS_${stamp}_1`).get()).data().status.state,"DISCONNECTED","bulk creation must not change physical meter status");
 assert.equal(result.success,true);assert.equal(result.totalMeters,200);assert.equal(result.batches.length,200);
 assert.deepEqual(await createBulkGraph({db,uid,data,source,csv}),result);
 const parent=(await db.doc(`tc_uploads/${result.batches[0].tcId}`).get()).data();
 const trn=(await db.doc(`trns/${parent.trnIds[0]}`).get()).data();
 assert.equal(trn.workflow.state,"CREATED");assert.equal(trn.assignment.instruction.reason,undefined);assert.equal(trn.origin.trnBgo.sourceRowNo,"1");
 assert.equal(parent.sourceFileId,source.id);assert.equal((await verifyBulkInstruction({db,id:trn.id})).id,trn.id);
 assert.equal((await db.doc(`tc_source_files/${source.id}`).get()).data().committed,true);
 const row=(await db.doc(`tc_rows/${parent.rowIds[0]}`).get()).data();assert.equal(row.input.meterPhase,"");assert.equal(row.input.actionReason,undefined);assert.equal(row.input.meterNo,rows[0].meterNo);
 await t.test("another upload cannot create an active same-operation job",async()=>{
  const other={...source,id:digest(`${uid}:other`)};await db.doc(`tc_source_files/${other.id}`).set(other);
  await assert.rejects(createBulkGraph({db,uid,data:{...data,selectedRowNos:["1"]},source:other,csv}),/already exists/);
  assert.equal((await db.doc(`tc_source_files/${other.id}`).get()).data().committed,undefined);
 });
 await t.test("MD policy allocates fifteen TC parents and current TEAM member accepts existing children without a business reason",async()=>{
  const teamId=`TEAM_${stamp}`,worker=`FIELD_${stamp}`;
  await db.doc(`users/${uid}`).update({"employment.serviceProvider.id":"MNC1"});
  await db.doc(`users/${worker}`).set({accountStatus:"ACTIVE",employment:{role:"FWR",serviceProvider:{id:"SUB1"}},access:{workbases:[lmPcode]}});
  await db.doc(`teams/${teamId}`).set({status:"ACTIVE",name:"Field team",ownership:{mncServiceProviderId:"MNC1"},scope:{memberUserIds:[worker]}});
  const batchIds=result.batches.slice(0,15).map(b=>b.tcId);
  const oversized=`CAPACITY_${stamp}`;
  await db.doc(`tc_uploads/${oversized}`).set({contractVersion:BULK_CONTRACT,lmPcode,workflow:{state:"READY_FOR_ALLOCATION"},trnIds:Array.from({length:201},(_,i)=>`EXCESS_${i}`)});
  await assert.rejects(allocateTcBatches({db,request:{auth:{uid},data:{batchIds:[oversized],targetType:"TEAM",targetId:teamId}}}),/Maximum per allocation action is 200/);
  assert.equal((await db.doc(`tc_uploads/${oversized}`).get()).data().workflow.state,"READY_FOR_ALLOCATION");

  const allocated=await allocateTcBatches({db,request:{auth:{uid},data:{batchIds,targetType:"TEAM",targetId:teamId}}});assert.equal(allocated.success,true);
  const issued=(await db.doc(`trns/${parent.trnIds[0]}`).get()).data();assert.equal(issued.workflow.state,"ISSUED");assert.equal(issued.assignment.instruction.reason,undefined);
  const reply=await decideTcBatch({db,request:{auth:{uid:worker},data:{batchId:batchIds[0],action:"ACCEPT"}}});assert.equal(reply.success,true);
  assert.equal((await db.doc(`trns/${parent.trnIds[0]}`).get()).data().workflow.state,"ACCEPTED");
  await assert.rejects(decideTcBatch({db,request:{auth:{uid:worker+"-forged"},data:{batchId:batchIds[1],action:"ACCEPT"}}}),/authorized/);
  assert.equal((await verifyBulkExecution({db,uid:worker,id:issued.id})).id,issued.id);
  await db.doc(`users/${worker}`).update({"access.workbases":[]});
  await assert.rejects(verifyBulkExecution({db,uid:worker,id:issued.id}),/currently accepted/);
  await db.doc(`users/${worker}`).update({"access.workbases":[lmPcode]});
  await db.doc(`teams/${teamId}`).update({status:"DISABLED"});
  await assert.rejects(verifyBulkExecution({db,uid:worker,id:issued.id}),/currently accepted/);
  await db.doc(`teams/${teamId}`).update({status:"ACTIVE"});
  const p=(await db.doc(`tc_uploads/${batchIds[0]}`).get()).data();
  const withdrawal={batchIds:[batchIds[0]],targetType:"UNALLOCATE",reason:"Owner recalled unstarted work",expectedIssuedAt:p.workflow.issuedAt};
  await assert.rejects(allocateTcBatches({db,request:{auth:{uid},data:{...withdrawal,expectedIssuedAt:"stale"}}}),/changed/);
  await allocateTcBatches({db,request:{auth:{uid},data:withdrawal}});
  assert.equal((await db.doc(`trns/${issued.id}`).get()).data().workflow.state,"CREATED");
  await assert.rejects(verifyBulkExecution({db,uid:worker,id:issued.id}),/currently accepted/);
  await deleteModernTc({db,request:{auth:{uid},data:{tcId:batchIds[0]}}});
  assert.equal((await db.doc(`trns/${issued.id}`).get()).data().workflow.state,"DELETED");
  assert.equal((await db.doc(`tc_source_files/${source.id}`).get()).data().committed,true);
  assert.deepEqual(await createBulkGraph({db,uid,data,source,csv}),result);
 });
 await t.test("invalid selection and lost authorization do not create a graph",async()=>{
  await assert.rejects(createBulkGraph({db,uid,data:{...data,selectedRowNos:["201"]},source,csv}),/missing or dropped/);
  await db.doc(`users/${uid}`).update({accountStatus:"DISABLED"});
  await assert.rejects(createBulkGraph({db,uid,data,source,csv}),/authorized/);
 });
 assert.equal(parseSource(csv)[0].meterNo,rows[0].meterNo);
 t.diagnostic("Actual coordinator created 200 authoritative Ward parents and 200 canonical CREATED instructions in one transaction; retries returned identical mapping.");
});
